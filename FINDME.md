TODO
import json
import logging
import re
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from agents.controllers import (
    format_post_auth_response,
    get_member_first_name,
    handle_authentication,
    is_authentication_required,
)
from agents.gateway.config import (
    build_llm_model,
    get_cors_allow_origins,
    get_fastapi_root_path,
)
from agents.orchestrate_horizon.orchestrator_horizon_agent import (
    OrchestratorHorizonAgent as HorizonOrchestrator,
)
from locales import en, es
from schemas.transcript_schemas import TranscriptQueryBody
from utils.authentication.auth_session_manager import get_session_manager
from utils.constants import EMERGENCY_INTENTS, Channel
from utils.document_processor import DocumentProcessor
from utils.emergency_handler import handle_emergency_intent
from utils.horizon.horizon_token_utils import get_horizon_access_token_async
from utils.http_error_handler import APISystemError, RateLimitError
from utils.language_utils import (
    detect_auth_language_from_text,
    language_code_to_locale,
    resolve_runtime_language,
)
from utils.live_chat_api_failure_handler import getHorizonAPIFailureLiveChatPayload
from utils.locale_utils import get_localized_message
from utils.logging import AuditMiddleware, RequestContext, get_logger
from utils.memory.conversation_history import get_conversation_history_manager
from utils.response_tracker import get_response_tracker
from utils.timing_utils import format_timing
from utils.token_utils import extract_member_id
from utils.transcript_utils import (
    parse_transcript_date,
    resolve_transcript_date_range,
    validate_transcript_date_range,
)

_CONVERSATION_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")

app = FastAPI(root_path=get_fastapi_root_path())
app.add_middleware(AuditMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_cors_allow_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    )



@app.middleware("http")
async def private_network_access_middleware(request: Request, call_next):
    allowed_origins = get_cors_allow_origins()
    origin = request.headers.get("Origin", "")
    # Echo back the configured entry, never the request header itself.
    matched_origin = next((allowed for allowed in allowed_origins if allowed == origin), None)
    if matched_origin is None and "*" in allowed_origins:
        matched_origin = "*"
    origin_allowed = matched_origin is not None

    if request.method == "OPTIONS" and request.headers.get("Access-Control-Request-Private-Network"):
        if not origin_allowed:
            return JSONResponse(status_code=403, content={"detail": "Origin not allowed for private network access"})
        response = JSONResponse(status_code=204, content=None)
        response.headers["Access-Control-Allow-Origin"] = matched_origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Allow-Methods"] = "*"
        response.headers["Access-Control-Allow-Headers"] = "*"
        response.headers["Access-Control-Allow-Private-Network"] = "true"
        return response
    response = await call_next(request)
    if origin_allowed and request.headers.get("Access-Control-Request-Private-Network"):
        response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response


logger = get_logger(__name__)


def _extract_hcid_from_session(session_id: str) -> str | None:
    """
    Extract HCID (mbrLookupId) from session.
    
    Args:
        session_id: Session identifier
        
    Returns:
        HCID if found, None otherwise
    """
    session_mgr = get_session_manager()
    session = session_mgr.get_session(session_id=session_id)
    
    if not session:
        logger.info(f"[AUTH] No session found for {session_id}")
        return None
    
    if not session.member_data:
        logger.info(f"[AUTH] No member_data in session {session_id}")
        return None
    
    hcid = session.member_data.get('mbrLookupId')
    if hcid:
        logger.info(f"[AUTH] Extracted HCID: {hcid}")
    else:
        logger.info(f"[AUTH] No mbrLookupId in member_data")
    
    return hcid


def _get_member_data_from_session(
    session_id: str | None,
    phone_number: str | None,
    conversation_id: str | None,
) -> dict | None:
    """Return authenticated member_data from the auth session, if any."""
    session = get_session_manager().get_request_session(
        session_id=session_id,
        phone_number=phone_number,
        conversation_id=conversation_id,
    )
    return session.member_data if session else None


async def _resolve_auth_language(
    message_content: str,
    auth_required: bool,
    channel: str,
) -> str | None:
    if not auth_required:
        return None

    detected_language = await detect_auth_language_from_text(message_content, channel=channel)
    resolved_language = resolve_runtime_language(detected_language, channel=channel)
    logger.info(f"[AUTH_LANGUAGE] Using detected language from message text for auth: {resolved_language}")
    print(f"[AUTH_LANGUAGE] Using detected language from message text for auth: {resolved_language}")
    return resolved_language


async def _resolve_request_language(message_content: str, channel: str) -> str:
    detected_language = await detect_auth_language_from_text(message_content, channel=channel)
    resolved_language = resolve_runtime_language(detected_language, channel=channel)
    logger.info(f"[REQUEST_LANGUAGE] Using detected language from message text: {resolved_language}")
    print(f"[REQUEST_LANGUAGE] Using detected language from message text: {resolved_language}")
    return resolved_language


def _invalid_conversation_id_response(message: str) -> JSONResponse:
    return JSONResponse(
        status_code=400,
        content={
            "error": "invalid_conversation_id",
            "message": message,
            "details": "Provide a non-empty conversationId using only letters, numbers, dots, underscores, colons, or hyphens",
        },
    )


def _parse_request_conversation_id(
    data: dict[str, Any],
    payload_source: dict[str, Any],
) -> tuple[str | None, JSONResponse | None]:
    request_conversation_id = (
        data.get("conversationId")
        or data.get("conversation_id")
        or payload_source.get("conversationId")
        or payload_source.get("conversation_id")
    )
    if request_conversation_id is None:
        return None, None
    if not isinstance(request_conversation_id, str):
        return None, _invalid_conversation_id_response("conversationId must be a string when provided")
    request_conversation_id = request_conversation_id.strip() or None
    if request_conversation_id and not _CONVERSATION_ID_PATTERN.fullmatch(request_conversation_id):
        return None, _invalid_conversation_id_response("conversationId contains unsupported characters")
    return request_conversation_id, None


@app.post("/search/horizon/orchestrate")
async def search_horizon_orchestrate_api(request: Request):
    # Generate message_id FIRST and set as RID for consistent correlation
    message_id = str(uuid.uuid4())
    RequestContext.set_rid(message_id)
    RequestContext.set_message_id(message_id)
    # Store in request.state so middleware can access it (contextvars don't propagate back)
    request.state.rid = message_id
    print(f"[API] Generated message_id/RID: {message_id}")
    
    try:
        data = await request.json()
    except json.JSONDecodeError as e:
        logger.error(f"Invalid JSON in request body: {str(e)}")
        return JSONResponse(
            content={
                "title": "Invalid Request",
                "response_summary": "The request contains invalid data. Please try again.",
                "error": "invalid_json",
                "error_details": str(e)
            },
            status_code=400
        )
    is_streaming = request.headers.get("Accept", "application/json") == "text/event-stream"

    skip_llm = request.headers.get("skip_llm", "false").lower() == "true"

    # Extract message_content - it's always a string (e.g., "46204", "Hello", etc.)
    raw_message = data.get("message_content", "")
    
    # Try to parse as JSON in case it's a nested payload
    parsed_payload = None
    if isinstance(raw_message, str) and raw_message.strip().startswith('{'):
        try:
            parsed_payload = json.loads(raw_message)
        except (json.JSONDecodeError, TypeError):
            parsed_payload = None
    elif isinstance(raw_message, dict):
        parsed_payload = raw_message
    
    payload_source = parsed_payload or data
    message_content = payload_source.get("Body") or data.get("Body") or raw_message or ""
    member_id = data.get("mbrUid") or data.get("member_id") or payload_source.get("mbrUid") or payload_source.get("member_id") or ""
    channel = data.get("channel") or payload_source.get("channel") or (Channel.SMS.value if payload_source.get("Body") else None)
    from_number = data.get("from") or payload_source.get("from") or ""
    request_conversation_id, invalid_conversation_id_response = _parse_request_conversation_id(data, payload_source)
    if invalid_conversation_id_response is not None:
        return invalid_conversation_id_response
    channel = channel.strip().lower() if isinstance(channel, str) and channel.strip() else None
    
    # Validate channel presence
    if not channel:
        error_msg = "Channel is required"
        print(f"[API ERROR] {error_msg}")
        return JSONResponse(
            status_code=400,
            content={
                "error": "missing_channel",
                "message": error_msg,
                "details": "Please provide 'channel' parameter in the request"
            }
        )
    
    print(f"[API] Incoming channel value: {channel!r}")
    
    auth_header = request.headers.get("Authorization") or request.headers.get("authorization")

    if not message_content:
        return JSONResponse(status_code=400, content={"error": "Missing 'message_content' in request body."})
    
    # Extract phone number from request (From field for SMS, or header)
    phone_number = from_number or request.headers.get("X-Phone-Number") or ""
    session_id = data.get("session_id") or payload_source.get("session_id")
    logger.info(f"[API] Initial session_id from request: {session_id}, phone: {phone_number}, channel: {channel}")
    
    # Extract reset_conversation flag from header only (case-insensitive)
    reset_conversation = (
        request.headers.get("reset_conversation", "").lower() == "true" or
        request.headers.get("Reset-Conversation", "").lower() == "true"
    )
    
    if reset_conversation:
        logger.info(f"[API] Reset conversation flag detected for phone {phone_number}, channel {channel}")
    
    # Try to get member_id from auth header
    if auth_header:
        parts = auth_header.split()
        token = parts[-1] if parts else ""
        member_id = extract_member_id(token) if token else member_id

    # Initialize with defaults (used if auth is disabled)
    is_post_auth = False
    initial_message = None
    conversation_id = request_conversation_id
    hcid = None  # For demo handler (non-PHI identifier)
    
    # Set additional request context (message_id/RID already set at top of function)
    if member_id:
        RequestContext.set_member_uid(member_id)
    RequestContext.set_domain("horizon")
    RequestContext.set_channel(channel)
    if conversation_id:
        RequestContext.set_conversation_id(conversation_id)
    if phone_number:
        RequestContext.set_phone_number(phone_number)
    
    # Check if authentication is required for this channel
    auth_required = is_authentication_required(
        channel=channel,
        member_id=member_id,
        phone_number=phone_number
    )
    auth_language = await _resolve_auth_language(
        message_content=message_content,
        auth_required=auth_required,
        channel=channel,
    )
    if auth_language:
        logger.info(f"[AUTH_LANGUAGE] API resolved auth language={auth_language} for message={message_content!r}")
        RequestContext.set_language(auth_language)
    
    if auth_required:
        print(f"[AUTH] Authentication required for channel '{channel}'")
    else:
        print(f"[AUTH] Authentication not required for channel '{channel}' - proceeding directly to orchestrator")

    # Performance-test bypass: skip auth entirely when skip_llm=True.
    # The orchestrator short-circuits before any real agent/API call, so
    # no member identity is needed. Normal traffic (skip_llm=False) is unaffected.
    if skip_llm and auth_required:
        logger.info("[PERF] Auth bypass active — skipping authentication flow for performance test")
        auth_required = False

    # Only run authentication flow if required
    if auth_required:
        should_continue, authenticated_member_id, auth_response, error_response = await handle_authentication(
            phone_number=phone_number,
            message_content=message_content,
            session_id=session_id,
            language_code=auth_language,
            channel=channel,
            member_id=member_id,
            reset_conversation=reset_conversation,
            conversation_id=conversation_id,
        )
        
        if error_response:
            return error_response
        
        if not should_continue:
            # Authentication in progress - return auth response
            return error_response if error_response else JSONResponse(content=auth_response)
        
        if authenticated_member_id:
            member_id = authenticated_member_id

        is_post_auth = auth_response.get('post_auth_flow', False)
        initial_message = auth_response.get('initial_message')
        conversation_id = conversation_id or auth_response.get('conversation_id')
        
        # Use session_id from auth response (it creates/manages session)
        auth_session_id = auth_response.get('session_id')
        if auth_session_id:
            session_id = auth_session_id
            logger.info(f"[AUTH] session_id: {session_id}, conversation_id: {conversation_id}, message_id: {message_id}")
            hcid = _extract_hcid_from_session(session_id)
            if hcid:
                RequestContext.set_hcid(hcid)
    else:
        # For non-auth channels, NO session_id (no conversational memory)
        session_id = None
        print(f"[MEMORY] Non-auth channel: session_id=None (no conversational history)")
    # ============================================================================
    
    # Determine which message to process
    orchestrator_message = initial_message if (is_post_auth and initial_message) else message_content
    effective_request_language = auth_language or await _resolve_request_language(orchestrator_message, channel)
    effective_request_locale = language_code_to_locale(effective_request_language) if effective_request_language else None
  
    total_start = time.time()
    # Build a concrete HorizonModel with the channel resolved at request time.
    # This avoids LazyHorizonModel deferring channel resolution into strands' ThreadPoolExecutor
    # threads where RequestContext.get_channel() returns None.
    if effective_request_language:
        RequestContext.set_language(effective_request_language)
    try:
        horizon_model = await build_llm_model(channel=channel)
    except Exception as exc:
        logger.error(
            "[API] Failed to build Horizon model: %s",
            exc,
            exc_info=not isinstance(exc, (APISystemError, RateLimitError)),
        )
        return JSONResponse(content=await getHorizonAPIFailureLiveChatPayload(member_id, channel, effective_request_locale))

    # Initialize orchestrator with channel for channel-specific prompt loading
    orchestrator = HorizonOrchestrator(model=horizon_model, system_prompt=None, channel=channel)
    intent_start = time.time()

    # Determine if user is authenticated (has member_id after auth flow)
    authenticated = bool(member_id) if auth_required else False
    
    orchestrator_kwargs = {
        'search_query': orchestrator_message,
        'language': effective_request_language,
        'member_id': member_id,
        'channel': channel,
        'locale': effective_request_locale,
        'session_id': session_id,
        'conversation_id': conversation_id,
        'message_id': message_id,
        'authenticated': authenticated,
        'hcid': hcid,
        'skip_llm': skip_llm,
    }

    logger.info(f"[API] Calling orchestrator -> authenticated: {authenticated}, session_id: {session_id}, conversation_id: {conversation_id}, message_id: {message_id}")

    try:
        result = await orchestrator.detect_intent_and_call_agents(**orchestrator_kwargs)
        # Check if result has live_agent_connection flag - return payload directly
        if isinstance(result, dict) and result.get("live_agent_connection"):
            live_agent_payload = result.get("live_agent_payload")
            logger.info("[API] Live agent connection detected - returning payload directly")
            return JSONResponse(content=live_agent_payload)
    except Exception as exc:
        logger.error(
            "[API] Failed during Horizon orchestration: %s",
            exc,
            exc_info=not isinstance(exc, (APISystemError, RateLimitError)),
        )
        return JSONResponse(content=await getHorizonAPIFailureLiveChatPayload(member_id, channel, effective_request_locale))

    # handle the greeting intent
    if result.get("primary_intent") == "GREETING":
        locale_map = {"es_US": es.LOCALES, "en_US": en.LOCALES}
        effective_language_code = resolve_runtime_language(result.get("language_code") or effective_request_language, channel=channel)
        effective_locale = language_code_to_locale(effective_language_code)
        locale_data = locale_map.get(effective_locale, en.LOCALES)
        response_msg = result.get("response_summary", "")
        
        if authenticated:
            member_data = auth_response.get('member_data') if is_post_auth else None
            if not member_data:
                member_data = _get_member_data_from_session(session_id, phone_number, conversation_id)
            response_msg = format_post_auth_response(
                response_summary=response_msg,
                primary_intent="GREETING",
                language_code=effective_language_code,
                has_errors=False,
                member_first_name=get_member_first_name(member_data),
                is_post_auth=is_post_auth,
            )

        # Build base greeting response
        greeting_response = {
            "title": locale_data.get("general", {}).get("title"),
            "response_summary": response_msg,
            "language_code": effective_language_code,
            "primary_intent": result.get("primary_intent"),
            "blocks": [],
            "timings": {
                "Intent detection": format_timing(time.time() - intent_start),
                "Total": format_timing(time.time() - total_start)
            }
        }
        
        # Add SMS-specific fields if SMS channel
        normalized_channel = (channel or "").strip().lower() if channel else None
        is_sms_channel = normalized_channel == Channel.SMS.value
        if is_sms_channel:
            greeting_response["authenticated"] = True if member_id else False
            greeting_response["post_auth_flow"] = is_post_auth
            greeting_response["conversation_id"] = conversation_id
        
        return JSONResponse(content=greeting_response)

    # handle emergency / safety intents inline — no downstream agent call
    if result.get("primary_intent") in EMERGENCY_INTENTS:
        emergency_result = handle_emergency_intent(
            primary_intent=result.get("primary_intent"),
            response=result,
            channel=channel,
            intent_time=round(time.time() - intent_start, 3),
            total_start=total_start,
            message_id=message_id,
            member_id=member_id,
            authenticated=authenticated,
            post_auth_flow=is_post_auth,
            conversation_id=conversation_id,
            locale=language_code_to_locale(resolve_runtime_language(result.get("language_code") or effective_request_language, channel=channel)),
        )
        return JSONResponse(content=emergency_result)

    # Get response summary
    response_summary = result.get("response_summary", "")

    # Add auth success prefix if post-auth flow
    if is_post_auth:
        primary_intent = result.get("primary_intent")
        has_errors = result.get("error") or False
        effective_language_code = resolve_runtime_language(result.get("language_code") or auth_language, channel=channel)
        
        # For unidentified intents, use personalized greeting instead of empty/generic response
        if primary_intent == "unidentified" and not response_summary:
            primary_intent = "GREETING"
            
        response_summary = format_post_auth_response(
            response_summary=response_summary,
            primary_intent=primary_intent,
            language_code=effective_language_code,
            has_errors=has_errors,
            member_first_name=get_member_first_name(auth_response.get('member_data')),
            is_post_auth=True,
        )
    # Normalize channel for comparison
    normalized_channel = (channel or "").strip().lower() if channel else None
    is_sms_channel = normalized_channel == Channel.SMS.value

    # Base response fields (always included)
    response = {
        "title": result.get("title", ""),
        "response_summary": response_summary,
        "language_code": resolve_runtime_language(result.get("language_code", effective_request_language), channel=channel),
        "primary_intent": result.get("primary_intent"),
        "member_id": result.get("member_id"),  # Include member_id
        "conversation_id": result.get("conversation_id"),  # Include conversation_id for direct access
        "blocks": result.get("blocks", []),
        "timings": result.get("timings", {})  # Use timings dict from orchestrator (includes only active agents)
    }

    # Only include these fields for SMS channel
    if is_sms_channel:
        response["authenticated"] = True if member_id else False
        response["post_auth_flow"] = is_post_auth
        response["conversation_id"] = conversation_id

    # Only include secondary_intent if it exists (omit for SMS channel)
    if result.get("secondary_intent") is not None:
        response["secondary_intent"] = result.get("secondary_intent")

    def event_stream(data):
        yield f"data: {{\"kind\": \"start\"}}\n\n"
        yield f"data: {{\"kind\": \"cot\",  \"data\": {{\"text\": \"analysing informations\"}}}}\n\n"
        time.sleep(2)
        
        yield f"data: {{\"kind\": \"cot\",  \"data\": {{\"text\": \"loading your profile details\"}}}}\n\n"
        time.sleep(2)
        yield f"data: {{\"kind\": \"title\",  \"data\": {{\"text\": {json.dumps(response.get('title', ''))}}}}}\n\n"
        blocks = response.get('blocks') or []
        response_summ = response.get('response_summary', '')
        
        yield f"data: {{\"kind\": \"summary\",  \"data\": {{\"text\": {json.dumps(response_summ)}}}}}\n\n"
        sms_text = response.get('sms_summary', '')
        if sms_text:
            yield f"data: {{\"kind\": \"sms_summary\",  \"data\": {{\"text\": {json.dumps(sms_text)}}}}}\n\n"
    def filter_response(data):
            # Generic response filtering - no agent-specific logic
            # The orchestrator has already provided the correct response_summary,
            # and it was already formatted with post-auth message above (lines 354-369)
            
            # Base response fields (always included)
            final_response = {
                "title": data.get('title', ''),
                "response_summary": data.get('response_summary', ''),  # Use orchestrator's summary directly
                "language_code": resolve_runtime_language(data.get('language_code', effective_request_language), channel=channel),
                "primary_intent": data.get('primary_intent'),
                "timings": data.get('timings', {})
            }
            
            # Only include these fields for SMS channel
            if is_sms_channel:
                final_response["authenticated"] = data.get('authenticated')
                final_response["post_auth_flow"] = data.get('post_auth_flow')
                final_response["conversation_id"] = data.get('conversation_id')
            
            # Only include secondary_intent if it exists (omit for SMS channel)
            if data.get('secondary_intent') is not None:
                final_response["secondary_intent"] = data.get('secondary_intent')
            return final_response
    if is_streaming:
        return StreamingResponse(event_stream(response), media_type="text/event-stream")
    else:
        return JSONResponse(content=filter_response(response))

@app.get("/health")
async def health_check():
    """Health check endpoint for Kubernetes liveness and readiness probes"""
    return {"status": "healthy", "service": "virtual-assistant-api"}

@app.get("/data")
async def get_response_data_api_query(message_id: str = Query(...)):
    """
    GET endpoint with query parameters for React to retrieve raw JSON data from database (DynamoDB/in-memory).
    Returns raw JSON from APIs (findcare, benefits, claims) and SMS summary.

    Missing data returns HTTP 404. Existing links that exceed LINK_TTL_SECONDS or LINK_MAX_CLICKS return HTTP 410.

    Args:
        message_id: Unique message/conversation identifier (query param)

    Returns:
        JSON response with raw data

    Example:
        GET http://localhost:8000/virtual-assistant/data?message_id=2270c584
    """
    try:
        print(f"[DATA API] GET request for message_id={message_id}")

        tracker = get_response_tracker()
        response_data = tracker.get_response_data(message_id)

        if not response_data:
            print(f"[DATA API] No data found for message_id={message_id}")
            raise HTTPException(
                status_code=404,
                detail=f"No data found for message_id={message_id}"
            )

        allowed, language = tracker.record_link_access(message_id)
        if not allowed:
            raise HTTPException(
                status_code=410,
                detail={
                    "error": "link_expired",
                    "language": language,
                    "message": get_localized_message("link_access", "link_expired_message", language=language),
                },
            )
        
        # Check for errors in data blocks
        has_errors = False
        data_blocks = response_data.get('data', [])
        if isinstance(data_blocks, list):
            for block in data_blocks:
                if isinstance(block, dict):
                    # Check for errors
                    if block.get('has_errors') or (block.get('errors') and len(block.get('errors', [])) > 0):
                        has_errors = True
                        break
        

        
        status_msg = "⚠️  Retrieved with errors" if has_errors else "✅ Successfully retrieved data"
        print(f"[DATA API] {status_msg} for message_id={message_id}")
        
        return JSONResponse(
            status_code=200,
            content={
                "success": not has_errors,
                "data": response_data
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"[DATA API] Error retrieving data: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail="Error retrieving data. Please try again later."
        )

@app.post("/chat/transcripts")
async def get_member_transcripts(request: Request, body: TranscriptQueryBody) -> JSONResponse:
    """Return grouped transcript conversations for a member.

    Unified Desktop calls this endpoint through the secured UAT/prod gateway
    with an access token.  No authentication logic is required here; security
    is handled externally by the platform.

    Conversations are grouped by session-level ``conversationId`` and ordered
    newest-first.  Each conversation contains the member's original query and
    the AI SMS summary for each turn.

    ``startDate``/``endDate`` are interpreted in the system default time zone
    when they do not carry an explicit UTC offset, then converted to GMT/UTC
    before the store is queried since transcript timestamps are persisted in UTC.

    The backing store is queried via a config-driven DynamoDB GSI Query when
    available, with an automatic fallback to in-memory storage when DynamoDB is
    unavailable. The retrieval implementation remains isolated so the API
    contract stays unchanged.

    Args:
        request: FastAPI request for the current API call.
        body: JSON request body.  ``mbrUid`` is mandatory; all other fields
            are optional.  See ``TranscriptQueryBody`` for full field docs.

    Returns:
        JSONResponse: ``{"memberId": ..., "conversations": [...], "pagination": {...}}``

    Raises:
        HTTPException: 422 when ``mbrUid`` is absent (Pydantic validation).
        HTTPException: 400 when ``mbrUid`` is blank or whitespace-only.
        HTTPException: 400 when date strings are unparseable or startDate > endDate.
        HTTPException: 500 on unexpected tracker failures.
    """
    request_rid = getattr(request.state, "rid", None) or str(uuid.uuid4())
    RequestContext.set_rid(request_rid)
    # Store in request.state so middleware can access it (contextvars don't propagate back)
    request.state.rid = request_rid

    failure_stage = "validate_member_id"
    try:
        if not body.mbrUid.strip():
            raise HTTPException(status_code=400, detail="mbrUid must not be blank")

        failure_stage = "parse_start_date"
        start_dt = (
            parse_transcript_date(body.startDate, "startDate", bound="start")
            if body.startDate
            else None
        )
        failure_stage = "parse_end_date"
        end_dt = (
            parse_transcript_date(body.endDate, "endDate", bound="end")
            if body.endDate
            else None
        )
        failure_stage = "validate_date_range"
        if start_dt and end_dt and start_dt >= end_dt:
            raise HTTPException(
                status_code=400,
                detail="startDate must be before endDate",
            )
        validate_transcript_date_range(start_dt, end_dt)
        failure_stage = "resolve_date_range"
        start_dt, end_dt = resolve_transcript_date_range(start_dt, end_dt)

        failure_stage = "query_by_member"
        tracker = get_response_tracker()
        result = tracker.query_by_member(
            member_id=body.mbrUid,
            conversation_id=body.conversationId,
            start_date=start_dt,
            end_date=end_dt,
        )
        logger.info(
            "[TRANSCRIPTS] Transcript request succeeded",
            HttpStatus=200,
        )
        return JSONResponse(
            status_code=200,
            content={
                "memberId": body.mbrUid,
                "conversations": result.get("conversations", []),
                "pagination": result.get("pagination", {}),
            },
        )
    except HTTPException as exc:
        logger.error(
            "[TRANSCRIPTS] Transcript request failed",
            FailureStage=failure_stage,
            HttpStatus=exc.status_code,
        )
        raise
    except Exception as exc:
        logger.error(
            "[TRANSCRIPTS] Transcript request failed",
            FailureStage=failure_stage,
            HttpStatus=500,
        )
        raise HTTPException(status_code=500, detail="Error retrieving transcripts. Please try again later.") from exc


@app.get("/test/dynamodb/connection")
async def test_dynamodb_connection():
    """
    Test DynamoDB connection - runs connection tests and returns results
    Useful for cloud deployment verification
    """
    test_script = Path(__file__).parent.parent / "tests" / "integration" / "test_dynamodb_connection.py"
    
    if not test_script.exists():
        return JSONResponse(
            status_code=404,
            content={
                "status": "error",
                "message": f"Test script not found: {test_script}"
            }
        )
    
    try:
        # Run the test script and capture output
        result = subprocess.run(
            [sys.executable, str(test_script)],
            capture_output=True,
            text=True,
            timeout=30
        )
        
        # Parse TEST_RESULT lines from output
        test_results = []
        for line in result.stdout.split('\n'):
            if 'TEST_RESULT:' in line:
                try:
                    json_str = line.split('TEST_RESULT:')[1].strip()
                    test_results.append(json.loads(json_str))
                except (json.JSONDecodeError, IndexError, ValueError) as e:
                    logging.warning(f"Failed to parse TEST_RESULT line: {line[:100]}... Error: {e}")
        
        return JSONResponse(content={
            "status": "completed" if result.returncode == 0 else "failed",
            "exit_code": result.returncode,
            "test_results": test_results,
            "stdout": result.stdout,
            "stderr": result.stderr
        })
    except subprocess.TimeoutExpired:
        return JSONResponse(
            status_code=408,
            content={
                "status": "timeout",
                "message": "DynamoDB connection test timed out after 30 seconds"
            }
        )
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": str(e),
                "error_type": type(e).__name__
            }
        )

@app.post("/test/dynamodb/setup")
async def setup_dynamodb_table():
    """
    Create DynamoDB table if it doesn't exist
    Returns table information or creation status
    """
    setup_script = Path(__file__).parent.parent / "tests" / "integration" / "setup_dynamodb_table.py"
    
    if not setup_script.exists():
        return JSONResponse(
            status_code=404,
            content={
                "status": "error",
                "message": f"Setup script not found: {setup_script}"
            }
        )
    
    try:
        # Run the setup script and capture output
        result = subprocess.run(
            [sys.executable, str(setup_script)],
            capture_output=True,
            text=True,
            timeout=60  # Table creation can take longer
        )
        
        # Parse JSON_RESULTS from output
        json_results = None
        for line in result.stdout.split('\n'):
            if 'JSON_RESULTS:' in line:
                try:
                    json_str = line.split('JSON_RESULTS:')[1].strip()
                    json_results = json.loads(json_str)
                except (json.JSONDecodeError, IndexError, ValueError) as e:
                    logging.warning(f"Failed to parse JSON_RESULTS line: {line[:100]}... Error: {e}")
        
        return JSONResponse(content={
            "status": "completed" if result.returncode == 0 else "failed",
            "exit_code": result.returncode,
            "results": json_results,
            "stdout": result.stdout,
            "stderr": result.stderr
        })
    except subprocess.TimeoutExpired:
        return JSONResponse(
            status_code=408,
            content={
                "status": "timeout",
                "message": "DynamoDB table setup timed out after 60 seconds"
            }
        )
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": str(e),
                "error_type": type(e).__name__
            }
        )

@app.get("/test/connections/all")
async def test_all_connections():
    """
    Test all connections (DynamoDB) and return combined results
    """
    dynamodb_result = await test_dynamodb_connection()
    
    return JSONResponse(content={
        "dynamodb": dynamodb_result.body.decode() if hasattr(dynamodb_result, 'body') else dynamodb_result,
        "timestamp": datetime.now(timezone.utc).isoformat()
    })


@app.post("/document/upload", tags=["Document Processing"])
async def upload_document(
    file: UploadFile = File(...),
    session_id: str = Form(...),
    channel: str | None = Form(default="sms"),
):
    """
    Upload and process document for SMS users
    
    Supports images (jpeg, png, webp, gif)
    
    Args:
        file: Image or document file (jpeg, png, webp, gif)
        session_id: Session ID from SMS conversation
        
    Returns:
        Processing result with claim numbers and extracted data
    """
    logger = get_logger(__name__)
    
    try:
        logger.info(f"[DOCUMENT_UPLOAD] Received upload for session {session_id}")
        
        # Validate session exists in conversation history
        # Use the same singleton instance that the orchestrator used to save history
        history_manager = get_conversation_history_manager(channel=channel)
        
        # Check if session has history
        if not history_manager.has_history(session_id=session_id):
            raise HTTPException(
                status_code=403,
                detail="Invalid session. Please request upload link from SMS first."
            )
        
        # Get most recent IMAGE_UPLOAD_REQUEST from history
        upload_request = history_manager.get_last_entry_by_intent(
            session_id=session_id,
            intent="IMAGE_UPLOAD_REQUEST"
        )
        
        if not upload_request:
            raise HTTPException(
                status_code=403,
                detail="No upload request found. Please request upload link from SMS first."
            )
        
        # Rate limiting check (check timestamp of last upload)
        last_upload_confirm = history_manager.get_last_entry_by_intent(
            session_id=session_id,
            intent="IMAGE_UPLOAD_CONFIRMATION"
        )
        
        if last_upload_confirm:
            upload_time = datetime.fromisoformat(last_upload_confirm['timestamp'])
            if (datetime.now() - upload_time).total_seconds() < 120:  # 2 min
                raise HTTPException(
                    status_code=429,
                    detail="Please wait 2 minutes between uploads"
                )
        
        # Validate file type
        allowed_types = [
            # Images
            "image/jpeg", "image/png", "image/webp", "image/gif",
            # Documents
            "application/pdf",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",  # docx
            "application/msword",  # doc
        ]
        if file.content_type not in allowed_types:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type. Allowed: images (jpeg, png, webp, gif) and documents (pdf, docx, doc)"
            )
        
        # Validate file size (10MB max)
        file_content = await file.read()
        if len(file_content) > 10 * 1024 * 1024:
            raise HTTPException(
                status_code=400,
                detail="File size exceeds 10MB limit"
            )
        
        logger.info(f"[DOCUMENT_UPLOAD] Processing {file.filename} ({len(file_content)} bytes) - type: {file.content_type}")
        
        # Process document with Horizon API
        access_token = await get_horizon_access_token_async(channel=channel)
        processor = DocumentProcessor(access_token=access_token, channel=channel)
        result = await processor.process_document(file_content, file.filename)
        
        identifier_id = result.get('identifierId')
        record_type = result.get('record_type', 'document')
        logger.info(
            f"[DOCUMENT_UPLOAD] identifierId={identifier_id}, "
            f"record_type={record_type}, confidence={result.get('confidence')}"
        )
        
        # Save to conversation history
        history_manager.add_conversation(
            session_id=session_id,
            query="[Document uploaded]",
            response_summary=f"Uploaded {record_type} document - identifier: {identifier_id}",
            intent="IMAGE_UPLOAD_CONFIRMATION",
            conversation_id=upload_request.get('conversation_id'),
            member_id=upload_request.get('member_id'),
            extra_data={'uploaded_document': result}
        )
        
        logger.info(f"[DOCUMENT_UPLOAD] Document saved to history for session {session_id}")
        
        # Return success
        return JSONResponse({
            "success": True,
            "message": f"Document uploaded successfully! {record_type}: {identifier_id}.\n\nPlease type 'uploaded' in SMS to continue.",
            "identifier": identifier_id,
            "record_type": record_type,
            "primary_intent": result.get('primary_intent'),
            "confidence": result.get('confidence')
        })
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[DOCUMENT_UPLOAD] Error: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Error processing document: {str(e)}"
        )


============================================================================================================

import asyncio
import json
import time
from typing import Optional

from dotenv import load_dotenv
from pydantic import BaseModel
from strands import Agent
from toon import encode

from agents.gateway.config import get_llm_base_url
from agents.planner_agent import PlannerAgent
from models.horizon.horizon_model import HorizonModel
from prompts.agent_prompts import (
    HORIZON_SUMMARIZER_PROMPTS,
    JSON_ENFORCER_PROMPTS,
    load_channel_prompt,
)
from utils.constants import Channel, Intent
from utils.horizon.horizon_token_utils import get_horizon_access_token
from utils.horizon_structures import call_horizon_structures
from utils.language_utils import normalize_language_code
from utils.logging.request_context import RequestContext

load_dotenv()

WRITER_RESPONSE_SCHEMA = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "type": "object",
    "properties": {
        "title": {"type": "string", "description": "Brief title for the response"},
        "summary": {"type": "string", "description": "The summary text"}
    },
    "required": ["title", "summary"],
    "additionalProperties": False
}

async def async_summarize_blocks_horizon(blocks, specialty, language="en", channel: str | None = None, primary_intent=None, secondary_intent=None, member_id: str | None = None):
    # Log blocks BEFORE processing
    print(f"\n{'='*80}")
    print(f"[SUMMARIZE] BEFORE PROCESSING - Total blocks received: {len(blocks) if isinstance(blocks, list) else 0}")
    try:
        print(f"[SUMMARIZE] Raw blocks payload:\n{json.dumps(blocks, indent=2, ensure_ascii=False, default=str)}")
    except Exception as e:
        print(f"[SUMMARIZE] Unable to serialize raw blocks payload: {e}")
        print(f"[SUMMARIZE] Raw blocks repr: {blocks!r}")
    print(f"[SUMMARIZE] Specialty: {specialty}, Language: {language}, Channel: {channel}")
    print(f"[SUMMARIZE] Primary Intent: {primary_intent}, Secondary Intent: {secondary_intent}")
    print(f"{'='*80}")
    
    if isinstance(blocks, list):
        for idx, block in enumerate(blocks, 1):
            print(f"\n[SUMMARIZE] Block #{idx}:")
            # Log agent metadata
            if isinstance(block, dict):
                agent_name = block.get('_agent_name', 'unknown')
                priority = block.get('_intent_priority', 'unknown')
                print(f"[SUMMARIZE]   - Agent: {agent_name}, Priority: {priority}")
                # Check for extracted_text attribute
                if "extracted_text" in block:
                    #CLAIMS SUBMISSION AGENT - DEEP LINK UPDATE in the response
                    if agent_name == Intent.CLAIMS_SUBMISSION.value:
                        # Updating the deeplink dynamically using Member id and brand code.
                        from utils.summarizers.summarizer_util import getDeepLink
                        direct_response_text = await getDeepLink(member_id, block.get('extracted_text'), channel)
                        block['extracted_text'] = direct_response_text

                    print(f"[SUMMARIZE]   - Has 'extracted_text': {block.get('extracted_text')}")
            # Log full block structure
            print(f"[SUMMARIZE]   - Full block data: {json.dumps(block, indent=2, ensure_ascii=False)}")
    else:
        print(f"[SUMMARIZE] WARNING: blocks is not a list, type={type(blocks)}")
    
    print(f"\n{'='*80}\n")
    
    try:
        if not isinstance(blocks, list):
            blocks = []
        
        # Handle empty blocks case - return early with appropriate message
        if not blocks:
            print("[SUMMARIZE] Warning: No blocks data available for summarization")
            normalized_channel = (channel or "").strip().lower() if channel else None
            if normalized_channel == Channel.SMS.value:
                return {
                    "title": "Benefits Info",
                    "summary": "Processing your request. Try again or contact support."
                }
            else:
                return {
                    "title": "Benefits Information",
                    "summary": "We're currently processing your benefits information. Please try again in a moment, or contact our support team for immediate assistance with your coverage questions."
                }
        blocks_data = encode(blocks)
        # print(f"Encoded blocks: {blocks_data}")
        # blocks_json = json.dumps(blocks, ensure_ascii=False)
    except Exception as e:
        print(f"[SUMMARIZE] Error encoding blocks: {e}")
        blocks_data = "[]"
    normalized_channel = (channel or "").strip().lower() if channel else None
    
    
    # For web/virtual-assistant, use LLM summarizer with full instruction
    print("[SUMMARIZER] Using FULL instruction (detailed format with LLM)")
    summary_instruction = HORIZON_SUMMARIZER_PROMPTS['full_instruction']
    
    # Build writer prompt from YAML template
    writer_prompt = HORIZON_SUMMARIZER_PROMPTS['prompt'].format(
        language=language,
        summary_instruction=summary_instruction,
        blocks_data=blocks_data,
        channel=normalized_channel or 'virtual-assistant'
    )
    
    # Build complete prompt with system instructions
    system_prompt = JSON_ENFORCER_PROMPTS['system_prompt']
    full_prompt = f"{system_prompt}\n\n{writer_prompt}"

    async def get_summary():
        # Use Horizon structures API for reliable JSON responses (avoids truncation)
        print("[SUMMARIZE] Using Horizon structures API for reliable JSON output")
        if normalized_channel == Channel.SMS.value:
            print("[SUMMARIZE] SMS mode: Enforcing 55 token limit for 180 char constraint")
        
        try:
            # For SMS: max_tokens=55 enforces ~180 char limit (1 token ≈ 3.75 chars)
            # Using 55 tokens to have buffer under 200 chars
            max_tokens = 55 if normalized_channel == Channel.SMS.value else None
            
            result_dict = await call_horizon_structures(
                full_prompt,
                WRITER_RESPONSE_SCHEMA,
                30,  # timeout
                max_tokens,  # token limit for SMS
                normalized_channel,
            )
            
            # Parse into WriterResponse model
            if result_dict:
                result = WriterResponse(
                    title=result_dict.get("title", ""),
                    summary=result_dict.get("summary", "")
                )
                return result
            return None
            
        except Exception as e:
            print(f"[SUMMARIZE] Error calling structures API: {e}")
            return None
            
    writer_response = await get_summary()
    title = getattr(writer_response, 'title', '') if writer_response else ''
    full_summary = getattr(writer_response, 'summary', '') if writer_response else ''
    
    # Log AFTER summarization
    print(f"\n{'='*80}")
    print(f"[SUMMARIZE] AFTER PROCESSING - Summary Generated")
    print(f"{'='*80}")
    print(f"[SUMMARIZE] Channel: {normalized_channel}")
    print(f"[SUMMARIZE] Title: {title}")
    print(f"[SUMMARIZE] Summary Length: {len(full_summary)} characters")
    print(f"[SUMMARIZE] Summary Content:\n{full_summary}")
    if normalized_channel == Channel.SMS.value:
        if len(full_summary) > 200:
            print(f"[SUMMARIZE] ❌❌❌ CRITICAL: SMS EXCEEDS 200 CHARS: {len(full_summary)}/200")
            print(f"[SUMMARIZE] LLM FAILED TO FOLLOW PROMPT! CHECK max_tokens AND PROMPT INSTRUCTIONS!")
        else:
            print(f"[SUMMARIZE] ✅ SMS within limit: {len(full_summary)}/200 chars (via 55 token limit + strong prompt)")
    print(f"{'='*80}\n")
    
    # Provide fallback if summary generation failed
    if not title and not full_summary:
        if normalized_channel == Channel.SMS.value:
            title = "Benefits Info"
            full_summary = "Error generating summary. Try again or contact support."  # 54 chars
        else:
            title = "Your Healthcare Information"
            full_summary = "We apologize, but we're experiencing technical difficulties generating your personalized summary. Please try again in a moment, or contact our support team for immediate assistance."
    
    return {
        "title": title,
        "summary": full_summary
    }

# --- Sync version for CLI ---
def summarize_blocks_horizon(blocks, specialty, language="en", channel: str | None = None, primary_intent=None, secondary_intent=None, member_id: str | None = None):
    coro = async_summarize_blocks_horizon(blocks, specialty, language, channel, primary_intent, secondary_intent, member_id)
    return asyncio.run(coro)


# --- API-compatible sync function for FastAPI ---
def detect_intent_and_call_tools_horizon(search_query: str):
    start_time = time.time()
    # Strict JSON enforcement to system prompt from YAML
    system_prompt_strict_json = JSON_ENFORCER_PROMPTS['system_prompt']
    async def get_intent():
        result = None
        gen = model.structured_output(
            output_model=HealthCareAgent,
            prompt=search_query,
            system_prompt=system_prompt_strict_json
        )
        async for event in gen:
            if 'output' in event:
                result = event['output']
                break
        return result
    response = asyncio.run(get_intent())
    language = normalize_language_code(getattr(response, "language", "en"))
    RequestContext.set_language(language)
    intent_time = time.time() - start_time
    results = []
    planner = PlannerAgent()
    plans = planner.plan(response)
    with ThreadPoolExecutor() as executor:
        futures = []
        tool_map = {
            'findcare': lambda *args, **kwargs: call_findcare_tool(*args, **kwargs)
        }
        for plan in plans:
            tool_func = tool_map.get(plan['agent'])
            if tool_func:
                fut = executor.submit(tool_func, *plan['args'])
                futures.append((plan['label'], fut, plan['agent']))
        for label, future, agent_type in futures:
            try:
                result = future.result()
                results.append(result)
            except Exception as e:
                results.append(None)
    blocks = [r for r in results if r and isinstance(r, dict)]
    return {
        "intent_response": response,
        "blocks": blocks,
        "intent_time": intent_time,
        "language_code": language,
    }

class WriterResponse(BaseModel):
    title: str = ""
    summary: str = ""

### Added benefitExplainability field for gateway routing
class HealthCareAgent(BaseModel):
    primary_intent: str
    secondary_intent: Optional[str] = None
    clarification_question: Optional[str] = None
    routing_response: Optional[str] = None
    claim_type_filter: Optional[str] = None  # For CLAIMS_DETAIL filters (MEDICAL, DENTAL, VISION, PHARMACY)
    member_name_filter: Optional[str] = None  # Member name filtering (LLM-based) for claims/pharmacy
    provider_name_filter: Optional[str] = None  # Provider name filtering (LLM-based)
    network_filter: Optional[str] = None  # Network filtering (IN_NETWORK, OUT_OF_NETWORK)
    status_filter: Optional[str] = None  # Shared status filtering for claims/pharmacy
    pharmacy_sub_intent: Optional[str] = None
    pharmacy_filter_drug: Optional[str] = None
    pharmacy_my_orders: Optional[bool] = None
    single_latest_claim_flag: Optional[bool] = False
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    date_range_label: Optional[str] = None
    specialty: str
    service_name: Optional[str]  # Service name for Benefits Explainability
    planName: str
    benefitsType: str
    placeOfService: str
    network: str
    confidence: float
    language: str = "en"
    benefitExplainability: bool = False  
    #Claim benefits fields
    ciw_inq_number: Optional[str]=None
    # TODO BillPay fields
    billpay_type: Optional[str] = None  # 'quick' (premium), 'doctor' (medical bills), 'undefined'
    dcn: Optional[str] = None
    # Member & date range filters
    member_relationship_filter: Optional[str] = None  # Relationship: "self", "spouse", "child", "daughter", "son", etc.
    member_gender_filter: Optional[str] = None  # Gender: "male" or "female" (strict enum)
    member_age_criteria: Optional[str] = None  # Age criteria: "youngest", "oldest", "first", "last" (strict enum)
    selection_index: Optional[int] = None  # Numbered selection from list: "number 2" → 2
    timeframe_months: Optional[int] = None  # Timeframe: 3, 6, 12, or 24 months
    is_custom_timeframe: Optional[bool] = None  # True when start_date AND end_date both present
    id_card_sub_group_id: Optional[str] = None  # Pre-selected subGroupId after ID card resolution enrichment (ID_CARD only)
    id_card_record_id: Optional[str] = None  # Pre-selected recordId after ID card resolution enrichment (ID_CARD only)
    id_card_system_id: Optional[str] = None  # Pre-selected systemId after ID card resolution enrichment (ID_CARD only)
    id_card_mbr_uid: Optional[str] = None  # Pre-selected mbrUid after member-selection enrichment (ID_CARD only)
    user_consent_email: Optional[str] = None  # Email confirmation response: "Yes", "No", or None (ID_CARD_EMAIL only)
    user_consent_address: Optional[str] = None  # Address confirmation response: "Yes", "No", or None (ID_CARD_MAIL only)
    user_consent_live_agent: Optional[str] = None  # Live Agent transfer response: "Yes", "No", or None (ID_CARD when has_chat=True)
    query_in_english: Optional[str] = None  # English translation of a Spanish follow-up query for BeCA routing (CLAIMS_DETAIL only)



_tool_access_token: str | None = None
_horizon_model: HorizonModel | None = None


def _resolve_horizon_channel() -> str:
    resolved_channel = (RequestContext.get_channel() or "").strip().lower()
    if not resolved_channel:
        raise ValueError("Request channel is required for Horizon operations")
    return resolved_channel


def _get_tool_access_token() -> str:
    global _tool_access_token
    if _tool_access_token in (None, "INVALID TOKEN"):
        _tool_access_token = _get_horizon_tool_access_token()
    return _tool_access_token


def _get_horizon_tool_access_token() -> str:
    return get_horizon_access_token(channel=_resolve_horizon_channel())


def _get_horizon_model() -> HorizonModel | None:
    global _horizon_model
    resolved_channel = _resolve_horizon_channel()
    token = _get_horizon_tool_access_token()
    if token == "INVALID TOKEN" or not token:
        return None
    base_url = get_llm_base_url(channel=resolved_channel)
    if _horizon_model is None:
        _horizon_model = HorizonModel(token, base_url=base_url, channel=resolved_channel)
    else:
        # Refresh the model's token if it changed or is rotated
        _horizon_model.access_token = token
        _horizon_model.base_url = str(base_url or "").strip().rstrip("/")
        _horizon_model.channel = resolved_channel
    return _horizon_model


class LazyHorizonModel:
    """Proxy that defers HorizonModel construction until first use."""

    def __getattr__(self, item):
        model = _get_horizon_model()
        if model is None:
            raise RuntimeError("Horizon model unavailable (token fetch failed)")
        return getattr(model, item)


def _get_initial_system_prompt() -> str:
    resolved_channel = (RequestContext.get_channel() or "").strip().lower()
    if not resolved_channel:
        return ""
    return load_channel_prompt(resolved_channel)


lazy_horizon_model = LazyHorizonModel()

agent = Agent(
    model=lazy_horizon_model,
    system_prompt=_get_initial_system_prompt(),
)

if __name__ == "__main__":
    while True:
        search_query = input("How can I assist you (or type 'exit' to quit): ")
        if search_query.lower() == "exit":
            print("Goodbye! Have a great day!")
            break
        overall_start_time = time.time()
        start_time = time.time()
        # Strict JSON enforcement to system prompt from YAML
        system_prompt_strict_json = JSON_ENFORCER_PROMPTS['intent_extraction_prefix'] + "\n" + agent.system_prompt
        async def get_intent():
            result = None
            model_instance = _get_horizon_model()
            if model_instance is None:
                return None
            gen = model_instance.structured_output(
                output_model=HealthCareAgent,
                prompt=search_query,
                system_prompt=system_prompt_strict_json
            )
            async for event in gen:
                if 'output' in event:
                    result = event['output']
                    break
            return result
        response = asyncio.run(get_intent())
        intent_time = time.time() - start_time
        print(f"[INFO] Intent detection timing: {intent_time:.2f} seconds")
        print(f"Primary Intent: {getattr(response, 'primary_intent', None)}")
        if getattr(response, 'secondary_intent', None):
            print(f"Secondary Intent: {getattr(response, 'secondary_intent', None)}")
        print(f"Specialty: {getattr(response, 'specialty', None)}\nConfidence: {getattr(response, 'confidence', None)}")
        print(f"Plan Name: {getattr(response, 'planName', None)}")
        print(f"Benefits Type: {getattr(response, 'benefitsType', None)}")
        print(f"Place of service: {getattr(response, 'placeOfService', None)}")
        print(f"Network: {getattr(response, 'network', None)}")
        blocks = []

        print("\nSummarizing response...\n")
        summary_result = summarize_blocks_horizon(
            blocks,
            getattr(response, "specialty", "unidentified"),
            normalize_language_code(getattr(response, "language", "en")),
            member_id=None,
        )
        final_response = {
            "title": summary_result["title"],
            "response_summary": summary_result["summary"],
            "blocks": blocks
        }
        print("\n\nFinal Response...\n")
        print(json.dumps(final_response, indent=2, ensure_ascii=False))
        overall_end_time = time.time()
        total_time = overall_end_time - overall_start_time
        print(f"\n[INFO] Total time: {total_time:.2f} seconds")

=============================================================================================================

import logging

from agents.gateway.config import get_config
from utils.claims.eob_constants import PLAN_LABEL_CLAIMS_ACCESS_DENIED
from utils.constants import Channel, GatewayAction, Intent
from utils.coverage_period import CoveragePeriodClient, transform_coverage_response
from utils.eligibility.eligibility_client import EligibilityClient
from utils.features.features import Feature
from utils.live_chat_integration_topic import LiveChatTopics, setLiveChatTopic
from utils.live_chat_util import getLiveAgentPlan
from utils.locale_utils import get_localized_message
from utils.logging.request_context import RequestContext
from utils.member_services import MemberResolver
from utils.planner_utils import (
    AgentIntents,
    getBenefitsPlan,
    getBillPayPlan,
    getClaimsDetailPlan,
    getClaimsSubmissionPlan,
    getFindCarePlan,
    getIdCardPlan,
    getPharmacyPlan,
    getPlanInfoPlan,
    getPriorAuthPlan,
    getSpendingAccountPlan,
)
from utils.shared.redis_cache import get_cache_client
from utils.tmv_utils import getImagingInquiryPlan, getSymptomInquiryPlan

logger = logging.getLogger(__name__)

# Intent to Live Chat Topic mapping
INTENT_TO_LIVE_CHAT_TOPIC = {
    Intent.BENEFITS_OVERVIEW.value: LiveChatTopics.BENEFITS_AND_COVERAGE,
    Intent.REVIEW_PROVIDERS.value: LiveChatTopics.FIND_A_DOCTOR,
    Intent.PHARMACY.value: LiveChatTopics.PHARMACY_BENEFITS_AND_CLAIMS,
    Intent.PROFILE_OVERVIEW.value: LiveChatTopics.OTHER_GENERAL_SERVICE,
    Intent.SPENDING_ACCOUNT.value: LiveChatTopics.OTHER_GENERAL_SERVICE,
    Intent.BILLPAY.value: LiveChatTopics.PAYMENT_ASSISTANCE,
    Intent.PLAN_INFO.value: LiveChatTopics.BENEFITS_AND_COVERAGE,
    Intent.CLAIMS_DETAIL.value: LiveChatTopics.CLAIM_STATUS_AND_INQUIRY,
    Intent.CLAIMS_SUBMISSION.value: LiveChatTopics.CLAIM_STATUS_AND_INQUIRY,
    Intent.PRIOR_AUTH.value: LiveChatTopics.CLAIM_STATUS_AND_INQUIRY,
    Intent.ID_CARD.value: LiveChatTopics.OTHER_GENERAL_SERVICE,
    Intent.DOCUMENTS.value: LiveChatTopics.OTHER_GENERAL_SERVICE,
    Intent.SYMPTOM_INQUIRY.value: LiveChatTopics.OTHER_GENERAL_SERVICE,
    Intent.IMAGING_INQUIRY.value: LiveChatTopics.OTHER_GENERAL_SERVICE,
    Intent.EOB_HELP.value: LiveChatTopics.CLAIM_STATUS_AND_INQUIRY,
    Intent.EOB_PAYMENT_INQUIRY.value: LiveChatTopics.CLAIM_STATUS_AND_INQUIRY,
}


class PlannerAgent:
    """
    Determines which agents to call and with what arguments, based on the intent detection response.
    Returns a list of dicts, each with:
      - label: str
      - agent: str (e.g., 'benefits', 'findcare')
      - args: tuple
      - kwargs: dict (optional)
    """
    
    def __init__(self):
        """Initialize PlannerAgent with required service dependencies."""
        self.coverage_client = CoveragePeriodClient()
        self.member_resolver = MemberResolver()
        logger.debug("[PLANNER] Initialized with CoveragePeriodClient and MemberResolver")
    
    def getAllowedAgentsByChannel(self, channel: str | None = None):
        """
        Get allowed agents for a specific channel from config.
        
        Args:
            channel: Channel (sms/web)
            
        Returns:
            list: List of allowed agent names for the channel
        """
        allowed_agents = []
        if channel:
            try:
                config = get_config(channel=channel)
                allowed_agents = config.get("agent_access") or []
                # Ensure it's always a list
                if not isinstance(allowed_agents, list):
                    allowed_agents = []
                logger.info(f"[PLANNER] Allowed agents for channel '{channel}': {allowed_agents}")
            except Exception as e:
                logger.error(f"[PLANNER] Error fetching agent_access for channel '{channel}': {e}")
                allowed_agents = []
        else:
            logger.warning(f"[PLANNER] No channel provided, returning empty agent_access list")
        
        return allowed_agents
    
    async def getFeatures(self, member_id: str, channel: str | None = None):
        """
        Fetch features for a member from eligibility API.
        
        Args:
            member_id: Member contrived ID
            channel: Channel (sms/web)
            
        Returns:
            dict: Features response or None if error occurs
        """
        features_response = None
        if member_id:
            try:
                cache = get_cache_client(channel=channel)
                eligibility_client = EligibilityClient(cache=cache, channel=channel)
                features_response = await eligibility_client.get_filtered_features(mbrUid=member_id)
                logger.info(f"[PLANNER] Fetched features for member={member_id}: {features_response}")
            except Exception as e:
                logger.error(f"[PLANNER] Error fetching features for member={member_id}: {e}")
                features_response = None
        return features_response
    
    async def plan(self, response, channel: str | None = None, member_id: str | None = None, user_query: str | None = None, conversation_id: str | None = None, conversation_history: list | None = None):
        """
        Build an execution plan from an intent detection response.

        Args:
            response: Intent detection response object with primary_intent and optional secondary_intent.
            channel: Channel identifier ('sms' or 'web'). When None, agent_access allowlist
                     is empty so all intents are denied — callers must pass a channel.
            member_id: Member contrived ID, required for eligibility checks (e.g. SPENDING_ACCOUNT).
            user_query: Raw/enriched query string forwarded to domain planners (e.g. ID card
                secondary-intent keywords). Member targeting no longer depends on it.
            conversation_id: Conversation ID for history lookup in live chat escalation.
            conversation_history: Pre-retrieved conversation history from orchestrator (for live chat escalation).

        Returns:
            list[dict]: Ordered list of plan steps, each with 'label', 'agent', 'args',
                        and optionally 'kwargs' or 'error_message'.
        """
        plans = []
        normalized_channel = (channel or "").strip().lower() or None
        
        # Get allowed agents for this channel
        allowed_agents = self.getAllowedAgentsByChannel(channel=normalized_channel) or []
        
        def _make_gateway_plan(label, args):
            plan = {
                'label': label,
                'agent': 'gateway',
                'args': args,
            }
            if normalized_channel == Channel.SMS.value:
                plan['kwargs'] = {'channel': Channel.SMS.value}
            return plan
        
        # Primary intent
        primary_intent = getattr(response, 'primary_intent', None)
        
        # Check if primary_intent is allowed for this channel.
        # Deny if: allowlist is empty (channel=None or agent_access not configured)
        # or intent is not explicitly listed in the allowlist.
        if primary_intent and (not allowed_agents or primary_intent not in allowed_agents):
            logger.warning(f"[PLANNER] Intent '{primary_intent}' not allowed for channel '{normalized_channel}'")
            
            # Get friendly name from AgentIntents enum
            try:
                intent_display_name = AgentIntents[primary_intent].value
            except KeyError:
                intent_display_name = primary_intent
            
            plans.append({
                'label': 'Agent Access Denied',
                'agent': 'error',
                'args': (),
                'message': f"Agent Access Denied: {intent_display_name} access is not available for channel {normalized_channel}",
                '_agent_name': primary_intent  # Use the intent as agent name for proper identification
            })
            return plans
        
        try:
            features_response = await self.getFeatures(member_id=member_id, channel=normalized_channel)
        except RuntimeError as exc:
            logger.error("[PLANNER] getFeatures raised RuntimeError: %s", exc)
            plans.append({
                'label': 'Features Unavailable',
                'agent': 'error',
                'args': (),
                'extracted_text': str(exc),
            })
            return plans
        
        # Determine which intents need bootstrap data (for 5W metadata population)
        # Plan Info: needs bootstrap for plan details
        # Benefits: needs bootstrap for eligibility enrichment (address.state, network-id, etc.)
        bootstrap_needed = primary_intent in (
            Intent.PLAN_INFO.value,
            Intent.BENEFITS_OVERVIEW.value,
        )
        
        # Create eligibility client for bootstrap data if needed
        eligibility_client = None
        bootstrap_data = None
        if bootstrap_needed and member_id:
            try:
                cache = get_cache_client(channel=normalized_channel)
                eligibility_client = EligibilityClient(cache=cache, channel=normalized_channel)
                logger.debug("[PLANNER] EligibilityClient created for bootstrap data fetch")
                bootstrap_data = await eligibility_client.get_bootstrap_data(member_id)
                logger.debug("[PLANNER] Bootstrap data fetched for member=%s", member_id)
            except Exception as exc:
                logger.error("[PLANNER] Failed to prepare bootstrap data for member=%s: %s", member_id, exc)

        coverage_needed = primary_intent in (
            Intent.BENEFITS_OVERVIEW.value,
            Intent.ID_CARD.value,
            Intent.PRIOR_AUTH.value,
            Intent.CLAIMS_DETAIL.value,
            Intent.SYMPTOM_INQUIRY.value,
            Intent.IMAGING_INQUIRY.value,
            Intent.PLAN_INFO.value,
            Intent.PHARMACY.value,
        )
        raw_coverage: dict = {}
        coverage_data: dict = {}
        if coverage_needed:
            try:
                raw_coverage = await self.coverage_client.get_coverage_period(
                    member_uid=member_id, cached=True
                )
                coverage_data = transform_coverage_response(raw_coverage, member_id)
                logger.debug("[PLANNER] Coverage pre-fetched for member=%s", member_id)
            except Exception as exc:
                logger.error("[PLANNER] Failed to pre-fetch coverage for member=%s: %s", member_id, exc)
        
        # Set live chat topic based on primary intent (centralized mapping)
        if primary_intent:
            topic = INTENT_TO_LIVE_CHAT_TOPIC.get(primary_intent)
            if not topic and primary_intent != Intent.LIVE_CHAT.value:
                logger.info(f"[PLANNER] No topic mapping for intent {primary_intent}, using default OTHER_GENERAL_SERVICE")
                topic = LiveChatTopics.OTHER_GENERAL_SERVICE
            if topic:
                try:
                    setLiveChatTopic(topic.value)
                    logger.info(f"[PLANNER] Set live chat topic to {topic.value} for intent {primary_intent}")
                except Exception as exc:
                    logger.warning(f"[PLANNER] Failed to set live chat topic for intent {primary_intent}: {exc}")
        
        if primary_intent == Intent.BENEFITS_OVERVIEW.value:
            # Re-transform coverage to include all statuses (Active, Future Active, Inactive)
            # for benefits queries where member may only have future/inactive coverage
            benefits_coverage_data = coverage_data
            if raw_coverage:
                try:
                    benefits_coverage_data = transform_coverage_response(
                        raw_coverage, member_id, include_all_statuses=True
                    )
                except Exception as exc:
                    logger.warning(
                        "[PLANNER] Failed to re-transform coverage for benefits with all statuses: %s", exc
                    )
            
            plan = await getBenefitsPlan(
                response=response,
                make_gateway_plan_func=_make_gateway_plan,
                get_user_options_message_func=self._get_user_options_message,
                member_resolver=self.member_resolver,
                raw_coverage=raw_coverage,
                coverage_data=benefits_coverage_data,
                features_response=features_response,
                member_id=member_id,
                channel=normalized_channel,
                bootstrap_data=bootstrap_data,
            )
            plans.append(plan)
        elif primary_intent == Intent.REVIEW_PROVIDERS.value:
            plan = await getFindCarePlan(
                response=response,
                features_response=features_response,
                member_id=member_id,
                channel=normalized_channel,
            )
            plans.append(plan)
        elif primary_intent == Intent.PHARMACY.value:
            plan = await getPharmacyPlan(
                response=response,
                make_gateway_plan_func=_make_gateway_plan,
                get_user_options_message_func=self._get_user_options_message,
                member_resolver=self.member_resolver,
                coverage_data=coverage_data,
                features_response=features_response,
                member_id=member_id,
                channel=normalized_channel,
                user_query=user_query,
            )
            plans.append(plan)
        elif primary_intent == Intent.PROFILE_OVERVIEW.value:
            plans.append(
                _make_gateway_plan(
                    'Gateway Agent Result',
                    (primary_intent, getattr(response, 'secondary_intent', None)),
                )
            )
        elif primary_intent == Intent.SPENDING_ACCOUNT.value:
            # Use utility function to generate spending account plan
            plan = await getSpendingAccountPlan(
                response=response,
                make_gateway_plan_func=_make_gateway_plan,
                get_user_options_message_func=self._get_user_options_message,
                features_response=features_response
            )
            plans.append(plan)
        elif primary_intent == Intent.BILLPAY.value:
            # Use utility function to generate billpay plan
            plan = await getBillPayPlan(
                response=response,
                make_gateway_plan_func=_make_gateway_plan,
                get_user_options_message_func=self._get_user_options_message,
                features_response=features_response,
                member_id=member_id,
                channel=normalized_channel
            )
            plans.append(plan)
        elif primary_intent == Intent.PLAN_INFO.value:
            plan_info_coverage_data = coverage_data
            if raw_coverage:
                try:
                    plan_info_coverage_data = transform_coverage_response(
                        raw_coverage, member_id, include_all_statuses=True
                    )
                except Exception as exc:
                    logger.warning(
                        "[PLANNER] Failed to re-transform coverage for plan info with all statuses: %s", exc
                    )
            
            plan = await getPlanInfoPlan(
                response=response,
                make_gateway_plan_func=_make_gateway_plan,
                get_user_options_message_func=self._get_user_options_message,
                raw_coverage=raw_coverage,
                coverage_data=plan_info_coverage_data,
                features_response=features_response,
                member_id=member_id,
                channel=normalized_channel,
                bootstrap_data=bootstrap_data,
            )
            plans.append(plan)
        elif primary_intent == Intent.CLAIMS_DETAIL.value:
            plan = await getClaimsDetailPlan(
                make_gateway_plan_func=_make_gateway_plan,
                features_response=features_response,
                response=response,
                member_resolver=self.member_resolver,
                raw_coverage=raw_coverage,
                coverage_data=coverage_data,
                member_id=member_id,
                channel=normalized_channel,
                user_query=user_query,
            )
            plans.append(plan)
        elif primary_intent == Intent.CLAIMS_SUBMISSION.value:
            # Use utility function to generate claims submission plan
            plan = await getClaimsSubmissionPlan(
                response=response,
                make_gateway_plan_func=_make_gateway_plan,
                get_user_options_message_func=self._get_user_options_message,
                features_response=features_response,
                member_id=member_id,
                channel=normalized_channel
            )
            plans.append(plan)
        elif primary_intent == Intent.PRIOR_AUTH.value:
            plan = await getPriorAuthPlan(
                response=response,
                make_gateway_plan_func=_make_gateway_plan,
                get_user_options_message_func=self._get_user_options_message,
                member_resolver=self.member_resolver,
                raw_coverage=raw_coverage,
                coverage_data=coverage_data,
                features_response=features_response,
                member_id=member_id,
                channel=normalized_channel,
            )
            plans.append(plan)
        elif primary_intent == Intent.ID_CARD.value:
            plan = await getIdCardPlan(
                response=response,
                make_gateway_plan_func=_make_gateway_plan,
                get_user_options_message_func=self._get_user_options_message,
                member_resolver=self.member_resolver,
                raw_coverage=raw_coverage,
                coverage_data=coverage_data,
                features_response=features_response,
                member_id=member_id,
                channel=normalized_channel,
            )
            plans.append(plan)
        elif primary_intent == Intent.DOCUMENTS.value:
            plans.append(
                _make_gateway_plan(
                    'Gateway Agent Result',
                    (primary_intent, primary_intent),
                )
            )
        elif primary_intent == Intent.SYMPTOM_INQUIRY.value:
            plan = await getSymptomInquiryPlan(
                response=response,
                member_resolver=self.member_resolver,
                raw_coverage=raw_coverage,
                coverage_data=coverage_data,
                member_id=member_id,
                user_query=user_query,
                channel=normalized_channel,
                get_user_options_message_func=self._get_user_options_message,
                features_response=features_response
            )
            plans.append(plan)
        elif primary_intent == Intent.IMAGING_INQUIRY.value:
            plan = await getImagingInquiryPlan(
                response=response,
                member_resolver=self.member_resolver,
                raw_coverage=raw_coverage,
                coverage_data=coverage_data,
                member_id=member_id,
                user_query=user_query,
                channel=normalized_channel,
                get_user_options_message_func=self._get_user_options_message,
                features_response=features_response
            )
            plans.append(plan)
        elif primary_intent == Intent.EOB_HELP.value:
            features_list = (features_response or {}).get("features", []) if features_response else []
            has_claims_access = Feature.CLAIMS.name in features_list
            if not has_claims_access:
                has_chat_access = Feature.CHAT.name in features_list
                message = (
                    get_localized_message("claims", "claims_no_access_chat")
                    if has_chat_access
                    else get_localized_message("claims", "claims_no_access_no_chat")
                )
                plans.append({
                    'label': PLAN_LABEL_CLAIMS_ACCESS_DENIED,
                    'agent': 'error',
                    'args': (),
                    'extracted_text': message,
                    '_agent_name': AgentIntents.CLAIMS_DETAIL.name,
                })
            else:
                plans.append(
                    _make_gateway_plan(
                        'EOB Help Agent Result',
                        (GatewayAction.CLAIMS_EXPLAINABILITY.value, Intent.EOB_HELP.value),
                    )
                )
        elif primary_intent == Intent.EOB_PAYMENT_INQUIRY.value:
            features_list = (features_response or {}).get("features", []) if features_response else []
            has_claims_access = Feature.CLAIMS.name in features_list
            if not has_claims_access:
                has_chat_access = Feature.CHAT.name in features_list
                message = (
                    get_localized_message("claims", "claims_no_access_chat")
                    if has_chat_access
                    else get_localized_message("claims", "claims_no_access_no_chat")
                )
                plans.append({
                    'label': PLAN_LABEL_CLAIMS_ACCESS_DENIED,
                    'agent': 'error',
                    'args': (),
                    'extracted_text': message,
                    '_agent_name': AgentIntents.CLAIMS_DETAIL.name,
                })
            else:
                plans.append(
                    _make_gateway_plan(
                        'EOB Payment Inquiry Agent Result',
                        (GatewayAction.CLAIMS_EXPLAINABILITY.value, Intent.EOB_PAYMENT_INQUIRY.value),
                    )
                )
        elif primary_intent == Intent.LIVE_CHAT.value:
            # STATIC message (Live chat currently not available) returning If the primary intent is LIVE_CHAT
            ## TODO: Implmentation of LIVE CHAT will be done later and will integrate with the gateway plan.
            # Get locale from request context
            language = RequestContext.get_language() or "en"
            locale = "es_US" if language == "es" else "en_US"

            secondary_intent = getattr(response, 'secondary_intent', None)
            
            plan = await getLiveAgentPlan(
                response=response,
                make_gateway_plan_func=_make_gateway_plan,
                get_user_options_message_func=self._get_user_options_message,
                features_response=features_response,
                member_id=member_id,
                channel=normalized_channel,
                locale=locale,
                secondary_intent=secondary_intent,
                conversation_id=conversation_id,
                conversation_history=conversation_history,
                user_consent_live_agent=getattr(response, "user_consent_live_agent", None),
            )
            plans.append(plan)
        # Secondary intent - Skip for SMS channel to keep response crisp
        if normalized_channel != Channel.SMS.value:
            secondary_intent = getattr(response, 'secondary_intent', None)
            if secondary_intent == Intent.BENEFITS_OVERVIEW.value:
                plans.append(
                    _make_gateway_plan(
                        'Benefits Explainability Agent Result (Secondary)',
                        (GatewayAction.BENEFITS_EXPLAINABILITY.value, GatewayAction.GET_BENEFITS_EXPLAINABILITY.value),
                    )
                )
            elif secondary_intent == Intent.REVIEW_PROVIDERS.value:
                plan = await getFindCarePlan(
                    response=response,
                    features_response=features_response,
                    member_id=member_id,
                    channel=normalized_channel,
                )
                plan["label"] = "FindCare Agent Result (Secondary)"
                plans.append(plan)
        return plans
    
    def _get_user_options_message(self, features_list: list) -> str:
        """
        Generate user options message based on available features.
        
        Args:
            features_list: List of available features
            
        Returns:
            Comma-separated string of available options (max 3)
        """
        # Get language from request context
        language = RequestContext.get_language() or "en"
        
        available_options = []
        
        if Feature.BENEFITS.name in features_list:
            available_options.append(Feature.BENEFITS.get_localized_name(language))
        if Feature.CLAIMS.name in features_list:
            available_options.append(Feature.CLAIMS.get_localized_name(language))
        if Feature.IDCARD.name in features_list:
            available_options.append(Feature.IDCARD.get_localized_name(language))
        if Feature.PHARMACY.name in features_list:
            available_options.append(Feature.PHARMACY.get_localized_name(language))
        
        # Limit to maximum 3 items
        available_options = available_options[:3]
        
        # Join with comma and space
        user_options_message = ", ".join(available_options) if available_options else ""
        
        return user_options_message

=========================================================================================================

"""
FastAPI Dependencies for Benefits Agent.
"""

from functools import lru_cache
from typing import Annotated

from fastapi import Depends

from agents.benefits_agent.handler import BenefitsAgent
from agents.benefits_agent.llm import BenefitsQueryAnalyzer
from agents.benefits_agent.services.response_builder import BenefitsResponseBuilder
from agents.gateway.api import BenefitsExplainabilityClient
from agents.gateway.config import (
    get_authorization_token_config,
    get_config,
    get_soa_config,
)
from utils.constants import Channel
from utils.shared.redis_cache import RedisCacheClient, get_cache_client

_CHANNEL_CACHE_SIZE = len(Channel) + 1


@lru_cache(maxsize=_CHANNEL_CACHE_SIZE)
def get_benefits_config(channel: str | None = None) -> dict:
    """
    Get channel-specific configuration.
    
    Args:
        channel: Channel identifier (web, sms, etc.)
        
    Returns:
        Configuration dict for the channel
    """
    return get_config(channel=channel)


ConfigDep = Annotated[dict, Depends(get_benefits_config)]


@lru_cache(maxsize=1)
def get_benefits_cache_client() -> RedisCacheClient:
    """
    Get Redis cache client singleton.
    
    Returns:
        RedisCacheClient instance
    """
    return get_cache_client()


CacheDep = Annotated[RedisCacheClient, Depends(get_benefits_cache_client)]


@lru_cache(maxsize=1)
def get_query_analyzer():
    """
    Get query analyzer singleton.
    
    Returns:
        BenefitsQueryAnalyzer instance
    """
    return BenefitsQueryAnalyzer(timeout=5)


QueryAnalyzerDep = Annotated[BenefitsQueryAnalyzer, Depends(get_query_analyzer)]


@lru_cache(maxsize=1)
def get_response_builder():
    """
    Get response builder singleton.
    
    Returns:
        BenefitsResponseBuilder instance
    """
    return BenefitsResponseBuilder()


ResponseBuilderDep = Annotated[BenefitsResponseBuilder, Depends(get_response_builder)]


@lru_cache(maxsize=_CHANNEL_CACHE_SIZE)
def get_benefits_api_client(channel: str | None = None) -> BenefitsExplainabilityClient:
    """
    Get or create Benefits API client per-channel.
    
    Uses gateway's BenefitsExplainabilityClient directly (no wrapper).
    Cached per-channel since config is channel-specific.
    
    Args:
        channel: Channel identifier (web, sms, etc.)
        
    Returns:
        BenefitsExplainabilityClient configured for the channel
    """
    return BenefitsExplainabilityClient(
        authorization_token_config=get_authorization_token_config(channel=channel),
        soa_config=get_soa_config(channel=channel)
    )


BenefitsAPIClientDep = Annotated[BenefitsExplainabilityClient, Depends(get_benefits_api_client)]


@lru_cache(maxsize=_CHANNEL_CACHE_SIZE)
def get_handler_instance(channel: str | None = None) -> BenefitsAgent:
    """
    Get Benefits handler instance with channel-aware dependencies.
    
    Creates handler per-channel to load channel-specific configuration.
    Uses lru_cache to avoid recreating for same channel.
    
    Args:
        channel: Channel identifier (web, sms, etc.)
        
    Returns:
        BenefitsAgent instance with injected dependencies
    """
    return BenefitsAgent(
        cache_client=get_benefits_cache_client(),
        query_analyzer=get_query_analyzer(),
        response_builder=get_response_builder(),
        benefits_api_client=get_benefits_api_client(channel=channel)
    )

==========================================================================================================

"""
Benefits A2A server (port 9061).
Handles HTTP/A2A protocol, delegates business logic to handler.

Architecture:
  Controller (server.py) → Service (handler.py) → Helpers/Services
       ↓                        ↓                       ↓
  HTTP/A2A protocol      Business logic         Data processing
"""

from __future__ import annotations

import json
import logging
import os
import sys
import traceback
import uuid
from contextlib import asynccontextmanager
from functools import lru_cache

import uvicorn
from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.apps import A2AFastAPIApplication
from a2a.server.events import EventQueue
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryTaskStore, TaskUpdater
from a2a.types import (
    AgentCapabilities,
    AgentCard,
    AgentSkill,
    InternalError,
    Part,
    TextPart,
)
from a2a.utils import new_task
from a2a.utils.errors import ServerError
from fastapi import FastAPI

from agents.benefits_agent.agent.dependencies import get_handler_instance
from agents.benefits_agent.transformers import (
    extract_intent_from_5w,
    extract_member_id_from_5w,
    extract_user_query,
)
from agents.benefits_agent.utils.config_validator import (
    ConfigValidationError,
    get_config_status,
    validate_benefits_config,
)
from agents.gateway.config import get_a2a_agents_config, get_config
from utils.constants import Channel
from utils.language_utils import normalize_language_code
from utils.logging.request_context import RequestContext as AppRequestContext
from utils.logging.structured_logger import StructuredLogger

logging.basicConfig(
    level=logging.INFO,
    format='%(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)

logger = StructuredLogger(__name__)

# ─────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────

DEFAULT_CHANNEL = Channel.WEB.value
DEFAULT_INTENT = "BENEFITS_OVERVIEW"
DEFAULT_PORT = int(os.getenv("BENEFITS_AGENT_PORT", "9061"))
DEFAULT_HOST = "0.0.0.0"


def _extract_payload_language(metadata: dict | None, default: str = "en") -> str:
    if isinstance(metadata, dict):
        profile = metadata.get("5w.profile") if isinstance(metadata.get("5w.profile"), dict) else {}
        return normalize_language_code(profile.get("language") or metadata.get("language") or default)
    return normalize_language_code(default)


# ─────────────────────────────────────────────
# Streaming Configuration
# ─────────────────────────────────────────────


@lru_cache(maxsize=1)
def _get_streaming_enabled() -> bool:
    """
    Get streaming capability from configuration.
    
    Uses CHANNEL env var if set, otherwise defaults to WEB channel.
    Returns False if config cannot be loaded.
    """
    channel_env = os.getenv("CHANNEL", "").strip().lower()
    target_channel = channel_env if channel_env else DEFAULT_CHANNEL
    
    try:
        config = get_config(channel=target_channel)
        streaming = config.get("agent_capability", {}).get("streaming", False)
        logger.info(f"[BENEFITS_SERVER] Streaming config loaded: channel={target_channel}, streaming={streaming}")
        return bool(streaming)
    except Exception as e:
        logger.warning(
            "[BENEFITS_SERVER] Failed to load config for channel=%s: %s. Defaulting streaming=False",
            target_channel, e
        )
        return False


# ─────────────────────────────────────────────
# Initialize dependencies using FastAPI DI pattern
# ─────────────────────────────────────────────

logger.info("[BENEFITS_SERVER] Dependencies initialized (handler created per-request with channel)")


# ─────────────────────────────────────────────
# Benefits Executor
# ─────────────────────────────────────────────

class BenefitsExecutor(AgentExecutor):
    """Benefits executor with production-grade error handling and logging."""
    
    @staticmethod
    def _get_or_create_context_id(context: RequestContext, task) -> str:
        """Get context ID from message or generate new one."""
        context_id = getattr(context.message, "context_id", None) if context.message else None
        if not context_id:
            context_id = task.context_id if task.context_id else str(uuid.uuid4())
            logger.info(f"[BENEFITS_EXECUTOR] Generated context_id: {context_id}")
        return context_id
    
    @staticmethod
    def _extract_metadata_fields(context: RequestContext) -> dict:
        """
        Extract all metadata fields from message.
        
        Returns:
            Dict with member_id, intent, user_query, channel, message_id, meta_trans_id
        """
        metadata = context.message.metadata if context.message else {}
        logger.info(f"[BENEFITS_EXECUTOR] Received metadata: {metadata}")
        
        # Extract member ID and intent from 5W structure
        member_contrived_id = extract_member_id_from_5w(metadata)
        intent = extract_intent_from_5w(metadata) or DEFAULT_INTENT
        
        # Extract user query from message parts
        user_query = extract_user_query(context.message)
        
        # Extract and normalize channel + language from 5w.profile (preferred) or metadata
        profile = metadata.get("5w.profile", {}) if isinstance(metadata.get("5w.profile"), dict) else {}
        channel_str = profile.get("channel") or (metadata.get("channel") if metadata else None)
        channel: Channel | None = None
        if channel_str:
            try:
                channel = Channel(channel_str.lower()) if channel_str else None
            except ValueError:
                logger.warning(f"[BENEFITS_EXECUTOR] Invalid channel '{channel_str}', defaulting to None")
        
        # Extract IDs
        meta_trans_id = getattr(context.message, "message_id", None) if context.message else None
        message_id = getattr(context.message, "message_id", None) if context.message else None
        
        return {
            "metadata": metadata,
            "member_contrived_id": member_contrived_id,
            "intent": intent,
            "user_query": user_query,
            "channel": channel,
            "language": _extract_payload_language(metadata),
            "meta_trans_id": meta_trans_id,
            "message_id": message_id,
        }
    
    @staticmethod
    def _setup_app_request_context(context_id: str, channel: Channel | None, task, meta_trans_id: str | None, message_id: str | None, language: str = "en") -> None:
        """Setup AppRequestContext for structured logging."""
        rid = meta_trans_id or message_id or task.id
        AppRequestContext.set_rid(rid)
        AppRequestContext.set_context_id(context_id)
        if channel:
            AppRequestContext.set_channel(channel.value)
        AppRequestContext.set_language(language)
    
    @staticmethod
    async def _build_and_send_artifacts(
        updater: TaskUpdater,
        result: dict,
        context_id: str,
        member_contrived_id: str,
        intent: str
    ) -> None:
        """
        Build and send artifacts following A2A best practices.
        
        Sends 3 artifacts:
        1. summarized_response - Complete JSON with all fields
        2. user_message - Formatted text for display
        3. structured_data - For downstream processing
        """
        result["context_id"] = context_id
        
        # 1. Summarized response
        summarized_response = json.dumps(result, ensure_ascii=False, default=str)
        await updater.add_artifact(
            [Part(root=TextPart(text=summarized_response))],
            name="summarized_response",
        )
        
        # 2. User message
        user_message = result.get("message", "")
        await updater.add_artifact(
            [Part(root=TextPart(text=user_message))],
            name="user_message",
        )
        
        # 3. Structured data
        structured_data = json.dumps({
            "member_contrived_id": member_contrived_id,
            "coverage_types": result.get("coverage_types", []),
            "plan_count": result.get("plan_count", 0),
            "intent": intent,
            "context_id": context_id,
        }, ensure_ascii=False, default=str)
        await updater.add_artifact(
            [Part(root=TextPart(text=structured_data))],
            name="structured_data",
        )

    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        task = context.current_task
        if not task:
            task = new_task(context.message)
            await event_queue.enqueue_event(task)

        updater = TaskUpdater(event_queue, task.id, task.context_id)

        try:
            # Extract all metadata fields
            extracted = self._extract_metadata_fields(context)
            
            # Get or create context ID
            context_id = self._get_or_create_context_id(context, task)
            
            # Setup request context for structured logging
            self._setup_app_request_context(
                context_id,
                extracted["channel"],
                task,
                extracted["meta_trans_id"],
                extracted["message_id"],
                extracted["language"]
            )

            logger.info(
                f"[BENEFITS_EXECUTOR] Dispatching: intent={extracted['intent']} "
                f"query={extracted['user_query']} channel={extracted['channel'].value if extracted['channel'] else None} context_id={context_id}"
            )

            # Create handler with channel-aware configuration
            handler = get_handler_instance(channel=extracted["channel"].value if extracted["channel"] else None)

            # Call handler with 5W metadata and user query
            result = await handler.handle_request(
                five_w_metadata=extracted["metadata"],
                user_query=extracted["user_query"],
                channel=extracted["channel"].value if extracted["channel"] else None,
                context_id=context_id,
                message_id=extracted["message_id"],
                meta_trans_id=extracted["meta_trans_id"],
            )
            logger.info(f"[BENEFITS_EXECUTOR] Result keys: {list(result.keys())}")

            # Build and send artifacts
            await self._build_and_send_artifacts(
                updater,
                result,
                context_id,
                extracted["member_contrived_id"],
                extracted["intent"]
            )

            await updater.complete()

        except Exception as exc:
            # Unexpected system errors
            logger.error(f"[BENEFITS_EXECUTOR] Unexpected error: {exc}\n{traceback.format_exc()}")
            try:
                await updater.error(InternalError(
                    message=f"Benefits agent error: {str(exc)}",
                    details={"exception_type": type(exc).__name__}
                ))
            except Exception as err_exc:
                logger.error(f"[BENEFITS_EXECUTOR] Failed to report error: {err_exc}")
                raise ServerError(error=InternalError(
                    message=f"Execution failed: {str(exc)}",
                    details={"exception_type": type(exc).__name__}
                )) from exc

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        """Cancel the current task. Not supported for Benefits agent."""
        raise ServerError(error=InternalError())


# ─────────────────────────────────────────────
# Agent Card Definition
# ─────────────────────────────────────────────

_agent_card = AgentCard(
    name="Benefits Agent",
    description="Intelligent agent for explaining healthcare benefits, coverage details, and plan information.",
    url=get_a2a_agents_config().get("benefits", {}).get("base_url"),
    version="1.0.0",
    skills=[
        AgentSkill(
            id="idx_benefits_explainability_agent",
            name="Benefits Explainability",
            tags=[
                "BENEFITS_EXPLAINABILITY",
                "BENEFITS_OVERVIEW",
                "benefits",
                "coverage",
                "plan",
                "medical",
                "dental",
                "vision"
            ],
            description="Explain benefits coverage, plan details, and eligibility",
            examples=[
                "What are my benefits?",
                "Show my coverage details",
                "What does my plan cover?",
                "Do I have dental coverage?",
                "Explain my medical benefits",
                "What's covered under my plan?",
                "Show benefits for my family"
            ]
        )
    ],
    default_input_modes=["text"],
    default_output_modes=["text"],
    capabilities=AgentCapabilities(streaming=_get_streaming_enabled())
)


# ─────────────────────────────────────────────
# FastAPI Application
# ─────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for startup and shutdown events."""
    try:
        config = get_config()
        validate_benefits_config(config)
        logger.info("[BENEFITS_SERVER] Configuration validated successfully")
    except ConfigValidationError as e:
        logger.error(f"[BENEFITS_SERVER] Configuration validation failed: {e}")
        for error in e.errors:
            logger.error(f"  - {error}")
        raise RuntimeError(f"Invalid configuration: {'; '.join(e.errors)}") from e
    
    yield
    # Cleanup on shutdown (if needed in future)


_request_handler = DefaultRequestHandler(
    agent_executor=BenefitsExecutor(),
    task_store=InMemoryTaskStore()
)

# Build A2A app, then set lifespan on the underlying FastAPI app
_a2a_app = A2AFastAPIApplication(
    agent_card=_agent_card,
    http_handler=_request_handler
)
app = _a2a_app.build()
app.router.lifespan_context = lifespan


@app.get("/health")
async def health_check():
    """Health check endpoint for liveness and readiness probes."""
    config = get_config()
    config_status = get_config_status(config)
    
    return {
        "status": "healthy" if config_status["valid"] else "degraded",
        "service": "benefits-agent",
        "config_valid": config_status["valid"],
        "config_errors": config_status["errors"],
    }


logger.info("[BENEFITS_SERVER] FastAPI application built successfully")
logger.info(f"[BENEFITS_SERVER] Agent card: {_agent_card.name}")
logger.info(f"[BENEFITS_SERVER] Streaming enabled: {_agent_card.capabilities.streaming}")


# ─────────────────────────────────────────────
# Main entry point (for direct execution)
# ─────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.getenv("PORT", str(DEFAULT_PORT)))
    
    logger.info("[BENEFITS_SERVER] Starting Benefits A2A Agent")
    logger.info(f"[BENEFITS_SERVER] Port: {port}")
    logger.info(f"[BENEFITS_SERVER] Agent Card: http://localhost:{port}/.well-known/agent-card.json")
    logger.info(f"[BENEFITS_SERVER] Health Check: http://localhost:{port}/health")
    uvicorn.run(app, host=DEFAULT_HOST, port=port)

========================================================================================================

"""Benefits Agent Constants."""

from utils.constants import Intent

AGENT_NAME = Intent.BENEFITS_OVERVIEW.value

=======================================================================================================

"""Web Links for Non-Medical Coverage Types."""

from enum import Enum
from functools import lru_cache
from pathlib import Path
from typing import Dict, Optional

import yaml


class CoverageTypeCode(str, Enum):
    """Coverage type codes from coveragePeriod API."""
    MEDICAL = "MED"
    DENTAL = "DEN"
    VISION = "VSN"
    PHARMACY = "PHAR"  # API uses "PHAR", not "PHR"


COVERAGE_TYPE_DISPLAY_NAMES = {
    CoverageTypeCode.MEDICAL: "Medical",
    CoverageTypeCode.DENTAL: "Dental",
    CoverageTypeCode.VISION: "Vision",
    CoverageTypeCode.PHARMACY: "Pharmacy",
}

COVERAGE_NAME_TO_CODE = {
    "MEDICAL": CoverageTypeCode.MEDICAL,
    "DENTAL": CoverageTypeCode.DENTAL,
    "VISION": CoverageTypeCode.VISION,
    "PHARMACY": CoverageTypeCode.PHARMACY,
}


@lru_cache(maxsize=1)
def _load_web_links_config() -> Dict[str, Optional[str]]:
    """Load web links from common-config.yaml."""
    config_path = Path(__file__).parent.parent.parent.parent / "config" / "common-config.yaml"
    
    if not config_path.exists():
        return {}
    
    with open(config_path, "r") as f:
        config = yaml.safe_load(f)
    
    benefits_config = config.get("benefits_web_links", {})
    
    return {
        CoverageTypeCode.DENTAL: benefits_config.get("dental_url"),
        CoverageTypeCode.VISION: benefits_config.get("vision_url"),
        CoverageTypeCode.PHARMACY: benefits_config.get("pharmacy_url"),
    }


def get_coverage_web_links() -> Dict[str, Optional[str]]:
    """Get web links for coverage types, filtered to non-null values."""
    links = _load_web_links_config()
    return {k: v for k, v in links.items() if v is not None}


COVERAGE_WEB_LINKS = get_coverage_web_links()


@lru_cache(maxsize=1)
def _load_live_agent_config() -> Dict[str, str]:
    """
    Load live agent config from common-config.yaml.
    
    Fail-fast: KeyError raised if config missing (system crashes at startup).
    """
    config_path = Path(__file__).parent.parent.parent.parent / "config" / "common-config.yaml"
    
    with open(config_path, "r") as f:  # FileNotFoundError if missing
        config = yaml.safe_load(f)
    
    # KeyError raised if sections missing - natural fail-fast
    return {
        "app_store_url": config["live_agent"]["sydney_app"]["app_store_url"],
        "google_play_url": config["live_agent"]["sydney_app"]["google_play_url"]
    }


def get_live_agent_links() -> Dict[str, str]:
    """Get Sydney Health App links for live agent fallback."""
    return _load_live_agent_config()


LIVE_AGENT_LINKS = get_live_agent_links()

==================================================================================================================

"""Coverage Data Processor - Extracts and processes coverage from 5W metadata.

Follows plan_info_agent/helpers/coverage_processor.py pattern.
Simplified for Benefits Agent: Only extract active plans.
"""

from datetime import datetime
from typing import Dict, List, Optional, Tuple

from agents.benefits_agent.schemas import CoveragePeriod, CoveragePeriodResponse
from utils.logging.structured_logger import StructuredLogger

logger = StructuredLogger(__name__)


def extract_coverage_data(five_w_metadata: Dict) -> Tuple[CoveragePeriodResponse, List[str], Optional[str]]:
    """
    Extract coverage data from 5W metadata.
    
    Pattern from plan_info_agent/helpers/coverage_processor.py:extract_coverage_data
    
    Returns:
        Tuple of (coverage_response, coverage_types, group_id)
        
    Raises:
        ValueError: If coverage data missing or invalid
    """
    what_service = five_w_metadata.get("5w.what.service", {})
    raw_coverage = what_service.get("coverage", {}).get("raw", {})
    
    if not raw_coverage:
        raise ValueError("No coverage data in 5W metadata")
    
    coverage_response = CoveragePeriodResponse.model_validate(raw_coverage)
    
    if not coverage_response.eligibility:
        raise ValueError("No eligibility records found")
    
    coverage_types = what_service.get("coverage", {}).get("type", [])
    group_id = coverage_response.eligibility[0].group_id if coverage_response.eligibility else None
    
    return coverage_response, coverage_types, group_id


def extract_all_plans(coverage_response: CoveragePeriodResponse) -> List[CoveragePeriod]:
    """
    Extract all coverage periods from eligibility records.
    
    Pattern from plan_info_agent/helpers/coverage_processor.py:extract_all_plans
    """
    all_plans = []
    for eligibility in coverage_response.eligibility:
        if eligibility.coverage:
            all_plans.extend(eligibility.coverage)
    
    logger.info(
        f"Extracted {len(all_plans)} plans from {len(coverage_response.eligibility)} eligibility records",
        extra={
            "plan_count": len(all_plans),
            "eligibility_count": len(coverage_response.eligibility)
        }
    )
    
    return all_plans


def extract_active_plans(all_plans: List[CoveragePeriod]) -> List[CoveragePeriod]:
    """
    Filter to only active plans (Benefits Agent simplification).
    
    Based on plan_info_agent/helpers/plan_classifier.py:classify_plans
    but simplified to return only active plans.
    
    Rules:
    - Active: start_date <= today AND (no end_date OR end_date >= today)
    """
    today = datetime.now().date()
    active = []
    
    for plan in all_plans:
        try:
            start_date = datetime.strptime(plan.effective_date, "%Y-%m-%d").date()
            end_date = (
                datetime.strptime(plan.termination_date, "%Y-%m-%d").date()
                if plan.termination_date else None
            )
            
            # Only include active plans
            if start_date <= today and (not end_date or end_date >= today):
                active.append(plan)
        
        except (ValueError, AttributeError) as exc:
            logger.warning(
                f"Failed to parse dates for plan {plan.coverage_key}: {exc}",
                extra={"coverage_key": plan.coverage_key}
            )
            continue
    
    logger.info(
        f"Filtered to {len(active)} active plans from {len(all_plans)} total",
        extra={
            "active_count": len(active),
            "total_count": len(all_plans)
        }
    )
    
    return active

========================================================================================================

"""Coverage Type Routing Logic.

Routes single plan requests by coverage type:
- Multiple coverage types: Ask which one
- Dental/Vision/Pharmacy: Return web links
- Requested type not available: Show available types
"""

from typing import Any, Dict, List, Optional

from agents.benefits_agent.constants import (
    AGENT_NAME,
    COVERAGE_NAME_TO_CODE,
    COVERAGE_TYPE_DISPLAY_NAMES,
    COVERAGE_WEB_LINKS,
    CoverageTypeCode,
)
from agents.benefits_agent.error_handler import handle_external_api_errors
from agents.benefits_agent.helpers.error_response_builder import build_error_response
from agents.benefits_agent.helpers.live_agent_handler import append_live_agent_follow_up
from agents.benefits_agent.i18n.messages import get_message
from utils.benefits_5w import align_benefits_metadata_to_selected_plan
from utils.constants import Channel
from utils.coverage_period.models import CoveragePeriod
from utils.language_utils import normalize_language_code
from utils.logging.request_context import RequestContext
from utils.logging.structured_logger import get_logger

logger = get_logger(__name__)


def _build_success_response(
    message: str,
    has_chat_access: bool,
    has_show_sydapplnk_access: bool,
    top_3_features: List[str] | None = None,
    *,
    skip_summarization: bool = True,
    extra_fields: Dict | None = None,
) -> Dict:
    follow_up = {} if has_chat_access else append_live_agent_follow_up(
        message,
        has_chat_access,
        has_show_sydapplnk_access,
        top_3_features,
    )
    response_fields = follow_up.copy() if follow_up else {}
    response_message = response_fields.pop("message", message)
    response_fields.pop("live_chat_topic_required", None)
    response_fields.pop("live_chat_topic_to_connect", None)

    payload = {
        "message": response_message,
        "skip_summarization": skip_summarization,
        "_agent_name": AGENT_NAME,
        **(extra_fields or {}),
        **response_fields,
    }
    if "extracted_text" in payload:
        payload["extracted_text"] = response_message
    return payload


def normalize_coverage_type(coverage_type_input: str) -> Optional[str]:
    """
    Normalize coverage type input to canonical code.
    
    Handles both:
    - Display names from query analyzer: "Medical", "Dental", "Vision", "Pharmacy"
    - API codes: "MED", "DEN", "VSN", "PHAR"
    
    Args:
        coverage_type_input: Display name or code
        
    Returns:
        Canonical code (e.g., "MED") or None if invalid
    """
    upper_input = coverage_type_input.upper()
    
    # Check if it's already a valid code
    try:
        return CoverageTypeCode(upper_input).value
    except ValueError:
        pass
    
    # Check if it's a display name
    code_enum = COVERAGE_NAME_TO_CODE.get(upper_input)
    return code_enum.value if code_enum else None


def _determine_target_coverage(requested_coverage_type: str) -> str | None:
    """
    Normalize and validate requested coverage type.
    
    Args:
        requested_coverage_type: Coverage type to route to (MEDICAL/DENTAL/VISION/PHARMACY or code)
        
    Returns:
        Coverage type code or None if invalid
    """
    target_code = normalize_coverage_type(requested_coverage_type)
    if not target_code:
        logger.warning(f"[COVERAGE_ROUTER] Invalid coverage type: {requested_coverage_type}")
    return target_code


def _is_coverage_available(target_code: str, coverage_types: List[str]) -> bool:
    """Check if target coverage type is available in plan."""
    return target_code in coverage_types


def _extract_benefit_response_artifact(response: Dict) -> str | None:
    """
    Extract ALL benefit_response artifacts from API response and combine them.
    
    Matches old gateway behavior: collects ALL parts from ALL benefit_response
    artifacts and joins them with double newlines.
    
    Args:
        response: API response dict
        
    Returns:
        Combined text from all benefit_response parts, or None if not found
    """
    if not response or "result" not in response:
        return None
    
    result = response.get("result", {})
    artifacts = result.get("artifacts", [])
    
    # Collect ALL benefit_response texts (not just the first one)
    benefit_texts = []
    
    for artifact in artifacts:
        if artifact.get("name") == "benefit_response":
            parts = artifact.get("parts", [])
            for part in parts:
                if isinstance(part, dict) and part.get("kind") == "text" and "text" in part:
                    text = part.get("text", "")
                    if text:  # Only add non-empty texts
                        benefit_texts.append(text)
    
    # Combine all parts with double newline (matches old gateway behavior)
    if benefit_texts:
        combined_text = "\n\n".join(benefit_texts)
        logger.info(f"[COVERAGE_ROUTER] Combined {len(benefit_texts)} benefit_response parts")
        return combined_text
    
    return None


def _extract_status_messages(response: Dict) -> list[str]:
    """
    Extract ONLY clarification messages from API response.
    
    Filters to state="input-required" messages, excluding:
    - Progress indicators (state="working") like "Analyzing query intent..."
    - Other status updates
    
    Returns:
        List of clarification question texts
    """
    result = response.get("result", {})
    status_messages = result.get("status_messages", [])
    
    messages = []
    for msg in status_messages:
        if isinstance(msg, dict):
            state = msg.get("state", "")
            text = msg.get("text", "")
            
            # ONLY include input-required state (clarifications)
            if state == "input-required" and text:
                messages.append(text)
                logger.info(f"[COVERAGE_ROUTER] API requesting clarification: {text[:100]}")
            elif state == "working" and text:
                # Log but don't include progress messages
                logger.debug(f"[COVERAGE_ROUTER] Skipping progress message: {text[:100]}")
    
    return messages


def _extract_error_messages(response: Dict) -> list[str]:
    """Extract error messages from API response."""
    result = response.get("result", {})
    
    if not result.get("has_errors", False):
        return []
    
    errors = result.get("errors", [])
    return [
        f"Error {e.get('code', 'UNKNOWN')}: {e.get('message', 'Unknown error')}"
        for e in errors
    ]


def _extract_plan_info_detail_artifact(response: Dict) -> list[Dict]:
    """Extract plan_info_detail artifacts for weblink display in SMS summarizer."""
    if not response or "result" not in response:
        return []
    
    artifacts = response.get("result", {}).get("artifacts", [])
    plan_info_details = []
    
    for artifact in artifacts:
        if artifact.get("name") != "plan_info_detail":
            continue
            
        for part in artifact.get("parts", []):
            if not isinstance(part, dict):
                continue
            if part.get("kind") != "data" or "data" not in part:
                continue
                
            data = part.get("data", {})
            if data:
                plan_info_details.append(data)
    
    if plan_info_details:
        logger.info(f"[COVERAGE_ROUTER] Extracted {len(plan_info_details)} plan_info_detail artifacts")
    
    return plan_info_details


def _build_web_link_response(
    coverage_code: str,
    has_chat_access: bool,
    has_show_sydapplnk_access: bool,
    top_3_features: List[str] | None = None
) -> Dict:
    """
    Build response for coverage types with web links (Dental/Vision/Pharmacy).
    
    Args:
        coverage_code: Coverage type code
        has_chat_access: Whether member has CHAT feature access
        has_show_sydapplnk_access: Whether member has SHOW_SYDAPPLNK feature access
        top_3_features: Top 3 features from 5W metadata
        
    Returns:
        Response dict with web link message
    """
    lang = normalize_language_code(RequestContext.get_language() or "en")
    if coverage_code == CoverageTypeCode.DENTAL.value:
        link = COVERAGE_WEB_LINKS.get(CoverageTypeCode.DENTAL, "")
        message = get_message("dental_web_link", lang, link=link)
    elif coverage_code == CoverageTypeCode.VISION.value:
        link = COVERAGE_WEB_LINKS.get(CoverageTypeCode.VISION, "")
        message = get_message("vision_web_link", lang, link=link)
    elif coverage_code == CoverageTypeCode.PHARMACY.value:
        message = "Pharmacy benefits information coming soon."
    else:
        return None
    
    return _build_success_response(
        message,
        has_chat_access,
        has_show_sydapplnk_access,
        top_3_features,
    )


@handle_external_api_errors("call_medical_benefits_api")
async def _call_medical_benefits_api(
    plan: CoveragePeriod,
    benefits_api_client,
    user_query: str,
    channel: str | None,
    meta_trans_id: str | None,
    five_w_metadata: Dict[str, Any] | None,
    has_chat_access: bool,
    has_show_sydapplnk_access: bool,
    top_3_features: List[str] | None = None
) -> Dict:
    """
    Call Medical benefits API and extract response.
    
    Args:
        plan: Coverage period containing plan details
        benefits_api_client: Gateway BenefitsExplainabilityClient
        user_query: User's question
        channel: Channel identifier
        meta_trans_id: Meta transaction ID
        five_w_metadata: Complete 5W metadata from planner (optional)
        has_chat_access: Whether member has CHAT feature access
        has_show_sydapplnk_access: Whether member has SHOW_SYDAPPLNK feature access
        top_3_features: Top 3 features from 5W metadata
        
    Returns:
        Response dict with Medical benefits
    """
    lang = normalize_language_code(RequestContext.get_language() or "en")

    if not plan.members or len(plan.members) == 0:
        logger.error("[COVERAGE_ROUTER] No members found in plan")
        return build_error_response(
            get_message("errors.coverage_not_found", lang),
            has_chat_access,
            has_show_sydapplnk_access,
            top_3_features
        )

    if not five_w_metadata:
        logger.error("[COVERAGE_ROUTER] Missing planner 5W metadata for Medical benefits request")
        return build_error_response(
            get_message("errors.api_error", lang),
            has_chat_access,
            has_show_sydapplnk_access,
            top_3_features
        )

    selected_plan_metadata = align_benefits_metadata_to_selected_plan(
        five_w_metadata,
        plan.model_dump(by_alias=True),
        routed_coverage_type=COVERAGE_TYPE_DISPLAY_NAMES[CoverageTypeCode.MEDICAL],
    )

    logger.info("[COVERAGE_ROUTER] Using planner's complete 5W metadata (no Sydney API calls)")
    response = benefits_api_client.get_api_response_with_5w_metadata(
        user_message=user_query,
        five_w_metadata=selected_plan_metadata,
        meta_trans_id=meta_trans_id,
        channel=channel or Channel.WEB.value
    )
    
    # Guard clause: Check for benefit_response artifact first
    benefit_response_text = _extract_benefit_response_artifact(response)
    if benefit_response_text:
        logger.info("[COVERAGE_ROUTER] Successfully retrieved Medical benefits")
        message = benefit_response_text
    else:
        # Guard clause: Check for status_messages (clarifications)
        status_messages = _extract_status_messages(response)
        if status_messages:
            logger.info("[COVERAGE_ROUTER] Returning API clarification question")
            message = "\n\n".join(status_messages)
        else:
            # Guard clause: Check for errors
            error_messages = _extract_error_messages(response)
            if error_messages:
                logger.error(f"[COVERAGE_ROUTER] API errors: {error_messages}")
                return build_error_response(
                    get_message("errors.api_error", normalize_language_code(RequestContext.get_language() or "en")),
                    has_chat_access,
                    has_show_sydapplnk_access,
                    top_3_features
                )
            
            # No response content found - unexpected
            logger.error("[COVERAGE_ROUTER] Empty API response")
            return build_error_response(
                get_message("errors.api_error", lang),
                has_chat_access,
                has_show_sydapplnk_access,
                top_3_features
            )
    
    plan_info = _extract_plan_info_detail_artifact(response)
    
    return _build_success_response(
        message,
        has_chat_access,
        has_show_sydapplnk_access,
        top_3_features,
        skip_summarization=False,
        extra_fields={
            "extracted_text": message,
            "plan_info": plan_info,
            "_external_api_response": True,
        },
    )


def get_coverage_display_name(coverage_code: str) -> str:
    """
    Get user-friendly display name for a coverage code.
    
    Args:
        coverage_code: Coverage type code (MED, DEN, VSN, PHAR)
        
    Returns:
        Display name (Medical, Dental, Vision, Pharmacy)
    """
    try:
        code_enum = CoverageTypeCode(coverage_code)
        return COVERAGE_TYPE_DISPLAY_NAMES.get(code_enum, coverage_code)
    except ValueError:
        return coverage_code


def extract_coverage_types_from_plan(plan: CoveragePeriod) -> List[str]:
    """
    Extract coverage type codes from a plan's coverageType array.
    
    Uses canonical coverage type CODES from API (MED, DEN, VSN, PHR) which match
    the CoverageTypeCode enum values. These are the authoritative identifiers.
    
    API structure:
        coverageTypeCd: {
            "code": "MED",      # ← Extract this (canonical)
            "name": "Medical",  # ← NOT this (display only)
            "description": "Medical"
        }
    
    Returns:
        List of coverage type codes (e.g., ["MED", "DEN", "VSN", "PHR"])
    """
    coverage_types = []
    
    # CoveragePeriod has extra="allow", so raw API fields are preserved with camelCase names
    if hasattr(plan, 'coverageType'):
        for ct in plan.coverageType:
            if isinstance(ct, dict):
                code = (ct.get("coverageTypeCd") or {}).get("code", "")
                if code:
                    coverage_types.append(code)
    
    logger.info(
        f"Extracted coverage types from plan: {coverage_types}",
        extra={"plan_name": plan.plan_name, "coverage_types": coverage_types}
    )
    
    return coverage_types


async def route_by_coverage_type(
    plan: CoveragePeriod,
    requested_coverage_type: str,
    benefits_api_client,
    user_query: str,
    channel: str | None = None,
    meta_trans_id: str | None = None,
    five_w_metadata: Dict[str, Any] | None = None,
    has_chat_access: bool = False,
    has_show_sydapplnk_access: bool = False,
    top_3_features: List[str] | None = None
) -> Dict:
    """
    Route to specific coverage type.
    
    Handler is responsible for orchestration (multi-coverage selection).
    This function only routes to a SPECIFIC coverage type.
    
    Args:
        plan: Coverage period to route
        requested_coverage_type: SPECIFIC coverage type (MEDICAL/DENTAL/VISION/PHARMACY or code)
        benefits_api_client: Gateway BenefitsExplainabilityClient
        user_query: Actual user query string
        channel: Channel identifier (web, sms, etc.)
        meta_trans_id: Meta transaction ID
        five_w_metadata: Complete 5W metadata from planner (optional for backward compat)
        has_chat_access: Whether member has CHAT feature access
        has_show_sydapplnk_access: Whether member has SHOW_SYDAPPLNK feature access
        top_3_features: Top 3 features from 5W metadata
        
    Returns:
        Response dict with message and metadata
    """
    # Normalize requested coverage type
    target_coverage_code = _determine_target_coverage(requested_coverage_type)
    
    lang = normalize_language_code(RequestContext.get_language() or "en")
    if not target_coverage_code:
        logger.error(f"[COVERAGE_ROUTER] Failed to normalize: {requested_coverage_type}")
        return build_error_response(
            get_message("errors.unexpected_error", lang),
            has_chat_access,
            has_show_sydapplnk_access,
            top_3_features
        )
    
    # Validate coverage type is available in plan
    coverage_types = extract_coverage_types_from_plan(plan)
    if not _is_coverage_available(target_coverage_code, coverage_types):
        logger.warning(
            f"[COVERAGE_ROUTER] Requested '{requested_coverage_type}' (code: {target_coverage_code}) "
            f"not in plan: {coverage_types}"
        )
        display_names = [get_coverage_display_name(code) for code in coverage_types]
        available_types = ", ".join(display_names)
        return build_error_response(
            get_message(
                "coverage_not_found",
                lang,
                coverage_type=get_coverage_display_name(target_coverage_code),
                available_types=available_types
            ),
            has_chat_access,
            has_show_sydapplnk_access,
            top_3_features
        )
    
    logger.info(f"[COVERAGE_ROUTER] Routing to: {target_coverage_code} ({get_coverage_display_name(target_coverage_code)})")
    
    # Medical coverage
    if target_coverage_code == CoverageTypeCode.MEDICAL.value:
        logger.info("[COVERAGE_ROUTER] Calling gateway Medical benefits API")
        return await _call_medical_benefits_api(
            plan,
            benefits_api_client,
            user_query,
            channel,
            meta_trans_id,
            five_w_metadata,
            has_chat_access,
            has_show_sydapplnk_access,
            top_3_features
        )

    # Dental/Vision/Pharmacy coverage types
    web_link_response = _build_web_link_response(
        target_coverage_code,
        has_chat_access,
        has_show_sydapplnk_access,
        top_3_features
    )
    if web_link_response:
        return web_link_response
    
    # Unknown coverage type
    logger.warning(f"[COVERAGE_ROUTER] Unknown coverage type code: {target_coverage_code}")
    return build_error_response(
        get_message("errors.unexpected_error", lang),
        has_chat_access,
        has_show_sydapplnk_access,
        top_3_features
    )


===========================================================================================================

"""
Centralized error response builder with live agent options.
"""

from typing import Dict, List

from agents.benefits_agent.constants import AGENT_NAME
from agents.benefits_agent.helpers.live_agent_handler import append_live_agent_follow_up


def build_error_response(
    message: str,
    has_chat_access: bool = False,
    has_show_sydapplnk_access: bool = False,
    top_3_features: List[str] | None = None,
    skip_summarization: bool = True
) -> Dict:
    """Build error response with live agent options."""
    final_message = message
    response_fields = {}

    try:
        follow_up = append_live_agent_follow_up(
            message,
            has_chat_access,
            has_show_sydapplnk_access,
            top_3_features,
        )
        if follow_up:
            final_message = follow_up.pop("message", final_message)
            response_fields = follow_up
    except Exception:
        pass

    return {
        "message": final_message,
        "skip_summarization": skip_summarization,
        "_agent_name": AGENT_NAME,
        **response_fields,
    }


=====================================================================================================

"""Live agent routing logic based on member feature access."""

from typing import Any, Dict, List

from agents.benefits_agent.constants import LIVE_AGENT_LINKS
from agents.benefits_agent.i18n.messages import get_message
from utils.features.features import Feature
from utils.language_utils import normalize_language_code
from utils.live_chat_integration_topic import LiveChatTopics
from utils.logging.request_context import RequestContext


def build_live_agent_follow_up(
    has_chat_access: bool,
    has_show_sydapplnk_access: bool,
    top_3_features: List[str] | None = None,
) -> Dict[str, Any]:
    lang = normalize_language_code(RequestContext.get_language() or "en")

    if has_chat_access:
        return {
            "message": get_message("live_agent_consent", lang),
            "live_chat_topic_required": True,
            "live_chat_topic_to_connect": LiveChatTopics.BENEFITS_AND_COVERAGE.value,
        }

    if has_show_sydapplnk_access:
        return {
            "message": get_message(
                "sydney_app_download",
                lang,
                app_store_url=LIVE_AGENT_LINKS["app_store_url"],
                google_play_url=LIVE_AGENT_LINKS["google_play_url"],
            )
        }

    localized_features = _localize_top_features(top_3_features, lang)
    if not localized_features:
        return {}

    return {
        "message": get_message(
            "no_live_agent_fallback",
            lang,
            features=", ".join(localized_features),
        )
    }


def append_live_agent_follow_up(
    message: str,
    has_chat_access: bool,
    has_show_sydapplnk_access: bool,
    top_3_features: List[str] | None = None,
) -> Dict[str, Any]:
    if not message:
        return {}

    follow_up = build_live_agent_follow_up(
        has_chat_access=has_chat_access,
        has_show_sydapplnk_access=has_show_sydapplnk_access,
        top_3_features=top_3_features,
    )
    follow_up_message = follow_up.pop("message", "")
    if not follow_up_message:
        return {}

    return {
        "message": f"{message}\n\n{follow_up_message}",
        **follow_up,
    }


def _localize_top_features(top_3_features: List[str] | None, language: str) -> List[str]:
    localized_features = []

    for feature_name in top_3_features or []:
        feature = Feature.__members__.get(feature_name)
        localized_features.append(
            feature.get_localized_name(language) if feature else feature_name
        )

    return localized_features

==================================================================================================

"""Plan selection logic for multiple plans."""

from datetime import datetime
from typing import Dict, List, Optional

from agents.benefits_agent.constants import AGENT_NAME
from agents.benefits_agent.helpers.error_response_builder import build_error_response
from agents.benefits_agent.i18n import get_message
from agents.benefits_agent.schemas import CoveragePeriod
from utils.language_utils import normalize_language_code
from utils.logging.request_context import RequestContext
from utils.logging.structured_logger import StructuredLogger

logger = StructuredLogger(__name__)


def _format_plan_dates(
    start_date: str,
    end_date: Optional[str],
    is_active: bool = False,
    is_future: bool = False
) -> str:
    """
    Format plan dates (copied from Plan Info Agent date_formatter).
    
    Rules:
    - Active with end date: "MM-DD-YYYY to MM-DD-YYYY"
    - Future: "Start Date: MM-DD-YYYY"
    - Active without end: "MM-DD-YYYY to Present"
    """
    def format_date(date_str: str) -> str:
        try:
            date_obj = datetime.strptime(date_str, "%Y-%m-%d")
            return date_obj.strftime("%m-%d-%Y")
        except (ValueError, TypeError):
            return date_str
    
    formatted_start = format_date(start_date) if start_date else "N/A"
    
    if is_future and not end_date:
        return f"Start Date: {formatted_start}"
    
    if is_active and not end_date:
        return f"{formatted_start} to Present"
    
    if end_date:
        formatted_end = format_date(end_date)
        return f"{formatted_start} to {formatted_end}"
    
    return formatted_start


def build_multi_plan_response(plans: List[CoveragePeriod]) -> Dict:
    """Display multiple plans with numbered list (matches Plan Info Agent format)."""
    logger.info(f"Displaying {len(plans)} active plans")
    
    lang = normalize_language_code(RequestContext.get_language() or "en")
    header = get_message("multiple_plans_found", lang, count=len(plans))
    
    plan_lines = []
    for idx, plan in enumerate(plans, start=1):
        plan_name = plan.plan_name or "Your Plan"
        
        # Format dates like Plan Info Agent (not coverage types!)
        today = datetime.now().date()
        start_date = datetime.strptime(plan.effective_date, "%Y-%m-%d").date() if plan.effective_date else today
        is_future = start_date > today
        
        # Format: "MM-DD-YYYY to MM-DD-YYYY" or "Start Date: MM-DD-YYYY"
        date_range = _format_plan_dates(
            start_date=plan.effective_date,
            end_date=plan.termination_date,
            is_active=not is_future,
            is_future=is_future
        )
        
        plan_lines.append(f"{idx}. {plan_name} ({date_range})")
    
    # Use same instruction as Plan Info Agent
    selection_instruction = get_message("select_plan_instruction", lang)
    
    message_parts = [header, ""] + plan_lines + ["", selection_instruction]
    
    return {
        "message": "\n".join(message_parts),
        "skip_summarization": True,
        "_agent_name": AGENT_NAME
    }


async def handle_plan_selection(
    plan_number: int,
    active_plans: List[CoveragePeriod],
    coverage_router_handler,
    has_chat_access: bool = False,
    has_show_sydapplnk_access: bool = False,
    top_3_features: List[str] | None = None
) -> Dict:
    """
    Handle plan selection by number.
    
    Args:
        plan_number: 1-based plan number selected by user
        active_plans: List of active coverage periods
        coverage_router_handler: Function to route single plan by coverage type
        has_chat_access: Whether member has CHAT feature access
        has_show_sydapplnk_access: Whether member has SHOW_SYDAPPLNK feature access
        top_3_features: Top 3 features from 5W metadata
        
    Returns:
        Response dict or error if invalid selection
    """
    logger.info(f"[PLAN_SELECTION] User selected plan #{plan_number}")
    
    # Validate plan number (1-based index)
    if plan_number < 1 or plan_number > len(active_plans):
        logger.warning(
            f"[PLAN_SELECTION] Invalid selection: {plan_number} (total: {len(active_plans)})"
        )
        return build_error_response(
            get_message(
                "errors.invalid_plan_number",
                normalize_language_code(RequestContext.get_language() or "en"),
                plan_number=plan_number,
                total=len(active_plans)
            ),
            has_chat_access,
            has_show_sydapplnk_access,
            top_3_features
        )
    
    # Get selected plan (convert 1-based to 0-based index)
    selected_plan = active_plans[plan_number - 1]
    
    logger.info(f"[PLAN_SELECTION] Displaying plan #{plan_number}: {selected_plan.plan_name}")
    
    # Route selected plan through coverage router
    return await coverage_router_handler(selected_plan)

=============================================================================================================

# Benefits Coverage Type Classifier
# Classifies user queries into coverage type intents

prompt: |
  You are a healthcare benefits specialist. Classify the user's query into ONE coverage type intent.

  **CLASSIFICATION RULES:**
  
  1. **MEDICAL** - Medical/health coverage questions OR vague/general queries (DEFAULT)
     Examples: 
     - Explicit medical: "medical benefits", "doctor coverage", "health plan", "hospital coverage"
     - Vague/general: "what are my benefits?", "show my coverage", "what do I have?"
     - Plan progress/accumulators: "deductible progress", "out-of-pocket remaining", "how much have I spent?", "what's my deductible?", "accumulator", "year-to-date spending"
     Keywords: medical, health, doctor, hospital, physician, surgery, emergency, clinic, deductible, out-of-pocket, accumulator, progress, spent, remaining, year-to-date, oopm, met
     DEFAULT: Use MEDICAL when no specific coverage type is mentioned
     IMPORTANT: All accumulator/progress queries default to MEDICAL unless explicitly mentioning dental/vision/pharmacy
     
  2. **DENTAL** - Dental coverage questions (EXPLICIT ONLY)
     Examples: "dental benefits", "dentist coverage", "teeth cleaning", "orthodontic"
     Keywords: dental, dentist, teeth, tooth, orthodontic, oral, cavity, crown, braces
     MUST explicitly mention dental/dentist keywords
     
  3. **VISION** - Vision/eye coverage questions (EXPLICIT ONLY)
     Examples: "vision benefits", "eye coverage", "glasses", "contact lenses"
     Keywords: vision, eye, glasses, contacts, optometry, ophthalmology, eyewear
     MUST explicitly mention vision/eye keywords
     
  4. **PHARMACY** - Prescription/medication coverage (EXPLICIT ONLY)
     Examples: "prescription coverage", "medication benefits", "drug coverage"
     Keywords: pharmacy, prescription, medication, drug, formulary, rx, prescriptions
     MUST explicitly mention pharmacy/prescription keywords
     
  5. **SELECT_PLAN** - Plan selection from numbered list OR by plan name
     Examples: 
     - By number: "show plan 2", "I want plan #3", "plan number 1"
     - By ordinal: "the second one", "the first plan", "the last one"
     - By name: "show me athm Blue Cross PPO", "I want the Gold Plan"
     
     Patterns: 
     - Explicit number (1, 2, 3)
     - Ordinal (first, second, third, last)
     - Plan name match (if user query contains a plan name from the available plans list)
     
     **SELECTION MAPPING** (when plan list is provided):
     - "plan 1" / "plan #1" → plan_number: 1
     - "first one" / "first" → plan_number: 1
     - "second one" / "second" → plan_number: 2
     - "third one" / "third" → plan_number: 3
     - "last one" / "last" → plan_number: [count of available plans]
     - Plan name substring match → plan_number: [matching position in list]
       Example: If plan list has "1. athm Blue Cross PPO" and user says "Blue Cross", 
                return plan_number: 1
     
  6. **GENERAL** - Multiple coverage types mentioned together (RARE)
     Examples: "medical and dental benefits?", "show me all coverage types"
     Use ONLY when: 
     - User explicitly asks for multiple coverage types together
     - Cannot determine a single coverage type
     Note: This is rarely used. Most vague queries should be MEDICAL.

  **COVERAGE TYPE IS ALWAYS CLASSIFIED SEPARATELY:**

  Always fill `coverage_type` from the coverage/service words in the query, even when `intent` is SELECT_PLAN.
  Use NONE only when the query names no coverage type and no medical/dental/vision/pharmacy service.
  - "Show MRI benefits for athm POS (01-01-2026 to 12-31-2026)" → intent: SELECT_PLAN, plan_number: 2, coverage_type: MEDICAL
  - "dental benefits for plan 1" → intent: SELECT_PLAN, plan_number: 1, coverage_type: DENTAL
  - "athm POS" / "plan 2" → intent: SELECT_PLAN, plan_number: 2, coverage_type: NONE
  - "what are my benefits?" → intent: MEDICAL, plan_number: null, coverage_type: NONE
  - "my prescription coverage" → intent: PHARMACY, plan_number: null, coverage_type: PHARMACY
  Infer the coverage type from the named service, not just from the words "medical"/"dental"/"vision"/"pharmacy":
  - MEDICAL services: MRI, CT, PET, x-ray, ultrasound, mammogram, colonoscopy, imaging, radiology, lab work, blood test,
    surgery, hospital stay, emergency room, urgent care, office visit, specialist, primary care, physical therapy,
    maternity, immunization, annual physical, preventive care, mental health, telehealth, durable medical equipment
  - DENTAL services: cleaning, filling, crown, root canal, extraction, braces, orthodontics, x-ray of teeth, periodontal
  - VISION services: eye exam, glasses, frames, lenses, contact lenses, optometrist, ophthalmologist
  - PHARMACY services: prescription, refill, generic/brand drug, formulary, specialty medication, mail order Rx

  **QUERY REWRITE FOR EXTERNAL BENEFITS CALL:**
  
  Always return `rewritten_query` for downstream external benefits calls.
  - Preserve the user's actual benefits question, requested service, and requested coverage type.
  - Remove personal names or family-member names when present.
  - Remove explicit plan names when present, including matches from the available plans list.
  - Remove plan-selection date ranges or other plan-list-only identifiers when present.
  - Do not add new facts.
  - If no rewrite is needed, return the original user query unchanged.
  
  Examples:
  - "Show MRI benefits for JOHN on athm POS (01-01-2026 to 12-31-2026)" → rewritten_query: "Show MRI benefits"
  - "What are Jane's dental benefits under athm Gold" → rewritten_query: "What are dental benefits"
  - "What's my deductible?" → rewritten_query: "What's my deductible?"
  
  **IMPORTANT DISTINCTIONS:**
  
  - "What are my medical benefits?" → MEDICAL (explicit medical)
  - "What are my benefits?" → MEDICAL (vague, defaults to medical)
  - "Medical and dental benefits?" → GENERAL (multiple types explicitly)
  - "Show plan 2" → SELECT_PLAN (has number)
  - "Show me athm Blue Cross" → SELECT_PLAN (has plan name)
  - "Do I have vision?" → VISION (explicit vision)
  - "Do I have dental coverage?" → DENTAL (explicit dental)
  - "What coverage do I have?" → MEDICAL (vague, defaults to medical)
  
  **ACCUMULATOR/PROGRESS QUERIES (ALWAYS MEDICAL UNLESS EXPLICIT):**
  - "What's my deductible?" → MEDICAL (default)
  - "How much have I spent?" → MEDICAL (default)
  - "Out-of-pocket maximum progress" → MEDICAL (default)
  - "Show my year-to-date spending" → MEDICAL (default)
  - "Dental deductible progress" → DENTAL (explicit dental mention)
  - "Vision out-of-pocket remaining" → VISION (explicit vision mention)

  **VAGUE/AMBIGUOUS QUERIES DEFAULT TO MEDICAL:**
  - If unsure → MEDICAL (not GENERAL)
  - If no specific type mentioned → MEDICAL (not GENERAL)
  - Only use GENERAL if multiple types explicitly mentioned
  - MEDICAL is the safe default

  **NOW CLASSIFY:**
  
  **USER'S ACTUAL QUERY (classify THIS only):**
  "{query}"
  
  **AVAILABLE PLANS (for plan selection context):**{plan_list}
  
  **CRITICAL**: Only classify the user's actual words above. The available plans list is provided to:
  - Resolve numeric references (e.g., "plan 2" means the 2nd item in the list)
  - Match plan names (e.g., if user says "Blue Cross" and plan 1 is "athm Blue Cross PPO", return plan_number: 1)
  - Validate ordinals (e.g., "last" refers to the last plan in the list)
  
  Think step-by-step:
  1. Does THE USER'S QUERY contain a plan number (1, 2, 3, etc.)? → SELECT_PLAN
  2. Does THE USER'S QUERY contain an ordinal (first, second, last)? → SELECT_PLAN
  3. Does THE USER'S QUERY contain a plan name from the available plans list? → SELECT_PLAN
  4. Does THE USER'S QUERY explicitly mention multiple coverage types together? → GENERAL
  5. Does THE USER'S QUERY specifically mention dental keywords? → DENTAL
  6. Does THE USER'S QUERY specifically mention vision/eye keywords? → VISION
  7. Does THE USER'S QUERY specifically mention pharmacy/prescription keywords? → PHARMACY
  8. Otherwise (including medical keywords or vague queries) → MEDICAL (DEFAULT)
  9. Independently of steps 1-8, set `coverage_type` from the coverage/service words in the query (NONE if there are none)
  10. Return `rewritten_query` using the rewrite rules above

schema:
  type: object
  properties:
    intent:
      type: string
      enum: ["GENERAL", "MEDICAL", "DENTAL", "VISION", "PHARMACY", "SELECT_PLAN"]
      description: "The classified coverage type intent"
    confidence:
      type: string
      enum: ["high", "medium", "low"]
      description: "Confidence level of the classification"
    plan_number:
      type: integer
      description: "Extracted plan number if intent is SELECT_PLAN (1-based index), otherwise null"
      nullable: true
    coverage_type:
      type: string
      enum: ["MEDICAL", "DENTAL", "VISION", "PHARMACY", "NONE"]
      description: "Coverage type implied by the query, independent of intent. NONE when the query implies no specific coverage type."
    rewritten_query:
      type: string
      description: "The user query rewritten for the external benefits call, preserving the question while removing names, plan names, and plan-list-only identifiers when present."
    reasoning:
      type: string
      description: "Brief explanation of why this intent was chosen"
  required: ["intent", "confidence", "plan_number", "coverage_type", "rewritten_query", "reasoning"]
  additionalProperties: false

================================================================================================================

"""
Benefits Agent Intent Constants.

Defines coverage type intents specific to benefits requests.
Pattern from plan_info_agent/llm/intents.py

KEY DIFFERENCE: Benefits uses COVERAGE TYPE intents, not ACTION intents.
Plan Info: OVERVIEW, RENEW, CANCEL (what action?)
Benefits: GENERAL, MEDICAL, DENTAL, VISION (which coverage type?)
"""

from enum import Enum


class BenefitsIntent(str, Enum):
    """
    Coverage type intents (internal to Benefits Agent).
    
    These intents are classified by the BenefitsQueryAnalyzer and determine
    which coverage type to route to.
    
    Note: These are NOT action intents like Plan Info Agent.
    Benefits focuses on WHICH coverage type, not WHAT action.
    """
    
    GENERAL = "GENERAL"           # Vague query: "what are my benefits?"
    MEDICAL = "MEDICAL"           # Medical coverage: "medical benefits", "health coverage"
    DENTAL = "DENTAL"             # Dental coverage: "dental benefits", "dentist"
    VISION = "VISION"             # Vision coverage: "vision benefits", "eye care"
    PHARMACY = "PHARMACY"         # Pharmacy coverage: "prescription", "medication"
    SELECT_PLAN = "SELECT_PLAN"   # Plan selection: "show plan 2", "plan number 1"

=============================================================================================================

"""
Benefits Query Analyzer.

Uses LLM to classify user queries into coverage type intents.
Pattern from plan_info_agent/llm/query_analyzer.py

KEY DIFFERENCE: Classifies into coverage types (MEDICAL, DENTAL, VISION)
not action types (RENEW, CANCEL).
"""

from typing import Optional

from utils.horizon_structures import call_horizon_structures
from utils.logging.structured_logger import get_logger

from .intents import BenefitsIntent
from .prompts import (
    BENEFITS_COVERAGE_CLASSIFIER_PROMPT,
    BENEFITS_COVERAGE_CLASSIFIER_SCHEMA,
)

logger = get_logger(__name__)


def _normalize_coverage_type(coverage_type: Optional[str]) -> Optional[str]:
    """Map the classifier's coverage_type field to an intent name, or None."""
    normalized = (coverage_type or "").strip().upper()
    if not normalized or normalized == "NONE":
        return None
    return normalized


def _normalize_rewritten_query(rewritten_query: Optional[str]) -> Optional[str]:
    """Normalize the classifier's rewritten_query field."""
    normalized = (rewritten_query or "").strip()
    if not normalized or normalized.upper() == "NONE":
        return None
    return normalized


class QueryAnalysisResult:
    """Result of coverage type query analysis."""
    
    def __init__(
        self,
        intent: str,
        confidence: str,
        plan_number: Optional[int] = None,
        reasoning: str = "",
        coverage_type: Optional[str] = None,
        rewritten_query: Optional[str] = None,
    ):
        self.intent = intent
        self.confidence = confidence
        self.plan_number = plan_number
        self.reasoning = reasoning
        self.coverage_type = coverage_type
        self.rewritten_query = rewritten_query

    def __repr__(self) -> str:
        return (
            f"QueryAnalysisResult(intent={self.intent}, "
            f"confidence={self.confidence}, "
            f"plan_number={self.plan_number}, "
            f"coverage_type={self.coverage_type}, "
            f"has_rewritten_query={bool(self.rewritten_query)})"
        )


class BenefitsQueryAnalyzer:
    """
    Analyzes user queries to determine coverage type intent.
    
    Uses Horizon structured completions API to classify queries into:
    - GENERAL: "what are my benefits?" (no specific type)
    - MEDICAL: "medical benefits", "doctor coverage"
    - DENTAL: "dental benefits", "dentist coverage"
    - VISION: "vision benefits", "eye coverage"
    - PHARMACY: "prescription benefits", "medication coverage"
    - SELECT_PLAN: "show plan 2", "plan number 1"
    """

    def __init__(self, timeout: int = 5):
        """
        Initialize coverage type query analyzer.
        
        Args:
            timeout: LLM API timeout in seconds (default: 5)
        """
        self.timeout = timeout
        logger.info(f"[BENEFITS_QUERY_ANALYZER] Initialized with timeout={timeout}s")

    async def analyze_query(
        self,
        user_query: str,
        channel: str | None = None,
        plan_context: list[str] | None = None
    ) -> QueryAnalysisResult:
        """
        Analyze user query and classify into coverage type intent.
        
        Args:
            user_query: The user's question/request
            channel: Communication channel (sms or web)
            plan_context: List of available plan names for context (helps extract plan numbers)
                          Example: ["athm Blue Cross PPO", "athm Gold Plan"]
            
        Returns:
            QueryAnalysisResult with classified coverage type intent and metadata
            
        Example:
            >>> result = await analyzer.analyze_query("What are my medical benefits?")
            >>> result.intent
            'MEDICAL'
        """
        if not user_query or not user_query.strip():
            logger.warning("[BENEFITS_QUERY_ANALYZER] Empty query, defaulting to MEDICAL")
            return self._create_fallback_result("Empty query provided")

        try:
            logger.info(
                "[BENEFITS_QUERY_ANALYZER] Analyzing query",
                query_length=len(user_query),
                channel=channel,
                plan_count=len(plan_context) if plan_context else 0
            )

            # Build plan list context for prompt
            plan_list_text = ""
            if plan_context and len(plan_context) > 0:
                plan_list_text = "\n" + "\n".join([
                    f"{i+1}. {plan_name}" 
                    for i, plan_name in enumerate(plan_context)
                ])

            # Build prompt with user query and plan context
            prompt = BENEFITS_COVERAGE_CLASSIFIER_PROMPT.format(
                query=user_query,
                plan_list=plan_list_text
            )

            # Call Horizon structured completions API
            result = await call_horizon_structures(
                prompt=prompt,
                schema=BENEFITS_COVERAGE_CLASSIFIER_SCHEMA,
                timeout=self.timeout,
                channel=channel
            )

            # Extract classification (default to MEDICAL for vague queries)
            intent = result.get("intent", BenefitsIntent.MEDICAL)
            confidence = result.get("confidence", "low")
            plan_number = result.get("plan_number")
            reasoning = result.get("reasoning", "")
            coverage_type = _normalize_coverage_type(result.get("coverage_type"))
            rewritten_query = _normalize_rewritten_query(result.get("rewritten_query"))

            logger.info(
                "[BENEFITS_QUERY_ANALYZER] Query classified",
                intent=intent,
                confidence=confidence,
                plan_number=plan_number,
                coverage_type=coverage_type,
                reasoning=reasoning,
                rewrite_applied=bool(rewritten_query and rewritten_query != user_query.strip()),
            )

            return QueryAnalysisResult(
                intent=intent,
                confidence=confidence,
                plan_number=plan_number,
                reasoning=reasoning,
                coverage_type=coverage_type,
                rewritten_query=rewritten_query,
            )

        except Exception as e:
            logger.error(
                f"[BENEFITS_QUERY_ANALYZER] Classification failed: {e}",
                query=user_query,
                exc_info=True
            )
            return self._create_fallback_result(f"LLM error: {str(e)}")

    def _create_fallback_result(self, reason: str) -> QueryAnalysisResult:
        """
        Create fallback result when analysis fails.
        
        Args:
            reason: Reason for fallback
            
        Returns:
            QueryAnalysisResult with MEDICAL intent (safe default)
        """
        logger.warning(f"[BENEFITS_QUERY_ANALYZER] Using fallback MEDICAL intent: {reason}")
        
        return QueryAnalysisResult(
            intent=BenefitsIntent.MEDICAL,
            confidence="low",
            plan_number=None,
            reasoning=f"Fallback: {reason}"
        )

==============================================================================================================

"""
Request validation schemas for Benefits Agent.

Pydantic models for validating 5W Healthcare Extension metadata.
"""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, field_validator


class Identifier(BaseModel):
    """Identifier in 5W metadata."""
    type: str = Field(..., description="Identifier type (e.g., 'member-contrived-id')")
    value: str = Field(..., description="Identifier value")


class FiveWWho(BaseModel):
    """Who section in 5W metadata."""
    role: str = Field(..., description="Role (e.g., '5w.who.asked', '5w.who.about')")
    identifier: List[Identifier] = Field(default_factory=list, description="List of identifiers")
    relationship: Optional[str] = Field(default="self", description="Relationship to target")
    firstName: Optional[str] = Field(default=None, description="First name")
    lastName: Optional[str] = Field(default=None, description="Last name")
    
    @field_validator("identifier")
    @classmethod
    def validate_identifiers(cls, v: List[Identifier]) -> List[Identifier]:
        """Ensure at least one member-contrived-id exists."""
        if not v:
            return v
        
        has_member_id = any(id.type == "member-contrived-id" for id in v)
        if not has_member_id:
            raise ValueError("At least one 'member-contrived-id' identifier is required")
        
        return v


class FiveWWhatServiceCoverage(BaseModel):
    """Coverage section in 5W what.service."""
    type: List[str] = Field(default_factory=list, description="Coverage types")


class FiveWWhatService(BaseModel):
    """What service section in 5W metadata."""
    chat_access: bool = Field(default=False, description="Chat feature access")
    has_show_sydapplnk_access: bool = Field(default=False, description="Sydney app link access")
    top_3_features: List[str] = Field(default_factory=list, description="Top 3 features")
    coverage: FiveWWhatServiceCoverage = Field(default_factory=FiveWWhatServiceCoverage, description="Coverage data")


class FiveWWhyService(BaseModel):
    """Why service section in 5W metadata."""
    intent: List[str] = Field(default_factory=list, description="List of intents")


class FiveWProfile(BaseModel):
    """Profile section in 5W metadata."""
    channel: Optional[str] = Field(default=None, description="Channel (web, sms, etc.)")


class FiveWMetadata(BaseModel):
    """
    Complete 5W Healthcare Extension metadata.
    
    Validates the structure and required fields of 5W metadata
    passed from the planner/orchestrator.
    """
    
    # Required sections
    five_w_who_asked: FiveWWho = Field(..., alias="5w.who.asked", description="Who asked the question")
    five_w_who_about: FiveWWho = Field(..., alias="5w.who.about", description="Who the question is about")
    five_w_what_service: FiveWWhatService = Field(..., alias="5w.what.service", description="What service")
    five_w_why_service: FiveWWhyService = Field(..., alias="5w.why.service", description="Why service (intent)")
    
    # Optional sections
    profile: Optional[FiveWProfile] = Field(default=None, description="Profile information")
    
    class Config:
        populate_by_name = True  # Allow both alias and field name
        extra = "allow"  # Allow extra fields (forward compatibility)


class BenefitsRequest(BaseModel):
    """
    Complete Benefits Agent request.
    
    Validates the entire request payload including metadata and query.
    """
    
    five_w_metadata: Dict[str, Any] = Field(..., description="5W Healthcare Extension metadata")
    user_query: str = Field(..., min_length=1, description="User's question")
    channel: Optional[str] = Field(default=None, description="Channel (web, sms, etc.)")
    context_id: Optional[str] = Field(default=None, description="Context ID for correlation")
    message_id: Optional[str] = Field(default=None, description="Message ID")
    meta_trans_id: Optional[str] = Field(default=None, description="Transaction ID")
    
    @field_validator("user_query")
    @classmethod
    def validate_user_query(cls, v: str) -> str:
        """Ensure query is not just whitespace."""
        if not v or not v.strip():
            raise ValueError("user_query cannot be empty or whitespace")
        return v.strip()

==========================================================================================================

"""
Benefits Response Builder.

Formats A2A responses for benefits information.
"""

from typing import Dict, List

from agents.benefits_agent.constants import AGENT_NAME
from utils.logging.structured_logger import StructuredLogger

logger = StructuredLogger(__name__)


class BenefitsResponseBuilder:
    """Builds A2A responses for benefits information."""
    
    def __init__(self):
        """Initialize response builder."""
        logger.info("[RESPONSE_BUILDER] Initialized")

    def build_plan_list_response(
        self,
        plans: List,
        message: str
    ) -> Dict:
        """
        Build response for multiple plans (AC-04).
        
        Args:
            plans: List of CoveragePeriod objects
            message: Formatted message with plan list
            
        Returns:
            A2A response dict
        """
        return {
            "message": message,
            "skip_summarization": True,
            "_agent_name": AGENT_NAME,
            "plan_count": len(plans)
        }

    def build_success_response(self, message: str, **kwargs) -> Dict:
        """
        Build standard success response.
        
        Args:
            message: Response message
            **kwargs: Additional fields to include
            
        Returns:
            A2A response dict
        """
        response = {
            "message": message,
            "skip_summarization": True,
            "_agent_name": AGENT_NAME,
            "success": True
        }
        response.update(kwargs)
        return response

=============================================================================================================

"""Configuration Validation Utilities for Benefits Agent."""

from typing import Any, Dict, List, Optional


class ConfigValidationError(Exception):
    """Raised when configuration validation fails."""
    
    def __init__(self, errors: List[str]):
        self.errors = errors
        super().__init__(f"Configuration validation failed: {'; '.join(errors)}")


def validate_benefits_config(config: Dict[str, Any], channel: Optional[str] = None) -> None:
    """
    Validate Benefits Agent configuration at startup.
    
    Args:
        config: Complete configuration dictionary
        channel: Optional channel for channel-specific validation
        
    Raises:
        ConfigValidationError: If any required config is missing or invalid
    """
    errors: List[str] = []
    
    if not config.get("authorization_token_config"):
        errors.append("Missing required config: authorization_token_config")
    else:
        auth_config = config["authorization_token_config"]
        if not auth_config.get("base_url"):
            errors.append("authorization_token_config.base_url is required")
    
    if not config.get("soa_sydney_api"):
        errors.append("Missing required config: soa_sydney_api")
    else:
        soa_config = config["soa_sydney_api"]
        if not soa_config.get("base_url"):
            errors.append("soa_sydney_api.base_url is required")
    
    if not config.get("benefits_web_links"):
        errors.append("Missing required config: benefits_web_links")
    else:
        web_links = config["benefits_web_links"]
        if not web_links.get("dental_url"):
            errors.append("benefits_web_links.dental_url is required")
        if not web_links.get("vision_url"):
            errors.append("benefits_web_links.vision_url is required")
    
    if errors:
        raise ConfigValidationError(errors)


def get_config_status(config: Dict[str, Any]) -> Dict[str, Any]:
    """
    Get configuration status for health checks.
    
    Args:
        config: Configuration dictionary
        
    Returns:
        Dictionary with config status details
    """
    try:
        validate_benefits_config(config)
        return {
            "valid": True,
            "errors": [],
            "config_keys": list(config.keys()),
        }
    except ConfigValidationError as e:
        return {
            "valid": False,
            "errors": e.errors,
            "config_keys": list(config.keys()),
        }

==============================================================================================================

"""Error handling for Benefits Agent."""

from functools import wraps
from http import HTTPStatus
from inspect import signature
from typing import Any, Callable, Dict, TypeVar

from agents.benefits_agent.exceptions import BenefitsAgentError, ErrorCategory
from agents.benefits_agent.helpers.live_agent_handler import append_live_agent_follow_up
from agents.benefits_agent.i18n import get_message
from utils.language_utils import normalize_language_code
from utils.logging.request_context import RequestContext
from utils.logging.structured_logger import StructuredLogger

logger = StructuredLogger(__name__)

T = TypeVar('T')


def handle_coverage_api_errors(tool_name: str):
    """
    Decorator for Coverage API error handling.
    
    Transforms coverage API errors into BenefitsAgentError with
    user-friendly messages.
    
    Args:
        tool_name: Name of the tool/function for logging context
        
    Example:
        @handle_coverage_api_errors("extract_active_plans")
        def extract_active_plans(...):
            return process_coverage_data(...)
    """
    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @wraps(func)
        def wrapper(*args, **kwargs) -> T:
            meta_trans_id = kwargs.get('meta_trans_id')
            live_agent_context = _extract_live_agent_context(func, args, kwargs)

            try:
                return func(*args, **kwargs)

            except ValueError as exc:
                logger.error(
                    f"[BENEFITS_AGENT] {tool_name} validation error",
                    extra={
                        "meta_trans_id": meta_trans_id,
                        "tool": tool_name,
                        "error_type": type(exc).__name__
                    },
                    exc_info=True
                )
                user_message = get_message("errors.coverage_not_found", normalize_language_code(RequestContext.get_language() or "en"))
                raise BenefitsAgentError(
                    category=ErrorCategory.VALIDATION,
                    user_message=user_message,
                    status_code=HTTPStatus.BAD_REQUEST,
                    technical_details=f"{tool_name} validation error: {str(exc)}",
                    log_extra={"meta_trans_id": meta_trans_id, "tool": tool_name},
                    response_fields=_build_live_agent_response_fields(user_message, live_agent_context)
                ) from exc

            except Exception as exc:
                logger.error(
                    f"[BENEFITS_AGENT] {tool_name} unexpected error",
                    extra={
                        "meta_trans_id": meta_trans_id,
                        "tool": tool_name,
                        "error_type": type(exc).__name__
                    },
                    exc_info=True
                )
                user_message = get_message("errors.unexpected_error", normalize_language_code(RequestContext.get_language() or "en"))
                raise BenefitsAgentError(
                    category=ErrorCategory.INTERNAL,
                    user_message=user_message,
                    status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
                    technical_details=f"{tool_name} unexpected error: {type(exc).__name__}",
                    log_extra={"meta_trans_id": meta_trans_id, "tool": tool_name},
                    response_fields=_build_live_agent_response_fields(user_message, live_agent_context)
                ) from exc

        return wrapper
    return decorator


def handle_external_api_errors(tool_name: str):
    """
    Decorator for External API error handling (Medical benefits).
    
    Gracefully handles external API failures with user-friendly messages.
    
    Args:
        tool_name: Name of the tool/function for logging context
        
    Example:
        @handle_external_api_errors("call_medical_benefits_api")
        async def call_external_api(...):
            return await http_client.post(...)
    """
    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @wraps(func)
        async def wrapper(*args, **kwargs) -> T:
            meta_trans_id = kwargs.get('meta_trans_id')
            live_agent_context = _extract_live_agent_context(func, args, kwargs)

            try:
                return await func(*args, **kwargs)

            except Exception as exc:
                logger.error(
                    f"[BENEFITS_AGENT] {tool_name} API error",
                    extra={
                        "meta_trans_id": meta_trans_id,
                        "tool": tool_name,
                        "error_type": type(exc).__name__
                    },
                    exc_info=True
                )
                user_message = get_message("errors.api_error", normalize_language_code(RequestContext.get_language() or "en"))
                raise BenefitsAgentError(
                    category=ErrorCategory.API_ERROR,
                    user_message=user_message,
                    status_code=HTTPStatus.SERVICE_UNAVAILABLE,
                    technical_details=f"{tool_name} API error: {type(exc).__name__}",
                    log_extra={"meta_trans_id": meta_trans_id, "tool": tool_name},
                    response_fields=_build_live_agent_response_fields(user_message, live_agent_context)
                ) from exc

        return wrapper
    return decorator


def _extract_live_agent_context(
    func: Callable[..., T],
    args: tuple[Any, ...],
    kwargs: Dict[str, Any],
) -> Dict[str, Any] | None:
    parameters = signature(func).parameters
    if not {"has_chat_access", "has_show_sydapplnk_access", "top_3_features"}.intersection(parameters):
        return None

    try:
        bound = signature(func).bind_partial(*args, **kwargs)
    except TypeError:
        return None

    bound.apply_defaults()
    arguments = bound.arguments
    return {
        "has_chat_access": bool(arguments.get("has_chat_access", False)),
        "has_show_sydapplnk_access": bool(arguments.get("has_show_sydapplnk_access", False)),
        "top_3_features": arguments.get("top_3_features"),
    }


def _build_live_agent_response_fields(
    user_message: str,
    live_agent_context: Dict[str, Any] | None,
) -> Dict[str, Any]:
    if not live_agent_context:
        return {}

    return append_live_agent_follow_up(
        user_message,
        has_chat_access=live_agent_context.get("has_chat_access", False),
        has_show_sydapplnk_access=live_agent_context.get("has_show_sydapplnk_access", False),
        top_3_features=live_agent_context.get("top_3_features"),
    )


def validate_input(
    member_contrived_id: str | None,
    intent: str | None
) -> None:
    """
    Validate required handler inputs.
    
    Args:
        member_contrived_id: Member identifier
        intent: Intent type
        
    Raises:
        BenefitsAgentError: If validation fails
    """
    lang = normalize_language_code(RequestContext.get_language() or "en")
    if not member_contrived_id or not member_contrived_id.strip():
        raise BenefitsAgentError(
            category=ErrorCategory.VALIDATION,
            user_message=get_message("errors.member_id_required", lang),
            status_code=HTTPStatus.BAD_REQUEST,
            technical_details="member_contrived_id is None or empty"
        )
    
    if not intent or not intent.strip():
        raise BenefitsAgentError(
            category=ErrorCategory.VALIDATION,
            user_message=get_message("errors.intent_required", lang),
            status_code=HTTPStatus.BAD_REQUEST,
            technical_details="intent is None or empty"
        )

==============================================================================================================

"""
Benefits Agent Exception Classes.

Centralized error handling with user-friendly messages and safe logging.
Follows plan_info_agent pattern for consistency.
"""

from enum import Enum
from http import HTTPStatus
from typing import Any, Dict, Optional


class ErrorCategory(str, Enum):
    """Error categories for classification and routing."""
    
    VALIDATION = "validation"          # Bad input (400)
    AUTHORIZATION = "authorization"    # Auth failed (401)
    NOT_FOUND = "not_found"           # Resource not found (404)
    API_ERROR = "api_error"           # External API failure (502/503)
    INTERNAL = "internal"             # Unexpected error (500)


class BenefitsAgentError(Exception):
    """
    Centralized error for Benefits agent.
    
    Transforms internal technical errors into user-friendly messages
    while preserving technical details for logging.
    
    Design Principles:
    - User messages are friendly and actionable
    - Technical details logged but not exposed to users
    - Error category enables proper routing and handling
    - No PII or credentials in any field
    
    Example:
        raise BenefitsAgentError(
            category=ErrorCategory.API_ERROR,
            user_message="We're experiencing technical difficulties. Please try again later.",
            status_code=503,
            technical_details="External BE API returned 503",
            log_extra={"meta_trans_id": "abc123"}
        )
    """
    
    def __init__(
        self,
        category: ErrorCategory,
        user_message: str,
        *,
        status_code: int = HTTPStatus.INTERNAL_SERVER_ERROR,
        technical_details: Optional[str] = None,
        log_extra: Optional[Dict[str, Any]] = None,
        response_fields: Optional[Dict[str, Any]] = None
    ) -> None:
        """
        Initialize error with classification and messages.
        
        Args:
            category: Error category for classification
            user_message: User-friendly message (no technical jargon)
            status_code: HTTP status code (default: 500)
            technical_details: Technical info for server logs only
            log_extra: Additional structured logging fields (no PII)
            response_fields: Additional response payload fields returned to clients
        """
        self.category = category
        self.user_message = user_message
        self.status_code = status_code
        self.technical_details = technical_details
        self.log_extra = log_extra or {}
        self.response_fields = response_fields or {}
        super().__init__(user_message)
    
    def to_response(self) -> Dict[str, Any]:
        """
        Convert to API response format.
        
        Returns user-friendly error dict suitable for returning to clients.
        Does NOT include technical_details (those are for server logs only).
        
        Returns:
            Dict with message, error_category, and agent metadata
        """
        response = {
            "message": self.user_message,
            "error_category": self.category.value,
            "skip_summarization": True,
            "_agent_name": "Benefits"
        }
        response.update(self.response_fields)
        return response

=======================================================================================================

"""
Benefits Agent Handler - Service Layer (Production Implementation).

Main orchestrator for benefits explanation business logic.
Follows plan_info_agent pattern with production-grade error handling.
"""

from typing import Any, Dict, List, Optional

from agents.benefits_agent.constants import AGENT_NAME
from agents.benefits_agent.exceptions import BenefitsAgentError
from agents.benefits_agent.helpers import (
    build_multi_plan_response,
    extract_active_plans,
    extract_all_plans,
    extract_coverage_data,
    extract_coverage_types_from_plan,
    handle_plan_selection,
    route_by_coverage_type,
)
from agents.benefits_agent.helpers.coverage_router import (
    get_coverage_display_name,
    normalize_coverage_type,
)
from agents.benefits_agent.helpers.error_response_builder import build_error_response
from agents.benefits_agent.i18n import get_message
from agents.benefits_agent.llm import BenefitsIntent
from agents.benefits_agent.llm.query_analyzer import (
    BenefitsQueryAnalyzer,
    QueryAnalysisResult,
)
from agents.benefits_agent.services.response_builder import BenefitsResponseBuilder
from agents.benefits_agent.transformers import extract_5w_metadata
from agents.gateway.api import BenefitsExplainabilityClient
from utils.language_utils import normalize_language_code
from utils.logging.request_context import RequestContext
from utils.logging.structured_logger import get_logger
from utils.shared.redis_cache import RedisCacheClient

logger = get_logger(__name__)

EXPLICIT_COVERAGE_INTENTS = (
    BenefitsIntent.MEDICAL,
    BenefitsIntent.DENTAL,
    BenefitsIntent.VISION,
    BenefitsIntent.PHARMACY,
)


def resolve_coverage_type_from_query(
    analysis: QueryAnalysisResult,
    coverage_types: List[str]
) -> Optional[str]:
    """
    Coverage type implied by the query, when the plan offers it.

    The classifier returns a single intent, so a query that both selects a plan
    and names a service ("Show MRI benefits for athm POS") is classified as
    SELECT_PLAN; `coverage_type` carries the service signal independently.

    Returns:
        Coverage type code available in the plan, or None if undeterminable
    """
    candidates = [analysis.coverage_type]
    if analysis.intent in EXPLICIT_COVERAGE_INTENTS:
        candidates.append(analysis.intent)

    for candidate in candidates:
        code = normalize_coverage_type(candidate) if candidate else None
        if code and code in coverage_types:
            return code

    return None


class BenefitsAgent:
    """
    Benefits Agent - Production orchestrator for benefits explanation.
    
    Simplified version of plan_info_agent pattern:
    - Extracts 5W metadata
    - Validates coverage data
    - Routes by plan count and coverage type
    - Handles Medical via external API
    - Handles Dental/Vision/Pharmacy via web links
    """
    
    def __init__(
        self,
        cache_client: RedisCacheClient,
        query_analyzer: BenefitsQueryAnalyzer,
        response_builder: BenefitsResponseBuilder,
        benefits_api_client: BenefitsExplainabilityClient
    ):
        """
        Initialize Benefits Agent with dependencies.
        
        Args:
            cache_client: Redis cache client for caching
            query_analyzer: Query analyzer for intent detection
            response_builder: Response builder for formatting
            benefits_api_client: Gateway Benefits API client for Medical benefits
        """
        self.cache = cache_client
        self.query_analyzer = query_analyzer
        self.response_builder = response_builder
        self.benefits_api_client = benefits_api_client
        logger.info("[BENEFITS_AGENT] Initialized with dependencies")

    async def handle_request(
        self,
        five_w_metadata: Dict[str, Any],
        user_query: str,
        channel: Optional[str] = None,
        context_id: Optional[str] = None,
        message_id: Optional[str] = None,
        meta_trans_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Handle benefits request with production-grade error handling.
        
        Args:
            five_w_metadata: Complete 5W metadata from planner
            user_query: User's original query
            channel: Communication channel (sms/web)
            context_id: Context ID for correlation
            message_id: Message ID for tracking
            meta_trans_id: Transaction ID for logging
            
        Returns:
            Dict with message, skip_summarization, and metadata
        """
        has_chat_access = False
        has_show_sydapplnk_access = False
        top_3_features = None
        lang = normalize_language_code(RequestContext.get_language() or "en")
        
        try:
            logger.info(
                "[BENEFITS_AGENT] Processing request",
                extra={
                    "context_id": context_id,
                    "meta_trans_id": meta_trans_id,
                    "channel": channel,
                    "query_length": len(user_query) if user_query else 0
                }
            )
            
            # Extract and validate 5W metadata
            extracted = extract_5w_metadata(five_w_metadata)
            primary_intent = extracted['primary_intent']
            has_chat_access = extracted['has_chat_access']
            has_show_sydapplnk_access = extracted['has_show_sydapplnk_access']
            top_3_features = extracted.get('top_3_features', [])
            
            logger.info(
                f"[BENEFITS_AGENT] Request validated",
                extra={
                    "context_id": context_id,
                    "intent": primary_intent
                }
            )
            
            # Extract coverage data from 5W metadata
            coverage_response, coverage_types, group_id = extract_coverage_data(five_w_metadata)
            all_plans = extract_all_plans(coverage_response)
            active_plans = extract_active_plans(all_plans)
            
            if not active_plans:
                logger.warning("[BENEFITS_AGENT] No active plans found")
                return build_error_response(
                    get_message("no_active_plans", lang),
                    has_chat_access,
                    has_show_sydapplnk_access,
                    top_3_features
                )
            
            logger.info(f"[BENEFITS_AGENT] Found {len(active_plans)} active plan(s)")
            
            # Analyze user query for coverage type intent
            analysis = await self.query_analyzer.analyze_query(
                user_query=user_query,
                channel=channel,
                plan_context=[p.plan_name for p in active_plans if p.plan_name]
            )
            
            external_user_query = analysis.rewritten_query or user_query

            logger.info(
                f"[BENEFITS_AGENT] Query analyzed: {analysis.intent}",
                extra={
                    "intent": analysis.intent,
                    "plan_number": analysis.plan_number,
                    "coverage_type": analysis.coverage_type,
                    "reasoning": analysis.reasoning,
                    "rewrite_applied": external_user_query != user_query,
                }
            )
            
            # Route based on detected intent
            if analysis.intent == BenefitsIntent.SELECT_PLAN and analysis.plan_number:
                logger.info(f"[BENEFITS_AGENT] Routing to plan selection: #{analysis.plan_number}")
                
                # Create closure for coverage routing after plan selection
                async def route_selected_plan(plan):
                    # After plan selection, determine coverage type routing (like GENERAL intent)
                    coverage_types = extract_coverage_types_from_plan(plan)
                    coverage_type_from_query = resolve_coverage_type_from_query(analysis, coverage_types)
                    
                    if coverage_type_from_query:
                        logger.info(
                            "[BENEFITS_AGENT] Coverage type resolved from query, skipping clarification",
                            extra={
                                "coverage_type": coverage_type_from_query,
                                "available_coverage_types": coverage_types
                            }
                        )
                        requested_coverage_type = coverage_type_from_query
                    elif len(coverage_types) > 1:
                        # Multiple coverage types and no type in the query - ask user which one
                        logger.info(f"[BENEFITS_AGENT] Plan has multiple coverage types, asking user: {coverage_types}")
                        display_names = [get_coverage_display_name(code) for code in coverage_types]
                        coverage_list = ", ".join(display_names)
                        return {
                            "message": get_message("select_coverage_type", lang, coverage_types=coverage_list),
                            "skip_summarization": True,
                            "_agent_name": AGENT_NAME
                        }
                    elif len(coverage_types) == 1:
                        # Single coverage type - route to it
                        logger.info(f"[BENEFITS_AGENT] Plan has single coverage type, routing to: {coverage_types[0]}")
                        requested_coverage_type = coverage_types[0]
                    else:
                        # No coverage types found
                        logger.warning("[BENEFITS_AGENT] Selected plan has no coverage types")
                        return build_error_response(
                            get_message("errors.coverage_not_found", lang),
                            has_chat_access,
                            has_show_sydapplnk_access,
                            top_3_features
                        )
                    
                    # Route to specific coverage type
                    return await route_by_coverage_type(
                        plan=plan,
                        requested_coverage_type=requested_coverage_type,
                        benefits_api_client=self.benefits_api_client,
                        user_query=external_user_query,
                        channel=channel,
                        meta_trans_id=meta_trans_id,
                        five_w_metadata=five_w_metadata,
                        has_chat_access=has_chat_access,
                        has_show_sydapplnk_access=has_show_sydapplnk_access,
                        top_3_features=top_3_features
                    )
                
                return await handle_plan_selection(
                    plan_number=analysis.plan_number,
                    active_plans=active_plans,
                    coverage_router_handler=route_selected_plan,
                    has_chat_access=has_chat_access,
                    has_show_sydapplnk_access=has_show_sydapplnk_access,
                    top_3_features=top_3_features
                )
            
            # Multiple plans without specific plan selection
            # Note: MEDICAL is now the default for vague queries (not GENERAL)
            if len(active_plans) > 1 and analysis.intent in (BenefitsIntent.GENERAL, BenefitsIntent.MEDICAL):
                logger.info("[BENEFITS_AGENT] Multiple plans, showing selection")
                return build_multi_plan_response(active_plans)
            
            # Single plan - determine routing
            selected_plan = active_plans[0]
            coverage_types = extract_coverage_types_from_plan(selected_plan)
            
            # GENERAL intent: Multiple coverage types explicitly mentioned (rare)
            # Note: Vague queries now default to MEDICAL, not GENERAL
            if analysis.intent == BenefitsIntent.GENERAL:
                coverage_type_from_query = resolve_coverage_type_from_query(analysis, coverage_types)
                if coverage_type_from_query:
                    logger.info(
                        "[BENEFITS_AGENT] Coverage type resolved from query, skipping clarification",
                        extra={
                            "coverage_type": coverage_type_from_query,
                            "available_coverage_types": coverage_types
                        }
                    )
                    requested_coverage_type = coverage_type_from_query
                elif len(coverage_types) > 1:
                    # Multiple coverage types available - ask user which one
                    logger.info(f"[BENEFITS_AGENT] GENERAL intent with multiple coverage types, asking user: {coverage_types}")
                    display_names = [get_coverage_display_name(code) for code in coverage_types]
                    coverage_list = ", ".join(display_names)
                    return {
                        "message": get_message("select_coverage_type", lang, coverage_types=coverage_list),
                        "skip_summarization": True,
                        "_agent_name": AGENT_NAME
                    }
                elif len(coverage_types) == 1:
                    # Single coverage type - route to it
                    logger.info(f"[BENEFITS_AGENT] Single coverage type, routing to: {coverage_types[0]}")
                    requested_coverage_type = coverage_types[0]
                else:
                    # No coverage types found
                    logger.warning("[BENEFITS_AGENT] No coverage types found")
                    return build_error_response(
                        get_message("errors.coverage_not_found", lang),
                        has_chat_access,
                        has_show_sydapplnk_access,
                        top_3_features
                    )
            else:
                # Specific coverage type requested (MEDICAL/DENTAL/VISION/PHARMACY)
                requested_coverage_type = analysis.intent
            
            # Route to specific coverage type
            return await route_by_coverage_type(
                plan=selected_plan,
                requested_coverage_type=requested_coverage_type,
                benefits_api_client=self.benefits_api_client,
                user_query=external_user_query,
                channel=channel,
                meta_trans_id=meta_trans_id,
                five_w_metadata=five_w_metadata,
                has_chat_access=has_chat_access,
                has_show_sydapplnk_access=has_show_sydapplnk_access,
                top_3_features=top_3_features
            )
            
        except BenefitsAgentError as exc:
            logger.error(
                f"[BENEFITS_AGENT] Handled error: {exc.user_message}",
                exc_info=True,
                extra={"context_id": context_id}
            )
            return exc.to_response()
        
        except ValueError as exc:
            logger.error(
                f"[BENEFITS_AGENT] Data error: {exc}",
                exc_info=True,
                extra={"context_id": context_id}
            )
            # Variables initialized at top - always in scope
            return build_error_response(
                get_message("no_active_plans", lang),
                has_chat_access,
                has_show_sydapplnk_access,
                top_3_features
            )
        
        except Exception as exc:
            logger.error(
                f"[BENEFITS_AGENT] Unexpected error: {exc}",
                exc_info=True,
                extra={"context_id": context_id}
            )
            # Variables initialized at top - always in scope
            return build_error_response(
                get_message("unexpected_error", lang),
                has_chat_access,
                has_show_sydapplnk_access,
                top_3_features
            )

===============================================================================================================

# Benefits Agent

**Version:** 0.1.0  
**Port:** 9061  
**Domain:** BENEFITS_EXPLAINABILITY

## Overview

Hello World implementation of the Benefits Agent following clean A2A architecture:
- **Controller Layer**: `server.py` - Handles A2A protocol
- **Service Layer**: `handler.py` - Business logic (currently hello world)

## Architecture

```
Gateway (9020) → Benefits Agent (9061)
                      ↓
                 handler.py (Hello World Response)
```

## Features Demonstrated

✅ Extracts 5W metadata from gateway  
✅ Reads feature flags (chat_access, has_show_sydapplnk_access, top_3_features)  
✅ Reads coverage data (types, plan name)  
✅ Returns formatted A2A response

## Configuration

**supervisord.conf:**
```ini
[program:benefits_agent]
command=/opt/venv/bin/uvicorn agents.benefits_agent.agent.server:app --host 0.0.0.0 --port 9061
```

**config/common-config.yaml:**
```yaml
a2a_agents:
  benefits:
    base_url: http://localhost:9061
    domains:
      - BENEFITS_EXPLAINABILITY
```

## Running

### Start Server
```bash
# With supervisord (production)
supervisorctl start benefits_agent

# Standalone (development)
source .venv/bin/activate
python -m uvicorn agents.benefits_agent.agent.server:app --host 0.0.0.0 --port 9061
```

### Check Health
```bash
curl http://localhost:9061/health
```

## Testing

### Via Gateway
The planner will route `BENEFITS_OVERVIEW` intent to this agent automatically.

**Test Query:**
```
"What are my benefits?"
```

**Expected Response:**
```
Hello {Member}! 👋

This is the Benefits Agent (Hello World).

📋 Your Plan: {plan_name}
🏥 Coverage Types: Medical, Dental, Vision
✨ Top Features Available: BENEFITS, CLAIMS, IDCARD
💬 Live Chat: Available
📱 Sydney App: Available

✅ Benefits Agent is working correctly!
```

## 5W Metadata Structure

The handler receives:
```python
{
    "5w.who.asked": {...},           # Logged-in member
    "5w.who.about": {...},           # Target member
    "5w.what.service": {
        "coverage": {
            "type": [...],            # Coverage types
            "plan": "...",            # Plan name
            "raw": {...}              # Full coverage response
        },
        "chat_access": bool,          # CHAT feature flag
        "top_3_features": [...],      # Top 3 available features
        "has_show_sydapplnk_access": bool  # Sydney App access
    }
}
```

## Next Steps

This is a hello world implementation. Production implementation will:

1. **Extract & Validate** - Use Pydantic models for coverage validation
2. **Classify Plans** - Active/future/inactive based on dates
3. **Detect Coverage Type** - Handle AC-06/07/08 logic
4. **Plan Selection** - Handle AC-04 multi-plan selection
5. **Route by Type**:
   - Medical → External A2A API
   - Dental/Vision/Pharmacy → Web links

## Clean Code Principles

✅ Small, focused functions  
✅ Single responsibility  
✅ No hardcoded strings  
✅ Guard clauses  
✅ Proper error handling  
✅ Structured logging

================================================================================================================

"""
5W Metadata Extraction for Benefits Agent.

Extracts structured data from 5W Healthcare Extension metadata
following the pattern established in plan_info_agent.
"""

from typing import Any, Dict, Optional

from pydantic import ValidationError

from agents.benefits_agent.schemas import FiveWMetadata
from utils.logging.structured_logger import get_logger

logger = get_logger(__name__)


def extract_5w_metadata(five_w_metadata: Dict[str, Any]) -> Dict[str, Any]:
    """
    Extract structured data from 5W metadata with Pydantic validation.
    
    Args:
        five_w_metadata: Complete 5W metadata from planner
        
    Returns:
        Dict with extracted fields for easy access
        
    Raises:
        ValueError: If required fields are missing or validation fails
    """
    if not five_w_metadata:
        raise ValueError("5W metadata is required")
    
    # Validate structure with Pydantic
    try:
        FiveWMetadata(**five_w_metadata)
    except ValidationError as e:
        error_details = "; ".join([f"{err['loc'][0]}: {err['msg']}" for err in e.errors()])
        raise ValueError(f"Invalid 5W metadata structure: {error_details}") from e
    
    # Extract who section
    who_asked = five_w_metadata.get("5w.who.asked", {})
    who_about = five_w_metadata.get("5w.who.about", {})
    
    # Handle self-reference (who.about = who.asked) - plan_info_agent pattern
    if who_about.get("role") == "5w.who.asked":
        who_about = who_asked
    
    # Extract what section (contains coverage data and feature flags)
    what_service = five_w_metadata.get("5w.what.service", {})
    internal_metadata = five_w_metadata.get("benefits_internal", {})
    
    # Extract why section (contains intent)
    why_service = five_w_metadata.get("5w.why.service", {})
    intents = why_service.get("intent", [])
    
    # Extract profile section (contains channel)
    profile = five_w_metadata.get("5w.profile", {})
    
    # Extract identifiers (list of {type, value} objects - plan_info_agent pattern)
    logged_in_identifiers = who_asked.get("identifier", [])
    logged_in_mbr_uid = next(
        (id["value"] for id in logged_in_identifiers if id.get("type") == "member-contrived-id"),
        None
    )
    
    target_identifiers = who_about.get("identifier", [])
    target_mbr_uid = next(
        (id["value"] for id in target_identifiers if id.get("type") == "member-contrived-id"),
        None
    )
    
    if not logged_in_mbr_uid:
        raise ValueError("Missing logged-in member identifier in 5W metadata")
    
    if not target_mbr_uid:
        raise ValueError("Missing target member identifier in 5W metadata")
    
    # Extract relationship
    relationship = who_about.get("relationship", "self")
    
    # Extract intent (primary)
    primary_intent = intents[0] if len(intents) > 0 else "BENEFITS_OVERVIEW"
    secondary_intent = intents[1] if len(intents) > 1 else None
    
    # Extract channel
    channel = profile.get("channel")
    
    # Extract feature flags from internal metadata with fallback to legacy what_service location
    has_chat_access = internal_metadata.get("has_chat_access", what_service.get("chat_access", False))
    has_show_sydapplnk_access = internal_metadata.get(
        "has_show_sydapplnk_access",
        what_service.get("has_show_sydapplnk_access", False),
    )
    top_3_features = internal_metadata.get("top_3_features", what_service.get("top_3_features", []))
    
    # Extract coverage data
    coverage_data = what_service.get("coverage", {})
    coverage_types = coverage_data.get("type", [])
    
    extracted = {
        # Member identifiers
        "logged_in_mbr_uid": logged_in_mbr_uid,
        "target_mbr_uid": target_mbr_uid,
        "relationship": relationship,
        
        # Intent
        "primary_intent": primary_intent,
        "secondary_intent": secondary_intent,
        
        # Channel
        "channel": channel,
        
        # Feature flags
        "has_chat_access": has_chat_access,
        "has_show_sydapplnk_access": has_show_sydapplnk_access,
        "top_3_features": top_3_features,
        
        # Coverage data
        "coverage_types": coverage_types,
        "coverage_data": coverage_data,
    }
    
    logger.info(
        "[TRANSFORMERS] Extracted 5W metadata",
        extra={
            "target_member": target_mbr_uid[:8] + "..." if target_mbr_uid else None,
            "relationship": relationship,
            "primary_intent": primary_intent,
            "coverage_types": coverage_types,
            "has_chat": has_chat_access
        }
    )
    
    return extracted


def extract_user_query(message) -> str:
    """
    Extract user query text from A2A message parts.
    
    Args:
        message: A2A Message object
        
    Returns:
        User query string or empty string if not found
    """
    if not message or not hasattr(message, "parts"):
        return ""
    
    for part in message.parts:
        if hasattr(part, "root") and hasattr(part.root, "text"):
            return part.root.text
    
    return ""


def extract_member_id_from_5w(metadata: Dict[str, Any]) -> Optional[str]:
    """
    Extract member_contrived_id from 5W who.about section.
    
    Args:
        metadata: Complete 5W metadata dict
        
    Returns:
        member_contrived_id or None
    """
    who_about = metadata.get("5w.who.about", {})
    
    # Handle self-reference (who.about = who.asked)
    if who_about.get("role") == "5w.who.asked":
        who_about = metadata.get("5w.who.asked", {})
    
    identifiers = who_about.get("identifier", [])
    return next(
        (id["value"] for id in identifiers if id.get("type") == "member-contrived-id"),
        None
    )


def extract_intent_from_5w(metadata: Dict[str, Any]) -> Optional[str]:
    """
    Extract primary intent from 5W why.service section.
    
    Args:
        metadata: Complete 5W metadata dict
        
    Returns:
        Primary intent string or None
    """
    why_service = metadata.get("5w.why.service", {})
    intents = why_service.get("intent", [])
    return intents[0] if len(intents) > 0 else None


===============================================================================================================

"""
Authentication Controller - YAML-Driven HIPAA Authentication
Implements complete DOB Flow and Member ID Flow with all branches
NO LLM - Pure state machine for deterministic authentication
YAML-DRIVEN - Flow logic defined in config/auth_flow_config.yaml

DEPRECATED: This is a temporary implementation until the auth layer is properly 
set up by voice and SMS channel teams. This controller will be replaced once 
the dedicated authentication service is available.
"""
import logging
from typing import Any, Dict, Optional, Tuple

from agents.gateway.config import (
    get_authentication_config,
    get_escalation_summary_config,
)
from utils.authentication.auth_session_manager import AuthSession, get_session_manager
from utils.authentication.auth_validation import (
    format_dob_display,
    get_pruned_member_id,
    parse_dob_fuzzy,
    strip_quotes,
    validate_member_id,
    validate_phone_number,
    validate_yes_no,
    validate_zipcode,
)
from utils.authentication.escalation_summary import (
    generate_escalation_summary,
    generate_simple_summary,
    generate_transcript_based_summary,
)
from utils.authentication.flow_engine import get_flow_engine
from utils.constants import Channel
from utils.language_utils import detect_auth_language_from_text, normalize_language_code
from utils.live_chat_constants import NO_CONVERSATION_HISTORY
from utils.live_chat_integration_util import getUnauthenticatedLiveChatPayload
from utils.member_search_utils import (
    dedupe_same_member,
    extract_member_id,
    extract_zipcode,
    filter_members_by_dob,
    filter_members_by_name,
    get_member_address,
    search_member_by_id,
    search_member_by_phone,
)

logger = logging.getLogger(__name__)


class AuthenticationController:
    """
    Flow-based authentication controller implementing complete HIPAA auth flows
    
    Flows:
    - DOB Flow: Phone → DOB → ZIP → HIPAA Auth
    - Member ID Flow: Member ID → DOB → HIPAA Auth
    - Twin Disambiguation: First Name → Last Name
    - Phone Fallback: Phone → DOB → ZIP
    
    Features:
    - Phone-based session caching (skip re-auth)
    - Multi-language support (English/Spanish)
    - Channel-specific messages (SMS channel)
    - Retry logic with attempt counters
    - Active member filtering
    """
    
    def __init__(
        self,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        config_path: Optional[str] = None,
        redis_cache_client = None
    ):
        """
        Initialize authentication agent
        
        Args:
            base_url: Base URL for Sydney API
            api_key: API key for authentication
            config_path: Path to auth_flow_config.yaml (optional)
            redis_cache_client: Optional Redis cache client for session management
        """
        self.base_url = base_url
        self.api_key = api_key
        
        # Initialize session manager with Redis cache
        self.session_manager = get_session_manager(cache_client=redis_cache_client)
        self.flow_engine = get_flow_engine(config_path)
        
        logger.info("AuthenticationController initialized (YAML-driven)")
        logger.info(f"Flow config version: {self.flow_engine.config.get('flow_metadata', {}).get('version')}")
        if redis_cache_client:
            logger.info(f"Session manager using Redis: {redis_cache_client.use_redis}")
    
    def get_message(self, session: AuthSession, message_key: str, **kwargs) -> str:
        """
        Get localized message for session language
        
        Args:
            session: Auth session
            message_key: Message key from locales
            **kwargs: Template variables
        
        Returns:
            Formatted message string
        """
        try:
            if session.language == "es":
                from locales.es import LOCALES
            else:
                from locales.en import LOCALES
            
            message = LOCALES.get("auth", {}).get(message_key, f"[Missing: {message_key}]")
            
            # Substitute template variables
            if kwargs:
                message = message.format(**kwargs)
            
            return message
        except Exception as e:
            logger.error(f"Error getting message {message_key}: {e}")
            return f"[Error loading message: {message_key}]"
    
    def get_channel_message(self, session: AuthSession, step_id: str, variant: Optional[str] = None, **kwargs) -> str:
        """
        Get channel-specific message using FlowEngine
        
        Args:
            session: Auth session
            step_id: Step identifier (e.g., "DOB-002")
            variant: Optional message variant (e.g., "on_invalid_retry")
            **kwargs: Template variables
        
        Returns:
            Channel-specific message
        """
        # Get message key from flow engine (handles channel variants)
        message_key = self.flow_engine.get_message_key(step_id, session, variant)
        
        # Get localized message
        message = self.get_message(session, message_key, **kwargs)
        
        return message
    
    async def check_authentication(
        self,
        phone_number: Optional[str] = None,
        session_id: Optional[str] = None,
        conversation_id: Optional[str] = None,
    ) -> Tuple[bool, Optional[Dict[str, Any]]]:
        """
        Check if phone/session is already authenticated (for caching)
        
        Args:
            phone_number: Phone number to check
            session_id: Session ID to check
        
        Returns:
            Tuple of (is_authenticated, member_data)
        """
        session = self.session_manager.get_request_session(
            session_id=session_id,
            phone_number=phone_number,
            conversation_id=conversation_id,
        )
        
        if session and session.is_authenticated:
            logger.info(f"Found authenticated session for phone {phone_number or session_id}")
            return True, session.member_data
        
        return False, None
    
    async def start_authentication(
        self,
        phone_number: str,
        session_id: Optional[str] = None,
        language: Optional[str] = None,
        channel: str = Channel.SMS.value,
        initial_message: Optional[str] = None,
        conversation_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Start authentication flow - Entry point
        Performs initial phone lookup to determine flow
        
        Args:
            phone_number: Device phone number from header
            session_id: Optional session ID
            language: Language code (en or es)
            channel: Channel type (default: sms)
            initial_message: User's initial message (before auth started)
        
        Returns:
            Response dict with next message and state
        """
        # Check if already authenticated (session caching)
        is_auth, member_data = await self.check_authentication(
            phone_number=phone_number,
            session_id=session_id,
            conversation_id=conversation_id,
        )
        if is_auth:
            logger.info(f"Phone {phone_number} already authenticated, skipping auth")
            effective_language = await detect_auth_language_from_text(initial_message, channel=channel) if initial_message else normalize_language_code(language)
            return {
                'success': True,
                'authenticated': True,
                'member_data': member_data,
                'message': self.get_message(
                    AuthSession(session_id="temp", language=effective_language),
                    "auth_complete"
                ),
                'skip_auth': True,
                'escalate_to_agent': False
            }
        effective_language = await detect_auth_language_from_text(initial_message, channel=channel) if initial_message else normalize_language_code(language)
        # Create new session (this also creates session_id and conversation_id)
        session = self.session_manager.get_or_create_session(
            session_id=session_id,
            phone_number=phone_number,
            conversation_id=conversation_id,
            language=effective_language,
            channel=channel
        )
        logger.info(f"[AUTH_LANGUAGE] start_authentication requested language={effective_language} for phone={phone_number}")
        print(f"[AUTH_LANGUAGE] start_authentication requested language={effective_language} for phone={phone_number}")
        logger.info(f"[AUTH_LANGUAGE] start_authentication session language after get_or_create={session.language}")
        print(f"[AUTH_LANGUAGE] start_authentication session language after get_or_create={session.language}")

        requested_language = normalize_language_code(effective_language)
        if normalize_language_code(session.language) != requested_language:
            logger.info(
                "[AUTH_LANGUAGE] updating auth session %s language %s -> %s before prompt generation",
                session.session_id,
                session.language,
                requested_language,
            )
            print(
                f"[AUTH_LANGUAGE] updating auth session {session.session_id} language {session.language} -> {requested_language} before prompt generation"
            )
            session.language = requested_language
        logger.info(f"[AUTH_LANGUAGE] start_authentication final session language={session.language}")
        print(f"[AUTH_LANGUAGE] start_authentication final session language={session.language}")
        
        logger.info(f"[AUTH] Session created - session_id: {session.session_id}, conversation_id: {session.conversation_id}")
        
        # Store initial user message immediately after session creation
        # ONLY if this is the very first interaction (INIT state)
        # This prevents storing auth inputs (DOB, Member ID, ZIP) as the initial message
        print(f"[AUTH-STORE-DEBUG] ========================================")
        print(f"[AUTH-STORE-DEBUG] Checking if should store initial_message")
        print(f"[AUTH-STORE-DEBUG] initial_message param: '{initial_message}'")
        print(f"[AUTH-STORE-DEBUG] session.initial_user_message: '{session.initial_user_message}'")
        print(f"[AUTH-STORE-DEBUG] session.current_step: '{session.current_step}'")
        print(f"[AUTH-STORE-DEBUG] Condition check:")
        print(f"[AUTH-STORE-DEBUG]   - initial_message provided: {bool(initial_message)}")
        print(f"[AUTH-STORE-DEBUG]   - session.initial_user_message not set: {not session.initial_user_message}")
        print(f"[AUTH-STORE-DEBUG]   - current_step == INIT: {session.current_step == 'INIT'}")
        
        if initial_message and not session.initial_user_message and session.current_step == "INIT":
            session.initial_user_message = initial_message
            print(f"[AUTH] ✅ STORED initial user message: '{initial_message}'")
            print(f"[AUTH] Session: {session.session_id}, Conversation: {session.conversation_id}")
            logger.info(f"[AUTH] ✅ Stored initial user message: '{initial_message}' (session_id: {session.session_id}, conversation_id: {session.conversation_id})")
        else:
            print(f"[AUTH] ❌ NOT storing initial_message (condition not met)")
        print(f"[AUTH-STORE-DEBUG] ========================================")
        
        # DOB-001: Phone Lookup API
        logger.info(f"[DOB-001] Starting phone lookup for {phone_number}")
        logger.info(f"[DOB-001] Session created: {session.session_id}, Language: {session.language}, Channel: {channel}")
        result = await search_member_by_phone(phone_number, self.base_url, self.api_key)
        logger.info(f"[DOB-001] Phone lookup result: success={result.get('success')}, count={result.get('count', 0)}")
        
        if result['success'] and result.get('members'):
            # API returned HTTP 200 with members — trust the response directly
            members = result['members']

            if members:
                # 1+ members found → DOB Flow
                session.members = members
                session.auth_flow = "dob_flow"
                session.set_step("DOB-002")

                logger.info(f"[DOB-001] Found {len(members)} member(s) from API, starting DOB flow")
                
                # Return DOB request message (using FlowEngine)
                message = self.get_channel_message(session, "DOB-002")
                
                # Add welcome message for first interaction
                welcome_prefix = self._get_welcome_message(session)
                if welcome_prefix:
                    message = welcome_prefix + message
                
                # Track initial message in conversation history
                session.add_conversation_message('assistant', message)
                
                # Save session to Redis
                print(f"[AUTH] Saving session to Redis with initial_user_message: '{session.initial_user_message}'")
                self.session_manager.update_session(session)
                print(f"[AUTH] ✅ Session saved to Redis")
                
                return {
                    'success': True,
                    'authenticated': False,
                    'awaits_input': self.flow_engine.awaits_input("DOB-002"),
                    'current_step': "DOB-002",
                    'message': message,
                    'session_id': session.session_id,
                    'escalate_to_agent': False
                }
        
        # 0 members found → Member ID Flow
        session.auth_flow = "member_id_flow"
        session.set_step("MID-001")
        
        logger.info(f"[DOB-001] No members found for phone, starting Member ID flow")
        
        # Get message variant based on session state (using FlowEngine)
        message_key = self.flow_engine.get_message_variant("MID-001", session)
        message = self.get_message(session, message_key)
        
        # Add welcome message for first interaction
        welcome_prefix = self._get_welcome_message(session)
        if welcome_prefix:
            message = welcome_prefix + message
        
        # Track initial message in conversation history
        session.add_conversation_message('assistant', message)
        
        # Save session to Redis
        self.session_manager.update_session(session)
        
        return {
            'success': True,
            'authenticated': False,
            'awaits_input': self.flow_engine.awaits_input("MID-001"),
            'current_step': "MID-001",
            'message': message,
            'session_id': session.session_id,
            'escalate_to_agent': False
        }
    
    def _track_response(self, session: AuthSession, response: Dict[str, Any]) -> Dict[str, Any]:
        """
        Track assistant response in conversation history
        
        Args:
            session: Current auth session
            response: Response dictionary
        
        Returns:
            Same response dictionary (pass-through)
        """
        # Track the message in conversation history
        message = response.get('message', '')
        if message:
            session.add_conversation_message('assistant', message)
        
        return response
    
    def _track_and_return(self, session: AuthSession, message: str, **kwargs) -> Dict[str, Any]:
        """
        Helper to track a message and return a response dictionary
        Used for intermediate messages within step methods
        
        Args:
            session: Current auth session
            message: Message to track and return
            **kwargs: Additional response fields
        
        Returns:
            Response dictionary with message
        """
        # Track the message
        session.add_conversation_message('assistant', message)
        self.session_manager.update_session(session)
        
        # Build response
        response = {'message': message}
        response.update(kwargs)
        return response
    
    async def process_input(
        self,
        session_id: str,
        user_input: str
    ) -> Dict[str, Any]:
        """
        Process user input based on current step
        Main router for all authentication steps
        
        Args:
            session_id: Session identifier
            user_input: User's input text
        
        Returns:
            Response dict with next message and state
        """
        session = self.session_manager.get_session(session_id=session_id)
        
        if not session:
            logger.error(f"[AUTH] Session not found: {session_id}")
            return {
                'success': False,
                'authenticated': False,
                'message': "Session not found. Please start authentication again.",
                'error': 'session_not_found',
                'escalate_to_agent': False
            }
        
        # Check for global interrupt - Unsubscribe
        if user_input.strip().lower() in ['unsubscribe', 'cancelar']:
            logger.info(f"[AUTH] Unsubscribe detected for session {session_id}")
            return await self._handle_unsubscribe(session)
        
        # Track user input in conversation history
        session.add_conversation_message('user', user_input)
        
        # Route to appropriate step handler
        current_step = session.current_step
        
        logger.info(f"[{current_step}] Processing input for session {session_id}")
        logger.info(f"[{current_step}] User input: '{user_input}' (length: {len(user_input)})")
        logger.info(f"[{current_step}] Session state - Flow: {session.auth_flow}, Language: {session.language}, Channel: {session.channel}")
        
        # DOB Flow steps
        if current_step == "DOB-002":
            result = await self._step_dob_002(session, user_input)
            self._track_response(session, result)
            self.session_manager.update_session(session)
            return result
        elif current_step == "DOB-003":
            result = await self._step_dob_003(session, user_input)
            self._track_response(session, result)
            self.session_manager.update_session(session)
            return result
        elif current_step == "DOB-004":
            result = await self._step_dob_004(session, user_input)
            self._track_response(session, result)
            self.session_manager.update_session(session)
            return result
        elif current_step == "DOB-005":
            result = await self._step_dob_005(session, user_input)
            self._track_response(session, result)
            self.session_manager.update_session(session)
            return result
        elif current_step == "DOB-006":
            result = await self._step_dob_006(session, user_input)
            self._track_response(session, result)
            self.session_manager.update_session(session)
            return result
        elif current_step == "DOB-007":
            result = await self._step_dob_007(session, user_input)
            self._track_response(session, result)
            self.session_manager.update_session(session)
            return result
        
        # Member ID Flow steps
        elif current_step == "MID-001":
            result = await self._step_mid_001(session, user_input)
            self._track_response(session, result)
            self.session_manager.update_session(session)
            return result
        elif current_step == "MID-002":
            result = await self._step_mid_002(session, user_input)
            self._track_response(session, result)
            self.session_manager.update_session(session)
            return result
        elif current_step == "MID-003":
            result = await self._step_mid_003(session, user_input)
            self._track_response(session, result)
            self.session_manager.update_session(session)
            return result
        elif current_step == "MID-005":
            result = await self._step_mid_005(session, user_input)
            self._track_response(session, result)
            self.session_manager.update_session(session)
            return result
        elif current_step == "MID-006":
            result = await self._step_mid_006(session, user_input)
            self._track_response(session, result)
            self.session_manager.update_session(session)
            return result
        
        # Twin disambiguation
        elif current_step == "SH-001":
            result = await self._step_sh_001(session, user_input)
            self._track_response(session, result)
            self.session_manager.update_session(session)
            return result
        elif current_step == "SH-002":
            result = await self._step_sh_002(session, user_input)
            self._track_response(session, result)
            self.session_manager.update_session(session)
            return result
        
        # Already authenticated
        elif current_step == "AUTHENTICATED":
            return {
                'success': True,
                'authenticated': True,
                'member_data': session.member_data,
                'message': self.get_message(session, "auth_complete"),
                'escalate_to_agent': False
            }
        
        else:
            logger.error(f"Unknown step: {current_step}")
            return {
                'success': False,
                'authenticated': False,
                'message': "Unknown authentication state. Please start again.",
                'error': 'unknown_step',
                'escalate_to_agent': False
            }
    
    # ==================== DOB FLOW STEPS ====================
    
    async def _step_dob_002(self, session: AuthSession, user_input: str) -> Dict[str, Any]:
        """
        DOB-002: Receive DOB input
        Store input and move to validation
        """
        session.member_dob_input = user_input.strip()
        session.set_step("DOB-003")
        
        # Immediately validate
        return await self._step_dob_003(session, user_input)
    
    async def _step_dob_003(self, session: AuthSession, user_input: str) -> Dict[str, Any]:
        """
        DOB-003: Validate DOB format (YAML-driven)
        Uses FlowEngine for max attempts and transitions
        """
        logger.info(f"[DOB-003] Validating DOB format for input: '{user_input}'")
        normalized_dob = parse_dob_fuzzy(user_input)
        logger.info(f"[DOB-003] Normalized DOB: {normalized_dob}")
        
        if normalized_dob:
            # Valid format → Get next step from YAML
            session.member_dob_input = normalized_dob
            next_step = self.flow_engine.get_next_step("DOB-003", "on_valid", session)
            session.set_step(next_step)
            
            # Format for display
            display_dob = format_dob_display(normalized_dob)
            message = self.get_channel_message(session, next_step, dob=display_dob)
            
            return {
                'success': True,
                'authenticated': False,
                'awaits_input': self.flow_engine.awaits_input(next_step),
                'current_step': next_step,
                'message': message,
                'session_id': session.session_id,
                'escalate_to_agent': False
            }
        
        # Invalid format - Get max attempts from YAML
        counter_key = self.flow_engine.get_attempt_counter_key("DOB-003")
        attempts = session.increment_attempt(counter_key)
        max_attempts = self.flow_engine.get_max_attempts("DOB-003")
        
        if attempts >= max_attempts:
            # Max attempts → Get exit step from YAML
            next_step = self.flow_engine.get_next_step("DOB-003", "on_max_attempts", session)
            return await self._exit_failure(session)
        
        # Retry - Get retry step from YAML
        next_step = self.flow_engine.get_next_step("DOB-003", "on_invalid_retry", session)
        session.set_step(next_step)
        message = self.get_channel_message(session, "DOB-003", variant="on_invalid_retry")
        
        return {
            'success': False,
            'authenticated': False,
            'awaits_input': self.flow_engine.awaits_input(next_step),
            'current_step': next_step,
            'message': message,
            'session_id': session.session_id,
            'escalate_to_agent': False
        }
    
    async def _step_dob_004(self, session: AuthSession, user_input: str) -> Dict[str, Any]:
        """
        DOB-004: Confirm DOB
        Yes/No validation
        """
        response = validate_yes_no(user_input)
        
        if response is True:
            # Yes → Move to DOB matching
            session.set_step("DOB-005")
            return await self._step_dob_005(session, session.member_dob_input)
        
        elif response is False:
            # No → Re-collect DOB
            session.reset_attempt("dob_format_attempts")
            session.set_step("DOB-002")
            message = self.get_message(session, "dob_mismatch_retry")
            
            return {
                'success': True,
                'authenticated': False,
                'awaits_input': True,
                'current_step': "DOB-002",
                'message': message,
                'session_id': session.session_id,
                'escalate_to_agent': False
            }
        
        # Invalid yes/no
        attempts = session.increment_attempt("dob_confirm_attempts")
        
        if attempts >= 2:
            return await self._exit_failure(session)
        
        # Retry confirm
        display_dob = format_dob_display(session.member_dob_input)
        message = self.get_message(session, "dob_confirm", dob=display_dob)
        
        return {
            'success': False,
            'authenticated': False,
            'awaits_input': True,
            'current_step': "DOB-004",
            'message': message,
            'session_id': session.session_id,
            'escalate_to_agent': False
        }
    
    async def _step_dob_005(self, session: AuthSession, dob_input: str) -> Dict[str, Any]:
        """
        DOB-005: Match DOB against members [Jump Point B]
        Handles multiple scenarios:
        - 1 member matched → ZIP verification
        - 2+ members (twins) → Member ID disambiguation
        - No match → Retry or fallback to Member ID
        """
        logger.info(f"[DOB-005] Matching DOB '{session.member_dob_input}' against {len(session.members)} member(s)")
        matching_members = dedupe_same_member(
            filter_members_by_dob(session.members, session.member_dob_input)
        )
        
        logger.info(f"[DOB-005] Matched {len(matching_members)} distinct member(s) with DOB")
        logger.info(f"[DOB-005] Context: dob_context={session.dob_context}, zip_required={session.zip_required}")
        
        if len(matching_members) == 1:
            # Single match → ZIP verification
            session.members = matching_members
            
            # Check if ZIP required (depends on path)
            if session.dob_context == "member_id_path":
                # Member ID path → Skip ZIP, go to HIPAA Auth
                session.set_step("DOB-009")
                return await self._step_dob_009(session)
            else:
                # Phone path → ZIP required
                session.set_step("DOB-006")
                message = self.get_message(session, "zip_request")
                
                return {
                    'success': True,
                    'authenticated': False,
                    'awaits_input': True,
                    'current_step': "DOB-006",
                    'message': message,
                    'session_id': session.session_id,
                    'escalate_to_agent': False
                }
        
        elif len(matching_members) >= 2:
            # Twins → Member ID disambiguation (DOB-008)
            session.members = matching_members
            session.dob_already_entered = True
            session.mbrid_only_mode = True  # No phone fallback
            session.set_step("MID-001")
            
            logger.info(f"[DOB-008] Twin scenario, requesting Member ID")
            
            message = self.get_message(session, "member_id_request_after_dob")
            
            return {
                'success': True,
                'authenticated': False,
                'awaits_input': True,
                'current_step': "MID-001",
                'message': message,
                'session_id': session.session_id,
                'escalate_to_agent': False
            }
        
        # No match
        attempts = session.increment_attempt("dob_mismatch_attempts")
        
        # Determine max attempts based on context
        max_attempts = 3 if session.prior_id_entered else 2
        
        if attempts >= max_attempts:
            if session.prior_id_entered:
                # Already tried ID/phone → Exit
                return await self._exit_failure(session)
            else:
                # No prior ID → Fallback to Member ID flow
                session.dob_already_entered = True
                session.set_step("MID-001")
                
                message = self.get_message(session, "member_id_request_after_dob")
                
                return {
                    'success': True,
                    'authenticated': False,
                    'awaits_input': True,
                    'current_step': "MID-001",
                    'message': message,
                    'session_id': session.session_id
                }
        
        # Retry DOB
        session.set_step("DOB-002")
        message = self.get_message(session, "dob_mismatch_retry")
        
        return {
            'success': False,
            'authenticated': False,
            'awaits_input': True,
            'current_step': "DOB-002",
            'message': message,
            'session_id': session.session_id,
            'escalate_to_agent': False
        }
    
    async def _step_dob_006(self, session: AuthSession, user_input: str) -> Dict[str, Any]:
        """
        DOB-006: Request ZIP code
        Store input and move to validation
        """
        session.member_zip_input = user_input.strip()
        session.set_step("DOB-007")
        
        # Immediately validate
        return await self._step_dob_007(session, user_input)
    
    async def _step_dob_007(self, session: AuthSession, user_input: str) -> Dict[str, Any]:
        """
        DOB-007: Validate ZIP format and match via Contacts API
        Max 2 attempts
        """
        is_valid, normalized_zip = validate_zipcode(user_input)
        
        if not is_valid:
            # Invalid format
            attempts = session.increment_attempt("zip_attempts")
            
            if attempts >= 2:
                return await self._exit_failure(session)
            
            session.set_step("DOB-006")
            message = self.get_message(session, "zip_invalid_format")
            
            return {
                'success': False,
                'authenticated': False,
                'awaits_input': True,
                'current_step': "DOB-006",
                'message': message,
                'session_id': session.session_id,
                'escalate_to_agent': False
            }
        
        # Valid format → Call Contacts API
        session.member_zip_input = normalized_zip
        
        member = session.members[0]
        member_id = extract_member_id(member)
        
        if not member_id:
            logger.error("[DOB-007] No member ID found")
            return await self._exit_failure(session)
        
        address_result = await get_member_address(member_id, self.base_url, self.api_key)
        
        if not address_result['success']:
            logger.error(f"[DOB-007] Contacts API failed: {address_result.get('error')}")
            return await self._exit_failure(session)
        
        # Extract and match ZIP
        api_zipcode = extract_zipcode(address_result['address'])
        
        if api_zipcode:
            api_zip_5 = str(api_zipcode)[:5]
            user_zip_5 = str(normalized_zip)[:5]
            
            if api_zip_5 == user_zip_5:
                # ZIP matched → HIPAA Auth
                logger.info(f"[DOB-007] ZIP matched: {user_zip_5}")
                session.set_step("DOB-009")
                return await self._step_dob_009(session)
        
        # ZIP not matched
        attempts = session.increment_attempt("zip_attempts")
        
        if attempts >= 2:
            return await self._exit_failure(session)
        
        session.set_step("DOB-006")
        message = self.get_message(session, "zip_no_match")
        
        return {
            'success': False,
            'authenticated': False,
            'awaits_input': True,
            'current_step': "DOB-006",
            'message': message,
            'session_id': session.session_id,
            'escalate_to_agent': False
        }
    
    async def _step_dob_009(self, session: AuthSession) -> Dict[str, Any]:
        """
        DOB-009: HIPAA Auth API (final verification)
        For now, we'll skip this and authenticate directly
        In production, call HIPAA Auth API and check CIRS flag
        """
        # TODO: Call HIPAA Auth API
        # For now, authenticate directly
        
        member = session.members[0]
        member_id = extract_member_id(member)
        
        if not member_id:
            logger.error("[DOB-009] No member ID found")
            return await self._exit_failure(session)
        
        # Authenticate
        session.authenticate(member_id, member)
        
        # Save authenticated session to Redis immediately
        self.session_manager.update_session(session)
        
        logger.info(f"[DOB-009] Authentication successful for member {member_id}")
        logger.info(f"[DOB-009] Session saved to Redis with authenticated state")
        
        return {
            'success': True,
            'authenticated': True,
            'member_data': member,
            'member_id': member_id,
            'session_id': session.session_id,
            'escalate_to_agent': False
        }
    
    # ==================== MEMBER ID FLOW STEPS ====================
    
    async def _step_mid_001(self, session: AuthSession, user_input: str) -> Dict[str, Any]:
        """
        MID-001: Request Member ID
        Handle "Other" keyword for phone fallback
        """
        # Check for "Other" keyword (strip quotes in case user types "Other" or 'Other')
        normalized_input = strip_quotes(user_input.strip().lower())
        if normalized_input in ['other', 'otro']:
            if session.mbrid_only_mode:
                # Twin path - no phone fallback allowed
                message = self.get_message(session, "member_id_request_retry")
                return {
                    'success': False,
                    'authenticated': False,
                    'awaits_input': True,
                    'current_step': "MID-001",
                    'message': message,
                    'session_id': session.session_id,
                    'escalate_to_agent': False
                }
            
            # Go to phone fallback
            session.set_step("MID-005")
            message = self.get_message(session, "phone_request")
            
            return {
                'success': True,
                'authenticated': False,
                'awaits_input': True,
                'current_step': "MID-005",
                'message': message,
                'session_id': session.session_id,
                'escalate_to_agent': False
            }
        
        # Store Member ID and validate
        session.member_id_input = user_input.strip()
        session.set_step("MID-002")
        
        return await self._step_mid_002(session, user_input)
    
    async def _step_mid_002(self, session: AuthSession, user_input: str) -> Dict[str, Any]:
        """
        MID-002: Validate Member ID format
        Max 2 attempts
        """
        is_valid, error_reason = validate_member_id(user_input)
        
        if is_valid:
            # Valid → Search API
            session.set_step("MID-003")
            return await self._step_mid_003(session, user_input)
        
        # Invalid format - provide specific error message
        attempts = session.increment_attempt("member_id_format_attempts")
        
        if attempts >= 2:
            return await self._exit_failure(session)
        
        session.set_step("MID-001")
        
        # Customize message based on error type
        if error_reason == 'all_letters':
            message = self.get_message(session, "member_id_all_letters")
        else:
            message = self.get_message(session, "member_id_invalid_format")
        
        return {
            'success': False,
            'authenticated': False,
            'awaits_input': True,
            'current_step': "MID-001",
            'message': message,
            'session_id': session.session_id,
            'escalate_to_agent': False
        }
    
    async def _step_mid_003(self, session: AuthSession, user_input: str) -> Dict[str, Any]:
        """
        MID-003: Member Search API by Member ID
        Routes to DOB collection or matching based on flags
        """
        pruned_member_id = get_pruned_member_id(session.member_id_input)
        logger.info(
            f"[MID-003] Searching member by ID (entered: {session.member_id_input}, "
            f"searched: {pruned_member_id})"
        )

        result = await search_member_by_id(pruned_member_id, self.base_url, self.api_key)
        
        if result['success'] and result.get('members'):
            # API returned HTTP 200 with members — trust the response directly
            members = result['members']
            total_members = len(members)

            logger.info(f"[MID-003] Found {total_members} member(s) from API")

            session.members = members
            session.prior_id_entered = True
            
            # Check if DOB already entered (twin path or DOB mismatch path)
            if session.dob_already_entered:
                # Jump to DOB-005 to match stored DOB
                logger.info("[MID-003] DOB already entered, jumping to DOB-005")
                session.set_step("DOB-005")
                return await self._step_dob_005(session, session.member_dob_input)
            else:
                # Collect DOB (Jump Point A - MID-004)
                logger.info("[MID-003] Member found, collecting DOB")
                session.dob_context = "member_id_path"
                session.zip_required = False
                session.set_step("DOB-002")
                
                message = self.get_channel_message(session, "DOB-002")
                
                return {
                    'success': True,
                    'authenticated': False,
                    'awaits_input': True,
                    'current_step': "DOB-002",
                    'message': message,
                    'session_id': session.session_id,
                    'escalate_to_agent': False
                }
        
        # Not found
        attempts = session.increment_attempt("member_id_search_attempts")
        
        if attempts >= 2:
            if session.mbrid_only_mode:
                # Twin path - no fallback
                return await self._exit_failure(session)
            
            # Offer phone fallback
            session.set_step("MID-005")
            message = self.get_message(session, "member_id_not_found_phone_fallback")
            
            return {
                'success': True,
                'authenticated': False,
                'awaits_input': True,
                'current_step': "MID-005",
                'message': message,
                'session_id': session.session_id,
                'escalate_to_agent': False
            }
        
        # Retry
        session.set_step("MID-001")
        message = self.get_message(session, "member_id_not_found_retry")
        
        return {
            'success': False,
            'authenticated': False,
            'awaits_input': True,
            'current_step': "MID-001",
            'message': message,
            'session_id': session.session_id,
            'escalate_to_agent': False
        }
    
    async def _step_mid_005(self, session: AuthSession, user_input: str) -> Dict[str, Any]:
        """
        MID-005: Request phone number (Other path)
        Validate format
        """
        is_valid, normalized_phone = validate_phone_number(user_input)
        
        if is_valid:
            session.member_phone_input = normalized_phone
            session.set_step("MID-006")
            return await self._step_mid_006(session, user_input)
        
        # Invalid format
        attempts = session.increment_attempt("phone_format_attempts")
        
        if attempts >= 2:
            return await self._exit_failure(session)
        
        message = self.get_message(session, "phone_invalid_format")
        
        return {
            'success': False,
            'authenticated': False,
            'awaits_input': True,
            'current_step': "MID-005",
            'message': message,
            'session_id': session.session_id,
            'escalate_to_agent': False
        }
    
    async def _step_mid_006(self, session: AuthSession, user_input: str) -> Dict[str, Any]:
        """
        MID-006: Phone Search API
        Routes to DOB collection or matching
        """
        result = await search_member_by_phone(session.member_phone_input, self.base_url, self.api_key)
        
        if result['success'] and result.get('members'):
            # API returned HTTP 200 with members — trust the response directly
            members = result['members']

            if members:
                session.members = members
                session.prior_id_entered = True
                
                # Check if DOB already entered
                if session.dob_already_entered:
                    # Jump to DOB-005
                    session.set_step("DOB-005")
                    return await self._step_dob_005(session, session.member_dob_input)
                else:
                    # Collect DOB (Jump Point A - MID-007)
                    session.dob_context = "phone_path"
                    session.zip_required = True  # Phone path requires ZIP
                    session.set_step("DOB-002")
                    
                    message = self.get_channel_message(session, "DOB-002")
                    
                    return {
                        'success': True,
                        'authenticated': False,
                        'awaits_input': True,
                        'current_step': "DOB-002",
                        'message': message,
                        'session_id': session.session_id,
                        'escalate_to_agent': False
                    }
        
        # Not found
        attempts = session.increment_attempt("phone_search_attempts")
        
        if attempts >= 2:
            return await self._exit_failure(session)
        
        session.set_step("MID-005")
        message = self.get_message(session, "phone_not_found")
        
        return {
            'success': False,
            'authenticated': False,
            'awaits_input': True,
            'current_step': "MID-005",
            'message': message,
            'session_id': session.session_id,
            'escalate_to_agent': False
        }
    
    # ==================== SHARED STEPS ====================
    
    async def _step_sh_001(self, session: AuthSession, user_input: str) -> Dict[str, Any]:
        """
        SH-001: Twin disambiguation - First name
        """
        matching = filter_members_by_name(session.members, first_name=user_input)
        
        if matching:
            session.members = matching
            session.member_first_name_input = user_input.strip()
            session.set_step("SH-002")
            
            message = self.get_message(session, "twin_last_name_request")
            
            return {
                'success': True,
                'authenticated': False,
                'awaits_input': True,
                'current_step': "SH-002",
                'message': message,
                'session_id': session.session_id,
                'escalate_to_agent': False
            }
        
        # No match
        attempts = session.increment_attempt("first_name_attempts")
        
        if attempts >= 2:
            return await self._exit_failure(session)
        
        message = self.get_message(session, "twin_first_name_invalid")
        
        return {
            'success': False,
            'authenticated': False,
            'awaits_input': True,
            'current_step': "SH-001",
            'message': message,
            'session_id': session.session_id,
            'escalate_to_agent': False
        }
    
    async def _step_sh_002(self, session: AuthSession, user_input: str) -> Dict[str, Any]:
        """
        SH-002: Twin disambiguation - Last name
        """
        matching = filter_members_by_name(session.members, last_name=user_input)
        
        if matching and len(matching) == 1:
            # Single match → HIPAA Auth
            session.members = matching
            session.set_step("DOB-009")
            return await self._step_dob_009(session)
        
        # No match or still multiple
        attempts = session.increment_attempt("last_name_attempts")
        
        if attempts >= 2:
            return await self._exit_failure(session)
        
        message = self.get_message(session, "twin_last_name_invalid")
        
        return {
            'success': False,
            'authenticated': False,
            'awaits_input': True,
            'current_step': "SH-002",
            'message': message,
            'session_id': session.session_id,
            'escalate_to_agent': False
        }
    
    # ==================== EXIT HANDLERS ====================
    
    async def _exit_failure(self, session: AuthSession) -> Dict[str, Any]:
        """
        EX-001: Authentication failure - Escalate to live agent
        Channel-specific failure messages (YAML-driven)
        Generates escalation summary from conversation history
        """
        # Use EX-002 (Transfer to Live Agent) instead of EX-001
        message = self.get_channel_message(session, "EX-002")
        
        logger.info(f"[EX-002] Escalating to live agent - authentication failed")
        
        # Generate transfer summary from conversation history
        transfer_summary = None
        
        try:
            # Get escalation summary configuration from settings.yaml
            escalation_config = get_escalation_summary_config(channel=session.channel)
            enable_summary = escalation_config.get('enabled', True)
            use_ai_summary = escalation_config.get('use_ai_summary', False)
            logger.info(f"[EX-002] [CONFIG] escalation_config={escalation_config}, use_ai_summary={use_ai_summary}")
            
            if not enable_summary:
                # Escalation summary disabled
                logger.info(f"[EX-002] Escalation summary disabled via config")
                transfer_summary = None
            else:
                # Get conversation transcript
                conversation_transcript = session.get_conversation_transcript()
                
                # Build session context for summary
                session_context = {
                    'current_step': session.current_step,
                    'attempt_counters': session.attempt_counters,
                    'phone_number': session.phone_number,
                    'member_id_input': session.member_id_input,
                    'member_dob_input': session.member_dob_input,
                    'member_phone_input': session.member_phone_input,
                    'member_zip_input': session.member_zip_input,
                    'auth_flow': session.auth_flow,
                    'language': session.language,
                    'channel': session.channel
                }
                
                if use_ai_summary and conversation_transcript and conversation_transcript != NO_CONVERSATION_HISTORY:
                    # Try AI-powered summary with timeout
                    logger.info(f"[EX-002] [SUMMARY] Attempting AI summary via Horizon LLM (use_ai_summary=true, timeout=8s)")
                    try:
                        summary_result = await generate_escalation_summary(conversation_transcript, session_context, timeout_seconds=8)
                        transfer_summary = summary_result.get('transfer_summary')
                        logger.info(f"[EX-002] [SUMMARY] ✅ SOURCE: AI — Transfer summary (first 150 chars): {transfer_summary[:150] if transfer_summary else 'None'}")
                    except Exception as ai_error:
                        logger.warning(f"[EX-002] [SUMMARY] ⚠️ AI failed ({ai_error}), falling back to transcript-based summary")
                        transfer_summary = generate_transcript_based_summary(conversation_transcript, session_context)
                        logger.info(f"[EX-002] [SUMMARY] ⚠️ SOURCE: FALLBACK — Transfer summary (first 150 chars): {transfer_summary[:150] if transfer_summary else 'None'}")
                else:
                    # Use transcript-based summary if available, otherwise simple summary
                    if conversation_transcript and conversation_transcript != NO_CONVERSATION_HISTORY:
                        transfer_summary = generate_transcript_based_summary(conversation_transcript, session_context)
                        logger.info(f"[EX-002] [SUMMARY] ℹ️ SOURCE: TEMPLATE — Transfer summary (use_ai_summary=false, first 150 chars): {transfer_summary[:150] if transfer_summary else 'None'}")
                    else:
                        simple_summary = generate_simple_summary(session_context)
                        transfer_summary = f"{simple_summary}\n\nContext: {session.current_step}"
                        logger.info(f"[EX-002] [SUMMARY] ℹ️ SOURCE: SIMPLE — Transfer summary (no transcript, use_ai_summary=false): {transfer_summary[:150] if transfer_summary else 'None'}")
                
        except Exception as e:
            logger.error(f"[EX-002] Error generating transfer summary: {e}", exc_info=True)
            # Fallback summary
            transfer_summary = f"Authentication failed at step: {session.current_step}. Please assist with identity verification."
        
        # Reset conversation by deleting the session
        session_id = session.session_id
        conversation_id = session.conversation_id
        channel = session.channel
        member_id = session.member_id_input  # Use input value (may be None for unauthenticated)
        self.session_manager.delete_session(session_id)
        logger.info(f"[EX-002] Session {session_id} deleted - conversation reset")

        ## Call live chat integration utility to establish connection
        unAuthLiveChatPayload = getUnauthenticatedLiveChatPayload(member_id, channel, session_id, conversation_id, transfer_summary)
        
        #logger.info(f"Unauthenticated live chat payload: {message}")
        logger.info(f"Unauthenticated live chat payload: {unAuthLiveChatPayload}")
        message = unAuthLiveChatPayload

        return {
            'title': 'Authentication Required',
            'response_summary': message,
            'success': False,
            'authenticated': False,
            'awaits_input': False,
            'exit': False,
            'transfer_to_agent': True,
            'exit_reason': 'authentication_failed',
            'message': message,
            'session_id': session_id,
            'conversation_id': conversation_id,
            'current_step': None,
            'escalate_to_agent': True,
            'transfer_summary': transfer_summary
        }
    
    async def _handle_unsubscribe(self, session: AuthSession) -> Dict[str, Any]:
        """
        EX-003: Unsubscribe handler (YAML-driven)
        """
        # Get message from YAML config (step EX-003)
        message = self.get_channel_message(session, "EX-003")
        
        # Check if session should be deleted (from YAML)
        should_delete = self.flow_engine.should_delete_session("EX-003")
        if should_delete:
            self.session_manager.delete_session(session.session_id)
        
        return {
            'success': True,
            'authenticated': False,
            'exit': True,
            'exit_reason': 'unsubscribe',
            'message': message,
            'escalate_to_agent': False
        }
    
    def _get_welcome_message(self, session: AuthSession) -> str:
        """
        Get welcome message with brand text and disclaimer for first interaction
        Only shown when session is at DOB-002 or MID-001 (first step)
        
        Returns:
            Welcome message string or empty string if not first interaction
        """
        # Only show welcome on first step (DOB-002 or MID-001)
        if session.current_step not in ["DOB-002", "MID-001"]:
            return ""
        
        # Check if this is truly the first interaction (no prior attempts)
        if session.get_attempt_count("dob_format_attempts") > 0:
            return ""
        if session.get_attempt_count("member_id_format_attempts") > 0:
            return ""
        
        # Get brand from search response (member data)
        brand_code = "abcbs"  # Default brand for now.
        brand_text = "athm"  # Default brand text for display
        if session.members and len(session.members) > 0:
            # Extract brand from first member in search results
            first_member = session.members[0]
            brand_code = first_member.get('brand', 'abcbs')
            brand_text = first_member.get('brand_text', 'athm')
        
        # Get brand privacy URL from config
        auth_config = get_authentication_config()
        brand_privacy_urls = auth_config.get('brand_privacy_urls', {})
        
        # Disclaimer URL shown in the greeting for all brands
        brand_disclaimer_url = brand_privacy_urls.get('default')
        
        logger.info(f"[AUTH] Brand: {brand_code}, Privacy URL: {brand_disclaimer_url}")
        
        # Get welcome message template from locale
        welcome_template = self.get_message(session, "privacy_greeting")
        
        # Format with brand variables
        welcome_message = welcome_template.format(
            brand=brand_text,
            url=brand_disclaimer_url
        )
        
        logger.info(f"[AUTH] Adding welcome message for first interaction")
        
        return welcome_message + "\n\n"

================================================================================================================

"""
Authentication Handler for FastAPI endpoints
Handles authentication flow and returns appropriate responses
"""
import asyncio
import html
import logging
from typing import Any, Dict, Optional, Tuple

from fastapi.responses import JSONResponse

from agents.gateway.config import get_config
from locales.en import LOCALES as EN_LOCALES
from locales.es import LOCALES as ES_LOCALES
from utils.authentication.auth_middleware import get_auth_middleware
from utils.authentication.auth_session_manager import (
    generate_conversation_id,
    get_session_manager,
)
from utils.coverage_period.coverage_period_client import CoveragePeriodClient
from utils.eligibility.eligibility_client import EligibilityClient
from utils.security.response_sanitizer import (
    escape_response_strings,
    sanitize_identifier,
)
from utils.shared.redis_cache import get_cache_client

logger = logging.getLogger(__name__)


async def _prefetch_eligibility(member_id: str, channel: str) -> None:
    """Background task: warm the eligibility features cache for the given member."""
    try:
        cache = get_cache_client(channel=channel)
        eligibility_client = EligibilityClient(cache=cache, channel=channel)
        await eligibility_client.get_filtered_features(member_id)
        logger.info("Eligibility features prefetched for member %s", member_id)
    except Exception as exc:
        logger.warning("Eligibility prefetch failed — continuing: %s", exc)


async def _prefetch_coverage_period(member_id: str, channel: str) -> None:
    """Background task: prefetch coverage period with API-side caching."""
    try:
        coverage_period_client = CoveragePeriodClient(channel=channel)
        await coverage_period_client.get_coverage_period(member_uid=member_id, cached=True)
        logger.info("Coverage period prefetched for member %s", member_id)
    except Exception as exc:
        logger.warning("Coverage period prefetch failed — continuing: %s", exc)


# Lazy-loaded auth middleware to avoid circular imports
_auth_middleware: Dict[str, Any] = {}

def _get_auth_middleware(channel: Optional[str] = None):
    """Lazy load auth middleware to avoid circular imports"""
    global _auth_middleware
    cache_key = (channel or "default").strip().lower() if isinstance(channel, str) else "default"
    if cache_key not in _auth_middleware:
        _auth_middleware[cache_key] = get_auth_middleware(channel=channel)
    return _auth_middleware[cache_key]


def _get_auth_config(channel: Optional[str] = None) -> Dict[str, Any]:
    """
    Get authentication configuration for a specific channel
    
    Args:
        channel: Channel name ('sms' or 'web')
        
    Returns:
        Authentication configuration dictionary
    """
    config = get_config(channel=channel)
    return dict(config.get('authentication') or {})


def is_authentication_required(channel: str, member_id: Optional[str] = None, phone_number: Optional[str] = None) -> bool:
    """
    Check if authentication is required based on channel and current state
    
    Args:
        channel: Communication channel (sms, voice, web, etc.)
        member_id: Member ID if already provided
        phone_number: Phone number if available
    
    Returns:
        True if authentication is required, False otherwise
    """
    # If member_id is already provided, no auth needed
    if member_id:
        return False
    
    # If no phone number, cannot authenticate
    if not phone_number:
        return False
    
    # Get channel-specific authentication config
    auth_config = _get_auth_config(channel=channel)
    auth_enabled = auth_config.get('enabled', True)
    auth_enabled_channels = auth_config.get('enabled_channels', [])
    
    logger.info(f"[AUTH_HANDLER] Channel: {channel}, Auth enabled: {auth_enabled}, Enabled channels: {auth_enabled_channels}")
    
    # Check global auth enabled flag
    if not auth_enabled:
        return False
    
    # Check if channel requires authentication
    if auth_enabled_channels and channel not in auth_enabled_channels:
        return False
    
    return True


async def handle_authentication(
    phone_number: str,
    message_content: str,
    session_id: Optional[str],
    language_code: str,
    channel: str,
    member_id: Optional[str],
    reset_conversation: bool,
    conversation_id: Optional[str] = None,
) -> Tuple[bool, Optional[str], Optional[Dict[str, Any]], Optional[JSONResponse]]:
    """
    Handle authentication flow
    
    Args:
        phone_number: User's phone number
        message_content: User's message
        session_id: Session ID
        language_code: Language code (en/es)
        channel: Communication channel
        member_id: Member ID if already authenticated
        reset_conversation: Whether to reset conversation
    
    Returns:
        Tuple of (should_continue, authenticated_member_id, auth_response, error_response)
        - should_continue: True if should proceed to orchestrator, False if auth in progress
        - authenticated_member_id: Member ID if authenticated
        - auth_response: Authentication response dict
        - error_response: JSONResponse if error occurred, None otherwise
    """
    # Get channel-specific authentication config
    auth_config = _get_auth_config(channel=channel)
    auth_enabled = auth_config.get('enabled', True)
    auth_enabled_channels = auth_config.get('enabled_channels', [])
    
    # Check if authentication is required
    auth_required = (
        auth_enabled and 
        not member_id and 
        phone_number and 
        (not auth_enabled_channels or channel in auth_enabled_channels)
    )
    
    # Log why authentication is skipped if not required
    if not member_id and phone_number and not auth_required:
        if not auth_enabled:
            print(f"[AUTH] Authentication disabled for channel '{channel}' - skipping for phone {phone_number}")
            logger.info(f"Authentication skipped: disabled for channel '{channel}'")
        elif auth_enabled_channels and channel not in auth_enabled_channels:
            print(f"[AUTH] Channel '{channel}' not in enabled channels {auth_enabled_channels} - skipping authentication")
            logger.info(f"Authentication skipped: channel '{channel}' not in enabled list")
        
        return True, member_id, {}, None
    
    if not auth_required:
        if member_id:
            asyncio.create_task(_prefetch_eligibility(member_id, channel))
            asyncio.create_task(_prefetch_coverage_period(member_id, channel))
        return True, member_id, {}, None
    
    print(f"[AUTH] Authentication required for phone {phone_number}, channel {channel}")
    logger.info(f"[AUTH_LANGUAGE] handle_authentication received language_code={language_code} for message={message_content!r}")
    print(f"[AUTH_LANGUAGE] handle_authentication received language_code={language_code} for message={message_content!r}")
    
    try:
        auth_middleware = _get_auth_middleware(channel)
        should_continue, auth_response, authenticated_member_id = await auth_middleware.process_request(
            phone_number=phone_number,
            user_message=message_content,
            session_id=session_id,
            language=language_code,
            channel=channel,
            member_id=member_id,
            reset_conversation=reset_conversation,
            conversation_id=conversation_id,
        )
    except Exception as e:
        # Authentication error - escalate to agent
        print(f"[AUTH ERROR] Authentication process failed: {str(e)}")
        logger.error(f"Authentication error for phone {phone_number}: {str(e)}", exc_info=True)
        locales = ES_LOCALES if language_code == "es" else EN_LOCALES
        response_summary = locales.get("general", {}).get(
            "technical_issue_live_agent_response",
            locales.get("general", {}).get("fallback_response", ""),
        )
        safe_session_id = sanitize_identifier(session_id)
        safe_conversation_id = sanitize_identifier(conversation_id)

        error_response = JSONResponse(content={
            "title": html.escape(str(locales.get("general", {}).get("title", "Response")), quote=False),
            "response_summary": html.escape(str(response_summary), quote=False),
            "language_code": html.escape(str(language_code), quote=False),
            "authenticated": False,
            "awaits_input": False,
            "escalate_to_agent": True,
            "transfer_to_agent": True,
            "error": "authentication_error",
            "session_id": html.escape(safe_session_id, quote=False) if safe_session_id else None,
            "conversation_id": html.escape(safe_conversation_id, quote=False) if safe_conversation_id else None,
        }, status_code=200)
        
        return False, None, {}, error_response
    
    if not should_continue:
        # Authentication in progress - return auth prompt
        print(f"[AUTH] Authentication in progress, returning auth message")
        
        # Get conversation_id from session
        session_mgr = get_session_manager()
        session = session_mgr.get_request_session(
            session_id=auth_response.get('session_id'),
            phone_number=phone_number,
            conversation_id=conversation_id,
        )
        response_conversation_id = conversation_id or (session.conversation_id if session else None)
        response_language_code = session.language if session and session.language else auth_response.get('language_code') or language_code
        locales = ES_LOCALES if response_language_code == "es" else EN_LOCALES
        
        safe_session_id = sanitize_identifier(auth_response.get('session_id'))
        safe_conversation_id = sanitize_identifier(response_conversation_id)
        current_step = auth_response.get('current_step')
        awaits_input = True
        if str(auth_response.get('awaits_input', True)).lower() == "false":
            awaits_input = False
        transfer_to_agent = False
        if str(auth_response.get('transfer_to_agent', False)).lower() == "true":
            transfer_to_agent = True

        response_content = {
            "title": html.escape(str(locales.get("general", {}).get("title", "Response")), quote=False),
            "response_summary": html.escape(str(auth_response.get('message', '')), quote=False),
            "language_code": html.escape(str(response_language_code), quote=False),
            "authenticated": False,
            "awaits_input": awaits_input,
            "current_step": html.escape(str(current_step), quote=False) if current_step is not None else None,
            "session_id": html.escape(safe_session_id, quote=False) if safe_session_id else None,
            "conversation_id": html.escape(safe_conversation_id, quote=False) if safe_conversation_id else None,
            "transfer_to_agent": transfer_to_agent
        }
        
        # Add transfer summary if transferring to agent
        if auth_response.get('transfer_to_agent') or auth_response.get('escalate_to_agent'):
            if auth_response.get('transfer_summary'):
                response_content['transfer_summary'] = html.escape(
                    str(auth_response.get('transfer_summary')), quote=False
                )
        
        if auth_response.get('escalate_to_agent'):
            response_content = escape_response_strings(auth_response.get('message', {}))

        auth_in_progress_response = JSONResponse(content=response_content)    

        return False, None, auth_response, auth_in_progress_response
    
    # Authentication complete
    logger.info(f"Authentication successful for member {authenticated_member_id}")
    
    # Check if this was cached authentication
    if auth_response.get('cached'):
        print(f"[AUTH-CACHE] Using cached authentication for member_id: {authenticated_member_id}")
    
    # Get session_id and conversation_id from session
    session_mgr = get_session_manager()
    resolved_conversation_id = conversation_id
    auth_session_id = None
    session = None
    
    session = session_mgr.get_request_session(
        session_id=auth_response.get('session_id'),
        phone_number=phone_number,
        conversation_id=resolved_conversation_id,
    )

    if session:
        resolved_conversation_id = resolved_conversation_id or session.conversation_id
        auth_session_id = session.session_id
        auth_response['language_code'] = session.language or auth_response.get('language_code') or language_code
    elif phone_number and channel and resolved_conversation_id is None:
        # Generate for display even if no session
        resolved_conversation_id = generate_conversation_id(phone_number, channel)
    auth_response.setdefault('language_code', language_code)
    
    # Add conversation_id and session_id to auth_response
    auth_response['conversation_id'] = resolved_conversation_id
    if auth_session_id:
        auth_response['session_id'] = auth_session_id
        print(f"[AUTH-HANDLER] Added session_id to auth_response: {auth_session_id}")
    
    # Log post-auth flow
    if auth_response.get('post_auth_flow') and auth_response.get('initial_message'):
        logger.info(f"[POST-AUTH] Processing initial message: '{auth_response.get('initial_message')}'")
    
    # Kick off eligibility and coverage period prefetch as background tasks — non-blocking.
    # resolved_id covers both SMS (authenticated_member_id) and Web (member_id).
    resolved_id = authenticated_member_id or member_id
    if resolved_id:
        asyncio.create_task(_prefetch_eligibility(resolved_id, channel))
        asyncio.create_task(_prefetch_coverage_period(resolved_id, channel))

    return True, authenticated_member_id, auth_response, None


def get_member_first_name(member_data: Optional[Dict[str, Any]]) -> Optional[str]:
    """Return the member's first name from auth member data (title-cased), or None."""
    if not member_data:
        return None
    return member_data['firstNm'].title()


def format_post_auth_response(
    response_summary: str,
    primary_intent: Optional[str],
    language_code: str,
    has_errors: bool = False,
    member_first_name: Optional[str] = None,
    is_post_auth: bool = False,
) -> str:
    """
    Format response summary for post-authentication flow
    
    Args:
        response_summary: Original response summary from orchestrator
        primary_intent: Primary intent detected
        language_code: Language code (en/es)
        has_errors: Whether the orchestrator had errors
        member_first_name: Authenticated member's first name for personalized greeting
        is_post_auth: True only for the first message after authentication completes
    
    Returns:
        Formatted response summary prefixed with a personalized greeting
    """
    locales = ES_LOCALES if language_code == "es" else EN_LOCALES
    auth_messages = locales.get('auth', {}) if locales else {}
    
    if primary_intent == "GREETING":
        general_messages = locales.get('general', {}) if locales else {}
        if member_first_name:
            greeting = general_messages.get('post_auth_greeting', EN_LOCALES['general']['post_auth_greeting']).format(name=member_first_name)
        else:
            greeting = general_messages.get('post_auth_greeting_no_name', EN_LOCALES['general']['post_auth_greeting_no_name'])
        if is_post_auth:
            greeting_tail = auth_messages.get('post_auth_greeting_tail', EN_LOCALES['auth']['post_auth_greeting_tail'])
            return f"{greeting}\n\n{greeting_tail}"
        return greeting
    
    general_messages = locales.get('general', {}) if locales else {}
    if member_first_name:
        greeting = general_messages.get('post_auth_intent_greeting', EN_LOCALES['general']['post_auth_intent_greeting']).format(name=member_first_name)
    else:
        greeting = general_messages.get('post_auth_intent_greeting_no_name', EN_LOCALES['general']['post_auth_intent_greeting_no_name'])

    if not (response_summary and response_summary.strip()):
        logger.info("[POST-AUTH] No response summary, returning only greeting")
        return greeting

    return f"{greeting}\n\n{response_summary}"

===============================================================================================================

"""Controller for building standardized error fallback responses."""

import time

from fastapi.responses import JSONResponse

from locales import en, es
from utils.constants import Channel
from utils.language_utils import normalize_language_code
from utils.timing_utils import format_timing


def build_llm_bootstrap_error_response(
    *,
    language_code: str | None,
    error_key: str | None,
    channel: str | None,
    member_id: str | None,
    conversation_id: str | None,
    is_post_auth: bool,
    total_start: float,
) -> JSONResponse:
    """
    Build a localized fallback JSON response when LLM bootstrap fails before orchestration.

    Use this when the Horizon model cannot be initialized (token fetch failure, timeout,
    rate limit) or when the orchestrator raises an unrecoverable error before producing
    a result. Returns a safe, user-facing message instead of a raw 500 error.

    Args:
        language_code: Canonical language code ('en' or 'es') for localized messages.
        channel: Request channel ('sms', 'web', etc.).
        member_id: Authenticated member ID, if available.
        conversation_id: Conversation session ID, if available.
        is_post_auth: Whether the request is part of a post-authentication flow.
        total_start: Epoch timestamp when the request started, used to compute Total timing.

    Returns:
        JSONResponse with a localized error summary and safe default fields.
    """
    normalized_language_code = normalize_language_code(language_code)
    locale_data = es.LOCALES if normalized_language_code == "es" else en.LOCALES
    errors = locale_data.get("errors", {})
    response_summary = errors.get(
        error_key or "error_500_agent_available",
        errors.get(
            "error_500_agent_available",
            locale_data.get("general", {}).get("fallback_response", ""),
        ),
    )

    normalized_channel = (channel or "").strip().lower() if channel else None
    is_sms_channel = normalized_channel == Channel.SMS.value

    response = {
        "title": locale_data.get("general", {}).get("title", "Healthcare Assistant"),
        "response_summary": response_summary,
        "language_code": normalized_language_code,
        "primary_intent": "unidentified",
        "blocks": [],
        "timings": {
            "Intent detection": 0.0,
            "Total": format_timing(time.time() - total_start),
        },
        "error": True,
        "member_id": member_id,
        "conversation_id": conversation_id,
    }

    if is_sms_channel:
        response["authenticated"] = True if member_id else False
        response["post_auth_flow"] = is_post_auth
        response["conversation_id"] = conversation_id

    return JSONResponse(content=response)

===============================================================================================================

"""
A2A Agent Proxy — pure card-driven discovery, no registry.json.

Agent base URLs are read from config/common-config.yaml under the a2a_agents key:

    a2a_agents:
      spending_account:
        base_url: http://localhost:9051
      claims:
        base_url: http://localhost:9052

AgentRegistry builds a domain→base_url index from config at startup. On each request,
only the agent declared for that domain is fetched (lazy, on-demand). This avoids
initializing agents that are not needed for the current request.
No hardcoded domain names or agent metadata anywhere in this file.
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any, Dict, List, Optional

import httpx

from agents.gateway.config import get_a2a_agents_config
from utils.constants import Channel

logger = logging.getLogger(__name__)


def _load_base_urls() -> List[str]:
    """Read base URLs from common-config.yaml a2a_agents section."""
    cfg = get_a2a_agents_config()
    urls = [
        str(agent_cfg.get("base_url", "")).strip().rstrip("/")
        for agent_cfg in cfg.values()
        if agent_cfg.get("base_url")
    ]
    logger.info("[AGENT_REGISTRY] Loaded %d agent URL(s) from config: %s", len(urls), urls)
    return urls


# ─────────────────────────────────────────────
# Registry — built from live agent cards
# ─────────────────────────────────────────────

class AgentRegistry:
    """
    Discovers remote agents by fetching their /.well-known/agent-card.json.
    Domain map is built from card data — nothing is hardcoded here.
    """

    def __init__(self, base_urls: Optional[List[str]] = None) -> None:
        self._base_urls = base_urls if base_urls is not None else _load_base_urls()
        self._agents: List[Dict[str, Any]] = []
        self._domain_map: Dict[str, Dict[str, Any]] = {}
        # Pre-built from config at startup: domain (upper) -> base_url
        # Used to load only the agent needed for a given domain, not all agents.
        self._config_domain_index: Dict[str, str] = self._build_domain_index()

    @staticmethod
    def _build_domain_index() -> Dict[str, str]:
        """Build a domain (uppercase) -> base_url map from config at startup."""
        index: Dict[str, str] = {}
        for agent_cfg in get_a2a_agents_config().values():
            base_url = str(agent_cfg.get("base_url", "")).strip().rstrip("/")
            for domain in agent_cfg.get("domains", []):
                index[domain.upper()] = base_url
        return index

    async def load(self) -> None:
        """Fetch all agent cards and build the domain map. Call once at startup."""
        self._agents = []
        self._domain_map = {}

        for base_url in self._base_urls:
            card = await self._fetch_card(base_url)
            if not card:
                continue

            agent_name = card.get("name", base_url).upper().replace(" ", "_")
            # Always derive rpc_url from base_url (config-sourced), never from
            # card.url which may contain 0.0.0.0 (the server bind address).
            rpc_url = f"{base_url}/"
            agent_entry = {
                "id": agent_name,
                "name": agent_name,
                "base_url": base_url,
                "rpc_url": rpc_url,
                "card_url": f"{base_url}/.well-known/agent-card.json",
                "card": card,
            }
            self._agents.append(agent_entry)

            # Map every domain listed in skills[].tags or skills[].id (uppercased)
            for skill in card.get("skills", []):
                for tag in skill.get("tags", []):
                    domain = tag.upper()
                    if domain not in self._domain_map:
                        self._domain_map[domain] = agent_entry

                skill_id = skill.get("id", "").upper()
                if skill_id and skill_id not in self._domain_map:
                    self._domain_map[skill_id] = agent_entry

            logger.info(
                "[AGENT_REGISTRY] Registered agent '%s' from %s — domains: %s",
                agent_name, base_url, [d for d, a in self._domain_map.items() if a is agent_entry],
            )

        logger.info(
            "[AGENT_REGISTRY] Discovery complete — %d agent(s), domain map: %s",
            len(self._agents), list(self._domain_map.keys()),
        )

    async def _fetch_card(self, base_url: str) -> Optional[Dict[str, Any]]:
        card_url = f"{base_url}/.well-known/agent-card.json"
        try:
            async with httpx.AsyncClient(timeout=5.0, verify=False) as client:
                resp = await client.get(card_url)
                resp.raise_for_status()
                logger.info("[AGENT_REGISTRY] Fetched card from %s", card_url)
                return resp.json()
        except Exception as exc:
            logger.warning("[AGENT_REGISTRY] Could not fetch card from %s: %s", card_url, exc)
            return None

    def get_by_domain(self, domain: str) -> Optional[Dict[str, Any]]:
        return self._domain_map.get(domain.upper())

    async def _load_single_url(self, base_url: str) -> None:
        """Fetch card for one base_url and register it in the domain map."""
        if any(a["base_url"] == base_url for a in self._agents):
            return  # already loaded
        card = await self._fetch_card(base_url)
        if not card:
            return
        agent_name = card.get("name", base_url).upper().replace(" ", "_")
        rpc_url = f"{base_url}/"
        agent_entry = {
            "id": agent_name,
            "name": agent_name,
            "base_url": base_url,
            "rpc_url": rpc_url,
            "card_url": f"{base_url}/.well-known/agent-card.json",
            "card": card,
        }
        self._agents.append(agent_entry)
        for skill in card.get("skills", []):
            for tag in skill.get("tags", []):
                d = tag.upper()
                if d not in self._domain_map:
                    self._domain_map[d] = agent_entry
            skill_id = skill.get("id", "").upper()
            if skill_id and skill_id not in self._domain_map:
                self._domain_map[skill_id] = agent_entry
        logger.info(
            "[AGENT_REGISTRY] Registered agent '%s' from %s — domains: %s",
            agent_name, base_url, [d for d, a in self._domain_map.items() if a is agent_entry],
        )

    async def get_by_domain_or_reload(self, domain: str) -> Optional[Dict[str, Any]]:
        """Return agent for domain.
        Looks up which agent owns the domain from config's domains list and loads
        only that agent. Falls back to a full load if not found in config or card.
        """
        upper_domain = domain.upper()
        if upper_domain in self._domain_map:
            return self._domain_map[upper_domain]

        # Use pre-built index for O(1) lookup — no config loop at request time
        base_url = self._config_domain_index.get(upper_domain)
        if base_url:
            logger.info("[AGENT_REGISTRY] Domain '%s' → loading agent from config index", upper_domain)
            await self._load_single_url(base_url)
            return self._domain_map.get(upper_domain)

        # Domain not declared in any config entry — fall back to full load
        logger.info("[AGENT_REGISTRY] Domain '%s' not in config index — attempting full reload", upper_domain)
        await self.load()
        return self._domain_map.get(upper_domain)

    def get_by_id(self, agent_id: str) -> Optional[Dict[str, Any]]:
        return next((a for a in self._agents if a["id"] == agent_id.upper()), None)

    @property
    def all_agents(self) -> List[Dict[str, Any]]:
        return list(self._agents)

    async def get_agents(self) -> List[Dict[str, Any]]:
        """Return full agent card details for all registered remote agents."""
        return [
            {
                "id": a["id"],
                "name": a["name"],
                "base_url": a["base_url"],
                "rpc_url": a["rpc_url"],
                "card_url": a["card_url"],
                "description": a["card"].get("description", ""),
                "version": a["card"].get("version", ""),
                "skills": a["card"].get("skills", []),
                "capabilities": a["card"].get("capabilities", {}),
            }
            for a in self._agents
        ]


# ─────────────────────────────────────────────
# Proxy caller
# ─────────────────────────────────────────────

class A2AAgentProxy:
    """Sends a JSON-RPC 2.0 message/send request to a remote A2A agent."""

    def __init__(self, timeout: float = 60.0) -> None:
        self._timeout = timeout

    async def call(
        self,
        rpc_url: str,
        member_contrived_id: str,
        intent: str,
        agent_specific_metadata,
        channel: Optional[str] = None,
        meta_trans_id: Optional[str] = None,
        context_id: Optional[str] = None,
        user_query: Optional[str] = None,
        five_w_metadata: Optional[Dict[str, Any]] = None,
        streaming: bool = False,
        
    ) -> Dict[str, Any]:
        """
        Build and POST a standard A2A JSON-RPC payload with 5W structure to the remote agent.
        
        Args:
            rpc_url: Remote agent URL
            member_contrived_id: Member identifier
            intent: Intent code (e.g., SPENDING_ACCOUNT_BALANCE, GET_BILLPAY_DETAILS)
            channel: Channel (sms/web)
            meta_trans_id: Transaction ID
            context_id: Context ID for conversation continuity
            user_query: Actual user query text (e.g., "What is my HSA balance?") for conversation context
            five_w_metadata: Complete 5W metadata from upstream (planner/gateway). If provided, used as-is.
                If not provided, builds minimal 5W from member_contrived_id and intent.
            streaming: If True, use message/stream method; otherwise message/send (A2A spec)
        """
        message_id = meta_trans_id or str(uuid.uuid4())
        
        # Use complete 5W metadata if provided, else build minimal version
        if five_w_metadata:
            metadata = five_w_metadata
            # Ensure channel is set
            if "channel" not in metadata:
                metadata["channel"] = channel or Channel.WEB.value
        else:
            # Build minimal 5W metadata structure for remote agents
            metadata = {
                "channel": channel or Channel.WEB.value,
                "5w.status": "5w-initiated",
                "5w.who.asked": {
                    "role": "member",
                    "identifier": [
                        {"type": "member-contrived-id", "value": member_contrived_id}
                    ]
                },
                "5w.why.service": {
                    "intent": [intent]
                }
            }
        
        # Merge any extra metadata passed by the gateway (e.g. has_chat, has_billpay_access, billpay_type)
        if agent_specific_metadata:
            metadata.update(agent_specific_metadata)
            logger.info("[A2A_PROXY] Merged extra_metadata keys: %s", list(agent_specific_metadata.keys()))

        rpc_payload = {
            "jsonrpc": "2.0",
            "id": message_id,
            "method": "message/stream" if streaming else "message/send",
            "params": {
                "message": {
                    "messageId": message_id,
                    "contextId": context_id,
                    "role": "user",
                    "parts": [{"kind": "text", "text": user_query or intent}],  # Use user query for conversation context, fallback to intent
                    "metadata": metadata
                }
            },
        }

        logger.info(
            "[A2A_PROXY] POST %s — member=%s intent=%s meta_trans_id=%s",
            rpc_url, member_contrived_id, intent, message_id,
        )

        try:
            async with httpx.AsyncClient(timeout=self._timeout, verify=False) as client:
                resp = await client.post(rpc_url, json=rpc_payload)
                resp.raise_for_status()
                body = resp.json()
        except httpx.TimeoutException as exc:
            raise RuntimeError(
                f"Remote agent timed out after {self._timeout:.1f}s: {rpc_url}"
            ) from exc
        except httpx.HTTPStatusError as exc:
            raise RuntimeError(
                f"Remote agent returned HTTP {exc.response.status_code}: {rpc_url}"
            ) from exc
        except httpx.HTTPError as exc:
            raise RuntimeError(f"Remote agent request failed: {rpc_url}") from exc

        return self._unwrap(body)

    def _unwrap(self, body: Dict[str, Any]) -> Dict[str, Any]:
        """
        Extract the agent's result from the JSON-RPC response envelope.
        Returns all artifacts so upstream can access them for building widgets, UI components, etc.
        """
        if "error" in body:
            raise RuntimeError(f"Remote agent error: {body['error']}")

        result = body.get("result", body)

        # Extract all artifacts and their content
        artifacts_data = {}
        try:
            for artifact in result.get("artifacts", []):
                artifact_name = artifact.get("name", "unknown")
                for part in artifact.get("parts", []):
                    if part.get("kind") == "text" and part.get("text"):
                        text = part["text"]
                        # Try to parse as JSON, otherwise keep as text
                        try:
                            artifacts_data[artifact_name] = json.loads(text)
                        except Exception:
                            artifacts_data[artifact_name] = text
        except Exception as e:
            logger.warning(f"[A2A_PROXY] Error extracting artifacts: {e}")

        # If we have artifacts, return them along with the full result
        if artifacts_data:
            # For backward compatibility, if there's a 'summarized_response' artifact, 
            # merge it at the top level so existing code still works
            if "summarized_response" in artifacts_data:
                response = artifacts_data["summarized_response"]
                if isinstance(response, dict):
                    # Create a shallow copy to avoid circular reference
                    result_dict = dict(response)
                    # Add all artifacts to the response (avoid circular reference by not including summarized_response in _artifacts)
                    result_dict["_artifacts"] = {k: v for k, v in artifacts_data.items() if k != "summarized_response"}
                    return result_dict
                else:
                    # If summarized_response is not a dict (e.g., string), wrap it
                    return {
                        "response": response,
                        "_artifacts": {k: v for k, v in artifacts_data.items() if k != "summarized_response"}
                    }
            
            # Otherwise return all artifacts
            return {"_artifacts": artifacts_data, "artifacts": list(artifacts_data.keys())}

        return result if isinstance(result, dict) else {"response": str(result)}


# ─────────────────────────────────────────────
# Module-level singletons (imported by gateway)
# ─────────────────────────────────────────────

registry = AgentRegistry()
proxy = A2AAgentProxy()

==============================================================================================================

from __future__ import annotations

from typing import Any, Dict, List, Optional

from .parser import GatewayRequestContext


def build_history_records(context: GatewayRequestContext, *, task_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Normalize the inbound message parts so they can be echoed via history."""
    message = context.raw_payload.get("params", {}).get("message", {}) if context.raw_payload else {}
    parts = message.get("parts") or []
    if not parts:
        return []

    normalized: List[Dict[str, Any]] = []
    for part in parts:
        kind = part.get("kind") or part.get("type") or "text"
        entry: Dict[str, Any] = {"kind": kind}
        if kind == "text":
            entry["text"] = part.get("text", "")
        elif kind == "file":
            entry["file"] = part.get("file", {})
        else:
            # Preserve the original content while normalizing the key name.
            for key, value in part.items():
                if key not in {"type"}:
                    entry.setdefault(key, value)
        normalized.append(entry)

    history_entry: Dict[str, Any] = {
        "role": message.get("role", "user"),
        "parts": normalized,
    }
    if context.message_id:
        history_entry["messageId"] = context.message_id
    if context.context_id:
        history_entry["contextId"] = context.context_id
    if task_id:
        history_entry["taskId"] = task_id
    return [history_entry]

======================================================================================================

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from utils.constants import Channel


@dataclass
class GatewayRequestContext:
    """Normalized view of the inbound A2A message needed for routing."""

    invocation_id: str
    message_id: str
    domain: Optional[str]
    intents: List[str] = field(default_factory=list)
    member_contrived_id: Optional[str] = None
    context_id: Optional[str] = None
    streaming_requested: bool = False
    raw_payload: Dict[str, Any] = field(default_factory=dict)
    expects_json_response: bool = True
    five_w_status: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)  # NEW: Store full message metadata
    channel: Optional[str] = None


class A2ARequestParser:
    """Extract the routing details from the canonical AWS Strands payload."""

    @staticmethod
    def parse(payload: Dict[str, Any], accept_header: str = "application/json") -> GatewayRequestContext:
        params = payload.get("params", {})
        message = params.get("message", {})
        metadata = message.get("metadata", {})

        invocation_id = payload.get("id", "")
        message_id = message.get("messageId", "")
        
        # Check for direct domain (claims) or 5W domain (benefits)
        domain = metadata.get("domain")  # Direct for claims
        if not domain:  # Fall back to 5W for benefits
            domain = (
                A2ARequestParser._safe_upper(
                    A2ARequestParser._dig(metadata, ["5w.what.service", "service", 0, "domain"])
                )
                if metadata
                else None
            )
        else:
            domain = A2ARequestParser._safe_upper(domain)
        
        intents = A2ARequestParser._extract_intents(metadata)
        member_contrived_id = A2ARequestParser._extract_member_id(metadata)
        channel = A2ARequestParser._extract_channel(payload, params, metadata)

        context_id = message.get("contextId")
        if not context_id:
            context_id = A2ARequestParser._extract_context_from_parts(message.get("parts", []))
        # Determine streaming based on Accept header
        streaming_requested = accept_header == "text/event-stream"
        # JSON response unless streaming (A2A spec: message/send = JSON, message/stream = SSE)
        expects_json_response = not streaming_requested
        five_w_status = metadata.get("5w.status") if isinstance(metadata.get("5w.status"), str) else None

        return GatewayRequestContext(
            invocation_id=invocation_id,
            message_id=message_id,
            domain=domain,
            intents=intents,
            member_contrived_id=member_contrived_id,
            context_id=context_id,
            streaming_requested=streaming_requested,
            raw_payload=payload,
            expects_json_response=expects_json_response,
            five_w_status=five_w_status,
            metadata=metadata,  # NEW: Store full metadata including intent_response
            channel=channel,
        )

    @staticmethod
    def _extract_channel(payload: Dict[str, Any], params: Dict[str, Any], metadata: Dict[str, Any]) -> Optional[str]:
        profile = metadata.get("5w.profile", {}) if isinstance(metadata.get("5w.profile"), dict) else {}
        for value in (profile.get("channel"), metadata.get("channel"), params.get("channel"), payload.get("channel")):
            if isinstance(value, str):
                normalized = value.strip().lower()
                if normalized:
                    return normalized
        # defaulting to WEB channel            
        return Channel.WEB.value

    @staticmethod
    def _dig(struct: Dict[str, Any], path: List[Any]) -> Any:
        cursor: Any = struct
        for key in path:
            if cursor is None:
                return None
            if isinstance(key, int):
                if isinstance(cursor, list) and 0 <= key < len(cursor):
                    cursor = cursor[key]
                else:
                    return None
            else:
                if isinstance(cursor, dict):
                    cursor = cursor.get(key)
                else:
                    return None
        return cursor

    @staticmethod
    def _extract_intents(metadata: Dict[str, Any]) -> List[str]:
        # Check for direct intent (claims)
        direct_intent = metadata.get("intent")
        if isinstance(direct_intent, str):
            return [direct_intent]
        
        # Fall back to 5W structure (benefits)
        intents = A2ARequestParser._dig(metadata, ["5w.why.service", "intent"])
        if isinstance(intents, list):
            return [intent for intent in intents if isinstance(intent, str)]
        if isinstance(intents, str):
            return [intents]
        return []

    @staticmethod
    def _extract_member_id(metadata: Dict[str, Any]) -> Optional[str]:
        # For claims: Check for direct member_contrived_id in metadata first
        direct_member_id = metadata.get("member_contrived_id")
        if isinstance(direct_member_id, str):
            return direct_member_id
        
        # For benefits: Fall back to 5W structure
        identifiers = A2ARequestParser._dig(metadata, ["5w.who.asked", "identifier"])
        if isinstance(identifiers, list):
            for identifier in identifiers:
                if (
                    isinstance(identifier, dict)
                    and identifier.get("type") == "member-contrived-id"
                    and isinstance(identifier.get("value"), str)
                ):
                    return identifier["value"]
        return None

    @staticmethod
    def _extract_context_from_parts(parts: List[Dict[str, Any]]) -> Optional[str]:
        for part in parts:
            metadata = part.get("metadata", {})
            if metadata and isinstance(metadata.get("contextId"), str):
                return metadata["contextId"]
        return None

    @staticmethod
    def _safe_upper(value: Optional[str]) -> Optional[str]:
        return value.upper() if isinstance(value, str) else None

================================================================================================================

from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional


def _artifact(text: str, kind: str) -> Dict:
    return {
        "artifactId": str(uuid.uuid4()),
        "description": "Healthcare information with 5W compliance",
        "name": "5W Healthcare Response",
        "parts": [
            {
                "kind": kind,
                "text": text,
            }
        ],
    }


def _task_base(meta_trans_id: str, context_id: Optional[str]) -> Dict:
    task_id = f"task-{context_id}" if context_id else f"task-{meta_trans_id}"
    return {
        "id": meta_trans_id,
        "jsonrpc": "2.0",
        "result": {
            "kind": "task",
            "id": task_id,
            "contextId": context_id,
        },
    }


def _message(metadata: Dict[str, Any], *, text: Optional[str] = None, role: str = "agent") -> Dict:
    parts: List[Dict[str, str]] = []
    if text:
        parts.append({"kind": "text", "text": text})
    message: Dict[str, Any] = {
        "kind": "message",
        "role": role,
        "parts": parts,
    }
    if metadata:
        message["metadata"] = metadata
    return message


def build_completed_response(
    meta_trans_id: str,
    context_id: str | None,
    text: str,
    *,
    as_json: bool = False,
) -> Dict:
    part_kind = "widget" if as_json else "text"
    base = _task_base(meta_trans_id, context_id)
    metadata = {"5w.status": "5w-completed"}
    base["result"]["status"] = {
        "state": "completed",
        "message": _message(metadata),
    }
    base["result"]["artifacts"] = [_artifact(text, part_kind)]
    return base


def build_incomplete_response(
    meta_trans_id: str,
    context_id: str | None,
    message: str,
    *,
    required_fields: List[str] | None = None,
    missing_fields: List[str] | None = None,
    state: str = "input-required",
) -> Dict:
    metadata: Dict[str, Any] = {"5w.status": "5w-incomplete"}
    if required_fields:
        metadata["5w.required"] = required_fields
    if missing_fields:
        metadata["5w.missing_fields"] = missing_fields

    base = _task_base(meta_trans_id, context_id)
    base["result"]["status"] = {
        "state": state,
        "message": _message(metadata, text=message),
    }
    return base


def build_missing_member_response(meta_trans_id: str, context_id: str | None) -> Dict:
    message = (
        "I need additional information to process your healthcare request properly. "
        "Please provide member-contrived-id."
    )
    return build_incomplete_response(
        meta_trans_id,
        context_id,
        message,
        required_fields=["5w.who.asked"],
        missing_fields=["5w.who.asked.identifier.member-contrived-id"],
    )


def build_failed_response(
    meta_trans_id: str,
    context_id: str | None,
    message: str,
    *,
    error_code: str = "INSUFFICIENT_CONTEXT",
) -> Dict:
    metadata = {
        "5w.status": "5w-failed",
        "5w.health.status": "5w-failed",
        "5w.error": error_code,
    }
    base = _task_base(meta_trans_id, context_id)
    base["result"]["status"] = {
        "state": "failed",
        "message": _message(metadata, text=message),
    }
    return base


def attach_history(response: Dict, history: Optional[List[Dict[str, Any]]]) -> Dict:
    """Add the inbound conversation history to the A2A response."""
    if history:
        response.setdefault("result", {})["history"] = history
    return response

===============================================================================================================

"""
Benefits Explainability Agent for A2A Gateway Integration.
This agent handles A2A-compliant benefits explainability requests through the gateway.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any, Dict, Generator, Union

from agents.gateway.a2a import GatewayRequestContext
from agents.gateway.api import BenefitsExplainabilityClient
from agents.gateway.config import get_authorization_token_config, get_soa_config

logger = logging.getLogger(__name__)


class BenefitsExplainabilityAgent:
    """
    A2A-compliant agent for benefits explainability requests.
    
    Extracts user queries and member data from A2A 5W framework metadata,
    then uses BenefitsExplainabilityClient to fetch detailed benefit information.
    """

    def __init__(self, client: BenefitsExplainabilityClient | None = None) -> None:
        """
        Initialize the Benefits Explainability Agent.
        
        Args:
            client: Optional BenefitsExplainabilityClient instance.
        """
        # Don't create client at init - create on-demand based on channel
        self._provided_client = client
    
    def _get_benefits_client(self, channel: str | None = None) -> BenefitsExplainabilityClient:
        """
        Create a client for the specified channel.
        
        Args:
            channel: Channel identifier (sms, web, etc.).
            
        Returns:
            BenefitsExplainabilityClient configured for the channel
        """
        # If client was provided at init (e.g., for testing), use it
        if self._provided_client:
            return self._provided_client
        
        # Normalize channel
        channel_key = (channel or '').strip().lower()
        if not channel_key:
            raise ValueError("channel is required to create BenefitsExplainabilityClient")
        
        # Create new client for this channel
        logger.info(f"[BENEFITS_EXPLAINABILITY_AGENT] Creating new client for channel={channel_key}")
        benefits_client = BenefitsExplainabilityClient(
            authorization_token_config=get_authorization_token_config(channel=channel_key),
            soa_config=get_soa_config(channel=channel_key)
        )
        return benefits_client

    def handle_request(
        self,
        context: GatewayRequestContext,
        intent: str,
        *,
        meta_trans_id: str | None = None,
        channel: str | None = None,
    ) -> Union[Dict[str, Any], Generator[str, None, None]]:
        """
        Handle A2A benefits explainability request.
        
        Args:
            context: Gateway request context with A2A 5W metadata
            intent: Intent string (e.g., "get_benefits_explainability")
            meta_trans_id: Optional transaction ID for logging
            channel: Optional channel identifier (sms, web, etc.)
            
        Returns:
            Dict containing the benefits explainability response payload
            
        Raises:
            ValueError: If required fields are missing
        """
        start_time = time.time()
        
        ### ADDED: Log agent invocation
        logger.info(
            "[BENEFITS_EXPLAINABILITY_AGENT] ⏱️ Agent START - intent=%s, meta_trans_id=%s, context_id=%s",
            intent, meta_trans_id, context.context_id
        )
        
        # Extract user message from A2A message parts
        user_message = self._extract_user_message(context)
        if not user_message:
            logger.error("[BENEFITS_EXPLAINABILITY_AGENT] Missing user message in request")
            raise ValueError("User message is required for Benefits Explainability requests.")

        # Extract member ID from 5W metadata
        member_id = self._extract_member_id(context)
        if not member_id:
            logger.error("[BENEFITS_EXPLAINABILITY_AGENT] Missing member ID in request")
            raise ValueError("Member ID is required for Benefits Explainability requests.")

        # Extract service_name from 5W metadata (from intent detection via orchestrator)
        service_name = self._extract_service_name(context)
        
        ### ADDED: Enhanced logging for input parameters
        logger.info(
            "[BENEFITS_EXPLAINABILITY_AGENT] Input parameters - "
            "user_message='%s', member_id=%s, service_name=%s, intent=%s, meta_trans_id=%s",
            user_message[:100] if len(user_message) > 100 else user_message,  # Truncate long messages
            member_id, service_name, intent, meta_trans_id
        )

        # ALWAYS use JSON API (non-streaming) to get complete response
        # Ignore streaming_requested flag to ensure we get the benefit_response artifact
        logger.info("[BENEFITS_EXPLAINABILITY_AGENT] Using JSON API (non-streaming) for member_id=%s", member_id)
        
        try:
            logger.info("[BENEFITS_EXPLAINABILITY_AGENT] Calling BenefitsExplainabilityClient JSON API for member_id=%s, service_name=%s, channel=%s", member_id, service_name, channel)
            response_data = self._collect_streaming_response(user_message, member_id, service_name, context, meta_trans_id, channel)
            
            # Calculate and log total time
            elapsed_time = time.time() - start_time
            logger.info(
                "[BENEFITS_EXPLAINABILITY_AGENT] ⏱️ Agent COMPLETE - member_id=%s, total_time=%.2f seconds",
                member_id, elapsed_time
            )
            logger.info("[BENEFITS_EXPLAINABILITY_AGENT] Successfully received JSON response for member_id=%s", member_id)
            return response_data
        except Exception as e:
            elapsed_time = time.time() - start_time
            logger.error(
                "[BENEFITS_EXPLAINABILITY_AGENT] ⏱️ Agent FAILED - member_id=%s, error=%s, time_elapsed=%.2f seconds",
                member_id, str(e), elapsed_time
            )
            raise ValueError(f"Failed to fetch benefits explainability: {str(e)}")

    def _extract_user_message(self, context: GatewayRequestContext) -> str | None:
        """
        Extract user message from A2A message parts.
        Looks for parts with kind="text" and extracts the text field.
        
        Args:
            context: Gateway request context
            
        Returns:
            User message text or None
        """
        try:
            parts = (
                context.raw_payload.get("params", {})
                .get("message", {})
                .get("parts", [])
            )
            if parts and isinstance(parts, list):
                # Look for parts with kind="text"
                for part in parts:
                    if isinstance(part, dict):
                        # Check for kind="text" attribute
                        if part.get("kind") == "text" and "text" in part:
                            logger.debug(f"[BENEFITS_EXPLAINABILITY_AGENT] Extracted text from part with kind='text': {part.get('text')}")
                            return part.get("text", "")
                        # Fallback: if no kind attribute, just get text
                        elif "text" in part and "kind" not in part:
                            logger.debug(f"[BENEFITS_EXPLAINABILITY_AGENT] Extracted text from part without kind attribute: {part.get('text')}")
                            return part.get("text", "")
        except (KeyError, IndexError, AttributeError) as e:
            logger.warning(f"[BENEFITS_EXPLAINABILITY_AGENT] Error extracting user message: {e}")
        return None

    def _extract_member_id(self, context: GatewayRequestContext) -> str | None:
        """
        Extract member ID from 5W who.asked metadata.
        
        Args:
            context: Gateway request context
            
        Returns:
            Member ID or None
        """
        # First try the context's member_contrived_id
        if context.member_contrived_id:
            return context.member_contrived_id

        # Otherwise, extract from 5W metadata
        try:
            metadata = (
                context.raw_payload.get("params", {})
                .get("message", {})
                .get("metadata", {})
            )
            who_asked = metadata.get("5w.who.asked", {})
            identifiers = who_asked.get("identifier", [])
            
            if isinstance(identifiers, list):
                for identifier in identifiers:
                    if isinstance(identifier, dict):
                        if identifier.get("type") == "member-contrived-id":
                            return identifier.get("value")
        except (KeyError, AttributeError):
            pass
        
        return None

    def _extract_service_name(self, context: GatewayRequestContext) -> str | None:
        """
        Extract service_name from 5W metadata service[].name[] field.
        
        Args:
            context: Gateway request context
            
        Returns:
            Service name or None
        """
        try:
            metadata = (
                context.raw_payload.get("params", {})
                .get("message", {})
                .get("metadata", {})
            )
            service = metadata.get("5w.what.service", {})
            
            logger.info(f"[BENEFITS_EXPLAINABILITY_AGENT] Full 5w.what.service: {service}")
            
            # Extract from service[].name[] structure
            service_list = service.get("service", [])
            if isinstance(service_list, list) and service_list:
                first_service = service_list[0]
                if isinstance(first_service, dict):
                    name_list = first_service.get("name", [])
                    if isinstance(name_list, list) and name_list:
                        service_name = name_list[0]
                        logger.info(f"[BENEFITS_EXPLAINABILITY_AGENT] Extracted service_name: {service_name}")
                        return service_name
                    elif isinstance(name_list, str):
                        logger.info(f"[BENEFITS_EXPLAINABILITY_AGENT] Extracted service_name (string): {name_list}")
                        return name_list
            
            logger.warning("[BENEFITS_EXPLAINABILITY_AGENT] No service_name found in 5W metadata")
        except (KeyError, AttributeError) as e:
            logger.error(f"[BENEFITS_EXPLAINABILITY_AGENT] Error extracting service_name: {e}")
        
        return None

    def _collect_streaming_response(self, user_message: str, member_id: str, service_name: str | None, context: GatewayRequestContext, meta_trans_id: str | None = None, channel: str | None = None) -> Dict[str, Any]:
        """
        Get the JSON response and extract ONLY the benefit_response artifact.
        Uses the non-streaming JSON API for complete response.
        
        Args:
            user_message: User's query message
            member_id: Member UID
            service_name: Service name from intent detection (optional)
            context: Gateway request context with 5W metadata
            meta_trans_id: Transaction ID from orchestrator for request tracking
            
        Returns:
            Structured response dictionary with extracted benefit_response text
        """
        benefit_response_text = None
        
        try:
            # Get the appropriate client for this channel
            benefits_client = self._get_benefits_client(channel)
            
            # Call the JSON API (non-streaming) with service_name, meta_trans_id, and channel
            logger.info(f"[BENEFITS_EXPLAINABILITY_AGENT] Calling JSON API for member_id={member_id}, service_name={service_name}, meta_trans_id={meta_trans_id}, channel={channel}")
            response_json = benefits_client.get_api_response_json(
                user_message, 
                member_id, 
                service_name=service_name,
                meta_trans_id=meta_trans_id,
                channel=channel
            )
            
            # Check for benefit_response artifacts (multiple chunks from last 2 chunks)
            benefit_response_texts = []  # Store multiple texts from different chunks
            
            if "result" in response_json:
                result = response_json.get("result", {})
                               
                # Look for artifacts with name="benefit_response"
                artifacts = result.get("artifacts", [])
                total_chunks = result.get("total_chunks", len(artifacts))
                
                if artifacts and isinstance(artifacts, list):
                    for idx, artifact in enumerate(artifacts):
                        if isinstance(artifact, dict) and artifact.get("name") == "benefit_response":
                            artifact_parts = artifact.get("parts", [])
                            chunk_index = artifact.get("chunk_index", idx + 1)
                            if artifact_parts and isinstance(artifact_parts, list):
                                for part in artifact_parts:
                                    if isinstance(part, dict) and part.get("kind") == "text" and "text" in part:
                                        text = part.get("text", "")
                                        benefit_response_texts.append({
                                            "text": text,
                                            "chunk_index": chunk_index
                                        })
                                        break
                
                # Location 2: result.status_messages (fallback - for clarification questions or errors)
                if not benefit_response_texts:
                    status_messages = result.get("status_messages", [])
                    
                    if status_messages and isinstance(status_messages, list):
                        for status_msg in status_messages:
                            if isinstance(status_msg, dict):
                                text = status_msg.get("text", "")
                                state = status_msg.get("state", "")
                                chunk_index = status_msg.get("chunk_index", 1)
                                
                                # Use status messages with input-required state for clarifications
                                if text and state == "input-required":
                                    benefit_response_texts.append({
                                        "text": text,
                                        "chunk_index": chunk_index
                                    })
        
        except Exception as e:
            logger.error(f"[BENEFITS_EXPLAINABILITY_AGENT] Error calling JSON API: {e}")
            raise ValueError(f"Failed to get benefits explainability response: {str(e)}")
        
        ### Check if we found any benefit_response
        # If no benefit_response but we have errors, handle gracefully
        has_errors = response_json.get("result", {}).get("has_errors", False)
        errors = response_json.get("result", {}).get("errors", [])
        
        if not benefit_response_texts:
            logger.warning(f"[BENEFITS_EXPLAINABILITY_AGENT] No benefit_response artifact found in API response")
            
            # If there are errors, return them instead of throwing exception
            if has_errors and errors:
                error_messages = []
                for error in errors:
                    error_msg = f"Error {error.get('code')}: {error.get('message')}"
                    error_messages.append(error_msg)
                
                # Return error response
                return {
                    "extracted_text": "\n".join(error_messages),
                    "plan_info": [],
                    "follow_up_questions": [],
                    "prior_authorization": [],
                    "status_messages": [msg.get("text", "") for msg in result.get("status_messages", [])],
                    "errors": errors,
                    "has_errors": True,
                    "total_chunks": result.get("total_chunks", 0),
                    "total_artifacts": result.get("total_artifacts", 0),
                    "member_id": member_id,
                    "message": user_message
                }
            else:
                # Check if there are status messages (e.g., clarification questions)
                status_messages = result.get("status_messages", [])
                if status_messages:
                    # API is asking for clarification (status: input-required)
                    clarification_text = "\n".join([msg.get("text", "") for msg in status_messages])
                    
                    # Return clarification as extracted_text
                    return {
                        "extracted_text": clarification_text,
                        "plan_info": [],
                        "follow_up_questions": [],
                        "prior_authorization": [],
                        "status_messages": [msg.get("text", "") for msg in status_messages],
                        "errors": [],
                        "has_errors": False,
                        "total_chunks": result.get("total_chunks", 0),
                        "total_artifacts": result.get("total_artifacts", 0),
                        "member_id": member_id,
                        "message": user_message
                    }
                else:
                    # No errors, no status messages, no benefit_response - this is unexpected
                    logger.warning(f"[BENEFITS_EXPLAINABILITY_AGENT] Please check the full response structure above")
                    raise ValueError("No benefit_response artifact found in API response")
                
        # Process all artifacts by type
        artifacts_by_type = {
            "benefit_response": [],
            "plan_info_detail": [],
            "follow_up_questions": [],
            "prior_authorization": [],
            "status_messages": [],
            "errors": []
        }
        
        # Collect all artifacts from response
        all_artifacts = result.get("artifacts", [])
        status_messages = result.get("status_messages", [])
        errors = result.get("errors", [])
        has_errors = result.get("has_errors", False)
                
        for artifact in all_artifacts:
            artifact_name = artifact.get("name", "unknown")
            parts = artifact.get("parts", [])
            
            # Extract content based on artifact type
            if artifact_name == "benefit_response":
                for part in parts:
                    if isinstance(part, dict) and part.get("kind") == "text" and "text" in part:
                        text = part.get("text", "")
                        artifacts_by_type["benefit_response"].append(text)
            
            elif artifact_name == "plan_info_detail":
                for part in parts:
                    if isinstance(part, dict) and part.get("kind") == "data" and "data" in part:
                        data = part.get("data", {})
                        artifacts_by_type["plan_info_detail"].append(data)
            
            elif artifact_name == "follow_up_questions":
                for part in parts:
                    if isinstance(part, dict) and part.get("kind") == "data" and "data" in part:
                        data = part.get("data", {})
                        suggestions = data.get("suggestions", [])
                        if suggestions:  # Only add if suggestions exist
                            artifacts_by_type["follow_up_questions"].extend(suggestions)
            
            elif artifact_name == "Prior_Authorization" or artifact_name == "prior_authorization":
                for part in parts:
                    if isinstance(part, dict) and part.get("kind") == "text" and "text" in part:
                        text = part.get("text", "")
                        artifacts_by_type["prior_authorization"].append(text)
        
        # Add status messages and errors
        artifacts_by_type["status_messages"] = [msg.get("text", "") for msg in status_messages]
        artifacts_by_type["errors"] = errors
        
        # Combine benefit_response texts
        combined_benefit_text = "\n\n".join(artifacts_by_type["benefit_response"])
        logger.info(f"[BENEFITS_EXPLAINABILITY_AGENT] Combined {len(artifacts_by_type['benefit_response'])} benefit responses")
        
        result = {
            "extracted_text": combined_benefit_text,
            "plan_info": artifacts_by_type["plan_info_detail"],
            "follow_up_questions": artifacts_by_type["follow_up_questions"],
            "prior_authorization": artifacts_by_type["prior_authorization"],
            "status_messages": artifacts_by_type["status_messages"],
            "errors": artifacts_by_type["errors"],
            "has_errors": has_errors,
            "total_chunks": result.get("total_chunks", 0),
            "total_artifacts": result.get("total_artifacts", 0),
            "member_id": member_id,
            "message": user_message
        }
        return result

    def stream_response(
        self,
        user_message: str,
        member_id: str,
        context: GatewayRequestContext,
        channel: str | None = None
    ) -> Generator[str, None, None]:
        """
        Stream benefits explainability response as SSE events.
        
        Args:
            user_message: User's query message
            member_id: Member UID
            context: Gateway request context
            channel: Optional channel identifier (sms, web, etc.)
            
        Yields:
            SSE-formatted event strings
        """
        logger.info(
            "[BENEFITS_EXPLAINABILITY_AGENT] Starting stream for member_id=%s, context_id=%s, channel=%s",
            member_id, context.context_id, channel
        )
        
        try:
            # Get the appropriate client for this channel
            benefits_client = self._get_benefits_client(channel)
            
            # Stream directly from the client
            for chunk in benefits_client.stream_api_response(user_message, member_id):
                # The client already returns SSE-formatted chunks ("data: ...\n\n")
                logger.debug(
                    "[BENEFITS_EXPLAINABILITY_AGENT] Streaming chunk - length=%d",
                    len(chunk)
                )
                yield chunk
            
            logger.info(
                "[BENEFITS_EXPLAINABILITY_AGENT] Stream completed for member_id=%s",
                member_id
            )
        except Exception as e:
            logger.error(
                "[BENEFITS_EXPLAINABILITY_AGENT] Stream failed - member_id=%s, error=%s",
                member_id, str(e)
            )
            # Yield an error event in SSE format
            error_event = json.dumps({
                "error": str(e),
                "member_id": member_id,
                "success": False
            })
            yield f"data: {error_event}\n\n"

=============================================================================================================

"""
Claims Explainability Agent for A2A Gateway Integration.

This agent handles A2A-compliant claims explainability requests through the gateway.
"""

from __future__ import annotations

import importlib
import logging
import re
from typing import Any, Dict, List

import locales.en as en_locale
from agents.gateway.a2a import GatewayRequestContext
from agents.gateway.api import ClaimsExplainabilityClient
from agents.gateway.config import (
    get_authorization_token_config,
    get_claims_explainability_config,
    get_soa_config,
)
from utils.claim_utils import ClaimUtils
from utils.claims import (
    TARGET_MEMBER_UID_FILTER_KEY,
    ClaimsDateSearchHandler,
    ClaimsFilterExtractor,
    DirectClaimQueryHandler,
    PartialClaimSearchHandler,
)
from utils.claims.eob_constants import DEFAULT_EOB_HELP_RESPONSE
from utils.constants import Intent
from utils.features.features import Feature
from utils.logging import AuditCode
from utils.logging.structured_logger import StructuredLogger
from utils.shared.redis_cache import get_cache_client

logger = logging.getLogger(__name__)
structured_logger = StructuredLogger(__name__)

YEAR_PATTERN = re.compile(r'^(19|20)\d{2}$')


class ClaimsExplainabilityAgent:
    """
    A2A-compliant agent for claims explainability requests.
    
    Extracts user queries and claim IDs from A2A request metadata,
    then uses ClaimsExplainabilityClient to fetch detailed claim information.
    """

    def __init__(self, client: ClaimsExplainabilityClient | None = None) -> None:
        """
        Initialize the Claims Explainability Agent.
        
        Args:
            client: Optional ClaimsExplainabilityClient instance for testing.
        """
        # Don't create client at init - create on-demand based on channel
        self._provided_client = client
        # Cache is used for partial claim search results, not BeCA tracking
        self._cache = None
    
    def _get_claims_client(self, channel: str | None = None) -> 'ClaimsExplainabilityClient':
        """
        Create a client for the specified channel.
        
        Args:
            channel: Channel identifier (sms, web, etc.).
            
        Returns:
            ClaimsExplainabilityClient configured for the channel
        """
        # If client was provided at init (e.g., for testing), use it
        if self._provided_client:
            return self._provided_client
        
        # Normalize channel
        channel_key = (channel or '').strip().lower()
        if not channel_key:
            raise ValueError("channel is required to create ClaimsExplainabilityClient")
        
        # Create new client for this channel
        logger.info("[CLAIMS_EXPLAINABILITY_AGENT] Creating new client for channel=%s", channel_key)
        claims_client = ClaimsExplainabilityClient(
            config=get_claims_explainability_config(channel=channel_key),
            authorization_token_config=get_authorization_token_config(channel=channel_key),
            soa_config=get_soa_config(channel=channel_key),
        )
        return claims_client
    
    def _get_locale_labels(self, language: str = "English") -> Dict[str, str]:
        """
        Get localized labels based on language.
        
        Args:
            language: Language string (English or Spanish)
            
        Returns:
            Dict of localized labels for claims
        """
        normalized_language = (language or "").strip().lower()
        locale_code = "es" if normalized_language in {"es"} else "en"
        try:
            locales_module = importlib.import_module(f"locales.{locale_code}")
            labels = locales_module.LOCALES.get("claims", {})
            logger.info("[CLAIMS_EXPLAINABILITY_AGENT] Loaded locale: %s", locale_code)
            return labels
        except ImportError:
            logger.warning("[CLAIMS_EXPLAINABILITY_AGENT] Failed to load locale: %s, using English", locale_code)
            # Fallback to English           
            return en_locale.LOCALES.get("claims", {})

    async def handle_request(
        self,
        context: GatewayRequestContext,
        intent: str,
        *,
        meta_trans_id: str | None = None,
        channel: str | None = None,
    ) -> Dict[str, Any]:
        """
        Handle A2A claims explainability request.
        
        Orchestrates the request flow by delegating to focused handler classes.
        Follows Open/Closed Principle: open for extension via handlers, closed for modification.
        
        Args:
            context: Gateway request context with A2A metadata
            intent: Intent string (e.g., "get_claims_explainability")
            meta_trans_id: Optional transaction ID for logging
            
        Returns:
            Dict containing the claims explainability response payload
            
        Raises:
            ValueError: If required fields are missing
        """
        logger.info(
            "[CLAIMS_EXPLAINABILITY_AGENT] Agent called - intent=%s, meta_trans_id=%s, context_id=%s",
            intent, meta_trans_id, context.context_id
        )
        structured_logger.audit(
            code=AuditCode.CALLED_REST_API_METHOD,
            parameters=[
                {"name": "Event", "value": "ClaimsAgentRequest"},
                {"name": "Intent", "value": intent or ""},
                {"name": "ContextId", "value": context.context_id or ""},
            ],
            message="Claims explainability agent invoked",
        )

        # Step 1: Validate and extract basic inputs
        user_message, member_id, language, labels = self._validate_and_extract_inputs(context)

         # Early-exit: EOB_HELP and EOB_PAYMENT_INQUIRY need no API calls — return localized copy directly
        normalized_intent = (intent or "").strip().upper()
        if normalized_intent == Intent.EOB_HELP.value:
            logger.info("[CLAIMS_EXPLAINABILITY_AGENT] Handling EOB_HELP intent — returning help copy")
            eob_help_text = labels.get("eob_help_response", DEFAULT_EOB_HELP_RESPONSE)
            return {
                "member_id": member_id,
                "query": user_message,
                "response": eob_help_text,
                "success": True,
                "language": language,
                "subtype": "eob_help",
                "skip_summarization": True,
                "extracted_text": eob_help_text,
                "requires_selection": True,
                "extra_data": {"pending_eob_help": True},
            }
        if normalized_intent == Intent.EOB_PAYMENT_INQUIRY.value:
            logger.info("[CLAIMS_EXPLAINABILITY_AGENT] Handling EOB_PAYMENT_INQUIRY intent — returning payment copy")
            return {
                "member_id": member_id,
                "query": user_message,
                "response": labels.get("eob_payment_response",
                    "It looks like your health plan doesn't offer this feature. Ask another question, or would you "
                    "like to be connected with an agent for further assistance?"),
                "success": True,
                "language": language,
                "subtype": "eob_payment_inquiry",
                "skip_summarization": True,
                "extracted_text": labels.get("eob_payment_response"),
            }

        # Step 2: Extract all filters from intent response
        filter_extractor = ClaimsFilterExtractor(labels)
        filters, error_response = filter_extractor.extract_all_filters(
            context, user_message, member_id, language
        )
        
        # Return early if unsupported claim type
        if error_response:
            return error_response
        
        # Step 3: Extract claim ID (full or partial) from LLM intent response
        claim_id, partial_claim = self._extract_claim_identifiers(user_message, context)

        route = "direct" if claim_id else ("partial" if partial_claim else "date_search")
        structured_logger.audit(
            code=AuditCode.CALLED_REST_API_METHOD,
            parameters=[
                {"name": "Event", "value": "ClaimsRouteResolved"},
                {"name": "Route", "value": route},
                {"name": "HasClaimId", "value": bool(claim_id)},
                {"name": "HasPartialClaim", "value": bool(partial_claim)},
                {"name": "Channel", "value": channel or ""},
            ],
            message="Claims request route resolved",
        )

        # Get the appropriate client for this channel once
        claims_client = self._get_claims_client(channel)
        cache_client = get_cache_client(channel=channel)

        metadata_features = (
            (context.metadata or {}).get("features", [])
            if hasattr(context, "metadata") and context.metadata
            else []
        )
        has_chat_access = Feature.CHAT.name in metadata_features
        has_show_sydapplnk_access = Feature.SHOW_SYDAPPLNK.name in metadata_features
        logger.info(
            "[CLAIMS_EXPLAINABILITY_AGENT] has_chat_access=%s, has_show_sydapplnk_access=%s (derived from metadata features)",
            has_chat_access, has_show_sydapplnk_access,
        )

        # Extract the LLM-provided English translation of a Spanish follow-up query.
        # Populated by the orchestrator LLM on HealthCareAgent.query_in_english and
        # forwarded here via context.metadata["intent_response"]["query_in_english"].
        intent_response_meta = (context.metadata.get("intent_response") or {}) if context.metadata else {}
        query_in_english = intent_response_meta.get("query_in_english") or None

        # Step 4: Handle partial claim search
        if partial_claim:
            partial_handler = PartialClaimSearchHandler(
                claims_client,
                cache_client,
                labels,
                has_chat_access=has_chat_access,
                has_show_sydapplnk_access=has_show_sydapplnk_access,
            )
            
            # Validate partial claim length
            error_response = partial_handler.validate_partial_claim_length(
                partial_claim, member_id, user_message, language
            )
            if error_response:
                return error_response
            
            # Check cached results
            if not claim_id:
                claim_id = partial_handler.check_cached_partial_results(
                    context, partial_claim, member_id
                )
            
            # Search for partial claim if no match found
            if not claim_id:
                result = await partial_handler.search_partial_claim(
                    context, partial_claim, member_id, user_message, language, channel=channel,
                    target_member_uid=filters.get(TARGET_MEMBER_UID_FILTER_KEY),
                )
                
                # If single match, extract claim_id for direct query
                if result.get('is_single_match'):
                    claim_id = result['claim_id']
                else:
                    return result  # Multiple matches or error

        # Step 5: Route to appropriate handler
        if claim_id:
            # Direct claim query
            direct_handler = DirectClaimQueryHandler(
                claims_client, self, labels, cache_client, channel,
                has_chat_access=has_chat_access,
                has_show_sydapplnk_access=has_show_sydapplnk_access,
            )
            return await direct_handler.query_claim_details(
                claim_id, member_id, user_message, language, context.context_id, channel,
                query_in_english=query_in_english,
            )
        else:
            # Date-based search with filtering
            date_handler = ClaimsDateSearchHandler(
                claims_client, self, labels,
                has_chat_access=has_chat_access,
                has_show_sydapplnk_access=has_show_sydapplnk_access,
                member_features=metadata_features,
            )
            return await date_handler.search_claims_by_date(
                filters,
                member_id,
                user_message,
                language,
                context_id=context.context_id,
                channel=channel,
                query_in_english=query_in_english,
            )
    
    def _validate_and_extract_inputs(
        self, context: GatewayRequestContext
    ) -> tuple[str, str, str, Dict[str, str]]:
        """
        Validate and extract required inputs from context.
        
        Args:
            context: Gateway request context
            
        Returns:
            Tuple of (user_message, member_id, language, labels)
            
        Raises:
            ValueError: If required fields are missing
        """
        # Extract language
        language = self._extract_language(context)
        logger.info("[CLAIMS_EXPLAINABILITY_AGENT] Detected language: %s", language)
        
        # Load localized labels
        labels = self._get_locale_labels(language)
        
        # Extract user message
        user_message = ClaimUtils.extract_user_message(context)
        if not user_message:
            logger.error("[CLAIMS_EXPLAINABILITY_AGENT] Missing user message in request")
            raise ValueError("User message is required for Claims Explainability requests.")
        
        # Extract member ID
        member_id = self._extract_member_id(context)
        if not member_id:
            logger.error("[CLAIMS_EXPLAINABILITY_AGENT] Missing member ID in request")
            raise ValueError("Member ID is required for Claims Explainability requests.")
        
        return user_message, member_id, language, labels
    
    def _extract_claim_identifiers(
        self, user_message: str, context: GatewayRequestContext
    ) -> tuple[str | None, str | None]:
        """
        Extract claim ID (full or partial) from LLM intent response.

        The LLM orchestrator populates the 'dcn' field for both full and partial
        claim references.  A length check determines which path to take:
        - Full DCN  (>= 11 chars) -> direct BeCA query
        - Partial   (>= MIN_PARTIAL_CLAIM_LENGTH digits) -> partial search flow
        - Falls back to structural regex only when intent_response is absent.

        Args:
            user_message: User's query message
            context: Gateway request context (carries intent_response metadata)

        Returns:
            Tuple of (claim_id, partial_claim)
        """
        MIN_FULL_DCN_LENGTH = 11

        intent_response = (
            context.metadata.get("intent_response")
            if hasattr(context, "metadata") and context.metadata
            else None
        )

        dcn = intent_response.get("dcn") if isinstance(intent_response, dict) else None

        if dcn:
            dcn = str(dcn).strip()
            if len(dcn) >= MIN_FULL_DCN_LENGTH:
                logger.info("[CLAIMS_EXPLAINABILITY_AGENT] Full DCN from LLM: %s", dcn)
                return dcn, None
            if len(dcn) >= ClaimUtils.MIN_PARTIAL_CLAIM_LENGTH:
                logger.info("[CLAIMS_EXPLAINABILITY_AGENT] Partial claim reference from LLM: %s", dcn)
                return None, dcn
            if YEAR_PATTERN.match(dcn):
                logger.info(
                    "[CLAIMS_EXPLAINABILITY_AGENT] DCN '%s' looks like a calendar year - ignoring as date context",
                    dcn,
                )
                return None, None
            logger.info(
                "[CLAIMS_EXPLAINABILITY_AGENT] DCN '%s' too short (len=%d) - ignoring", dcn, len(dcn)
            )
            return None, None

        logger.info(
            "[CLAIMS_EXPLAINABILITY_AGENT] No DCN in intent_response - falling back to structural regex"
        )
        return ClaimUtils.extract_claim_id(user_message), None
    
    # Note: _extract_user_message method moved to utils.claim_utils.ClaimUtils for better maintainability

    def _extract_member_id(self, context: GatewayRequestContext) -> str | None:
        """
        Extract member ID from who.asked metadata.
        
        Args:
            context: Gateway request context
            
        Returns:
            Member ID or None
        """
        if context.member_contrived_id:
            return context.member_contrived_id

        try:
            metadata = (
                context.raw_payload.get("params", {})
                .get("message", {})
                .get("metadata", {})
            )
            who_asked = metadata.get("5w.who.asked", {})
            identifiers = who_asked.get("identifier", [])
            
            if isinstance(identifiers, list):
                for identifier in identifiers:
                    if isinstance(identifier, dict):
                        if identifier.get("type") == "member-contrived-id":
                            return identifier.get("value")
        except (KeyError, AttributeError):
            pass
        
        return None
    

    
    def _extract_language(self, context: GatewayRequestContext) -> str:
        """
        Extract language preference from A2A metadata.
        
        Args:
            context: Gateway request context
            
        Returns:
            Language string (English or Spanish)
        """
        try:
            metadata = (
                context.raw_payload.get("params", {})
                .get("message", {})
                .get("metadata", {})
            )
            # Check for language preference in metadata
            language = metadata.get("language", "English")
            logger.info("[CLAIMS_EXPLAINABILITY_AGENT] Extracted language from metadata: %s", language)
            return language
        except (KeyError, AttributeError):
            logger.info("[CLAIMS_EXPLAINABILITY_AGENT] No language in metadata, defaulting to English")
            return "English"  # Default to English

    def _log_claims_by_type(self, claims: List[Dict[str, Any]]) -> None:
        """
        Log all claim IDs grouped by claim type if <= 5 per type.
        Helps with debugging and verification of claim filtering.
        
        Args:
            claims: List of claim dictionaries to log
        """
        if not claims:
            logger.info("[CLAIMS_EXPLAINABILITY_AGENT] No claims to log")
            return
        
        # Group claims by type
        claims_by_type = {}
        for claim in claims:
            claim_type = claim.get('claim_type', 'UNKNOWN')
            claim_id = claim.get('claim_id', 'N/A')
            
            if claim_type not in claims_by_type:
                claims_by_type[claim_type] = []
            claims_by_type[claim_type].append(claim_id)
        
        # Log each type with its claim IDs (only if <= 5 per type)
        for claim_type, claim_ids in claims_by_type.items():
            if len(claim_ids) <= 5:
                ids_str = ", ".join(claim_ids)
                logger.info(
                    "[CLAIMS_EXPLAINABILITY_AGENT] Search results contain %d %s claim(s): %s",
                    len(claim_ids), claim_type, ids_str
                )
            else:
                # If more than 5, just log the count
                logger.info(
                    "[CLAIMS_EXPLAINABILITY_AGENT] Search results contain %d %s claim(s) (showing first 5: %s)",
                    len(claim_ids), claim_type, ", ".join(claim_ids[:5])
                )

    def _has_invalid_claim_number(self, user_message: str) -> tuple[bool, str | None]:
        """
        Check if user provided something that looks like a claim number but doesn't match valid format.
        
        Returns:
            (has_invalid_claim, extracted_text): Tuple indicating if invalid claim found and what was extracted
        """
        # Keywords that suggest user is trying to provide a claim number
        claim_keywords = ['claim number', 'claim #', 'claim id', 'dcn']
        
        if not any(keyword in user_message.lower() for keyword in claim_keywords):
            return False, None
        
        # Extract potential claim number after keywords
        # Look for alphanumeric sequences that don't match valid pattern
        words = user_message.split()
        for i, word in enumerate(words):
            word_lower = word.lower()
            if any(kw in word_lower for kw in ['claim', 'dcn', 'number', '#']):
                # Check next word(s) for potential claim number
                if i + 1 < len(words):
                    potential_claim = words[i + 1].strip('.,;:')
                    # If it's alphanumeric but doesn't match our pattern, it's invalid
                    if potential_claim and len(potential_claim) >= 8:
                        pattern = r'\b(?:\d{7,13}[A-Z]{1,2}\d{4,5}|\d{5}[A-Z]{2}\d{4}|\d{10,15})\b'
                        if not re.match(pattern, potential_claim.upper()):
                            return True, potential_claim
        
        return False, None

===============================================================================================================

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple

from agents.agent_horizon import agent as horizon_agent
from agents.gateway.a2a import A2ARequestParser, GatewayRequestContext
from agents.gateway.a2a.agent_proxy import proxy as _agent_proxy
from agents.gateway.a2a.agent_proxy import registry as _agent_registry
from agents.gateway.agents.benefits_explainability_agent import (
    BenefitsExplainabilityAgent,
)
from agents.gateway.agents.claims_explainability_agent import ClaimsExplainabilityAgent
from agents.orchestrate_horizon.orchestrator_horizon_agent import (
    OrchestratorHorizonAgent,
)
from utils.claim_utils import ClaimUtils
from utils.constants import Channel

logger = logging.getLogger(__name__)


@dataclass
class GatewayExecutionResult:
    context: GatewayRequestContext
    raw_payload: Any
    summary_text: Optional[str] = None


class GatewayAgent:
    """Gateway Agent that enforces the AWS Strands A2A contract and routes to downstream agents."""

    def __init__(
        self,
        benefits_explainability_agent: BenefitsExplainabilityAgent | None = None,
        claims_explainability_agent: ClaimsExplainabilityAgent | None = None,
    ) -> None:
        self._benefits_explainability_agent = benefits_explainability_agent or BenefitsExplainabilityAgent()
        self._claims_explainability_agent = claims_explainability_agent or ClaimsExplainabilityAgent()
        self._parser = A2ARequestParser()

    async def handle_request(
        self,
        payload: Dict[str, Any],
        context: Optional[GatewayRequestContext] = None,
        meta_trans_id: Optional[str] = None,
    ) -> GatewayExecutionResult:
        logger.info(
            "[GATEWAY] Handling A2A request - meta_trans_id=%s, method=%s",
            meta_trans_id, payload.get("method")
        )
        context = context or self._parser.parse(payload)
        
        domain, intent = self._determine_domain_and_intent(context)
        logger.info(
            "[GATEWAY] Routing to agent - domain=%s, intent=%s, context_id=%s",
            domain, intent, context.context_id
        )

        # Route: remote agents first (registry-driven), then local handlers
        remote = await _agent_registry.get_by_domain_or_reload(domain)
        logger.info(
            "[GATEWAY] Registry lookup domain=%s → %s",
            domain, remote.get("id") if remote else "local"
        )

        if remote:
            downstream_payload = await self._route_to_remote_agent(
                domain, remote, context, intent, meta_trans_id
            )
        else:
            local_handlers = {
                # TODO: Migrate PROFILE_OVERVIEW to a remote A2A agent (profile agent)
                # and remove it from local_handlers once the agent is online and registered.
                "BENEFITS_EXPLAINABILITY": self._handle_benefits,
                "CLAIMS_EXPLAINABILITY": self._handle_claims,
            }
            if domain not in local_handlers:
                logger.error("[GATEWAY] Unsupported domain=%s — no remote agent registered and no local handler", domain)
                raise ValueError(f"No remote agent registered for domain '{domain}'. Ensure the agent is running and call GET /agents to reload the registry.")
            logger.info("[GATEWAY] Calling local %s agent", domain)
            downstream_payload = await local_handlers[domain](context, intent, meta_trans_id)

        return GatewayExecutionResult(context=context, summary_text=None, raw_payload=downstream_payload)

    def _determine_domain_and_intent(self, context: GatewayRequestContext) -> Tuple[str, str]:
        """Extract domain and intent from A2A payload. Gateway enforces explicit values - no inference."""
        if not context.domain:
            logger.error("[GATEWAY] Missing domain in A2A payload")
            raise ValueError(
                "Domain is required in A2A metadata (5w.what.service.service[0].domain). "
                "Gateway does not perform intent classification. "
                "Use orchestrator (POST /chat) for LLM-based intent detection."
            )
        
        if not context.intents:
            logger.error("[GATEWAY] Missing intent in A2A payload - domain=%s", context.domain)
            raise ValueError(
                "Intent is required in A2A metadata (5w.why.service.intent). "
                "Gateway does not perform intent classification. "
                "Use orchestrator (POST /chat) for LLM-based intent detection."
            )
        
        logger.info(
            "[GATEWAY] Validated domain/intent - domain=%s, intent=%s",
            context.domain, context.intents[0]
        )
        return context.domain, context.intents[0]

    async def _route_to_remote_agent(
        self,
        domain: str,
        remote: Dict[str, Any],
        context: GatewayRequestContext,
        intent: str,
        meta_trans_id: Optional[str],
    ) -> Dict[str, Any]:
        """Generic remote agent call via A2A proxy. Raises if the remote agent is unreachable."""
        logger.info(
            "[GATEWAY] Delegating %s to remote agent '%s' at %s",
            domain, remote.get("id"), remote["rpc_url"],
        )
        
        # Extract user query from message parts for conversation context
        user_query = None
        try:
            parts = context.raw_payload.get("params", {}).get("message", {}).get("parts", [])
            if parts and isinstance(parts, list):
                for part in parts:
                    if isinstance(part, dict) and part.get("kind") == "text" and part.get("text"):
                        user_query = part["text"]
                        break
        except Exception as e:
            logger.debug(f"[GATEWAY] Could not extract user query from parts: {e}")
        
        # Extract BillPay-specific flags from incoming metadata (set by planner, must be forwarded)
        agent_specific_metadata = context.raw_payload.get("params", {}).get("message", {}).get("agent_specific_metadata", [])

        return await _agent_proxy.call(
            rpc_url=remote["rpc_url"],
            member_contrived_id=context.member_contrived_id or "",
            intent=intent,
            channel=context.channel,
            meta_trans_id=meta_trans_id,
            context_id=context.context_id,
            user_query=user_query,
            agent_specific_metadata=agent_specific_metadata,
            five_w_metadata=context.metadata if hasattr(context, "metadata") else None,
            streaming=context.streaming_requested,
        )

    def _resolve_channel(self, context: GatewayRequestContext, default: str = Channel.WEB.value) -> str:
        """Resolve channel from context, falling back to metadata then default."""
        metadata_channel = (context.metadata.get("channel") or "") if hasattr(context, "metadata") and context.metadata else ""
        return (context.channel or metadata_channel or default).strip().lower()


    async def _handle_benefits(
        self, context: GatewayRequestContext, intent: Optional[str], meta_trans_id: Optional[str]
    ) -> Dict[str, Any]:
        if not intent:
            raise ValueError("Intent is required for Benefits Explainability Agent routing.")
        channel = self._resolve_channel(context)
        logger.info("[GATEWAY] Routing to Benefits agent with channel=%s", channel)
        return self._benefits_explainability_agent.handle_request(
            context,
            intent,
            meta_trans_id=meta_trans_id,
            channel=channel,
        )

    async def _handle_claims(
        self, context: GatewayRequestContext, intent: Optional[str], meta_trans_id: Optional[str]
    ) -> Dict[str, Any]:
        if not intent:
            raise ValueError("Intent is required for Claims Explainability Agent routing.")
        channel = self._resolve_channel(context)
        user_message = ClaimUtils.extract_user_message(context)
        existing_intent_response = context.metadata.get("intent_response") if hasattr(context, "metadata") and context.metadata else None

        if existing_intent_response:
            logger.info(
                "[GATEWAY] intent_response already in metadata — skipping orchestrator (network_filter=%s, claim_type_filter=%s)",
                existing_intent_response.get("network_filter"),
                existing_intent_response.get("claim_type_filter"),
            )
        elif user_message:
            try:
                logger.info("[GATEWAY] Calling orchestrator for LLM intent detection, channel=%s", channel)
                orchestrator = OrchestratorHorizonAgent(
                    model=horizon_agent.model,
                    system_prompt=None,
                    channel=channel,
                )
                intent_result = await orchestrator.detect_intent_and_call_agents(
                    user_message,
                    language="English",
                    member_id=context.metadata.get("member_contrived_id"),
                    channel=channel,
                    enable_query_validation=False,
                    locale="en",
                )
                if isinstance(intent_result, dict):
                    intent_response = {
                        "primary_intent": intent_result.get("primary_intent", "CLAIMS_DETAIL"),
                        "secondary_intent": intent_result.get("secondary_intent"),
                        "claim_type_filter": intent_result.get("claim_type_filter"),
                        "member_name_filter": intent_result.get("member_name_filter"),
                        "provider_name_filter": intent_result.get("provider_name_filter"),
                        "network_filter": intent_result.get("network_filter"),
                        "status_filter": (
                            intent_result.get("status_filter")
                            if str(channel).strip().lower() == Channel.SMS.value
                            else None
                        ),
                        "specialty": intent_result.get("specialty", "unidentified"),
                        "planName": intent_result.get("planName", "unidentified"),
                        "benefitsType": intent_result.get("benefitsType", "unidentified"),
                        "placeOfService": intent_result.get("placeOfService", "unidentified"),
                        "network": intent_result.get("network", "inNetwork"),
                        "confidence": intent_result.get("confidence", 0.95),
                        "language": intent_result.get("language", "English"),
                        "benefitExplainability": intent_result.get("benefitExplainability", False),
                        "dcn": intent_result.get("dcn"),
                        "ciw_inq_number": intent_result.get("ciw_inq_number"),
                    }
                    if not hasattr(context, "metadata") or context.metadata is None:
                        context.metadata = {}
                    context.metadata["intent_response"] = intent_response
                    logger.info(
                        "[GATEWAY] intent_response added to metadata, member_name_filter=%s",
                        intent_response.get("member_name_filter"),
                    )
            except Exception as e:
                logger.warning("[GATEWAY] Orchestrator intent detection failed: %s — using NER fallback", e)

        logger.info("[GATEWAY] Routing to Claims agent, channel=%s", channel)
        return await self._claims_explainability_agent.handle_request(
            context,
            intent,
            meta_trans_id=meta_trans_id,
            channel=channel,
        )

===============================================================================================================

"""
Benefits Explainability API Integration
Handles OAuth token generation and API calls to the A2A benefits API.
"""

import json
import time
import uuid
from typing import Any, Dict, Optional

import requests

from utils.benefits_5w import (
    DEFAULT_BENEFITS_INTENT,
    build_benefits_api_payload,
    build_benefits_why_service,
    build_legacy_benefits_api_payload,
    filter_benefits_api_metadata,
    map_legacy_benefits_member_data,
    validate_benefits_api_metadata,
)
from utils.channel_auth import get_channel_auth
from utils.constants import Channel
from utils.header_utils import get_meta_senderapp
from utils.http_error_handler import (
    APISystemError,
    HTTPErrorHandler,
    RateLimitError,
    ResourceNotFoundError,
)
from utils.http_utils import filter_sensitive_headers, get_requests_verify
from utils.intent_classifier_regex import classify_intent_keyword
from utils.logging import AuditCode
from utils.logging.request_context import RequestContext
from utils.logging.structured_logger import get_logger

logger = get_logger(__name__)


SSE_DATA_PREFIX = "data: "


def _resolve_channel(channel: str | None, default: Channel = Channel.WEB) -> str:
    try:
        return Channel((channel or default.value).strip().lower()).value
    except ValueError as exc:
        supported_channels = ", ".join([f"'{c.value}'" for c in Channel])
        raise ValueError(
            f"Unsupported channel '{channel}'. Supported channels: {supported_channels}"
        ) from exc


def _resolve_meta_trans_id(meta_trans_id: str | None) -> str:
    return meta_trans_id or RequestContext.get_rid() or RequestContext.get_message_id() or str(uuid.uuid4())


def _build_api_headers(api_key: str, authorization_token: str, channel: str, meta_trans_id: str | None) -> Dict[str, str]:
    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {authorization_token}",
        "Content-Type": "application/json",
        "apikey": api_key,
        "meta-transid": _resolve_meta_trans_id(meta_trans_id),
        "meta-senderapp": get_meta_senderapp(channel)
    }
    return {key: value for key, value in headers.items() if value is not None}


def _parse_a2a_sse_chunks(raw_response_text: str) -> list[Dict[str, Any]]:
    all_chunks = []
    for line in raw_response_text.strip().split("\n"):
        if not line.startswith(SSE_DATA_PREFIX):
            continue
        data_content = line[len(SSE_DATA_PREFIX):].strip()
        try:
            all_chunks.append(json.loads(data_content))
        except json.JSONDecodeError as e:
            logger.warning(f"[BENEFITS_CLIENT] Failed to parse chunk: {e}")
    return all_chunks


def _extract_chunk_error(chunk: Dict[str, Any], chunk_index: int) -> Dict[str, Any]:
    error = chunk.get("error", {})
    return {
        "code": error.get("code"),
        "message": error.get("message", "Unknown error"),
        "data": error.get("data", {}),
        "chunk_index": chunk_index,
    }


def _aggregate_named_a2a_chunks(all_chunks: list[Dict[str, Any]]) -> Dict[str, Any]:
    """Aggregate A2A chunks into named artifacts and status texts (Sydney path)."""
    all_artifacts = []
    status_messages = []
    errors = []

    for idx, chunk in enumerate(all_chunks):
        chunk_num = idx + 1
        if not isinstance(chunk, dict):
            continue

        if "error" in chunk:
            chunk_error = _extract_chunk_error(chunk, chunk_num)
            errors.append(chunk_error)
            logger.warning(
                f"[BENEFITS_CLIENT] Chunk #{chunk_num} error: "
                f"{chunk_error['message']} (code: {chunk_error['code']})"
            )
            continue

        if "result" not in chunk:
            continue
        result = chunk.get("result", {})

        if "artifact" in result:
            artifacts = [result.get("artifact")]
        else:
            artifacts = result.get("artifacts", [])
        for artifact in artifacts:
            if isinstance(artifact, dict):
                all_artifacts.append({
                    "name": artifact.get("name", "unknown"),
                    "parts": artifact.get("parts", []),
                    "chunk_index": chunk_num,
                })

        status = result.get("status", {})
        if not status:
            continue
        state = status.get("state", "")
        for part in status.get("message", {}).get("parts", []):
            if isinstance(part, dict) and part.get("kind") == "text" and "text" in part:
                status_messages.append({
                    "text": part.get("text", ""),
                    "state": state,
                    "chunk_index": chunk_num,
                })

    return {
        "result": {
            "artifacts": all_artifacts,
            "status_messages": status_messages,
            "errors": errors,
            "total_chunks": len(all_chunks),
            "total_artifacts": len(all_artifacts),
            "has_errors": bool(errors),
        }
    }


def _build_outbound_benefits_metadata(
    five_w_metadata: Dict[str, Any],
    user_message: str,
) -> Dict[str, Any]:
    """Reduce planner 5W metadata to the schema-compliant outbound metadata."""
    filtered_metadata = filter_benefits_api_metadata(five_w_metadata)
    filtered_metadata["5w.why.service"] = build_benefits_why_service(user_message)
    return filtered_metadata


def _reject_invalid_benefits_metadata(metadata: Dict[str, Any], channel: str) -> None:
    """Raise before the wire call when the outbound metadata is not schema-compliant.

    The offending 5W field paths stay in the log; the raised error carries none
    of them, since it travels back out through the agent's error handling.

    Raises:
        APISystemError: If the metadata is missing mandatory fields.
    """
    validation_errors = validate_benefits_api_metadata(metadata)
    if not validation_errors:
        return

    logger.error(
        "[BENEFITS_CLIENT] Invalid Benefits 5W metadata",
        extra={"channel": channel, "validation_errors": validation_errors},
    )
    raise APISystemError("benefits", "Benefits request metadata failed schema validation")


def _aggregate_a2a_chunks(all_chunks: list[Dict[str, Any]]) -> Dict[str, Any]:
    """Aggregate A2A chunks, keeping artifacts and status messages verbatim."""
    all_artifacts = []
    status_messages = []
    errors = []

    for idx, chunk in enumerate(all_chunks):
        if not isinstance(chunk, dict):
            continue

        if "error" in chunk:
            errors.append(_extract_chunk_error(chunk, idx + 1))
            continue

        if "result" not in chunk:
            continue
        result = chunk.get("result", {})

        if "artifact" in result:
            all_artifacts.append(result["artifact"])
        if isinstance(result.get("artifacts"), list):
            all_artifacts.extend(result["artifacts"])

        if "status_message" in result:
            status_messages.append(result["status_message"])
        if isinstance(result.get("status_messages"), list):
            status_messages.extend(result["status_messages"])

    return {
        "result": {
            "artifacts": all_artifacts,
            "status_messages": status_messages,
            "errors": errors,
            "has_errors": bool(errors),
        }
    }


class BenefitsExplainabilityClient:
    """Client for interacting with the Benefits Explainability API."""

    def __init__(self, authorization_token_config: Dict[str, Any] = None, soa_config: Dict[str, Any] = None):
        """
        Initialize the client with configuration from settings.

        Args:
            authorization_token_config: Configuration for authorization token API settings (base_url, api_key)
            soa_config: Configuration for Sydney API (base_url, api_key)
        """
        # Load from config
        authorization_token_cfg = authorization_token_config or {}
        soa_cfg = soa_config or {}

        # OAuth and Benefits API Configuration
        apigee_base_url = authorization_token_cfg.get("base_url")
        if not apigee_base_url or apigee_base_url.startswith("${"):
            raise ValueError(
                "authorization_token_config.base_url is not configured. "
                "Make sure EXTERNAL_APIGEE_BASE_URL is set in your .env file"
            )

        self.TOKEN_URL = authorization_token_cfg.get("token_url")
        self.API_URL = authorization_token_cfg.get("benefits_a2a_url")
        if not self.TOKEN_URL or str(self.TOKEN_URL).startswith("${"):
            raise ValueError(
                "authorization_token_config.token_url is not configured. "
                "Make sure it is defined in your channel settings file"
            )
        if not self.API_URL or str(self.API_URL).startswith("${"):
            raise ValueError(
                "authorization_token_config.benefits_a2a_url is not configured. "
                "Make sure it is defined in your channel settings file"
            )

        self.API_KEY = authorization_token_cfg.get("api_key")
        if not self.API_KEY or self.API_KEY.startswith("${"):
            raise ValueError(
                "authorization_token_config.api_key is not configured. "
                "Make sure EXTERNAL_APIGEE_API_KEY is set in your .env file"
            )

        # Load OAuth authorization from configuration (optional for SMS channel)
        # SMS uses OAuth from the 'oauth' section, WEB uses APIGEE authorization
        self.AUTH_HEADER = authorization_token_cfg.get("authorization")
        if self.AUTH_HEADER and self.AUTH_HEADER.startswith("${"):
            # Treat unresolved env vars as None
            self.AUTH_HEADER = None

        # Sydney Member API Configuration
        soa_base_url = soa_cfg.get("base_url")
        if not soa_base_url or soa_base_url.startswith("${"):
            raise ValueError(
                "soa_sydney_api.base_url is not configured. "
                "Make sure SOA_SYDNEY_BASE_URL is set in your .env file"
            )

        self.SYDNEY_API_URL = soa_cfg.get("member_summary_url")
        if not self.SYDNEY_API_URL or str(self.SYDNEY_API_URL).startswith("${"):
            raise ValueError(
                "soa_sydney_api.member_summary_url is not configured. "
                "Make sure it is defined in your channel settings file"
            )

        self.SYDNEY_API_KEY = soa_cfg.get("api_key")
        if not self.SYDNEY_API_KEY or self.SYDNEY_API_KEY.startswith("${"):
            raise ValueError(
                "soa_sydney_api.api_key is not configured. "
                "Make sure SOA_API_KEY is set in your .env file"
            )

        # Token management
        self._access_token: Optional[str] = None
        self._token_expiry: Optional[float] = None

    def getAuthorizationToken(self, force_refresh: bool = False) -> str:
        """
        Generate OAuth bearer token dynamically.
        Checks if existing token is valid, otherwise generates a new one.

        NOTE: This method is for WEB channel (APIGEE). SMS channel uses OAuth from channel_token_utils.

        Args:
            force_refresh: If True, always generate a new token regardless of expiration

        Returns:
            str: The access token

        Raises:
            Exception: If token generation fails or AUTH_HEADER not configured
        """
        # Skip if AUTH_HEADER not configured (e.g., SMS channel)
        if not self.AUTH_HEADER:
            raise ValueError(
                "Cannot use getAuthorizationToken for SMS channel. "
                "SMS uses centralized channel auth via get_channel_auth('sms')"
            )

        # Check if we have a valid token
        current_time = time.time()
        if not force_refresh and self._access_token and self._token_expiry:
            # Add 60 second buffer before expiry
            if current_time < (self._token_expiry - 60):
                return self._access_token

        # Generate new token
        try:
            headers = {
                "Authorization": self.AUTH_HEADER,
                "Content-Type": "application/x-www-form-urlencoded",
                "apikey": self.API_KEY
            }

            data = {
                "grant_type": "client_credentials",
                "scope": "public"
            }

            cert_verify = get_requests_verify(self.TOKEN_URL)

            response = requests.post(
                self.TOKEN_URL,
                headers=headers,
                data=data,
                timeout=30,
                verify=cert_verify
            )

            # Log response details before validation
            if response.status_code != 200:
                logger.error(f"OAuth error: {response.status_code} - {response.text[:200]}")

            # Use HTTPErrorHandler for consistent error handling
            try:
                response.raise_for_status()
            except requests.exceptions.HTTPError as e:
                HTTPErrorHandler.handle_http_error(e, "benefits", context="OAuth token request")

            token_data = response.json()

            access_token = token_data.get("access_token")
            if not access_token:
                HTTPErrorHandler.handle_validation_error("benefits", "No access_token in OAuth response")

            # Get expiration time (typically in seconds, e.g., 3600 for 1 hour)
            expires_in_raw = token_data.get("expires_in", 3600)
            try:
                expires_in = int(expires_in_raw)
            except (ValueError, TypeError):
                expires_in = 3600  # Default to 1 hour

            self._token_expiry = current_time + expires_in
            self._access_token = access_token

            logger.info(f"[BENEFITS_CLIENT] OAuth token generated successfully - expires_in={expires_in}s")
            return access_token

        except (APISystemError, ResourceNotFoundError, RateLimitError):
            raise
        except requests.exceptions.Timeout as e:
            HTTPErrorHandler.handle_timeout_error(e, "benefits")
        except requests.exceptions.RequestException as e:
            HTTPErrorHandler.handle_request_error(e, "benefits")
        except Exception as e:
            HTTPErrorHandler.handle_unexpected_error(e, "benefits")

    def fetch_member_data(self, member_id: str, access_token: str = None, channel: str = None) -> Dict[str, Any]:
        """
        Fetch member data from Sydney API.

        Args:
            member_id: The member UID (mbrUid)
            access_token: Optional OAuth Bearer token for authentication
            channel: Optional channel identifier (sms, web, etc.) to determine API key

        Returns:
            dict: Member summary data from Sydney API

        Raises:
            Exception: If API call fails
        """
        try:
            # Determine which API key to use based on channel
            normalized_channel = _resolve_channel(channel)
            channel_auth = get_channel_auth(normalized_channel)
            api_key = channel_auth.member_api_key or self.SYDNEY_API_KEY
            if normalized_channel == Channel.SMS.value:
                logger.info(f"[BENEFITS_CLIENT] Using SMS member API key for member data fetch")

            headers = {
                "apikey": api_key,
                "Accept": "application/json"
            }

            # Add OAuth Bearer token if provided (for SMS channel)
            if access_token:
                headers["Authorization"] = f"Bearer {access_token}"

            params = {
                "mbruid": member_id
            }

            logger.info(
                "[BENEFITS_CLIENT] Sydney member request",
                channel=channel,
                url=self.SYDNEY_API_URL,
                has_authorization="Authorization" in headers,
                token_length=len(access_token or ""),
                apikey_length=len(api_key or ""),
                headers=filter_sensitive_headers(headers),
            )

            api_start_time = time.time()

            response = requests.get(
                self.SYDNEY_API_URL,
                headers=headers,
                params=params,
                timeout=30,
                verify=get_requests_verify(self.SYDNEY_API_URL)
            )

            api_elapsed_time = time.time() - api_start_time

            # Log error details before validation
            if response.status_code != 200:
                logger.error(
                    "API error",
                    status_code=response.status_code,
                    response_body_preview=response.text[:500],
                )

            # Use HTTPErrorHandler for consistent error handling
            try:
                response.raise_for_status()
            except requests.exceptions.HTTPError as e:
                HTTPErrorHandler.handle_http_error(e, "benefits", context=f"member {member_id}")

            response_data = response.json()

            logger.audit_downstream_call(
                code=AuditCode.CALLED_EMEP_GATEWAY,
                method="GET",
                url=self.SYDNEY_API_URL,
                status_code=response.status_code,
                elapsed_ms=api_elapsed_time * 1000,
                request_body={"params": params},
                response_body=response_data,
                request_name="SydneyMemberSummaryRequest"
            )

            return response_data

        except (APISystemError, ResourceNotFoundError, RateLimitError):
            raise
        except requests.exceptions.Timeout as e:
            HTTPErrorHandler.handle_timeout_error(e, "benefits")
        except requests.exceptions.RequestException as e:
            HTTPErrorHandler.handle_request_error(e, "benefits")
        except Exception as e:
            HTTPErrorHandler.handle_unexpected_error(e, "benefits")

    def map_member_data(self, sydney_response: Dict[str, Any]) -> tuple[Dict[str, Any], Dict[str, Any]]:
        """
        Map Sydney API response to the format required by benefits API.

        Args:
            sydney_response: Response from Sydney member summary API

        Returns:
            tuple: (member_data, coverage_data) formatted for benefits API
        """
        try:
            return map_legacy_benefits_member_data(sydney_response)

        except Exception as e:
            HTTPErrorHandler.handle_unexpected_error(e, "benefits")

    def force_refresh_token(self) -> str:
        """
        Force refresh the OAuth token regardless of expiration.

        Returns:
            str: The new access token
        """
        return self.getAuthorizationToken(force_refresh=True)

    def get_api_response_json(
        self,
        user_message: str,
        member_id: str,
        service_name: str | None = None,
        meta_trans_id: str | None = None,
        channel: str | None = None
    ) -> Dict[str, Any]:
        """
        Get the complete API response as JSON (non-streaming).
        Uses Accept: application/json header to get complete response in one call.

        Args:
            user_message: The user's text message/query
            member_id: Required member UID to fetch dynamic data from Sydney API
            service_name: Service name from intent detection (optional, defaults to user_message)
            meta_trans_id: Transaction ID from gateway server (optional, for request tracking)

        Returns:
            Dict containing the complete API response with benefit_response artifact

        Raises:
            Exception: If API call fails
        """
        try:
            # Validate required parameters
            if not user_message:
                raise ValueError("user_message is required")
            if not member_id:
                raise ValueError("member_id is required")
            normalized_channel = _resolve_channel(channel)
            channel_auth = get_channel_auth(normalized_channel)

            # Get OAuth token for Benefits API
            # NOTE: Benefits API is on athm domain (uat.api.securecloud.athm.com)
            # So we need athm domain OAuth token (APIGEE), NOT Sydney domain OAuth
            # Sydney OAuth is only for Sydney domain APIs (member summary, etc.)

            # Each channel uses its OWN APIGEE credentials for athm domain APIs
            benefits_api_token = channel_auth.apigee_oauth_token
            if not benefits_api_token:
                raise ValueError(f"APIGEE OAuth token is not available for channel '{normalized_channel}'")
            logger.info(f"[BENEFITS_CLIENT] Using {normalized_channel.upper()} APIGEE OAuth token for Benefits API")

            # Fetch member data - SMS uses Sydney OAuth, WEB uses SOA API key
            member_data_token = channel_auth.member_oauth_token
            if not member_data_token:
                raise ValueError(f"Member-domain OAuth token is not available for channel '{normalized_channel}'")
            logger.info(f"[BENEFITS_CLIENT] Using {normalized_channel.upper()} member-domain token for member data fetch")

            sydney_data = self.fetch_member_data(member_id, access_token=member_data_token, channel=normalized_channel)
            member_data, coverage_data = self.map_member_data(sydney_data)

            # Use Accept: application/json to get non-streaming response (like Postman)
            resolved_meta_trans_id = _resolve_meta_trans_id(meta_trans_id)
            headers = _build_api_headers(self.API_KEY, benefits_api_token, normalized_channel, resolved_meta_trans_id)

            # Use service_name from intent detection, fallback to user_message
            if not service_name:
                service_name = user_message

            keyword_classification = classify_intent_keyword(user_message)
            primary_intent = keyword_classification.get("intent", DEFAULT_BENEFITS_INTENT)
            reasons = keyword_classification.get("reasons", [primary_intent])

            payload = build_legacy_benefits_api_payload(
                user_message,
                member_data,
                coverage_data,
                service_name,
                primary_intent,
                reasons,
            )

            logger.info(
                "[BENEFITS_CLIENT] Calling external API (JSON mode with Accept: application/json and stream: false)",
                url=self.API_URL,
                channel=normalized_channel,
                meta_trans_id=resolved_meta_trans_id,
                metadata_keys=list(payload["params"]["message"]["metadata"].keys())
            )

            # Make JSON request (non-streaming) - stream=False is key
            api_start_time = time.time()

            response = requests.post(
                self.API_URL,
                headers=headers,
                json=payload,
                timeout=60,
                stream=False,  # Important: Don't stream, get complete response
                verify=get_requests_verify(self.API_URL)
            )

            api_elapsed_time = time.time() - api_start_time

            # Log error details before validation
            if response.status_code != 200:
                error_text = response.text
                logger.error(f"[BENEFITS_CLIENT] HTTP {response.status_code} error from external API")
                logger.error(f"[BENEFITS_CLIENT] Error response: {error_text}")

            # Use HTTPErrorHandler for consistent error handling
            try:
                response.raise_for_status()
            except requests.exceptions.HTTPError as e:
                HTTPErrorHandler.handle_http_error(e, "benefits", context="benefits query")

            # Parse SSE response (text/event-stream format)
            raw_response_text = response.text
            content_type = response.headers.get('Content-Type', '')
            if 'text/event-stream' in content_type:
                all_chunks = _parse_a2a_sse_chunks(raw_response_text)
                if not all_chunks:
                    HTTPErrorHandler.handle_missing_data_error("benefits", "No valid chunks found in SSE response")

                logger.audit_downstream_call(
                    code=AuditCode.CALLED_EMEP_GATEWAY,
                    method="POST",
                    url=self.API_URL,
                    status_code=response.status_code,
                    elapsed_ms=api_elapsed_time * 1000,
                    request_body=payload,
                    response_body=raw_response_text,
                    request_name="BenefitsExplainabilityRequest"
                )

                return _aggregate_named_a2a_chunks(all_chunks)
            else:
                # Try parsing as regular JSON
                try:
                    response_json = response.json()
                    logger.info(f"[BENEFITS_CLIENT] Successfully parsed JSON response")
                    logger.info(f"[BENEFITS_CLIENT] Response keys: {list(response_json.keys())}")
                    return response_json
                except json.JSONDecodeError as e:
                    logger.error(f"[BENEFITS_CLIENT] Failed to parse JSON: {e}")
                    logger.error(f"[BENEFITS_CLIENT] Raw response was: {raw_response_text[:500]}")
                    HTTPErrorHandler.handle_parsing_error("benefits", f"API returned invalid JSON: {str(e)}", original_error=e)

        except (APISystemError, ResourceNotFoundError, RateLimitError):
            raise
        except requests.exceptions.Timeout as e:
            HTTPErrorHandler.handle_timeout_error(e, "benefits")
        except requests.exceptions.RequestException as e:
            HTTPErrorHandler.handle_request_error(e, "benefits")
        except Exception as e:
            HTTPErrorHandler.handle_unexpected_error(e, "benefits")

    def stream_api_response(self, user_message: str, member_id: str):
        """
        Stream the API response in real-time as SSE events.

        Args:
            user_message: The user's text message/query
            member_id: Required member UID to fetch dynamic data from Sydney API

        Yields:
            SSE formatted data chunks
        """
        try:
            # Validate member_id is provided
            if not member_id:
                raise ValueError("member_id is required")
            resolved_channel = Channel.WEB.value
            channel_auth = get_channel_auth(resolved_channel)

            # Get channel-specific tokens for WEB streaming flow
            apigee_token = channel_auth.apigee_oauth_token
            member_data_token = channel_auth.member_oauth_token
            if not apigee_token or not member_data_token:
                raise ValueError("WEB channel OAuth credentials are not available")

            # Fetch and map member data from Sydney API using WEB member-domain token
            sydney_data = self.fetch_member_data(member_id, access_token=member_data_token, channel=resolved_channel)
            member_data, coverage_data = self.map_member_data(sydney_data)

            headers = {
                "Accept": "application/json",
                "Authorization": f"Bearer {apigee_token}",
                "Content-Type": "application/json",
                "apikey": self.API_KEY
            }

            # Classify the query intent dynamically using Horizon structured completions
            logger.info(f"[BENEFITS_CLIENT] Step 1: Classifying query intent...")
            intent_classification = self.classify_query_intent(user_message)

            # Use classified service name if available, otherwise use user_message
            service_name = intent_classification.get("service_name") or user_message
            logger.info(f"[BENEFITS_CLIENT] Using service.name: {service_name[:100]}")

            # Build 5w.why.service with classified intent and reasons
            primary_intent = intent_classification.get("intent", DEFAULT_BENEFITS_INTENT)
            reasons = intent_classification.get("reasons", [primary_intent])

            logger.info(f"[BENEFITS_CLIENT] 5w.why.service - intent: {primary_intent}, reasons: {reasons}")

            payload = build_legacy_benefits_api_payload(
                user_message,
                member_data,
                coverage_data,
                service_name,
                primary_intent,
                reasons,
                stream=True,
                include_plan_metadata=False,
            )

            logger.info(
                "[BENEFITS_CLIENT] Calling external API",
                url=self.API_URL,
                channel=resolved_channel,
                metadata_keys=list(payload["params"]["message"]["metadata"].keys())
            )

            # Make streaming request (optimized for fast response)
            with requests.post(
                self.API_URL,
                headers=headers,
                json=payload,
                timeout=55,
                stream=True,
                verify=get_requests_verify(self.API_URL)
            ) as response:
                # Handle HTTP errors
                if response.status_code != 200:
                    error_text = response.text
                    logger.error(f"[BENEFITS_CLIENT] HTTP {response.status_code} error from external API")
                    logger.error(f"[BENEFITS_CLIENT] Error response: {error_text}")
                    try:
                        error_json = response.json()
                        yield f"data: {json.dumps({'error': error_json, 'success': False})}\n\n"
                    except ValueError:
                        yield f"data: {json.dumps({'error': error_text, 'success': False})}\n\n"
                    return

                # Stream response immediately without buffering
                for line in response.iter_lines(decode_unicode=True, chunk_size=1):
                    if line:
                        if line.startswith('data: '):
                            yield f"{line}\n\n"
                        else:
                            yield f"data: {line}\n\n"

        except Exception as e:
            logger.error("Error streaming benefits API: %s", str(e))
            error_data = {
                "error": str(e),
                "success": False
            }
            yield f"data: {json.dumps(error_data)}\n\n"

    def get_api_response_with_5w_metadata(
        self,
        user_message: str,
        five_w_metadata: Dict[str, Any],
        meta_trans_id: str | None = None,
        channel: str | None = None
    ) -> Dict[str, Any]:
        """
        Call Benefits API using complete 5W metadata from planner.

        NO Sydney API calls - uses planner's enriched 5W directly with:
        - address.state (mandatory)
        - network-id (mandatory)
        - dependent-id (per-member)
        - subgroup-id, source-system-id
        - Distinct who.asked and who.about for target member queries

        This is the production method that eliminates Sydney API dependency.

        Args:
            user_message: The user's text message/query
            five_w_metadata: Complete 5W from planner (with all enrichment)
            meta_trans_id: Transaction ID from gateway server (optional)
            channel: Channel (sms/web)

        Returns:
            Dict containing the complete API response

        Raises:
            Exception: If API call fails
        """
        response = None
        status_code = 0
        error_message: str | None = None
        response_body: Any = None
        payload: Dict[str, Any] | None = None
        api_start_time: float | None = None

        try:
            if not user_message:
                raise ValueError("user_message is required")
            if not five_w_metadata:
                raise ValueError("five_w_metadata is required")

            normalized_channel = _resolve_channel(channel)
            filtered_metadata = _build_outbound_benefits_metadata(five_w_metadata, user_message)
            payload = build_benefits_api_payload(user_message, filtered_metadata)
            _reject_invalid_benefits_metadata(filtered_metadata, normalized_channel)

            channel_auth = get_channel_auth(normalized_channel)

            # Get OAuth token for Benefits API
            benefits_api_token = channel_auth.apigee_oauth_token
            if not benefits_api_token:
                raise ValueError(f"APIGEE OAuth token is not available for channel '{normalized_channel}'")

            logger.info(
                "[BENEFITS_CLIENT] Using planner's complete 5W metadata (no Sydney API calls)",
                extra={"channel": normalized_channel}
            )

            # Build headers
            resolved_meta_trans_id = _resolve_meta_trans_id(meta_trans_id)
            headers = _build_api_headers(self.API_KEY, benefits_api_token, normalized_channel, resolved_meta_trans_id)

            # Log request for debugging
            logger.info(
                "[BENEFITS_CLIENT] Calling external API (with planner 5W)",
                url=self.API_URL,
                channel=normalized_channel,
                meta_trans_id=resolved_meta_trans_id,
                metadata_keys=list(filtered_metadata.keys())
            )

            # Make JSON request (non-streaming)
            api_start_time = time.time()

            response = requests.post(
                self.API_URL,
                headers=headers,
                json=payload,
                timeout=60,
                stream=False,
                verify=get_requests_verify(self.API_URL)
            )

            api_elapsed_time = time.time() - api_start_time
            status_code = response.status_code

            # Log error details before validation
            if response.status_code != 200:
                error_text = response.text
                error_message = error_text
                response_body = error_text
                logger.error(f"[BENEFITS_CLIENT] HTTP {response.status_code} error from external API")
                logger.error(f"[BENEFITS_CLIENT] Error response: {error_text}")

            # Use HTTPErrorHandler for consistent error handling
            try:
                response.raise_for_status()
            except requests.exceptions.HTTPError as e:
                HTTPErrorHandler.handle_http_error(
                    e, 
                    "benefits", 
                    context="benefits query with planner 5W metadata"
                )

            # Parse response (might be text/event-stream or application/json)
            raw_response_text = response.text
            content_type = response.headers.get('Content-Type', '')

            if 'text/event-stream' in content_type:
                response_body = raw_response_text
                all_chunks = _parse_a2a_sse_chunks(raw_response_text)
                if not all_chunks:
                    logger.error("[BENEFITS_CLIENT] Empty response from external API")
                    raise APISystemError("benefits", "Empty response from Benefits API")

                final_response = _aggregate_a2a_chunks(all_chunks)
                aggregated = final_response["result"]
                logger.info(
                    f"[BENEFITS_CLIENT] API call completed in {api_elapsed_time:.2f}s",
                    extra={
                        "artifacts_count": len(aggregated["artifacts"]),
                        "status_messages_count": len(aggregated["status_messages"]),
                        "errors_count": len(aggregated["errors"]),
                    }
                )
                return final_response

            else:
                # Direct JSON response
                try:
                    final_response = response.json()
                    response_body = final_response
                    logger.info(
                        f"[BENEFITS_CLIENT] API call completed in {api_elapsed_time:.2f}s",
                        extra={"response_type": "json"}
                    )
                    return final_response
                except json.JSONDecodeError as e:
                    error_message = str(e)
                    logger.error(f"[BENEFITS_CLIENT] Failed to parse JSON response: {e}")
                    raise APISystemError("benefits", f"Invalid JSON response: {e}", e)

        except (APISystemError, ResourceNotFoundError, RateLimitError, ValueError):
            if error_message is None:
                error_message = "Benefits API request failed"
            raise
        except requests.exceptions.Timeout as e:
            error_message = str(e)
            HTTPErrorHandler.handle_timeout_error(e, "benefits")
        except requests.exceptions.RequestException as e:
            error_message = str(e)
            HTTPErrorHandler.handle_request_error(e, "benefits")
        except Exception as e:
            error_message = str(e)
            logger.error("[BENEFITS_CLIENT] Error calling Benefits API with 5W metadata", error=e)
            HTTPErrorHandler.handle_unexpected_error(e, "benefits")
        finally:
            if payload is not None:
                logger.audit_downstream_call(
                    code=AuditCode.CALLED_EMEP_GATEWAY,
                    method="POST",
                    url=self.API_URL,
                    status_code=status_code,
                    elapsed_ms=(time.time() - api_start_time) * 1000 if api_start_time is not None else 0,
                    request_body=payload,
                    response_body=response_body,
                    error=error_message,
                    request_name="BenefitsExplainabilityRequest"
                )

=================================================================================================================

"""
Claims Explainability API Integration
Handles OAuth token generation and API calls to the Claims Explainability API.
"""

import json
import logging
import re
import threading
import time
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import httpx
import urllib3

from agents.gateway.api.claims_eob_client import ClaimsEobClient

# Import custom exceptions
from agents.gateway.config import get_soa_config
from utils.channel_auth import get_channel_auth
from utils.claims.eob_constants import (
    CDHP_CARVEOUT,
    SOA_CFG_BASE_URL,
    SOA_CFG_CLAIMS_URL,
    SOA_CFG_EOB_ENDPOINT,
    SOA_CFG_EOB_URL,
    URL_PLACEHOLDER_MEMBER_ID,
)
from utils.constants import Channel, SenderApp, UserRole
from utils.http_error_handler import (
    APISystemError,
    HTTPErrorHandler,
    RateLimitError,
    ResourceNotFoundError,
)
from utils.logging import AuditCode
from utils.logging.request_context import RequestContext
from utils.logging.structured_logger import StructuredLogger

# Disable SSL warnings
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Use StructuredLogger for audit calls, but keep standard logger for regular logging
logger = logging.getLogger(__name__)
structured_logger = StructuredLogger(__name__)


class ClaimsExplainabilityClient(ClaimsEobClient):
    """Client for interacting with the Claims Explainability API."""

    def __init__(self, config: Dict[str, Any] = None, authorization_token_config: Dict[str, Any] = None, soa_config: Dict[str, Any] = None):
        """
        Initialize the client with configuration.
        
        Args:
            config: Configuration dictionary containing:
                - base_url: Base URL for the explainability API
            authorization_token_config: Authorization token configuration containing:
                - base_url: OAuth token endpoint base URL
                - api_key: API key for authentication
                - authorization: Authorization header value for OAuth
        """
        # Load from config or use defaults
        cfg = config or {}
        authorization_token_cfg = authorization_token_config or {}
        
        # Query API URL (new endpoint for query_claim method)
        self.QUERY_URL = cfg.get("query_url")
        logger.info("Claims Query URL configured: %s", self.QUERY_URL)
        # OAuth Configuration (from authorization_token_config)
        auth_base_url = authorization_token_cfg.get("base_url")
        if not auth_base_url:
            raise ValueError(
                "Authorization token base_url is not configured. "
                "Please set it in channel config under authorization_token_config.base_url"
            )
        self.TOKEN_URL = authorization_token_cfg.get("token_url")
        if not self.TOKEN_URL:
            raise ValueError(
                "Authorization token token_url is not configured. "
                "Please set it in channel config under authorization_token_config.token_url"
            )
        
        self.API_KEY = authorization_token_cfg.get("api_key")
        if not self.API_KEY:
            raise ValueError(
                "Authorization token api_key is not configured. "
                "Please set it in channel config under authorization_token_config.api_key"
            )
        
        # Load OAuth authorization from authorization_token_config configuration
        self.AUTH_HEADER = authorization_token_cfg.get("authorization")
        if not self.AUTH_HEADER:
            raise ValueError(
                "Authorization token authorization is not configured. "
                "Please set it in channel config under authorization_token_config.authorization"
            )
        
        # Token management
        self._access_token: Optional[str] = None
        self._token_expiry: Optional[float] = None
        self._token_lock = threading.Lock()
        # Search by date URL — assembled from soa_sydney_api base_url + claims_endpoint
        soa_cfg = soa_config or {}
        self.SEARCH_BY_DATE_URL = soa_cfg.get(SOA_CFG_CLAIMS_URL)
        logger.info("Claims Search by Date URL configured: %s", self.SEARCH_BY_DATE_URL)
       
        _soa_base_url = (soa_cfg.get(SOA_CFG_BASE_URL) or "").rstrip("/")
        _eob_ep = (soa_cfg.get(SOA_CFG_EOB_ENDPOINT) or "").lstrip("/")
        self.EOB_URL = (
            soa_cfg.get(SOA_CFG_EOB_URL)
            or (f"{_soa_base_url}/{_eob_ep}" if _soa_base_url and _eob_ep else None)
        )
        logger.info("EOB URL configured: %s", bool(self.EOB_URL))

    def getAuthorizationToken(self, force_refresh: bool = False) -> str:
        """
        Generate OAuth bearer token dynamically.
        Checks if existing token is valid, otherwise generates a new one.
        Thread-safe implementation prevents duplicate token refreshes.
        
        Args:
            force_refresh: If True, always generate a new token regardless of expiration
        
        Returns:
            str: The access token
            
        Raises:
            Exception: If token generation fails
        """
        # Quick check without lock for valid token (optimization)
        current_time = time.time()
        if not force_refresh and self._access_token and self._token_expiry:
            # Add 60 second buffer before expiry
            if current_time < (self._token_expiry - 60):
                return self._access_token
        
        # Acquire lock for token refresh
        with self._token_lock:
            # Double-check after acquiring lock (another thread may have refreshed)
            current_time = time.time()
            if not force_refresh and self._access_token and self._token_expiry:
                if current_time < (self._token_expiry - 60):
                    return self._access_token
            
            # Generate new token
            try:
                headers = {
                    "Authorization": self.AUTH_HEADER,
                    "Content-Type": "application/x-www-form-urlencoded",
                    "apikey": self.API_KEY
                }
                
                data = {
                    "grant_type": "client_credentials",
                    "scope": "public"
                }

                # Use httpx with structured logging
                start_time = time.time()
                error_message = None
                status_code = 0
                response_body = None
                
                try:
                    with httpx.Client(verify=False, timeout=30.0) as client:
                        response = client.post(
                            self.TOKEN_URL,
                            headers=headers,
                            data=data
                        )
                    status_code = response.status_code
                    response_body = response.text
                    
                    # Use HTTPErrorHandler for consistent error handling
                    if response.status_code != 200:
                        response.raise_for_status()
                    
                    token_data = response.json()
                except httpx.HTTPStatusError as e:
                    error_message = str(e)
                    HTTPErrorHandler.handle_http_error(e, "claims", context="OAuth token request")
                except httpx.TimeoutException as e:
                    error_message = str(e)
                    HTTPErrorHandler.handle_timeout_error(e, "claims", context="OAuth token request")
                except httpx.RequestError as e:
                    error_message = str(e)
                    HTTPErrorHandler.handle_request_error(e, "claims", context="OAuth token request")
                except Exception as e:
                    error_message = str(e)
                    raise
                finally:
                    # Log the API call with structured logging
                    elapsed_ms = (time.time() - start_time) * 1000
                    structured_logger.audit_downstream_call(
                        code=AuditCode.CALLED_EMEP_GATEWAY,
                        method="POST",
                        url=self.TOKEN_URL,
                        status_code=status_code,
                        elapsed_ms=elapsed_ms,
                        request_body=data,
                        response_body=response_body,
                        error=error_message,
                        request_name="OAuthTokenRequest"
                    )
                
                access_token = token_data.get("access_token")
                if not access_token:
                    HTTPErrorHandler.handle_validation_error("claims", "No access_token in OAuth response")
                
                # Get expiration time (typically in seconds, e.g., 3600 for 1 hour)
                expires_in_raw = token_data.get("expires_in", 3600)
                try:
                    expires_in = int(expires_in_raw)
                except (ValueError, TypeError) as e:
                    logger.warning("Invalid expires_in value '%s', defaulting to 3600s: %s", expires_in_raw, e)
                    expires_in = 3600  # Default to 1 hour
                
                self._token_expiry = current_time + expires_in
                self._access_token = access_token
                
                logger.info("Successfully obtained OAuth token, expires in %d seconds", expires_in)
                return access_token
                
            except APISystemError:
                raise
    
    def force_refresh_token(self) -> str:
        """
        Force refresh the OAuth token regardless of expiration.
        
        Returns:
            str: The new access token
        """
        return self.getAuthorizationToken(force_refresh=True)
    
    async def query_claim(
            self,
            flexidkey: str,
            query: str,
            agent_id: str = None,
            lob: str = "csbd",
            contract_id: str = "",
            member_seq_num: str = "",
            channel: str = None
        ) -> Dict[str, Any]:
            """
            Query the orch-api Claims endpoint.

            Args:
                flexidkey: Claim ID - e.g., "2025064742922"
                query: User's query about the claim or "clm-sum-init" for initial load
                agent_id: ID of the person initiating the call (e.g. member ID).
                lob: Line of business (default: "csbd")
                contract_id: Contract ID identifier sent in identifiers array (default: "")
                member_seq_num: Member sequence number (default: "")
                channel: Channel name ('sms' or 'web') for channel-specific authentication

            Returns:
                dict: Unwrapped API response containing claim information (inner "response" object)

            Raises:
                ResourceNotFoundError: If claim is not found in EDP system (404)
                APISystemError: For API errors (400, 401, 403, 408, 500, 502, 503, 504)
                RateLimitError: If rate limit is exceeded (429)
            """
            try:
                # Validate required parameters
                if not flexidkey:
                    HTTPErrorHandler.handle_validation_error("claims", "flexidkey (claim ID) is required")
                if not query:
                    HTTPErrorHandler.handle_validation_error("claims", "query is required")
                
                api_url = self.QUERY_URL

                resolved_interaction_id = f"{agent_id}_DIGITAL_TWIN"


                # Build request headers using apikey (orch-api uses apikey, not Bearer token)
                # meta-senderapp is mandatory for BeCA API access
                headers = {
                    "Content-Type": "application/json",
                    "apikey": self.API_KEY,
                    "meta-senderapp": SenderApp.DTWIN.value,
                }

                # Build request payload with nested header + identifiers structure
                payload = {
                    "header": {
                        "agentId": agent_id,
                        "identifiers": [
                            {"name": "contractId", "value": contract_id},
                            {"name": "claimId", "value": flexidkey}
                        ],
                        "interactionId": resolved_interaction_id,
                        "lob": lob,
                        "mbrSeqNum": member_seq_num,
                        "query": query
                    }
                }
                
                logger.info("Making Claims Query API request for claim ID: %s", flexidkey)
                logger.debug("Query: %s", query)  # Changed to DEBUG to avoid logging user queries

                # Use requests with structured logging
                start_time = time.time()
                error_message = None
                status_code = 0
                response_body = None
                
                try:
                    async with httpx.AsyncClient(verify=False, timeout=55.0) as client:
                        response = await client.post(
                            api_url,
                            headers=headers,
                            json=payload,
                        )
                    status_code = response.status_code
                    response_body = response.text

                    # Handle different HTTP status codes with custom exceptions
                    if response.status_code == 200:
                        response_data = response.json()
                        logger.info("Successfully received Claims Query response for claim ID: %s", flexidkey)
                        # Unwrap new orch-api envelope: { "intent": "claims", "response": {...} }
                        return response_data.get("response", response_data)
                    else:
                        # Handle error status codes - raise for HTTPErrorHandler
                        response.raise_for_status()
                except httpx.HTTPStatusError as e:
                    error_message = str(e)
                    HTTPErrorHandler.handle_http_error(e, "claims", context=f"claim {flexidkey}")
                except Exception as e:
                    error_message = str(e)
                    raise
                finally:
                    # Log the API call with structured logging
                    elapsed_ms = (time.time() - start_time) * 1000
                    structured_logger.audit_downstream_call(
                        code=AuditCode.CALLED_EMEP_GATEWAY,
                        method="POST",
                        url=api_url,
                        status_code=status_code,
                        elapsed_ms=elapsed_ms,
                        request_body=payload,
                        response_body=response_body,
                        error=error_message,
                        request_name="ClaimsQueryRequest"
                    )
                
            except (ResourceNotFoundError, APISystemError, RateLimitError):
                raise
            except httpx.TimeoutException as e:
                HTTPErrorHandler.handle_timeout_error(e, "claims", context=f"claim {flexidkey}")
            except httpx.RequestError as e:
                HTTPErrorHandler.handle_request_error(e, "claims", context=f"claim {flexidkey}")
            except Exception as e:
                HTTPErrorHandler.handle_unexpected_error(e, "claims", context=f"claim {flexidkey}")

    async def search_claims_by_date(
        self,
        member_id: str,
        start_date: str = None,
        end_date: str = None,
        channel: str = None,
        user_role: UserRole = UserRole.MEMBER,
    ) -> Dict[str, Any]:
        """
        Search for claims by date range for a member.
        
        Args:
            member_id: Member ID to search claims for
            start_date: Start date in YYYY-MM-DD format (defaults to 24 months ago)
            end_date: End date in YYYY-MM-DD format (defaults to today)
            channel: Channel name ('sms' or 'web') for channel-specific authentication
            user_role: Role of the requesting user. Defaults to UserRole.MEMBER.
            
        Returns:
            dict: API response containing list of claims
            
        Raises:
            Exception: If API call fails
        """
        try:
            # Validate required parameters
            if not member_id:
                raise ValueError("member_id is required")
            
            # Default date range: last 24 months if not provided
            if not end_date:
                end_date = datetime.now().strftime('%Y-%m-%d')
            if not start_date:
                start_dt = datetime.now() - timedelta(days=730)
                start_date = start_dt.strftime('%Y-%m-%d')
            
            # Build search URL - get from config
            search_url_template = self.SEARCH_BY_DATE_URL
            if not search_url_template:
                raise ValueError("search_by_date_url is not configured in channel config")
            
            # Replace member_id placeholder
            search_url = search_url_template.replace(URL_PLACEHOLDER_MEMBER_ID, member_id)
            
            # Add query parameters
            params = {
                "clmStartDt": start_date,
                "clmEndDt": end_date,
                "size": 1000,
                "page": 1,
                "sort": "clmEndDt",
                "userRole": user_role,
                "cdhpcarveout": CDHP_CARVEOUT
            }
            
            # Build request headers based on channel
            resolved_channel = (channel or RequestContext.get_channel() or '').strip().lower()
            try:
                normalized_channel = Channel(resolved_channel).value
            except ValueError as exc:
                supported_channels = ", ".join([f"'{c.value}'" for c in Channel])
                raise ValueError(
                    f"channel is required and must be one of {supported_channels} for claims date search"
                ) from exc

            channel_auth = get_channel_auth(channel=normalized_channel)
            oauth_token = channel_auth.member_oauth_token
            if not oauth_token:
                raise ValueError(
                    f"{normalized_channel.upper()} OAuth token is not available for claims date search"
                )
            soa_config = get_soa_config(channel=normalized_channel)
            api_key = soa_config.get("api_key")
            headers = {
                "accept": "application/json",
                "Authorization": f"Bearer {oauth_token}",
            }
            if api_key:
                headers["apikey"] = api_key
            
            logger.info(
                "Searching claims by date for member_id=%s, start_date=%s, end_date=%s, channel=%s",
                member_id, start_date, end_date, normalized_channel
            )

            # Use httpx with structured logging
            start_time = time.time()
            error_message = None
            status_code = 0
            response_body = None
            
            try:
                async with httpx.AsyncClient(verify=False, timeout=10.0) as client:
                    response = await client.get(
                        search_url,
                        headers=headers,
                        params=params
                    )
                status_code = response.status_code
                response_body = response.text
                
                # Handle different HTTP status codes properly
                if response.status_code == 200:
                    # Success - parse response
                    try:
                        result = response.json()
                        # Check if response is empty or has no claims
                        claims = result.get("claims", [])
                        if not claims:
                            logger.info("No claims found for member_id=%s in date range %s to %s", 
                                      member_id, start_date, end_date)
                            return {
                                "claims": [],
                                "message": "No claims found for your account.",
                                "member_id": member_id,
                                "search_period": f"{start_date} to {end_date}",
                                "no_claims_found": True
                            }
                        total_elements = (
                            result.get("metadata", {})
                            .get("page", {})
                            .get("totalElements", len(claims))
                        )
                        logger.info("Successfully received claims search response for member_id=%s, found %d claims (total=%d)", 
                                  member_id, len(claims), total_elements)
                        result["total_found"] = total_elements
                        return result
                    except json.JSONDecodeError:
                        # Empty response body with 200 status - no claims found
                        logger.info("No claims found (empty response) for member_id=%s in date range %s to %s", 
                                  member_id, start_date, end_date)
                        return {
                            "claims": [],
                            "message": "No claims found for your account.",
                            "member_id": member_id,
                            "search_period": f"{start_date} to {end_date}",
                            "no_claims_found": True
                        }
                elif response.status_code == 204:
                    # No Content - explicitly indicates no claims found
                    logger.info("No claims found (204 No Content) for member_id=%s in date range %s to %s", 
                              member_id, start_date, end_date)
                    return {
                        "claims": [],
                        "message": "No claims found for your account.",
                        "member_id": member_id,
                        "search_period": f"{start_date} to {end_date}",
                        "no_claims_found": True
                    }
                else:
                    # Handle 404 "NO DATA FOUND" as empty result, not error
                    if response.status_code == 404:
                        try:
                            error_json = response.json()
                            exceptions = error_json.get("exceptions", [])
                            # Check if this is a "NO DATA FOUND" response
                            for exc in exceptions:
                                if exc.get("code") == "1002" and "NO DATA FOUND" in exc.get("message", ""):
                                    logger.info(
                                        "No claims found for member_id=%s in date range %s to %s (API returned 404 with NO DATA FOUND)",
                                        member_id, start_date, end_date
                                    )
                                    return {"claims": []}  # Return empty claims list, not error
                        except Exception as parse_error:
                            logger.warning("Failed to parse 404 response as JSON: %s", parse_error)
                    
                    # Handle error status codes - raise for HTTPErrorHandler
                    response.raise_for_status()
            except httpx.HTTPStatusError as e:
                error_message = str(e)
                HTTPErrorHandler.handle_http_error(e, "claims", context=f"date search {start_date} to {end_date}")
            except Exception as e:
                error_message = str(e)
                raise
            finally:
                # Log the API call with structured logging
                elapsed_ms = (time.time() - start_time) * 1000
                structured_logger.audit_downstream_call(
                    code=AuditCode.CALLED_EMEP_GATEWAY,
                    method="GET",
                    url=search_url,
                    status_code=status_code,
                    elapsed_ms=elapsed_ms,
                    request_body=params,
                    response_body=response_body,
                    error=error_message,
                    request_name="ClaimsSearchRequest"
                )
        except (ResourceNotFoundError, APISystemError, RateLimitError):
            raise
        except httpx.TimeoutException as e:
            HTTPErrorHandler.handle_timeout_error(e, "claims", context=f"date search {start_date} to {end_date}")
        except httpx.RequestError as e:
            HTTPErrorHandler.handle_request_error(e, "claims", context=f"date search {start_date} to {end_date}")
        except Exception as e:
            HTTPErrorHandler.handle_unexpected_error(e, "claims", context=f"date search {start_date} to {end_date}")

    async def get_claim_details(
        self,
        member_id: str,
        claim_id: str,
        channel: str,
        user_role: UserRole = UserRole.MEMBER,
    ) -> Dict[str, Any]:
        """
        Fetch details for a specific claim from the claim details API.

        URL: {soa_base}/v8/cp/members/{member_id}/claims/{claim_id}?userRole={user_role}&cdhpcarveout=n

        Uses the same channel-based OAuth + apikey authentication as search_claims_by_date.

        Args:
            member_id: Member contrived ID.
            claim_id: Full claim ID (clmId) to fetch details for.
            channel: Channel name ('sms' or 'web') for channel-specific authentication.
            user_role: Role of the requesting user. Defaults to UserRole.MEMBER.

        Returns:
            The first claim dict from the ``claims`` list in the API response.

        Raises:
            ValueError: If required parameters are missing or channel is unsupported.
            ResourceNotFoundError: If the claim is not found (404 NO DATA FOUND).
            APISystemError: For other HTTP/API errors.
            RateLimitError: If rate limit is exceeded (429).
        """
        if not member_id:
            raise ValueError("member_id is required for get_claim_details")
        if not claim_id:
            raise ValueError("claim_id is required for get_claim_details")

        search_url_template = self.SEARCH_BY_DATE_URL
        if not search_url_template:
            raise ValueError("search_by_date_url is not configured in channel config")

        base_claims_url = search_url_template.replace(URL_PLACEHOLDER_MEMBER_ID, member_id)
        detail_url = f"{base_claims_url}/{claim_id}"

        params = {
            "userRole": user_role,
            "cdhpcarveout": CDHP_CARVEOUT,
        }

        resolved_channel = (channel or RequestContext.get_channel() or "").strip().lower()
        try:
            normalized_channel = Channel(resolved_channel).value
        except ValueError as exc:
            supported_channels = ", ".join([f"'{c.value}'" for c in Channel])
            raise ValueError(
                f"channel is required and must be one of {supported_channels} for get_claim_details"
            ) from exc

        channel_auth = get_channel_auth(channel=normalized_channel)
        oauth_token = channel_auth.member_oauth_token
        if not oauth_token:
            raise ValueError(
                f"{normalized_channel.upper()} OAuth token is not available for get_claim_details"
            )
        soa_config = get_soa_config(channel=normalized_channel)
        api_key = soa_config.get("api_key")
        headers = {
            "accept": "application/json",
            "Authorization": f"Bearer {oauth_token}",
        }
        if api_key:
            headers["apikey"] = api_key

        start_time = time.time()
        error_message = None
        status_code = 0
        response_body = None

        try:
            async with httpx.AsyncClient(verify=False, timeout=10.0) as client:
                response = await client.get(detail_url, headers=headers, params=params)
            status_code = response.status_code
            response_body = response.text

            if response.status_code == 200:
                result = response.json()
                claims = result.get("claims", [])
                if not claims:
                    logger.info(
                        "[CLAIM_DETAILS] No claims in response for member_id=%s, claim_id=%s",
                        member_id, claim_id,
                    )
                    return None
                return claims[0]

            if response.status_code == 404:
                try:
                    error_json = response.json()
                    for exc in error_json.get("exceptions", []):
                        if exc.get("code") == "1002" and "NO DATA FOUND" in exc.get("message", ""):
                            logger.info(
                                "[CLAIM_DETAILS] Claim not found for member_id=%s, claim_id=%s",
                                member_id, claim_id,
                            )
                            return None
                except Exception:
                    pass

            response.raise_for_status()

        except httpx.HTTPStatusError as e:
            error_message = str(e)
            HTTPErrorHandler.handle_http_error(e, "claims", context=f"claim details {claim_id}")
        except httpx.TimeoutException as e:
            error_message = str(e)
            HTTPErrorHandler.handle_timeout_error(e, "claims", context=f"claim details {claim_id}")
        except httpx.RequestError as e:
            error_message = str(e)
            HTTPErrorHandler.handle_request_error(e, "claims", context=f"claim details {claim_id}")
        except (ResourceNotFoundError, APISystemError, RateLimitError):
            raise
        except Exception as e:
            error_message = str(e)
            raise
        finally:
            elapsed_ms = (time.time() - start_time) * 1000
            structured_logger.audit_downstream_call(
                code=AuditCode.CALLED_EMEP_GATEWAY,
                method="GET",
                url=detail_url,
                status_code=status_code,
                elapsed_ms=elapsed_ms,
                request_body=params,
                response_body=response_body,
                error=error_message,
                request_name="ClaimDetailsRequest",
            )

        return None

    def get_top_claims_for_selection(
        self,
        search_response: Dict[str, Any],
        limit: int = 5
    ) -> List[Dict[str, Any]]:
        """
        Get top N claims sorted by receive date for user selection.
        
        Args:
            search_response: Response from search_claims_by_date API
            limit: Number of claims to return (default: 5)
            
        Returns:
            List of claim dictionaries with formatted information
        """
        try:
            claims_list = search_response.get("claims", [])
            
            if not claims_list:
                logger.warning("No claims found in search results")
                return []
            
            # Process claims for user selection
            logger.info("Processing %d claims for user selection", len(claims_list))
            
            # Sort claims by service start date (most recent first) with tie-breakers
            def get_sort_key(claim):
                """
                Extract sort key with tie-breakers:
                1. Service Start Date (clmStartDt) - descending (most recent first)
                2. Processed Date (clmProcessDt) - descending
                3. Claim ID - ascending (for consistency)
                """
                # Primary: Service Start Date (clmStartDt)
                service_start_date_str = claim.get('clmStartDt', '')
                if service_start_date_str:
                    try:
                        service_start_date = datetime.fromisoformat(service_start_date_str.replace('Z', '+00:00'))
                    except (ValueError, AttributeError):
                        try:
                            service_start_date = datetime.strptime(service_start_date_str, '%Y-%m-%d')
                        except ValueError:
                            service_start_date = datetime.min
                else:
                    service_start_date = datetime.min
                
                # Tie-breaker 1: Processed Date (clmProcessDt)
                process_date_str = claim.get('clmProcessDt', '')
                if process_date_str:
                    try:
                        process_date = datetime.fromisoformat(process_date_str.replace('Z', '+00:00'))
                    except (ValueError, AttributeError):
                        try:
                            process_date = datetime.strptime(process_date_str, '%Y-%m-%d')
                        except ValueError:
                            process_date = datetime.min
                else:
                    process_date = datetime.min
                
                # Tie-breaker 2: Claim ID (ascending for consistency)
                claim_id = claim.get('clmId', '')
                
                # Return tuple: (clmStartDt DESC, clmProcessDt DESC, claim_id ASC)
                # Use negative for descending datetime, positive for ascending string
                return (-service_start_date.timestamp() if service_start_date != datetime.min else float('inf'),
                        -process_date.timestamp() if process_date != datetime.min else float('inf'),
                        claim_id)

            # Sort claims with tie-breakers
            sorted_claims = sorted(claims_list, key=get_sort_key)
            
            # Get top N claims
            top_claims = sorted_claims[:limit]
            
            # Format claims for display
            formatted_claims = []
            for claim in top_claims:
                # Format received date
                received_date = claim.get('clmReceiveDt', 'N/A')
                if received_date != 'N/A':
                    try:
                        dt = datetime.fromisoformat(received_date.replace('Z', '+00:00'))
                        received_date = dt.strftime('%Y-%m-%d')
                    except (ValueError, AttributeError):
                        pass  # Keep original format if parsing fails
                
                # Format service dates
                service_start_date = claim.get('clmStartDt', 'N/A')
                service_end_date = claim.get('clmEndDt', 'N/A')
                
                if service_start_date != 'N/A':
                    try:
                        dt = datetime.fromisoformat(service_start_date.replace('Z', '+00:00'))
                        service_start_date = dt.strftime('%Y-%m-%d')
                    except (ValueError, AttributeError):
                        pass
                
                if service_end_date != 'N/A':
                    try:
                        dt = datetime.fromisoformat(service_end_date.replace('Z', '+00:00'))
                        service_end_date = dt.strftime('%Y-%m-%d')
                    except (ValueError, AttributeError):
                        pass
                
                # Extract nested values safely
                status_cd = claim.get('clmStatusCd', {})
                status = status_cd.get('name', 'N/A') if isinstance(status_cd, dict) else 'N/A'
                
                billing_provider = claim.get('billingProvider', {})
                provider_name = (
                    billing_provider.get('professionalNm', 'N/A')
                    if isinstance(billing_provider, dict)
                    else 'N/A'
                )
                
                amount = claim.get('amount', {})
                total_charge = amount.get('totalChargeAmt', '0.00') if isinstance(amount, dict) else '0.00'
                mbr_responsibility = amount.get('mbrResponsibilityAmt', '0.00') if isinstance(amount, dict) else '0.00'
                # Format service start date for SMS display (MM/DD/YYYY)
                # service_start_date is already normalized to '%Y-%m-%d' above
                service_date_sms = 'N/A'
                if service_start_date != 'N/A':
                    try:
                        dt = datetime.strptime(service_start_date, '%Y-%m-%d')
                        service_date_sms = dt.strftime('%m/%d/%Y')
                    except ValueError:
                        service_date_sms = service_start_date
                
                
                
                # Infer claim type from API response data
                claim_type = self._infer_claim_type(claim)
                claim_id = claim.get('clmId', 'N/A')
                clm_class_cd = claim.get('clmClassCd', {})
                logger.info(
                    "[CLAIM_TYPE_INFERENCE] Claim %s - clmClassCd: %s -> inferred type: %s",
                    claim_id, clm_class_cd, claim_type
                )
                
                claim_info = {
                    "claim_id": claim_id,
                    "claim_type": claim_type,  # Add claim type for logging
                    "received_date": received_date,
                    "service_date_sms": service_date_sms,
                    "service_start_date": service_start_date,
                    "service_end_date": service_end_date,
                    "status": status,
                    "provider": provider_name,
                    "total_charge": total_charge,
                    "member_responsibility": mbr_responsibility  # What you pay
                }
                formatted_claims.append(claim_info)
            
            logger.info("Returning top %d claims for user selection", len(formatted_claims))
            return formatted_claims
            
        except Exception as e:
            logger.error("Error getting top claims for selection: %s", str(e), exc_info=True)
            return []
    async def search_claims_by_partial_number(
        self,
        member_id: str,
        partial_claim_number: str,
        start_date: str = None,
        end_date: str = None,
        channel: str = None
    ) -> List[Dict[str, Any]]:
        """
        Search for claims matching a partial claim number.
        Matches claims whose last N digits match the partial number.
        
        Args:
            member_id: Member ID to search claims for
            partial_claim_number: Partial claim number (e.g., last 4-8 digits)
            start_date: Optional start date in YYYY-MM-DD format (defaults to 24 months ago)
            end_date: Optional end date in YYYY-MM-DD format (defaults to today)
            channel: Channel name ('sms' or 'web') for channel-specific authentication
            
        Returns:
            List of claims matching the partial number
            
        Raises:
            Exception: If API call fails
        """
        try:
            # Search all claims by date first
            search_response = await self.search_claims_by_date(
                member_id=member_id,
                start_date=start_date,
                end_date=end_date,
                channel=channel
            )
            
            claims_list = search_response.get("claims", [])
            if not claims_list:
                logger.info(
                    "No claims found for member_id=%s to filter by partial number %s",
                    member_id, partial_claim_number
                )
                return []
            
            # Filter claims by partial number match
            # Extract only digits from partial number
            partial_digits = re.sub(r'[^0-9]', '', partial_claim_number)
            partial_length = len(partial_digits)
            
            logger.info(
                "Filtering claims by last %d digits matching '%s'",
                partial_length, partial_digits
            )
            
            matching_claims = []
            for claim in claims_list:
                claim_id = claim.get('clmId', '')
                # Extract only digits from claim ID
                claim_digits = re.sub(r'[^0-9]', '', claim_id)
                
                # FIXED: Match ONLY if last N digits match exactly
                # If user provides 4 digits, match last 4 digits
                # If user provides 5 digits, match last 5 digits, etc.
                if claim_digits.endswith(partial_digits):
                    matching_claims.append(claim)
                    logger.debug(
                        "Matched claim %s (digits: %s) with partial %s",
                        claim_id, claim_digits[-partial_length:], partial_digits
                    )
            
            logger.info(
                "Found %d claims matching last %d digits '%s' out of %d total claims",
                len(matching_claims), partial_length, partial_digits, len(claims_list)
            )
            
            return matching_claims
            
        except Exception as e:
            logger.error(
                "Error searching claims by partial number '%s': %s",
                partial_claim_number, str(e), exc_info=True
            )
            raise

    def _infer_claim_type(self, claim: Dict[str, Any]) -> str:
        """
        Infer claim type from claim data if not provided by API.
        
        Looks at:
        - claim_type field (if present)
        - clmClassCd field (API field for claim classification)
        - provider_type field
        - service_category field
        - claim description
        
        Args:
            claim: Claim dictionary from API response
            
        Returns:
            ClaimType value or "UNKNOWN"
        """
        try:
            # If claim_type already exists, return it
            if "claim_type" in claim and claim["claim_type"]:
                return claim["claim_type"]
            
            # Check clmClassCd field from API response (can be object or string)
            clm_class_cd = claim.get("clmClassCd", "")
            if clm_class_cd:
                # Handle both object and string formats
                if isinstance(clm_class_cd, dict):
                    # Extract name field from object
                    clm_class_str = clm_class_cd.get("name", "") or clm_class_cd.get("code", "")
                else:
                    clm_class_str = str(clm_class_cd)
                
                clm_class_lower = clm_class_str.lower()
                logger.debug("[CLAIM_TYPE_INFERENCE] clmClassCd value: %s, extracted: %s", clm_class_cd, clm_class_lower)
                
                if "dental" in clm_class_lower:
                    logger.debug("[CLAIM_TYPE_INFERENCE] Detected DENTAL from clmClassCd")
                    return "DENTAL"
                elif "vision" in clm_class_lower or "eye" in clm_class_lower:
                    logger.debug("[CLAIM_TYPE_INFERENCE] Detected VISION from clmClassCd")
                    return "VISION"
                elif "pharmacy" in clm_class_lower or "drug" in clm_class_lower or "rx" in clm_class_lower:
                    logger.debug("[CLAIM_TYPE_INFERENCE] Detected PHARMACY from clmClassCd")
                    return "PHARMACY"
                elif "medical" in clm_class_lower or "hospital" in clm_class_lower or "doctor" in clm_class_lower:
                    logger.debug("[CLAIM_TYPE_INFERENCE] Detected MEDICAL from clmClassCd")
                    return "MEDICAL"
            
            # Try to infer from provider_type
            provider_type = claim.get("provider_type", "").lower()
            if "dental" in provider_type:
                return "DENTAL"
            elif "vision" in provider_type or "eye" in provider_type:
                return "VISION"
            elif "pharmacy" in provider_type or "drug" in provider_type:
                return "PHARMACY"
            elif "medical" in provider_type or "hospital" in provider_type or "doctor" in provider_type:
                return "MEDICAL"
            
            # Try to infer from service_category
            service_category = claim.get("service_category", "").lower()
            if "dental" in service_category:
                return "DENTAL"
            elif "vision" in service_category or "eye" in service_category:
                return "VISION"
            elif "pharmacy" in service_category or "prescription" in service_category:
                return "PHARMACY"
            elif "medical" in service_category or "hospital" in service_category:
                return "MEDICAL"
            
            # Try to infer from description
            description = claim.get("description", "").lower()
            if "dental" in description:
                return "DENTAL"
            elif "vision" in description or "eye" in description:
                return "VISION"
            elif "pharmacy" in description or "prescription" in description or "drug" in description:
                return "PHARMACY"
            elif "medical" in description or "hospital" in description or "doctor" in description:
                return "MEDICAL"
            
            # Default to UNKNOWN if cannot infer
            logger.debug("Could not infer claim type for claim: %s", claim.get("claim_id", "N/A"))
            return "UNKNOWN"
            
        except Exception as e:
            logger.warning("Error inferring claim type: %s", str(e))
            return "UNKNOWN"

    async def search_claims_by_type(
        self,
        member_id: str,
        claim_type: str,
        start_date: str = None,
        end_date: str = None,
        limit: int = None,
        channel: str = None
    ) -> Dict[str, Any]:
        """
        Search for claims by type for a member.
        
        Filters claims from search_claims_by_date() by claim_type field.
        
        Args:
            member_id: Member ID to search claims for
            claim_type: Claim type to filter by (e.g., "MEDICAL", "DENTAL", "VISION", "PHARMACY")
            start_date: Start date in YYYY-MM-DD format (defaults to 24 months ago)
            end_date: End date in YYYY-MM-DD format (defaults to today)
            limit: Maximum number of claims to return (default: None)
            channel: Channel name ('sms' or 'web') for channel-specific authentication
            
        Returns:
            dict: API response containing filtered claims list with claim_type field
            
        Raises:
            ValueError: If member_id or claim_type is invalid
            APISystemError: If API call fails
        """
        try:
            # Validate required parameters
            if not member_id:
                raise ValueError("member_id is required")
            if not claim_type:
                raise ValueError("claim_type is required")
            
            logger.info(
                "Searching claims by type - member_id=%s, claim_type=%s, start_date=%s, end_date=%s",
                member_id, claim_type, start_date, end_date
            )
            
            # Call search_claims_by_date to get all claims in date range
            # Handle 404 "NO DATA FOUND" gracefully
            search_response = await self.search_claims_by_date(
                    member_id=member_id,
                    start_date=start_date,
                    end_date=end_date,
                    channel=channel
                )
            
            # Extract claims from response
            all_claims = search_response.get("claims", [])
            
            if not all_claims:
                logger.info("No claims found for member_id=%s in date range", member_id)
                return {
                    "claims": [],
                    "message": f"No {claim_type.lower()} claims found for your account.",
                    "member_id": member_id,
                    "claim_type": claim_type,
                    "no_claims_found": True
                }
            
            # Filter claims by type
            filtered_claims = []
            for claim in all_claims:
                # Get claim type from claim data, infer if missing
                claim_type_value = claim.get("claim_type")
                
                # If claim_type not present, try to infer it
                if not claim_type_value:
                    claim_type_value = self._infer_claim_type(claim)
                
                # Match against requested type (case-insensitive)
                if claim_type_value and claim_type_value.upper() == claim_type.upper():
                    filtered_claims.append(claim)
            
            # Limit results
            limited_claims = filtered_claims[:limit] if limit else filtered_claims
            
            logger.info(
                "Filtered claims by type - found %d of %d claims matching type %s",
                len(limited_claims), len(all_claims), claim_type
            )
            
            if not limited_claims:
                logger.info("No claims found matching type %s for member_id=%s", claim_type, member_id)
                return {
                    "claims": [],
                    "message": f"No {claim_type.lower()} claims found for your account.",
                    "member_id": member_id,
                    "claim_type": claim_type,
                    "no_claims_found": True
                }
            
            return {
                "claims": limited_claims,
                "message": f"Found {len(limited_claims)} {claim_type.lower()} claims for your account.",
                "member_id": member_id,
                "claim_type": claim_type,
                "total_found": len(filtered_claims),
                "returned_count": len(limited_claims),
                "no_claims_found": False
            }
            
        except ValueError as e:
            logger.error("Invalid parameters for search_claims_by_type: %s", str(e))
            raise
        except Exception as e:
            logger.error("Error searching claims by type: %s", str(e), exc_info=True)
            HTTPErrorHandler.handle_unexpected_error(e, "claims", context="search claims by type")

=================================================================================================================

"""
EOB-specific API methods extracted from ClaimsExplainabilityClient.

Provides get_eob_list and get_eob_document against the Sydney Member API EOB endpoints.
Reuses the same channel auth, SOA config, API-key selection, constants, and
HTTPErrorHandler patterns as the rest of claims_client.py.
"""

import logging
import time
from typing import Any, Dict

import httpx
import urllib3

from agents.gateway.config import get_soa_config
from utils.channel_auth import get_channel_auth
from utils.claims.eob_constants import (
    URL_PLACEHOLDER_EOB_UID,
    URL_PLACEHOLDER_MEMBER_ID,
)
from utils.constants import Channel
from utils.http_error_handler import (
    APISystemError,
    HTTPErrorHandler,
    RateLimitError,
    ResourceNotFoundError,
)
from utils.logging import AuditCode
from utils.logging.request_context import RequestContext
from utils.logging.structured_logger import StructuredLogger

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

logger = logging.getLogger(__name__)
structured_logger = StructuredLogger(__name__)


class ClaimsEobClient:
    """
    Mixin providing EOB list and document retrieval against the Sydney Member API.

    Expects the host class to expose ``self.EOB_URL`` (str | None).
    """

    def _get_timeout(self, channel: str = None) -> float:
        """
        Return the configured SOA timeout for the given channel, defaulting to 30.0 seconds.

        Args:
            channel: Channel name ('sms' or 'web').

        Returns:
            Timeout in seconds as a float.
        """
        try:
            soa_cfg = get_soa_config(channel=channel)
            return float(soa_cfg.get("timeout_seconds", 30.0))
        except Exception:
            return 30.0

    def get_eob_list(
        self,
        member_id: str,
        channel: str = None,
    ) -> Dict[str, Any]:
        """
        Fetch the list of EOBs for a member from the Sydney Member API.

        GET /v7/cp/members/{member_id}/eobs
            (list endpoint derived from EOB_URL by stripping the /{eob_uid} suffix)

        Args:
            member_id: Member ID whose EOB list to retrieve.
            channel: Channel name ('sms' or 'web') for channel-specific authentication.

        Returns:
            dict: Parsed JSON response (expects an 'eobs' list key).

        Raises:
            ValueError: If member_id is missing or URL is not configured.
            ResourceNotFoundError / APISystemError / RateLimitError: On HTTP errors.
        """
        try:
            if not member_id:
                HTTPErrorHandler.handle_validation_error("claims", "member_id is required")
            if not self.EOB_URL:
                raise ValueError("eob_url is not configured; cannot derive EOB list URL")

            eob_list_url = (
                self.EOB_URL
                .replace(f"/{URL_PLACEHOLDER_EOB_UID}", "")
                .replace(URL_PLACEHOLDER_MEMBER_ID, member_id)
            )

            resolved_channel = (channel or RequestContext.get_channel() or "").strip().lower()
            try:
                normalized_channel = Channel(resolved_channel).value
            except ValueError as exc:
                supported_channels = ", ".join([f"'{c.value}'" for c in Channel])
                raise ValueError(
                    f"channel is required and must be one of {supported_channels} for EOB list lookup"
                ) from exc

            channel_auth = get_channel_auth(channel=normalized_channel)
            oauth_token = channel_auth.member_oauth_token
            if not oauth_token:
                raise ValueError(
                    f"{normalized_channel.upper()} OAuth token is not available for EOB list lookup"
                )

            soa_config = get_soa_config(channel=normalized_channel)
            api_key = soa_config.get("api_key")
            headers = {
                "accept": "application/json",
                "Authorization": f"Bearer {oauth_token}",
            }
            if api_key:
                headers["apikey"] = api_key

            logger.info("Fetching EOB list for member")

            start_time = time.time()
            error_message = None
            status_code = 0

            try:
                with httpx.Client(verify=False, timeout=10.0) as client:
                    response = client.get(eob_list_url, headers=headers)
                status_code = response.status_code

                logger.info("EOB list HTTP status: %d", response.status_code)
                if response.status_code == 200:
                    result = response.json()
                    logger.info("Successfully received EOB list")
                    return result
                else:
                    logger.warning(
                        "EOB list non-200: status=%d body=%s",
                        response.status_code,
                        response.text[:500],
                    )
                    response.raise_for_status()
            except httpx.TimeoutException:
                error_message = "EOB list request timed out"
                raise
            except httpx.RequestError:
                error_message = "EOB list request failed"
                raise
            except httpx.HTTPStatusError as e:
                error_message = "EOB list HTTP error"
                HTTPErrorHandler.handle_http_error(e, "claims", context="EOB list")
            except (ResourceNotFoundError, APISystemError, RateLimitError):
                raise
            except Exception:
                error_message = "unexpected EOB list error"
                raise
            finally:
                elapsed_ms = (time.time() - start_time) * 1000
                structured_logger.audit_downstream_call(
                    code=AuditCode.CALLED_EMEP_GATEWAY,
                    method="GET",
                    url=eob_list_url,
                    status_code=status_code,
                    elapsed_ms=elapsed_ms,
                    request_body=None,
                    response_body=None,
                    error=error_message,
                    request_name="EOBListRequest",
                )

        except (ResourceNotFoundError, APISystemError, RateLimitError):
            raise
        except httpx.TimeoutException as e:
            HTTPErrorHandler.handle_timeout_error(e, "claims", context="EOB list")
        except httpx.RequestError as e:
            HTTPErrorHandler.handle_request_error(e, "claims", context="EOB list")
        except Exception as e:
            HTTPErrorHandler.handle_unexpected_error(e, "claims", context="EOB list")

    def get_eob_document(
        self,
        member_id: str,
        eob_uid: str,
        channel: str = None,
    ) -> bytes:
        """
        Fetch an EOB document from the Sydney Member API.

        GET /v7/cp/members/{member_id}/eobs/{eob_uid}

        Args:
            member_id: Member ID whose EOB to retrieve.
            eob_uid: EOB identifier (maps to {eob_uid} in the endpoint template).
            channel: Channel name ('sms' or 'web') for channel-specific authentication.

        Returns:
            bytes: Raw document bytes from the Sydney API (PDF or binary content).

        Raises:
            ValueError: If member_id or eob_uid is missing, or URL not configured.
            ResourceNotFoundError: If the EOB is not found (404).
            APISystemError: For API errors (400, 401, 403, 408, 500, 502, 503, 504).
            RateLimitError: If rate limit is exceeded (429).
        """
        try:
            if not member_id:
                HTTPErrorHandler.handle_validation_error("claims", "member_id is required")
            if not eob_uid:
                HTTPErrorHandler.handle_validation_error("claims", "eob_uid is required")
            if not self.EOB_URL:
                raise ValueError(
                    "eob_url is not configured in soa_sydney_api. "
                    "Add eob_endpoint to common-config.yaml."
                )

            url = (
                self.EOB_URL
                .replace(URL_PLACEHOLDER_MEMBER_ID, member_id)
                .replace(URL_PLACEHOLDER_EOB_UID, eob_uid)
            )

            resolved_channel = (channel or RequestContext.get_channel() or "").strip().lower()
            try:
                normalized_channel = Channel(resolved_channel).value
            except ValueError as exc:
                supported_channels = ", ".join([f"'{c.value}'" for c in Channel])
                raise ValueError(
                    f"channel is required and must be one of {supported_channels} for EOB document lookup"
                ) from exc

            channel_auth = get_channel_auth(channel=normalized_channel)
            oauth_token = channel_auth.member_oauth_token
            if not oauth_token:
                raise ValueError(
                    f"{normalized_channel.upper()} OAuth token is not available for EOB document lookup"
                )
            soa_config = get_soa_config(channel=normalized_channel)
            api_key = soa_config.get("api_key")
            headers = {
                "accept": "application/pdf",
                "Authorization": f"Bearer {oauth_token}"
            }
            if api_key:
                headers["apikey"] = api_key

            logger.info("Fetching EOB document")

            start_time = time.time()
            error_message = None
            status_code = 0

            try:
                with httpx.Client(verify=False, timeout=self._get_timeout(normalized_channel)) as client:
                    response = client.get(url, headers=headers)
                status_code = response.status_code

                if response.status_code == 200:
                    content = response.content
                    if not content:
                        raise APISystemError("claims", "EOB document response was empty")
                    logger.info("Successfully received EOB document")
                    return content
                else:
                    response.raise_for_status()
            except httpx.TimeoutException:
                error_message = "EOB document request timed out"
                raise
            except httpx.RequestError:
                error_message = "EOB document request failed"
                raise
            except httpx.HTTPStatusError as e:
                error_message = "EOB document HTTP error"
                HTTPErrorHandler.handle_http_error(e, "claims", context="EOB document")
            except (APISystemError, ResourceNotFoundError, RateLimitError):
                raise
            except Exception as e:
                error_message = "unexpected EOB document error"
                raise
            finally:
                elapsed_ms = (time.time() - start_time) * 1000
                structured_logger.audit_downstream_call(
                    code=AuditCode.CALLED_EMEP_GATEWAY,
                    method="GET",
                    url=url,
                    status_code=status_code,
                    elapsed_ms=elapsed_ms,
                    request_body=None,
                    response_body=None,
                    error=error_message,
                    request_name="EOBDocumentRequest",
                )

        except (ResourceNotFoundError, APISystemError, RateLimitError):
            raise
        except httpx.TimeoutException as e:
            HTTPErrorHandler.handle_timeout_error(e, "claims", context="EOB document")
        except httpx.RequestError as e:
            HTTPErrorHandler.handle_request_error(e, "claims", context="EOB document")
        except Exception as e:
            HTTPErrorHandler.handle_unexpected_error(e, "claims", context="EOB document")

==================================================================================================================

"""Authentication and header validation handlers for gateway requests."""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from agents.gateway.config import get_gateway_api_key
from agents.gateway.constants import FIVE_W_EXTENSION_URI
from agents.gateway.services.request_guard import (
    enforce_api_key,
    enforce_extension_header,
)
from utils.logging.request_context import RequestContext

if TYPE_CHECKING:
    from fastapi import Request

    from agents.gateway.a2a import GatewayRequestContext


def extract_meta_trans_id(request: Request) -> str:
    """Extract or generate meta-trans-id from request headers.
    
    Args:
        request: FastAPI Request object
        
    Returns:
        Transaction ID string
    """
    return request.headers.get("meta-trans-id") or str(uuid.uuid4())


def extract_and_set_request_context(request: Request) -> None:
    """Extract request context headers and set in RequestContext.
    
    Sets X-Rid and message_id in the global RequestContext for log correlation.
    
    Args:
        request: FastAPI Request object
    """
    RequestContext.clear()
    
    # Set RID from incoming header for log correlation
    x_rid = request.headers.get("X-Rid") or request.headers.get("x-rid")
    if x_rid:
        RequestContext.set_rid(x_rid)
        RequestContext.set_message_id(x_rid)


def validate_request_headers(
    request: Request,
    parsed_context: GatewayRequestContext,
    meta_trans_id: str,
    logger,
) -> None:
    """Validate required request headers (API key and extension).
    
    Args:
        request: FastAPI Request object
        parsed_context: Parsed gateway request context
        meta_trans_id: Transaction ID for logging
        logger: Logger instance
        
    Raises:
        HTTPException: If validation fails
    """
    request_api_key = get_gateway_api_key(parsed_context.channel)
    
    # Validate extension header
    enforce_extension_header(
        FIVE_W_EXTENSION_URI,
        request.headers.get("x-a2a-extensions"),
        meta_trans_id=meta_trans_id,
        context_id=None,
        logger=logger,
    )
    
    # Validate API key
    enforce_api_key(
        request_api_key,
        request.headers.get("x-api-key"),
        meta_trans_id=meta_trans_id,
        context_id=None,
        logger=logger,
        extension_uri=FIVE_W_EXTENSION_URI,
    )

=========================================================================================================

"""Request parsing and validation handlers for gateway requests."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from agents.gateway.a2a import A2ARequestParser
from agents.gateway.a2a.history import build_history_records
from agents.gateway.services.request_guard import (
    MEMBER_ID_VALIDATOR,
    get_validators_for_domain,
    validate_context_fields,
)
from agents.gateway.services.session_tracker import persist_session_snapshot
from utils.logging.request_context import RequestContext

if TYPE_CHECKING:
    from fastapi import Request

    from agents.gateway.a2a import GatewayRequestContext


# Module-level parser instance (stateless, safe for reuse across requests)
_request_parser = A2ARequestParser()


def parse_a2a_request(
    payload: dict,
    request: Request,
    logger,
) -> tuple[GatewayRequestContext, str, str]:
    """Parse A2A request payload and extract context.
    
    Args:
        payload: A2A request payload
        request: FastAPI Request object
        logger: Logger instance
        
    Returns:
        Tuple of (parsed_context, request_method, user_message)
    """
    # Get Accept header to determine if streaming is requested
    accept_header = request.headers.get("Accept", "application/json")
    parsed_context = _request_parser.parse(payload, accept_header=accept_header)
    
    # Set channel in RequestContext
    if parsed_context.channel:
        RequestContext.set_channel(parsed_context.channel)
    
    # Extract user message for logging
    user_message = (
        payload.get("params", {}).get("message", {}).get("parts", [{}])[0].get("text", "")
    )
    
    # Log parsed context
    logger.info(
        "[SERVER] Parsed context - context_id=%s, domain=%s, message='%s'",
        parsed_context.context_id,
        parsed_context.domain,
        user_message[:100] if len(user_message) > 100 else user_message
    )
    
    # Extract request method
    request_method = str(payload.get("method", "message/send")).lower()
    
    return parsed_context, request_method, user_message


def build_task_context(
    parsed_context: GatewayRequestContext,
    meta_trans_id: str,
    session_settings: dict,
) -> tuple[str, list[dict[str, Any]]]:
    """Build task ID and history records for the request.
    
    Args:
        parsed_context: Parsed gateway request context
        meta_trans_id: Transaction ID
        session_settings: Session configuration settings
        
    Returns:
        Tuple of (task_id, history)
    """
    # Generate task ID
    task_id = f"task-{parsed_context.context_id}" if parsed_context.context_id else f"task-{meta_trans_id}"
    
    # Build history records
    history = build_history_records(parsed_context, task_id=task_id)
    
    # Persist session snapshot
    persist_session_snapshot(parsed_context, history, session_settings)
    
    return task_id, history


def validate_request_context(
    parsed_context: GatewayRequestContext,
    meta_trans_id: str,
    logger,
) -> dict | None:
    """Validate request context fields.
    
    Args:
        parsed_context: Parsed gateway request context
        meta_trans_id: Transaction ID for logging
        logger: Logger instance
        
    Returns:
        Validation error response dict if validation fails, None otherwise
    """
    # Get validators for the domain
    validators = (MEMBER_ID_VALIDATOR,) + tuple(get_validators_for_domain(parsed_context.domain))
    
    # Run validation
    validation_response = validate_context_fields(
        parsed_context,
        validators,
        meta_trans_id=meta_trans_id,
        logger=logger,
    )
    
    return validation_response

===============================================================================================================

"""Response handlers for gateway error handling and streaming responses."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi.responses import JSONResponse

from agents.gateway.a2a import GatewayRequestContext
from agents.gateway.a2a.responses import (
    build_failed_response,
    build_incomplete_response,
)
from agents.gateway.agents.gateway import GatewayExecutionResult
from agents.gateway.exceptions import ClientActionRequiredError
from agents.gateway.services.request_guard import respond_with_extension
from agents.gateway.utils.logging_utils import log_event
from locales.en import LOCALES as EN_LOCALES
from locales.es import LOCALES as ES_LOCALES
from utils.http_error_handler import (
    APISystemError,
    RateLimitError,
    ResourceNotFoundError,
)


def build_error_response(
    exc: Exception,
    *,
    status_code: int,
    error_code: str,
    meta_trans_id: str,
    context_id: str | None,
    logger,
    extension_uri: str,
    message: str | None = None,
    log_level: str = "error",
    log_message: str | None = None,
    response_builder=None,
    **response_kwargs,
) -> JSONResponse:
    """Common helper to build error responses and reduce code duplication.
    
    Args:
        exc: The exception being handled
        status_code: HTTP status code to return
        error_code: Error code for the response body
        meta_trans_id: Transaction ID for logging
        context_id: Context ID for logging
        logger: Logger instance
        extension_uri: Extension URI for response
        message: Optional message override (defaults to str(exc))
        log_level: Logging level (default: "error", can be "warning")
        log_message: Optional log message override
        response_builder: Optional custom response builder (defaults to build_failed_response)
        **response_kwargs: Additional kwargs for response builder
    """
    # Default message to exception string
    if message is None:
        message = str(exc) or "Gateway error."
    
    # Default log message
    if log_message is None:
        log_message = f"Gateway error: {exc}"
    
    # Log the event
    log_event(logger, log_level, log_message, meta_trans_id, context_id)
    
    # Build response body
    if response_builder is None:
        response_builder = build_failed_response
    
    # build_incomplete_response doesn't accept error_code, only build_failed_response does
    if response_builder == build_incomplete_response:
        response_body = response_builder(
            meta_trans_id,
            context_id,
            message,
            **response_kwargs,
        )
    else:
        response_body = response_builder(
            meta_trans_id,
            context_id,
            message,
            error_code=error_code,
            **response_kwargs,
        )
    
    # Return response with extension
    return respond_with_extension(response_body, extension_uri, status_code=status_code)


def handle_system_or_rate_limit(
    exc: APISystemError | RateLimitError,
    *,
    meta_trans_id: str,
    context_id: str | None,
    logger,
    extension_uri: str,
    language: str = "en",
) -> JSONResponse:
    """Handle APISystemError and RateLimitError (500/429)."""
    locales = ES_LOCALES if language == "es" else EN_LOCALES
    errors = locales.get("errors") or {}  # Ensure it's always a dict
    
    status_code = exc.error_code
    error_code = "SYSTEM_ERROR" if status_code == 500 else "RATE_LIMIT"
    
    # Use different messages for 429 vs 500
    if status_code == 429:
        message = errors.get("error_429_rate_limit", errors.get("error_500_agent_available")) or "Service temporarily unavailable. Please try again later."
    else:
        message = errors.get("error_500_agent_available") or "Service temporarily unavailable. Please try again in a few minutes."
    
    return build_error_response(
        exc,
        status_code=status_code,
        error_code=error_code,
        meta_trans_id=meta_trans_id,
        context_id=context_id,
        logger=logger,
        extension_uri=extension_uri,
        message=message,
        log_message=f"{error_code} in {exc.api_name}: {exc}",
    )


def handle_not_found(
    exc: ResourceNotFoundError,
    *,
    meta_trans_id: str,
    context_id: str | None,
    logger,
    extension_uri: str,
    language: str = "en",
) -> JSONResponse:
    """Handle ResourceNotFoundError (404)."""
    locales = ES_LOCALES if language == "es" else EN_LOCALES
    errors = locales.get("errors") or {}  # Ensure it's always a dict
    
    message_key = f"error_404_{exc.api_name}"
    message = errors.get(message_key, errors.get("error_404_benefits")) or "The requested information could not be found."
    
    return build_error_response(
        exc,
        status_code=404,
        error_code="NOT_FOUND",
        meta_trans_id=meta_trans_id,
        context_id=context_id,
        logger=logger,
        extension_uri=extension_uri,
        message=message,
        log_level="warning",
        log_message=f"Not found in {exc.api_name}: {exc}",
    )


def handle_client_action_required(
    exc: ClientActionRequiredError,
    *,
    meta_trans_id: str,
    context_id: str | None,
    logger,
    extension_uri: str,
) -> JSONResponse:
    """Handle ClientActionRequiredError."""
    return build_error_response(
        exc,
        status_code=200,  # Client action required uses 200 status
        error_code="",  # Not used for incomplete responses
        meta_trans_id=meta_trans_id,
        context_id=context_id,
        logger=logger,
        extension_uri=extension_uri,
        message=exc.message,
        log_level="warning",
        log_message=f"Client action required: {exc.message}",
        response_builder=build_incomplete_response,
        required_fields=exc.required_fields,
        missing_fields=exc.missing_fields,
    )


def handle_not_implemented(
    exc: NotImplementedError,
    *,
    meta_trans_id: str,
    context_id: str | None,
    logger,
    extension_uri: str,
) -> JSONResponse:
    """Handle NotImplementedError (501)."""
    return build_error_response(
        exc,
        status_code=501,
        error_code="NOT_IMPLEMENTED",
        meta_trans_id=meta_trans_id,
        context_id=context_id,
        logger=logger,
        extension_uri=extension_uri,
        log_message=f"Not implemented error: {exc}",
    )


def handle_validation_error(
    exc: ValueError,
    *,
    meta_trans_id: str,
    context_id: str | None,
    logger,
    extension_uri: str,
) -> JSONResponse:
    """Handle ValueError (400)."""
    return build_error_response(
        exc,
        status_code=400,
        error_code="INVALID_REQUEST",
        meta_trans_id=meta_trans_id,
        context_id=context_id,
        logger=logger,
        extension_uri=extension_uri,
        log_message=f"Gateway validation error: {exc}",
    )


def handle_generic_error(
    exc: Exception,
    *,
    meta_trans_id: str,
    context_id: str | None,
    logger,
    extension_uri: str,
) -> JSONResponse:
    """Handle generic exceptions (500)."""
    return build_error_response(
        exc,
        status_code=500,
        error_code="GATEWAY_ERROR",
        meta_trans_id=meta_trans_id,
        context_id=context_id,
        logger=logger,
        extension_uri=extension_uri,
    )


# Exception handler mapping
_EXCEPTION_HANDLERS = {
    APISystemError: handle_system_or_rate_limit,
    RateLimitError: handle_system_or_rate_limit,
    ResourceNotFoundError: handle_not_found,
    ClientActionRequiredError: handle_client_action_required,
    NotImplementedError: handle_not_implemented,
    ValueError: handle_validation_error,
}


def handle_gateway_exception(
    exc: Exception,
    *,
    meta_trans_id: str,
    context_id: str | None,
    logger,
    extension_uri: str,
    language: str = "en",
) -> JSONResponse:
    """Convert gateway execution errors into HTTP/JSON responses."""
    
    # Try to find a specific handler for this exception type
    handler = _EXCEPTION_HANDLERS.get(type(exc))
    if handler:
        # Only pass language to handlers that use locale-based messages
        if type(exc) in (APISystemError, RateLimitError, ResourceNotFoundError):
            return handler(
                exc,
                meta_trans_id=meta_trans_id,
                context_id=context_id,
                logger=logger,
                extension_uri=extension_uri,
                language=language,
            )
        else:
            return handler(
                exc,
                meta_trans_id=meta_trans_id,
                context_id=context_id,
                logger=logger,
                extension_uri=extension_uri,
            )
    
    # Fallback to generic error handler (doesn't use language)
    return handle_generic_error(
        exc,
        meta_trans_id=meta_trans_id,
        context_id=context_id,
        logger=logger,
        extension_uri=extension_uri,
    )


def build_streaming_response(
    context: GatewayRequestContext,
    result: GatewayExecutionResult,
    history: list[dict[str, Any]],
    *,
    meta_trans_id: str,
    task_id: str,
    request_id: Any,
    extension_uri: str,
) -> "StreamingResponse | None":
    """Translate the Gateway result into SSE events."""
    from fastapi.responses import StreamingResponse

    # Use agent-formatted text or serialize payload
    if isinstance(result.raw_payload, str):
        text = result.raw_payload
    else:
        try:
            text = json.dumps(result.raw_payload)
        except (TypeError, ValueError):
            text = None
    if not text:
        return None

    generator = sse_event_generator(
        context,
        text,
        history,
        task_id=task_id,
        request_id=request_id or meta_trans_id,
    )
    headers = {
        "Cache-Control": "no-cache",
        "X-A2A-Extensions": extension_uri,
    }
    return StreamingResponse(generator, media_type="text/event-stream", headers=headers)


def sse_event_generator(
    context: GatewayRequestContext,
    text: str,
    history: list[dict[str, Any]],
    *,
    task_id: str,
    request_id: Any,
):
    """Yield JSON-RPC envelopes formatted as SSE data frames."""
    status_event: dict[str, Any] = {
        "jsonrpc": "2.0",
        "id": request_id,
        "result": {
            "id": task_id,
            "contextId": context.context_id,
            "status": {
                "state": "working",
                "timestamp": _timestamp(),
            },
        },
    }
    if history:
        status_event["result"]["history"] = history
    yield format_sse_event(status_event)

    artifact_id = str(uuid.uuid4())
    chunks = chunk_text(text, size=480)
    for idx, chunk in enumerate(chunks):
        artifact_event = {
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {
                "taskId": task_id,
                "contextId": context.context_id,
                "artifact": {
                    "artifactId": artifact_id,
                    "parts": [
                        {
                            "kind": "text",
                            "text": chunk,
                        }
                    ],
                },
                "append": idx > 0,
                "lastChunk": idx == len(chunks) - 1,
                "kind": "artifact-update",
            },
        }
        yield format_sse_event(artifact_event)

    final_event = {
        "jsonrpc": "2.0",
        "id": request_id,
        "result": {
            "id": task_id,
            "contextId": context.context_id,
            "status": {
                "state": "completed",
                "timestamp": _timestamp(),
            },
            "artifacts": [
                {
                    "artifactId": artifact_id,
                    "parts": [
                        {
                            "kind": "text",
                            "text": text,
                        }
                    ],
                }
            ],
        },
    }
    if history:
        final_event["result"]["history"] = history
    yield format_sse_event(final_event)


def format_sse_event(payload: dict[str, Any]) -> bytes:
    """Format a payload as an SSE event."""
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n".encode("utf-8")


def chunk_text(text: str, size: int) -> list[str]:
    """Split text into chunks of specified size."""
    return [text[i : i + size] for i in range(0, len(text), size)] or [text]


def _timestamp() -> str:
    """Get current UTC timestamp in ISO format."""
    return datetime.now(timezone.utc).isoformat()

==============================================================================================================

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Callable, Iterable

from fastapi import HTTPException
from fastapi.responses import JSONResponse

from agents.gateway.a2a import GatewayRequestContext
from agents.gateway.a2a.responses import (
    build_completed_response,
    build_missing_member_response,
)
from agents.gateway.agents.gateway import GatewayExecutionResult
from agents.gateway.constants import FIVE_W_EXTENSION_HEADER
from agents.gateway.utils.logging_utils import log_event


@dataclass(frozen=True)
class FieldValidator:
    """Describe a required field that must be present on the parsed 5W context."""

    name: str
    getter: Callable[[GatewayRequestContext], Any]
    response_builder: Callable[[str, str | None], dict]
    log_message: str


def _extension_headers(extension_uri: str | None) -> dict[str, str] | None:
    if not extension_uri:
        return None
    return {FIVE_W_EXTENSION_HEADER: extension_uri}


def enforce_api_key(
    expected_api_key: str | None,
    provided_api_key: str | None,
    *,
    meta_trans_id: str,
    context_id: str | None,
    logger,
    extension_uri: str | None = None,
) -> None:
    """Validate the caller-supplied API key and raise HTTP errors when invalid."""
    if not expected_api_key:
        log_event(logger, "error", "GATEWAY_API_KEY is not configured.", meta_trans_id, context_id)
        raise HTTPException(
            status_code=500,
            detail="Gateway API key is not configured.",
            headers=_extension_headers(extension_uri),
        )
    if provided_api_key != expected_api_key:
        log_event(logger, "warning", "Invalid API key provided.", meta_trans_id, context_id)
        raise HTTPException(
            status_code=401,
            detail="Invalid API key.",
            headers=_extension_headers(extension_uri),
        )


def enforce_extension_header(
    expected_uri: str,
    provided_value: str | None,
    *,
    meta_trans_id: str,
    context_id: str | None,
    logger,
) -> None:
    """Ensure callers activate the required 5W Healthcare extension."""
    if not provided_value:
        log_event(logger, "warning", "Missing X-A2A-Extensions header.", meta_trans_id, context_id)
        raise HTTPException(
            status_code=428,
            detail="X-A2A-Extensions header must request the 5W Healthcare extension.",
            headers=_extension_headers(expected_uri),
        )

    requested = [value.strip() for value in provided_value.split(",") if value.strip()]
    if expected_uri not in requested:
        log_event(logger, "warning", "5W extension not requested.", meta_trans_id, context_id)
        raise HTTPException(
            status_code=428,
            detail="Request must activate the https://github.com/exponential-engineering/a2a-5w/v0.1 extension.",
            headers=_extension_headers(expected_uri),
        )


def validate_context_fields(
    context: GatewayRequestContext,
    validators: Iterable[FieldValidator],
    *,
    meta_trans_id: str,
    logger,
) -> dict | None:
    """Run the configured validators and return an error response when a field is missing."""
    for validator in validators:
        if validator.getter(context):
            continue
        log_event(logger, "warning", validator.log_message, meta_trans_id, context.context_id)
        return validator.response_builder(meta_trans_id, context.context_id)
    return None


def build_gateway_response(
    context: GatewayRequestContext,
    result: GatewayExecutionResult,
    *,
    meta_trans_id: str,
) -> dict:
    """Construct the final A2A response payload (non-streaming)."""

    if context.expects_json_response:
        serialized = json.dumps(result.raw_payload)
        return build_completed_response(meta_trans_id, context.context_id, serialized, as_json=True)

    # For non-JSON: use agent-formatted text or serialize payload
    if isinstance(result.raw_payload, str):
        text = result.raw_payload
    else:
        text = json.dumps(result.raw_payload)
    return build_completed_response(meta_trans_id, context.context_id, text, as_json=False)


def respond_with_extension(body: dict, extension_uri: str, *, status_code: int = 200) -> JSONResponse:
    """Attach the extension header to JSON responses."""
    return JSONResponse(body, headers=_extension_headers(extension_uri), status_code=status_code)


MEMBER_ID_VALIDATOR = FieldValidator(
    name="member-contrived-id",
    getter=lambda ctx: ctx.member_contrived_id,
    response_builder=lambda meta_trans_id, context_id: build_missing_member_response(meta_trans_id, context_id),
    log_message="Missing member-contrived-id.",
)


_DOMAIN_VALIDATORS: dict[str, list[FieldValidator]] = {}


def register_domain_validators(domain: str, validators: list[FieldValidator]) -> None:
    """Register additional validators that only apply to the provided domain."""
    key = domain.upper()
    existing = _DOMAIN_VALIDATORS.get(key, [])
    existing.extend(validators)
    _DOMAIN_VALIDATORS[key] = existing


def get_validators_for_domain(domain: str | None) -> list[FieldValidator]:
    if not domain:
        return []
    return _DOMAIN_VALIDATORS.get(domain.upper(), [])


def reset_domain_validators() -> None:
    _DOMAIN_VALIDATORS.clear()

===============================================================================================================

from __future__ import annotations

from typing import Dict

from agents.gateway.a2a import GatewayRequestContext
from agents.gateway.a2a.responses import build_incomplete_response
from agents.gateway.services.request_guard import (
    FieldValidator,
    register_domain_validators,
)


def _metadata(context: GatewayRequestContext) -> Dict:
    return (
        context.raw_payload.get("params", {})
        .get("message", {})
        .get("metadata", {})
    )


def has_service_identifier(context: GatewayRequestContext, identifier_type: str) -> bool:
    metadata = _metadata(context)
    service = metadata.get("5w.what.service") or {}
    identifiers = service.get("identifier")
    if not isinstance(identifiers, list):
        return False
    for identifier in identifiers:
        if isinstance(identifier, dict) and identifier.get("type") == identifier_type and identifier.get("value"):
            return True
    return False


def build_missing_group_response(meta_trans_id: str, context_id: str | None) -> Dict:
    message = "Live Agent requests must include a 5w.what.service.identifier entry with type group-id."
    return build_incomplete_response(
        meta_trans_id,
        context_id,
        message,
        required_fields=["5w.what.service"],
        missing_fields=[
            "5w.what.service.identifier.group-id",
        ],
    )


def configure_domain_validators() -> None:
    """Register all domain-specific validation rules."""
    register_domain_validators(
        "LIVEAGENT",
        [
            FieldValidator(
                name="liveagent-group-id",
                getter=lambda ctx: has_service_identifier(ctx, "group-id"),
                response_builder=build_missing_group_response,
                log_message="Missing live agent group-id identifier.",
            )
        ],
    )

=================================================================================================================

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, List

from agents.gateway.a2a import GatewayRequestContext
from agents.gateway.config import get_session_settings

AGENT_ID = "gateway_request"


def persist_session_snapshot(
    context: GatewayRequestContext,
    history: List[dict[str, Any]],
    session_settings: dict[str, Any] | None = None,
) -> None:
    """Persist the inbound request so GET /sessions/{context} can replay it."""
    settings = session_settings or get_session_settings()
    enabled = settings.get("enabled")
    session_dir_root = settings.get("dir")
    if not enabled or not session_dir_root:
        return

    session_id = _derive_session_id(context)
    if not session_id:
        return

    session_dir = Path(session_dir_root) / f"session_{session_id}"
    messages_dir = session_dir / "agents" / f"agent_{AGENT_ID}" / "messages"
    timestamp = datetime.now(timezone.utc).isoformat()

    _write_session_metadata(session_dir, timestamp)
    _write_agent_metadata(session_dir, timestamp)
    messages_dir.mkdir(parents=True, exist_ok=True)

    message_id = _next_message_index(messages_dir)
    payload = {
        "message": {
            "role": context.raw_payload.get("params", {}).get("message", {}).get("role", "user"),
            "content": [
                {
                    "text": json.dumps(
                        {
                            "history": history,
                            "rawPayload": context.raw_payload,
                        },
                        indent=2,
                    )
                }
            ],
        },
        "message_id": message_id,
        "created_at": timestamp,
        "updated_at": timestamp,
    }
    message_file = messages_dir / f"message_{message_id}.json"
    message_file.write_text(json.dumps(payload, indent=2))


def _derive_session_id(context: GatewayRequestContext) -> str | None:
    candidates: Iterable[str | None] = (
        context.context_id,
        context.member_contrived_id,
        context.message_id,
        context.invocation_id,
    )
    for candidate in candidates:
        if isinstance(candidate, str) and candidate.strip():
            return _sanitize_identifier(candidate)
    return None


def _sanitize_identifier(value: str) -> str:
    """Restrict identifiers to filesystem-safe characters."""
    sanitized = re.sub(r"[^A-Za-z0-9_.-]", "_", value)
    return sanitized[:128] or "gateway"


def _write_session_metadata(session_dir: Path, timestamp: str) -> None:
    session_dir.mkdir(parents=True, exist_ok=True)
    session_file = session_dir / "session.json"
    if session_file.exists():
        session_data = json.loads(session_file.read_text())
        session_data["updated_at"] = timestamp
    else:
        session_data = {
            "session_id": session_dir.name.replace("session_", "", 1),
            "session_type": "AGENT",
            "created_at": timestamp,
            "updated_at": timestamp,
        }
    session_file.write_text(json.dumps(session_data, indent=2))


def _write_agent_metadata(session_dir: Path, timestamp: str) -> None:
    agent_dir = session_dir / "agents" / f"agent_{AGENT_ID}"
    agent_dir.mkdir(parents=True, exist_ok=True)
    agent_file = agent_dir / "agent.json"
    if agent_file.exists():
        agent_data = json.loads(agent_file.read_text())
        agent_data["updated_at"] = timestamp
    else:
        agent_data = {
            "agent_id": AGENT_ID,
            "state": {},
            "conversation_manager_state": {},
            "_internal_state": {},
            "created_at": timestamp,
            "updated_at": timestamp,
        }
    agent_file.write_text(json.dumps(agent_data, indent=2))


def _next_message_index(messages_dir: Path) -> int:
    existing: list[int] = []
    if messages_dir.exists():
        for path in messages_dir.glob("message_*.json"):
            suffix = path.stem.replace("message_", "", 1)
            try:
                existing.append(int(suffix))
            except ValueError:
                continue
    return max(existing) + 1 if existing else 0

==================================================================================================================

from __future__ import annotations

import copy
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, Optional


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class TaskRecord:
    task_id: str
    context_id: Optional[str]
    history: list[dict[str, Any]]
    channel: Optional[str] = None
    status_text: str = "Task is in progress. Poll tasks/get for updates."
    created_at: str = field(default_factory=_timestamp)
    updated_at: str = field(default_factory=_timestamp)
    result: Optional[Dict[str, Any]] = None

    @property
    def state(self) -> str:
        if self.result:
            return self.result.get("status", {}).get("state", "completed")
        return "working"

    def working_result(self) -> Dict[str, Any]:
        return {
            "kind": "task",
            "id": self.task_id,
            "contextId": self.context_id,
            "history": self.history,
            "status": {
                "state": "working",
                "timestamp": _timestamp(),
                "message": {
                    "kind": "message",
                    "role": "agent",
                    "parts": [
                        {
                            "kind": "text",
                            "text": self.status_text,
                        }
                    ],
                },
            },
        }


class TaskStore:
    """In-memory store that tracks long-running tasks for the /tasks/get endpoint."""

    def __init__(self) -> None:
        self._tasks: dict[str, TaskRecord] = {}
        self._lock = threading.Lock()

    def create_task(
        self,
        task_id: str,
        context_id: str | None,
        history: list[dict[str, Any]],
        *,
        status_text: str,
        channel: str | None = None,
    ) -> TaskRecord:
        with self._lock:
            record = TaskRecord(
                task_id=task_id,
                context_id=context_id,
                history=history,
                channel=channel,
                status_text=status_text,
            )
            self._tasks[task_id] = record
            return record

    def set_result(self, task_id: str, result: Dict[str, Any]) -> None:
        with self._lock:
            record = self._tasks.get(task_id)
            if not record:
                return
            record.result = result
            record.updated_at = _timestamp()

    def get_task(self, task_id: str) -> Optional[TaskRecord]:
        with self._lock:
            record = self._tasks.get(task_id)
            return copy.deepcopy(record) if record else None

    def build_response(self, task_id: str, *, request_id: Any) -> Dict[str, Any] | None:
        record = self.get_task(task_id)
        if not record:
            return None
        result = record.result or record.working_result()
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "result": result,
        }

================================================================================================================

from __future__ import annotations

import inspect
import logging
from pathlib import Path
from typing import Optional


def log_event(
    logger: logging.Logger,
    level: str,
    message: str,
    meta_trans_id: Optional[str],
    context_id: Optional[str],
) -> None:
    """Log enriched metadata using the requested level (debug/info/warning/error/critical)."""
    caller = inspect.stack()[1]
    file_path = Path(caller.filename)
    log_fn = getattr(logger, level.lower(), logger.info)
    log_fn(
        "%s | meta-trans-id=%s | contextId=%s | file=%s | function=%s | line=%s",
        message,
        meta_trans_id or "unknown",
        context_id or "unknown",
        file_path.name,
        caller.function,
        caller.lineno,
    )

============================================================================================================

from __future__ import annotations

import json
import logging
from typing import Any, Dict, Mapping, MutableMapping, Optional

import httpx

from agents.gateway.config import get_config
from utils.constants import Channel
from utils.http_utils import get_requests_verify

logger = logging.getLogger(__name__)


class SOARestAPIError(Exception):
    """Raised when an upstream SOA REST API call fails."""

    def __init__(self, status_code: int, message: str) -> None:
        self.status_code = status_code
        self.message = message
        payload = json.dumps({"status_code": status_code, "message": message})
        super().__init__(payload)


class SOARestAPIClient:
    """HTTP client for SOA REST services with connection pooling."""

    def __init__(self, base_url: str, api_key: str, timeout_seconds: float = 5.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._timeout_seconds = timeout_seconds
        self._client = httpx.AsyncClient(
            timeout=timeout_seconds,
            verify=get_requests_verify(base_url),
        )

    async def request_json(
        self,
        method: str,
        path: str,
        *,
        params: Optional[Mapping[str, Any]] = None,
        json_body: Any | None = None,
        headers: Optional[MutableMapping[str, str]] = None,
    ) -> Dict[str, Any]:
        """Execute HTTP request and return JSON response."""
        url = self.build_url(path)
        main_headers = self._build_headers()
        if headers:
            main_headers.update(headers)
        
        try:
            response = await self._client.request(
                method.upper(),
                url,
                params=params,
                json=json_body,
                headers=main_headers,
            )
        except httpx.RequestError as exc:
            logger.error("SOA REST API request failure (%s) for url=%s", exc, url)
            raise SOARestAPIError(status_code=0, message=f"SOA REST API request failed: {exc}") from exc

        if response.status_code == 404:
            raise SOARestAPIError(status_code=404, message="Requested resource was not found.")

        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text.strip()
            message = f"SOA REST API error ({exc.response.status_code}): {detail or 'Unknown error'}"
            raise SOARestAPIError(status_code=exc.response.status_code, message=message) from exc

        try:
            return response.json()
        except ValueError as exc:
            raise SOARestAPIError(
                status_code=response.status_code, message="Invalid JSON received from SOA REST API."
            ) from exc

    async def get_json(
        self,
        path: str,
        *,
        params: Optional[Mapping[str, Any]] = None,
        headers: Optional[MutableMapping[str, str]] = None,
    ) -> Dict[str, Any]:
        """Convenience wrapper for GET requests."""
        return await self.request_json("GET", path, params=params, headers=headers)

    def _build_headers(self) -> Dict[str, str]:
        return {
            "apikey": self._api_key,
        }

    def build_url(self, path: str) -> str:
        """Return the absolute URL for a path served by this client."""
        normalized_path = path.lstrip("/")
        return f"{self._base_url}/{normalized_path}"
    
    async def close(self) -> None:
        """Close HTTP client and release connections."""
        await self._client.aclose()
    
    async def __aenter__(self):
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()


_CONFIGURED_CLIENTS: Dict[str, SOARestAPIClient] = {}


def _normalize_channel(channel: str | Channel | None) -> str:
    if isinstance(channel, Channel):
        return channel.value
    normalized_channel = (channel or "").strip().lower()
    if not normalized_channel:
        raise ValueError("channel is required and must be 'sms' or 'web'")
    return Channel(normalized_channel).value


def configure_soa_rest_client(
    _legacy_settings: Any = None,
    *,
    client: SOARestAPIClient | None = None,
    channel: str | Channel | None = None,
) -> None:
    """Configure the shared SOA REST client that tools can reuse."""
    global _CONFIGURED_CLIENTS
    channel_key = _normalize_channel(channel)
    if client is None:
        _CONFIGURED_CLIENTS.pop(channel_key, None)
        return
    _CONFIGURED_CLIENTS[channel_key] = client


def get_soa_rest_client(channel: str | Channel | None = None) -> SOARestAPIClient:
    """Return an explicitly configured SOA REST client or build a fresh one for this request."""
    global _CONFIGURED_CLIENTS
    channel_key = _normalize_channel(channel)
    if channel_key in _CONFIGURED_CLIENTS:
        return _CONFIGURED_CLIENTS[channel_key]
    return _build_default_client(channel=channel_key)


def reset_soa_rest_client() -> None:
    """Clear the cached SOA REST client (used primarily by tests)."""
    global _CONFIGURED_CLIENTS
    _CONFIGURED_CLIENTS = {}


def _build_default_client(channel: str | Channel | None = None) -> SOARestAPIClient:
    settings = _resolve_soa_settings(channel=channel)
    return SOARestAPIClient(
        base_url=settings["base_url"],
        api_key=settings["api_key"],
        timeout_seconds=settings["timeout_seconds"],
    )


def _resolve_soa_settings(channel: str | Channel | None = None) -> Dict[str, Any]:
    config = get_config(channel=_normalize_channel(channel)) or {}
    soa_config = config.get("soa_sydney_api") or {}

    base_url = str(soa_config.get("base_url", "")).strip()
    if not base_url:
        raise ValueError("soa_sydney_api.base_url is not configured")

    api_key = str(soa_config.get("api_key", "")).strip()
    if not api_key:
        raise ValueError("soa_sydney_api.api_key is not configured")

    timeout_seconds = float(soa_config.get("timeout_seconds", 5))

    return {
        "base_url": base_url.rstrip("/"),
        "api_key": api_key,
        "timeout_seconds": timeout_seconds,
    }

==============================================================================================================

from __future__ import annotations

import ast
import json
from typing import Any, Callable, Dict, Iterable, List

ToolContent = List[Dict[str, Any]]
ErrorHandler = Callable[[ToolContent], None]
NotFoundHandler = Callable[[int, str], None]


def extract_tool_payload(
    tool_result: Dict[str, Any],
    *,
    on_error: ErrorHandler,
    parse_error_message: str = "Unable to parse tool payload.",
) -> Dict[str, Any]:
    """
    Convert a strands tool result into a JSON payload, delegating error handling to `on_error`.

    This helper enforces a consistent parsing strategy so downstream agents can reuse the same
    logic when working with text-based tool responses.
    """
    content = tool_result.get("content") or []
    status = tool_result.get("status")
    if status != "success":
        on_error(content)
        raise ValueError("Tool execution failed without raising an error.")

    if content and isinstance(content[0], dict):
        text_value = content[0].get("text")
        if text_value:
            parsed = ast.literal_eval(text_value)
            if isinstance(parsed, dict):
                return parsed
    raise ValueError(parse_error_message)


def handle_tool_error(
    content: ToolContent,
    *,
    error_prefixes: Iterable[str] | None = None,
    not_found_handler: NotFoundHandler | None = None,
    default_detail: str = "Upstream API error.",
    default_error_message: str = "Tool execution error.",
) -> None:
    """
    Inspect a tool error payload and raise structured exceptions.

    `error_prefixes` identify upstream exceptions that encode JSON payloads.
    When a 404 is detected and `not_found_handler` is provided, the callback is invoked to allow
    callers to raise domain-specific exceptions (e.g., ClientActionRequiredError).
    """
    message = ""
    if content and isinstance(content[0], dict):
        message = content[0].get("text", "") or ""

    prefixes = tuple(error_prefixes or ())
    matched_prefix = next((prefix for prefix in prefixes if message.startswith(prefix)), None)
    if matched_prefix:
        error_payload = message[len(matched_prefix) :].strip()
        status_code = 0
        detail = default_detail
        try:
            parsed = json.loads(error_payload)
            status_code = int(parsed.get("status_code", 0))
            detail = parsed.get("message") or detail
        except (json.JSONDecodeError, TypeError, ValueError):
            if error_payload:
                detail = error_payload

        if status_code == 404 and not_found_handler:
            not_found_handler(status_code, detail)
            return
        raise ValueError(detail)

    raise ValueError(message or default_error_message)

=================================================================================================================

"""
Channel-first configuration loader.

Loads configuration in the following order (later overrides earlier):
1. config/common-config.yaml       - Truly shared values across all channels and environments
2. config/{channel}/environments.yaml [defaults] - Channel-specific defaults
3. config/{channel}/environments.yaml [{ENV}]    - Channel + environment-specific overrides

This structure eliminates the need for a separate defaults.yaml file.
"""

from __future__ import annotations

import logging
import os
import re
from pathlib import Path
from typing import Any, Dict, Optional

import yaml
from dotenv import load_dotenv

from utils.constants import Channel
from utils.env_config import get_env_var

logger = logging.getLogger(__name__)

_project_root = Path(__file__).parent.parent.parent
_env_path = _project_root / ".env"
if _env_path.exists():
    load_dotenv(dotenv_path=_env_path, override=True)
    logger.info(f"Loaded .env from: {_env_path}")
else:
    logger.warning(f".env file not found at {_env_path}")
    load_dotenv(override=True)

_ENV_PLACEHOLDER = re.compile(r"\$\{([^}]+)\}")


def _deep_merge(base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
    """Recursively merge two dictionaries, with override taking precedence."""
    result = dict(base)
    for key, value in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def _resolve_urls(config: Dict[str, Any]) -> Dict[str, Any]:
    """For each config section, if a base_url and *_endpoint keys exist,
    construct the corresponding *_url keys automatically.
    This means only base_url needs to be overridden per environment.
    """
    result = {}
    for section_key, section_val in config.items():
        if not isinstance(section_val, dict):
            result[section_key] = section_val
            continue
        section = dict(section_val)
        base_url = (section.get("base_url") or "").rstrip("/")
        secondary_bases = {k: v.rstrip("/") for k, v in section.items()
                          if k.endswith("_base_url") and isinstance(v, str)}
        resolved = {}
        for k, v in section.items():
            if k.endswith("_endpoint") and isinstance(v, str):
                url_key = k[:-len("_endpoint")] + "_url"
                # Determine which base_url to use based on naming convention
                # e.g. member_search_endpoint -> look for member_search_base_url first
                prefix = k[:-len("_endpoint")]
                matching_base = secondary_bases.get(f"{prefix}_base_url", base_url)
                resolved[url_key] = matching_base + v
            else:
                resolved[k] = v
        result[section_key] = resolved
    return result


def _interpolate_value(value: Any) -> Any:
    """Replace ${ENV_VAR} placeholders with environment variable values."""
    if isinstance(value, str):
        def replace(match: re.Match[str]) -> str:
            env_key = match.group(1)
            env_value = get_env_var(env_key, default=None)
            if env_value is not None:
                return env_value
            return match.group(0)
        return _ENV_PLACEHOLDER.sub(replace, value)
    if isinstance(value, dict):
        return {k: _interpolate_value(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_interpolate_value(item) for item in value]
    return value


def load_hierarchical_config(channel: str, environment: Optional[str] = None) -> Dict[str, Any]:
    """
    Load configuration using channel-first structure.
    
    Args:
        channel: Channel name ('sms' or 'web')
        environment: Environment name (DEV/SIT/UAT/PROD). If None, uses PROJECT_ENV env var.
        
    Returns:
        Merged configuration dictionary
        
    Raises:
        ValueError: If channel is invalid or config files are missing
    """
    channel = channel.lower().strip()
    valid_channels = [c.value for c in Channel]
    if channel not in valid_channels:
        supported_channels = ", ".join([f"'{c}'" for c in valid_channels])
        raise ValueError(
            f"Unknown channel '{channel}'. Supported channels: {supported_channels}"
        )
    
    env_name = (environment or os.getenv("PROJECT_ENV", "UAT")).upper()
    
    config_dir = _project_root / "config"
    channel_dir = config_dir / channel
    
    common_path = config_dir / "common-config.yaml"
    environments_path = channel_dir / "environments.yaml"
    
    if not common_path.exists():
        raise ValueError(f"Common config file not found: {common_path}")
    if not environments_path.exists():
        raise ValueError(f"Channel environments file not found: {environments_path}")
    
    # Load common config
    with common_path.open(encoding="utf-8") as f:
        common_config = yaml.safe_load(f) or {}
    
    # Load channel environments file (contains both defaults + env-specific overrides)
    with environments_path.open(encoding="utf-8") as f:
        env_overrides = yaml.safe_load(f) or {}
    
    channel_defaults = env_overrides.get("defaults", {})
    env_config = env_overrides.get(env_name, {})
    
    # Merge: common <- channel defaults <- environment overrides
    merged = _deep_merge(common_config, channel_defaults)
    merged = _deep_merge(merged, env_config)
    
    # Resolve base_url + *_endpoint -> *_url
    merged = _resolve_urls(merged)
    
    # Interpolate environment variables
    hydrated = _interpolate_value(merged)
    hydrated["project_env"] = env_name
    hydrated["channel"] = channel
    
    logger.info(f"Loaded config for channel='{channel}', environment='{env_name}'")
    
    return hydrated


=============================================================================================================

from __future__ import annotations

import asyncio
import os
import re
import threading
from pathlib import Path
from typing import Any, Dict, Iterable, Mapping, Optional
from urllib.parse import urlencode, urlparse, urlunparse

import yaml
from dotenv import load_dotenv

from agents.gateway.config_loader import load_hierarchical_config
from utils.constants import Channel
from utils.env_config import get_env_var
from utils.logging.request_context import RequestContext

# Load .env from project root (two levels up from this file)
_project_root = Path(__file__).parent.parent.parent
_env_path = _project_root / ".env"
if _env_path.exists():
    load_dotenv(dotenv_path=_env_path, override=True)
    print(f"[CONFIG] Loaded .env from: {_env_path}")
else:
    print(f"[CONFIG] Warning: .env file not found at {_env_path}")
    load_dotenv(override=True)  # Try default search


_ENV_PLACEHOLDER = re.compile(r"\$\{([^}]+)\}")


def _parse_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    text = str(value).strip().lower()
    if text in {"1", "true", "yes", "on"}:
        return True
    if text in {"0", "false", "no", "off"}:
        return False
    return default


def _deep_merge(base: Mapping[str, Any] | None, override: Mapping[str, Any] | None) -> Dict[str, Any]:
    """Recursively merge two mapping objects."""
    result: Dict[str, Any] = dict(base or {})
    for key, value in (override or {}).items():
        base_value = result.get(key)
        if isinstance(base_value, dict) and isinstance(value, dict):
            result[key] = _deep_merge(base_value, value)
        else:
            result[key] = value
    return result


def _interpolate_value(value: Any) -> Any:
    if isinstance(value, str):
        def replace(match: re.Match[str]) -> str:
            env_key = match.group(1)
            env_value = get_env_var(env_key, default=None)
            if env_value is not None:
                return env_value
            return match.group(0)

        return _ENV_PLACEHOLDER.sub(replace, value)
    if isinstance(value, dict):
        return {k: _interpolate_value(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_interpolate_value(item) for item in value]
    return value


def _resolve_requested_channel(channel: Optional[str] = None) -> Optional[str]:
    requested_channel = (channel or RequestContext.get_channel() or "").strip().lower()
    if not requested_channel:
        return None
    try:
        return Channel(requested_channel).value
    except ValueError as exc:
        supported_channels = ", ".join([f"'{c.value}'" for c in Channel])
        raise ValueError(
            f"Unknown channel '{requested_channel}'. Supported channels: {supported_channels}"
        ) from exc


class Config:
    """Loads and exposes settings from config/settings.yaml for the active environment."""

    def __init__(
        self,
        *,
        config_path: str | Path | None = None,
        environment_var: str = "PROJECT_ENV",
    ) -> None:
        self._config_path = Path(config_path).resolve() if config_path else None
        self._environment_var = environment_var
        self._config: Dict[str, Any] = {}
        self._channel_configs: Dict[str, Dict[str, Any]] = {}  # Cache for channel-specific configs
        self._config_lock = threading.Lock()  # Thread-safe config access

    @property
    def data(self) -> Dict[str, Any]:
        return self._config

    def get(self, key: str, default: Any = None) -> Any:
        return self._config.get(key, default)

    def reload(self, channel: Optional[str] = None) -> None:
        """
        Reload configuration, optionally for a specific channel.
        
        Args:
            channel: Optional channel name ('sms' or 'web'). If provided, loads channel-specific config.
            
        Raises:
            ValueError: If an unknown channel is provided
        """
        # Determine config file based on channel
        resolved_channel = _resolve_requested_channel(channel)
        if not resolved_channel:
            supported_channels = ", ".join([f"'{c.value}'" for c in Channel])
            raise ValueError(
                f"Channel is required. Supported channels: {supported_channels}"
            )
        
        # Use new hierarchical config loader
        env_name = os.getenv(self._environment_var, "UAT")
        hydrated = load_hierarchical_config(channel=resolved_channel, environment=env_name)
        
        # Thread-safe config update
        with self._config_lock:
            self._config = hydrated
            
            # Cache the channel-specific config if channel was specified
            if resolved_channel:
                if hydrated:
                    self._channel_configs[resolved_channel] = hydrated
                else:
                    self._channel_configs.pop(resolved_channel, None)
    
    def get_channel_config(self, channel: str) -> Dict[str, Any]:
        """
        Get configuration for a specific channel.
        
        Args:
            channel: Channel name ('sms' or 'web')
            
        Returns:
            Channel-specific configuration dictionary
        """
        resolved_channel = _resolve_requested_channel(channel)
        if not resolved_channel:
            supported_channels = ", ".join([f"'{c.value}'" for c in Channel])
            raise ValueError(
                f"Channel is required. Supported channels: {supported_channels}"
            )
        
        # Thread-safe cache check
        with self._config_lock:
            cached_config = self._channel_configs.get(resolved_channel)
        if cached_config:
            return cached_config
        
        # Load channel config
        self.reload(channel=resolved_channel)
        return self._channel_configs.get(resolved_channel, self._config)


_CONFIG = Config()
config = _CONFIG.data


def reload_config(channel: Optional[str] = None) -> Dict[str, Any]:
    """
    Reload configuration, optionally for a specific channel.
    
    Args:
        channel: Optional channel name ('sms' or 'web')
        
    Returns:
        Configuration dictionary
    """
    _CONFIG.reload(channel=channel)
    return _CONFIG.data


def get_config(channel: Optional[str] = None) -> Dict[str, Any]:
    """
    Get configuration, optionally for a specific channel.
    
    Args:
        channel: Optional channel name ('sms' or 'web')
        
    Returns:
        Configuration dictionary
    """
    resolved_channel = _resolve_requested_channel(channel)
    if resolved_channel:
        return _CONFIG.get_channel_config(resolved_channel)
    return _CONFIG.data


def get_llm_config(channel: Optional[str] = None) -> Dict[str, Any]:
    return dict(get_config(channel=channel).get("llm") or {})


def get_language_config(channel: Optional[str] = None) -> Dict[str, Any]:
    return dict(get_config(channel=channel).get("language") or {})


def build_llm_url(path_key: str, channel: Optional[str] = None) -> str:
    """Build a full Horizon API URL from a llm config path key, appending qos and reasoning query params, plus preview only when enabled."""
    llm_config = get_llm_config(channel=channel)
    base_url = llm_config.get("base_url", "").rstrip("/")
    path = llm_config.get(path_key, "")
    url = base_url + path
    query_params = {
        "qos": llm_config["qos"],
        "reasoning": str(llm_config["reasoning"]).lower(),
    }
    parsed = urlparse(url)
    new_query = (parsed.query + "&" + urlencode(query_params)) if parsed.query else urlencode(query_params)
    return urlunparse(parsed._replace(query=new_query))


def get_llm_base_url(channel: Optional[str] = None) -> str:
    base_url = get_llm_config(channel=channel).get("base_url") or get_env_var("HORIZON_BASE_URL", default=None)
    if isinstance(base_url, str):
        normalized_base_url = base_url.strip().rstrip("/")
        if normalized_base_url and not normalized_base_url.startswith("${"):
            return normalized_base_url
    raise ValueError("LLM base_url is missing. Provide it from channel config ('sms' or 'web').")


def get_gateway_agent_config(channel: Optional[str] = None) -> Dict[str, Any]:
    return dict(_get_effective_config(channel=channel).get("gateway_agent") or {})


def _get_effective_config(channel: Optional[str] = None) -> Dict[str, Any]:
    resolved_channel = _resolve_requested_channel(channel)
    if resolved_channel:
        return _CONFIG.get_channel_config(resolved_channel)
    if _CONFIG.data:
        return _CONFIG.data
    return {}


def get_logging_level(default: str = "INFO") -> str:
    logging_cfg = _get_effective_config().get("logging") or {}
    return str(logging_cfg.get("level", default)).upper()


def get_session_settings() -> Dict[str, Any]:
    gateway_cfg = get_gateway_agent_config()
    env_override = os.getenv("GATEWAY_SESSION_ENABLED")
    session_enabled = _parse_bool(env_override if env_override is not None else gateway_cfg.get("session_enabled"), True)

    session_dir_value = gateway_cfg.get("session_dir")
    resolved_dir: Optional[Path] = None
    if session_enabled and session_dir_value:
        resolved_dir = Path(session_dir_value).expanduser().resolve()
        resolved_dir.mkdir(parents=True, exist_ok=True)

    return {
        "enabled": session_enabled,
        "dir": resolved_dir,
    }


def get_gateway_api_key(channel: Optional[str] = None) -> Optional[str]:
    resolved_channel = _resolve_requested_channel(channel)
    if not resolved_channel:
        return None
    gateway_cfg = get_gateway_agent_config(channel=resolved_channel)
    api_key = gateway_cfg.get("api_key")
    if api_key:
        return str(api_key)
    return None


def get_gateway_agent_url(default: Optional[str] = None, channel: Optional[str] = None) -> Optional[str]:
    if channel is None:
        raise ValueError("channel is required")
    gateway_cfg = get_gateway_agent_config(channel=channel)
    url = gateway_cfg.get("url")
    if url:
        return str(url)
    return default


def get_fastapi_root_path() -> str:
    return "/virtual-assistant"


def get_cors_allow_origins(default: Optional[Iterable[str]] = None) -> list[str]:
    common_cfg = _get_effective_config().get("common") or {}
    origins = common_cfg.get("cors_allow_origins")
    if isinstance(origins, str):
        return [origin.strip() for origin in origins.split(",") if origin.strip()]
    if isinstance(origins, Iterable):
        return [str(origin) for origin in origins]
    return list(default or ["*"])


def get_authorization_token_config(channel: Optional[str] = None) -> Dict[str, Any]:
    """
    Get authorization token configuration, optionally for a specific channel.
    
    Args:
        channel: Optional channel name ('sms' or 'web')
        
    Returns:
        Authorization token configuration dictionary
    """
    resolved_channel = _resolve_requested_channel(channel)
    authorization_token_config = dict(get_config(channel=resolved_channel).get("authorization_token_config") or {})

    if resolved_channel and (
        not authorization_token_config.get("api_key") or not authorization_token_config.get("authorization")
    ):
        _CONFIG.reload(channel=resolved_channel)
        authorization_token_config = dict(
            _CONFIG.get_channel_config(resolved_channel).get("authorization_token_config") or {}
        )

    return authorization_token_config


def get_oauth_config(channel: Optional[str] = None) -> Dict[str, Any]:
    """
    Get OAuth configuration, optionally for a specific channel.
    
    Args:
        channel: Optional channel name ('sms' or 'web')
        
    Returns:
        OAuth configuration dictionary
    """
    return dict(get_config(channel=channel).get("oauth") or {})


def get_s3_config(channel: Optional[str] = None) -> Dict[str, Any]:
    """
    Get S3 configuration, optionally for a specific channel.
    Returns a dict with optional keys: bucket_name, region, prefix.
    """
    cfg = get_config(channel=channel)
    s3_cfg = dict(cfg.get("s3") or {})
    return s3_cfg


def get_protegrity_config(channel: Optional[str] = None) -> Dict[str, Any]:
    """
    Get Protegrity Protector Lambda configuration.
    Returns a dict with optional keys: lambda_arn, user, region, data_element, timeout_seconds,
    retry_max_attempts.
    Unresolved ${ENV_VAR} placeholders are treated as unset.
    """
    cfg = get_config(channel=channel)
    raw = dict(cfg.get("protegrity") or {})
    resolved: Dict[str, Any] = {}
    for key, value in raw.items():
        if isinstance(value, str) and _ENV_PLACEHOLDER.fullmatch(value.strip()):
            continue
        resolved[key] = value
    return resolved


def get_findcare_config(channel: Optional[str] = None) -> Dict[str, Any]:
    """Get findcare configuration including provider_search_distance."""
    return dict(get_config(channel=channel).get("findcare") or {})


def get_soa_config(channel: Optional[str] = None) -> Dict[str, Any]:
    return dict(get_config(channel=channel).get("soa_sydney_api") or {})


def get_soa_digitalproduct_config(channel: Optional[str] = None) -> Dict[str, Any]:
    return dict(get_config(channel=channel).get("digital_products_api") or {})

  
def get_claims_explainability_config(channel: Optional[str] = None) -> Dict[str, Any]:
    return dict(get_config(channel=channel).get("claims_explainability") or {})


def get_pharmacy_config(channel: Optional[str] = None) -> Dict[str, Any]:
    """Get pharmacy API config — base_url and api_key from soa_sydney_api (single source of truth)."""
    cfg = get_config(channel=channel)
    soa_cfg = dict(cfg.get("soa_sydney_api") or {})
    pharmacy_cfg = dict(cfg.get("pharmacy") or {})
    return {
        "base_url": soa_cfg.get("base_url", ""),
        "api_key": soa_cfg.get("api_key", ""),
        "skip_feature_check": _parse_bool(pharmacy_cfg.get("skip_feature_check"), default=False),
        "timeout_seconds": int(pharmacy_cfg.get("timeout_seconds", 120)),
        "orders_endpoint": soa_cfg.get("pharmacy_orders_endpoint", "/v4/pharmacy/orders/{member_id}"),
        "order_detail_endpoint": soa_cfg.get("pharmacy_order_detail_endpoint", "/v4/pharmacy/orders/{member_id}/{order_id}"),
        "outstanding_balance_endpoint": soa_cfg.get("pharmacy_outstanding_balance_endpoint", "/v4/pharmacy/payment/{member_id}/outstandingBalance"),
    }


def get_membership_api_config(channel: Optional[str] = None) -> Dict[str, Any]:
    """Get membership/feature-flag API config — reads from dcs_sydney_api (single source of truth)."""
    cfg = get_config(channel=channel)
    dcs_cfg = dict(cfg.get("dcs_sydney_api") or {})
    oauth_cfg = dict(cfg.get("oauth") or {})
    return {
        "base_url": dcs_cfg.get("base_url", ""),
        "api_key": dcs_cfg.get("api_key") or oauth_cfg.get("api_key", ""),
        "bootstrap_path": dcs_cfg.get("bootstrap_endpoint", "/member/secure/api/tcp/membership/member/chat/bootstrap"),
        "filtered_features_path": dcs_cfg.get("filtered_features_endpoint", "/member/secure/api/tcp/membership/v2/filteredFeatures"),
    }
def get_redis_config(channel: Optional[str] = None) -> Dict[str, Any]:
    """Get Redis configuration from sms-settings.yaml"""
    return dict(get_config(channel=channel).get("redis") or {})


def get_authentication_config(channel: Optional[str] = None) -> Dict[str, Any]:
    """Get authentication configuration from sms-settings.yaml"""
    return dict(get_config(channel=channel).get("authentication") or {})


def get_escalation_summary_config(channel: Optional[str] = None) -> Dict[str, Any]:
    """Get escalation summary configuration from settings.yaml"""
    auth_config = get_authentication_config(channel=channel)
    return dict(auth_config.get("escalation_summary") or {})


async def build_llm_model(channel: Optional[str] = None):
    resolved_channel = _resolve_requested_channel(channel)
    if not resolved_channel:
        raise ValueError("LLM channel is missing. Provide a valid channel ('sms' or 'web').")
    llm_cfg = get_llm_config(channel=resolved_channel)
    if not llm_cfg:
        raise ValueError(
            f"LLM configuration is missing for channel '{resolved_channel}'. Check the {resolved_channel}-settings.yaml file."
        )
    raw_org = llm_cfg.get("org")
    if isinstance(raw_org, str) and raw_org.strip().startswith("${") and raw_org.strip().endswith("}"):
        raw_org = None
    org = str(raw_org or "horizon").lower()
    if org == "horizon":
        from models.horizon.horizon_model import HorizonModel
        from utils.horizon.horizon_token_utils import get_horizon_access_token_async

        token = await get_horizon_access_token_async(channel=resolved_channel)
        base_url = get_llm_base_url(channel=resolved_channel)
        model_id = llm_cfg.get("model_id", "horizon-llm-v2")
        temperature = float(llm_cfg.get("temperature", 0))
        return HorizonModel(
            token,
            model_id=model_id,
            temperature=temperature,
            base_url=base_url,
            channel=resolved_channel,
        )
    raise ValueError(f"Unsupported LLM org '{org}'")


def build_llm_model_sync(channel: Optional[str] = None):
    """Sync wrapper for build_llm_model for callers outside an event loop."""
    return asyncio.run(build_llm_model(channel))

def get_feature_flags(channel: Optional[str] = None) -> Dict[str, Any]:
    """Get feature flags configuration."""
    return dict(get_config(channel=channel).get("feature_flags") or {})


def get_a2a_agents_config() -> Dict[str, Any]:
    """Get a2a_agents section from common-config.yaml.
    Returns a dict of agent_id -> {base_url, ...}.
    Reads common-config.yaml directly since this section is channel-independent.
    """
    common_path = _project_root / "config" / "common-config.yaml"
    try:
        with common_path.open(encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        return dict(data.get("a2a_agents") or {})
    except Exception:
        return {}


def get_gateway_base_url() -> Optional[str]:
    """Get gateway_agent.url from common-config.yaml.
    Reads common-config.yaml directly since gateway URL is channel-independent.
    """
    common_path = _project_root / "config" / "common-config.yaml"
    try:
        with common_path.open(encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        return (data.get("gateway_agent") or {}).get("url")
    except Exception:
        return None



def get_dcs_sydney_config(channel: Optional[str] = None) -> Dict[str, Any]:
    """Get DCS Sydney API configuration."""
    return dict(get_config(channel=channel).get("dcs_sydney_api") or {})


def get_chat_availability_config(channel: Optional[str] = None) -> Dict[str, Any]:
    """Get chat availability configuration from environment.yaml"""
    return dict(get_config(channel=channel).get("chat_availability") or {})


def get_clara_api_auth_config(channel: Optional[str] = None) -> Dict[str, Any]:
    """Get Clara API authentication configuration."""
    return dict(get_config(channel=channel).get("clara_api_auth") or {})


def get_tmv_config(channel: str) -> Dict[str, Any]:
    """
    Get TMV/Clara API configuration.
    Uses dynamic config loader which automatically builds full URLs from base_url + endpoints.
    
    Args:
        channel: Channel name ('sms' or 'web') - REQUIRED
        
    Returns:
        Dictionary with Clara API configuration including:
        - base_url: Clara API base URL
        - token_url: Full token URL (base_url + token_endpoint)
        - a2a_agents_url: Full A2A agents URL (base_url + a2a_agents_endpoint)
        - timeout_seconds: Request timeout
        - api_key: API key from channel-specific config
        
    Raises:
        ValueError: If channel is not provided or invalid
    """
    if not channel:
        raise ValueError("Channel is required for TMV config. Provide 'sms' or 'web'.")
    
    # Get Clara API config using dynamic config loader (same pattern as get_dcs_sydney_config)
    cfg = get_config(channel=channel)
    clara_config = dict(cfg.get("clara_api_auth") or {})
    
    # Validate that config was loaded
    if not clara_config:
        raise ValueError(
            f"clara_api_auth configuration not found for channel '{channel}'. "
            f"Check that common-config.yaml and {channel}/environments.yaml have clara_api_auth section."
        )
    
    # Build configuration
    # Note: config loader converts *_endpoint to *_url (base_url + endpoint)
    base_url = clara_config.get("base_url", "").rstrip("/")
    token_url = clara_config.get("token_url", "")  # Already built by config loader
    a2a_agents_url = clara_config.get("a2a_agents_url", "")  # Already built by config loader
    timeout_seconds = clara_config.get("timeout_seconds", 60)
    api_key = clara_config.get("api_key", "")
    
    return {
        "base_url": base_url,
        "token_url": token_url,
        "a2a_agents_url": a2a_agents_url,
        "timeout_seconds": timeout_seconds,
        "api_key": api_key,
    }


def get_a2a_agents_config() -> Dict[str, Any]:
    """Get a2a_agents section from common-config.yaml.
    Returns a dict of agent_id -> {base_url, ...}.
    Reads common-config.yaml directly since this section is channel-independent.
    """
    common_path = _project_root / "config" / "common-config.yaml"
    try:
        with common_path.open(encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        return dict(data.get("a2a_agents") or {})
    except Exception:
        return {}

===========================================================================================================

"""Project-wide constants for the AWS Strands Gateway Agent."""

FIVE_W_EXTENSION_URI = "https://github.com/exponential-engineering/a2a-5w/v0.1"
FIVE_W_EXTENSION_HEADER = "X-A2A-Extensions"

===========================================================================================================

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List


@dataclass
class ClientActionRequiredError(Exception):
    """Signals that the Gateway should return a 5W input-required response to the caller."""

    message: str
    missing_fields: List[str] = field(default_factory=list)
    required_fields: List[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        super().__init__(self.message)


@dataclass
class LongRunningTaskScheduledError(Exception):
    """Raised when a request transitions into async processing."""

    task_id: str

    def __post_init__(self) -> None:
        super().__init__(self.task_id)

=====================================================================================================

from __future__ import annotations

import logging
from collections.abc import Generator
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse

from agents.gateway.a2a.agent_proxy import registry as _agent_registry
from agents.gateway.a2a.responses import attach_history
from agents.gateway.agents.benefits_explainability_agent import (
    BenefitsExplainabilityAgent,
)
from agents.gateway.agents.gateway import GatewayAgent
from agents.gateway.config import (
    get_fastapi_root_path,
    get_logging_level,
    get_session_settings,
)
from agents.gateway.constants import FIVE_W_EXTENSION_URI
from agents.gateway.exceptions import LongRunningTaskScheduledError
from agents.gateway.handlers.auth import (
    extract_and_set_request_context,
    extract_meta_trans_id,
    validate_request_headers,
)
from agents.gateway.handlers.request import (
    build_task_context,
    parse_a2a_request,
    validate_request_context,
)
from agents.gateway.handlers.response import (
    build_streaming_response as build_streaming_response_handler,
)
from agents.gateway.handlers.response import handle_gateway_exception
from agents.gateway.services.request_guard import (
    build_gateway_response,
    respond_with_extension,
)
from agents.gateway.services.request_validation import configure_domain_validators
from agents.gateway.services.task_store import TaskStore
from utils.shared.redis_cache import get_cache_client

logging.basicConfig(
    level=getattr(logging, get_logging_level(), logging.INFO),
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="AWS Strands Gateway Agent",
    version="0.1.0",
    description="FastAPI wrapper that exposes the Gateway Agent over HTTP for A2A-compliant requests.",
    root_path=get_fastapi_root_path(),
)

_session_settings = get_session_settings()
_task_store = TaskStore()

# Initialize Redis cache client (reads config from settings.yaml)
logger.info("[STARTUP] Initializing Redis cache client...")
_redis_cache = get_cache_client()
if _redis_cache:
    logger.info(f"[STARTUP] Redis cache initialized: {_redis_cache.get_stats()}")

_benefits_explainability_agent = BenefitsExplainabilityAgent()
_gateway = GatewayAgent(
    benefits_explainability_agent=_benefits_explainability_agent,
)

configure_domain_validators()


@app.on_event("startup")
async def _load_agent_registry() -> None:
    """Fetch agent cards from all A2A_AGENT_URLS and build the domain map."""
    await _agent_registry.load()


@app.get("/health", tags=["system"])
async def health() -> dict[str, Any]:
    """Health check endpoint with Redis status."""
    redis_health = _redis_cache.health_check()
    return {
        "status": "ok",
        "redis": redis_health
    }


@app.get("/agents", tags=["discovery"])
async def list_agents() -> JSONResponse:
    """Re-fetch all agent cards live and return full details."""
    await _agent_registry.load()
    agents = await _agent_registry.get_agents()
    return JSONResponse({"total": len(agents), "agents": agents})


@app.post("/agents/reload", tags=["discovery"])
async def reload_agents() -> JSONResponse:
    """Re-run agent discovery — fetch cards from all configured A2A agent URLs."""
    await _agent_registry.load()
    agents = await _agent_registry.get_agents()
    return JSONResponse({"reloaded": True, "total": len(agents), "agents": [a["id"] for a in agents]})


@app.get("/agents/{agent_id}/card", tags=["discovery"])
async def get_agent_card(agent_id: str) -> JSONResponse:
    """Proxy-fetch the live agent card from the registered agent's server."""
    agent = _agent_registry.get_by_id(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found in registry")
    try:
        import httpx as _httpx
        async with _httpx.AsyncClient(timeout=3.0, verify=False) as client:
            resp = await client.get(agent["card_url"])
            resp.raise_for_status()
            card = resp.json()
        return JSONResponse({"agent_id": agent_id, "source_url": agent["card_url"], "card": card})
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Agent '{agent_id}' unreachable: {exc}")

@app.post("/a2a", tags=["gateway"])
async def invoke_gateway(payload: dict, request: Request) -> JSONResponse:
    """Handle incoming AWS Strands A2A requests."""
    # Extract and set request context
    extract_and_set_request_context(request)
    meta_trans_id = extract_meta_trans_id(request)
    
    # Log incoming request
    logger.info("[SERVER] Received A2A request - meta_trans_id=%s, method=%s", meta_trans_id, payload.get("method"))
    
    # Parse A2A request
    parsed_context, request_method, _ = parse_a2a_request(payload, request, logger)
    
    # Update meta_trans_id if message_id is present
    if parsed_context.message_id:
        meta_trans_id = parsed_context.message_id
    
    # Validate request headers (API key and extension)
    validate_request_headers(request, parsed_context, meta_trans_id, logger)
    
    # Build task context and history
    task_id, history = build_task_context(parsed_context, meta_trans_id, _session_settings)
    
    # Validate context fields
    validation_response = validate_request_context(parsed_context, meta_trans_id, logger)
    if validation_response:
        attach_history(validation_response, history)
        return respond_with_extension(validation_response, FIVE_W_EXTENSION_URI)

    try:
        result = await _gateway.handle_request(
            payload,
            context=parsed_context,
            meta_trans_id=meta_trans_id,
        )
        ### ADDED: Log successful gateway processing
        logger.info(
            "[SERVER] Gateway processing complete - context_id=%s, has_summary=%s, meta_trans_id=%s",
            parsed_context.context_id,
            result.summary_text is not None,
            meta_trans_id
        )
    except LongRunningTaskScheduledError as task_exc:
        logger.info("[SERVER] Long-running task scheduled - task_id=%s", task_exc.task_id)
        response_body = _task_store.build_response(task_exc.task_id, request_id=payload.get("id") or meta_trans_id)
        if not response_body:
            raise HTTPException(status_code=500, detail="Task scheduling failed.")
        return respond_with_extension(response_body, FIVE_W_EXTENSION_URI)
    except Exception as exc:  # pragma: no cover - centralized error handling
        logger.error("[SERVER] Gateway processing failed - error=%s, meta_trans_id=%s", str(exc), meta_trans_id)
        # Extract language from context metadata
        language = "en"  # Default to English
        if hasattr(parsed_context, 'metadata') and parsed_context.metadata:
            language = parsed_context.metadata.get("language", "en")
            # Normalize language format (handle "English"/"Spanish" to "en"/"es")
            if isinstance(language, str):
                language_lower = language.lower()
                if language_lower in ["spanish", "español", "es"]:
                    language = "es"
                else:
                    language = "en"
        
        return handle_gateway_exception(
            exc,
            meta_trans_id=meta_trans_id,
            context_id=parsed_context.context_id,
            logger=logger,
            extension_uri=FIVE_W_EXTENSION_URI,
            language=language,
        )

    # Check if raw_payload is a generator (for direct streaming from agents like benefits)
    if isinstance(result.raw_payload, Generator):
        logger.info(
            "[SERVER] Detected generator in raw_payload, returning direct streaming response - context_id=%s",
            parsed_context.context_id
        )
        headers = {
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-A2A-Extensions": FIVE_W_EXTENSION_URI,
        }
        return StreamingResponse(
            result.raw_payload,
            media_type="text/event-stream",
            headers=headers
        )
    
    should_stream = request_method == "message/stream" or parsed_context.streaming_requested
    if should_stream:
        streaming_response = build_streaming_response_handler(
            parsed_context,
            result,
            history,
            meta_trans_id=meta_trans_id,
            task_id=task_id,
            request_id=payload.get("id"),
            extension_uri=FIVE_W_EXTENSION_URI,
        )
        if streaming_response:
            return streaming_response

    response_body = build_gateway_response(parsed_context, result, meta_trans_id=meta_trans_id)
    attach_history(response_body, history)
    return respond_with_extension(response_body, FIVE_W_EXTENSION_URI)


===============================================================================================================

import asyncio
import json
import os
import random
import time

from strands import Agent

from agents.agent_horizon import HealthCareAgent
from agents.demos.demo_handler import get_demo_handler
from agents.gateway.config import build_llm_model
from agents.orchestrate_horizon.orchestrator_horizon_constants import AgentNameMapping
from agents.planner_agent import PlannerAgent
from locales import en, es
from prompts.agent_prompts import load_channel_prompt
from tools.call_gateway_tool import call_gateway_agent
from tools.findcare_tool import call_findcare_tool
from utils.channel_adapters import get_channel_adapter
from utils.channel_auth import get_channel_auth
from utils.constants import Channel, Intent
from utils.image_upload import (
    get_upload_request_language,
    handle_upload_confirmation,
    handle_upload_request,
)
from utils.image_upload.document_handlers import process_healthcare_document
from utils.image_upload.upload_manager import IMAGE_UPLOAD_LOCALE_CATEGORY
from utils.language_utils import resolve_runtime_language
from utils.live_chat_integration_topic import setLiveChatTopic
from utils.locale_utils import get_localized_message
from utils.logging import get_logger
from utils.logging.request_context import RequestContext
from utils.memory.context_enrichment import get_context_enricher
from utils.memory.conversation_history import (
    format_previous_conversations,
    get_conversation_history_manager,
)
from utils.performance_testing import match_performance_intent
from utils.query_validator import OutputValidator
from utils.timing_utils import accumulate_agent_timing, init_agent_timings

logger = get_logger(__name__)


USE_HISTORY_FOR_FOLLOWUPS_AGENT_NAMES = {"BENEFITS_OVERVIEW", "REVIEW_PROVIDERS"}

class OrchestratorHorizonAgent:
    def __init__(self, model, system_prompt=None, channel: str = None):
        normalized_channel = (channel or "").strip().lower() or None
        self.channel = normalized_channel
        self.model=model
        # Load channel-specific prompt if not provided
        if system_prompt is None:
            system_prompt = load_channel_prompt(channel)
            logger.info(f"[ORCHESTRATOR] Loaded channel-specific prompt for channel={channel}")
        self.orchestrator = Agent(
            model=model,
            system_prompt=system_prompt,
            callback_handler=None,
        )
        self.history_manager = get_conversation_history_manager(channel=self.channel)
        self.context_enricher = get_context_enricher(model)

    async def detect_intent_and_call_agents(
        self,
        search_query: str,
        language: str = "en",
        member_id: str | None = None,
        channel: str | None = None,
        enable_query_validation: bool | None = None,
        locale: str = "en",
        session_id: str | None = None,
        conversation_id: str | None = None,
        message_id: str | None = None,
        authenticated: bool = False,
        hcid: str | None = None,
        skip_llm: bool = False
    ):
        """
        Detect intent and call appropriate agents.
        Now includes query validation to filter out non-healthcare queries.
        Includes memory management for conversation context.
        """
        total_start = time.time()
        language = resolve_runtime_language(language, channel=channel)
        RequestContext.set_language(language)
        # Set conversation_id and session_id in RequestContext for live chat escalation
        if conversation_id:
            RequestContext.set_conversation_id(conversation_id)
        if session_id:
            RequestContext.set_session_id(session_id)
        # ============================================================================
        # MEMORY MANAGEMENT: Check history and enrich query (ONLY for authenticated users)
        # ============================================================================
        original_query = search_query
        history = []
        latest_history_entry = {}
        latest_history_extra = {}
        # Check if we have conversation history (only for authenticated users)
        has_history = False
        if authenticated and (session_id or conversation_id or member_id):
            logger.info(f"[MEMORY] ===========================================")
            logger.info(f"[MEMORY] HISTORY LOOKUP (authenticated user)")
            logger.info(f"[MEMORY] Looking up by session_id: {session_id}")
            logger.info(f"[MEMORY] conversation_id (from auth): {conversation_id}")
            logger.info(f"[MEMORY] message_id (this request): {message_id}")
            logger.info(f"[MEMORY] member_id (fallback): {member_id}")
            has_history = self.history_manager.has_history(
                session_id=session_id,
                conversation_id=conversation_id,
                member_id=member_id
            )
            if has_history:
                logger.info(f"[MEMORY] Found existing history for session_id: {session_id}")
                # Retrieve last 10 conversations
                history = self.history_manager.get_conversation_history(
                    session_id=session_id,
                    conversation_id=conversation_id,
                    member_id=member_id,
                    limit=10
                )
                if history:
                    latest_history_entry = history[0]
                    latest_history_extra = latest_history_entry.get("extra_data") or latest_history_entry
                logger.info(f"[MEMORY] Retrieved {len(history)} conversation(s) from Redis/in-memory")
                for idx, entry in enumerate(history[-5:], 1):  # Show last 5
                    logger.info(f"[MEMORY]   Entry {idx}: '{entry.get('query', '')[:40]}...' intent={entry.get('intent', 'N/A')}")
            else:
                logger.info(f"[MEMORY] No history found - First message for session_id: {session_id}")
            logger.info(f"[MEMORY] ===========================================")
        elif not authenticated:
            logger.info("[MEMORY] Skipping history lookup - user not authenticated")
            print(f"[MEMORY] Skipping conversation history - user not authenticated")
        else:
            logger.info("[MEMORY] No identifiers provided - skipping memory management")
        # ============================================================================
        # DEMO LAYER: Check BEFORE query enrichment (saves LLM call for demo users)
        # Demo handler uses original_query and raw history, not enriched query
        # CRITICAL: Skip entirely in PROD environment
        # ============================================================================
        demo_response = await self._try_demo_handler(
            member_id=member_id,
            hcid=hcid,
            original_query=original_query,
            language=language,
            history=history,
            channel=channel,
            authenticated=authenticated,
            session_id=session_id,
            conversation_id=conversation_id
        )
        if demo_response:
            return demo_response
        # ============================================================================
        # CLARIFICATION ESCALATION: if last turn was a pending clarification and user
        # replied affirmatively ("yes"), escalate to LIVE_AGENT without calling the LLM.
        # Must run BEFORE query enrichment to avoid awaiting an unmocked coroutine in tests.
        # ============================================================================
        if authenticated and has_history and history:
            if latest_history_extra.get("clarification_state") == "asked":
                affirmative = original_query.strip().lower() in {"yes", "y", "1", "ok", "okay", "sure"}
                if affirmative:
                    locale_data = es.LOCALES if language == "es" else en.LOCALES
                    live_agent_text = locale_data.get("general", {}).get("live_agent_offer_response", "Would you like to connect with a live agent?")
                    logger.info(f"[ORCHESTRATOR] Clarification escalation: user confirmed — routing to {Intent.LIVE_CHAT.value}")
                    self._save_history_entry(
                        session_id=session_id,
                        conversation_id=conversation_id,
                        member_id=member_id,
                        query=original_query,
                        response_summary=live_agent_text,
                        intent=Intent.LIVE_CHAT.value,
                        extra_data={
                            "clarification_state": "answered",
                            "clarification_type": latest_history_extra.get("clarification_type"),
                            "clarification_question": latest_history_extra.get("clarification_question") or latest_history_entry.get("response_summary", ""),
                            "clarification_answer": original_query.strip(),
                            "clarification_resolution": Intent.LIVE_CHAT.value,
                        },
                    )
                    return OutputValidator.validate_response({
                        "title": locale_data.get("general", {}).get("title", "Response"),
                        "response_summary": live_agent_text,
                        "full_summary": live_agent_text,
                        "sms_summary": live_agent_text,
                        "language_code": language,
                        "primary_intent": Intent.LIVE_CHAT.value,
                        "secondary_intent": None,
                        "blocks": [],
                        "intent_response": None,
                        "timings": {"Intent detection": 0, "Total": round(time.time() - total_start, 3)},
                        "intent_time": 0,
                        "benefits_time": 0,
                        "findcare_time": 0,
                        "gateway_time": 0,
                        "claim_explainability_time": 0,
                        "pharmacy_time": 0,
                        "spending_account_time": 0,
                        "prior_auth_time": 0,
                        "id_card_time": 0,
                        "document_time": 0,
                        "summarization_time": 0,
                        "total_time": time.time() - total_start,
                    }, locale=locale)

        # ============================================================================
        # QUERY ENRICHMENT
        # ============================================================================
        if authenticated and has_history:
            logger.info("===== BEFORE QUERY ENRICHMENT =====")
            logger.info(f"USER QUERY: {original_query}")
            logger.info(f"SEARCH QUERY BEFORE ENRICH: {search_query}")
            print("===== BEFORE QUERY ENRICHMENT =====")
            print(f"USER QUERY: {original_query}")
            print(f"SEARCH QUERY BEFORE ENRICH: {search_query}")
            # Enrich query with context
            search_query = await self.context_enricher.enrich_query(
                current_query=original_query,
                conversation_history=history,
                channel=channel,
                member_id=member_id,
            )
            logger.info(f"[MEMORY] Query enriched with conversation context")
            logger.info(f"[MEMORY] Original query: {original_query}")
            logger.info(f"[MEMORY] Enriched query: {search_query}")

        # Track which query to use for processing
        processed_query = search_query
        enriched_query = processed_query#search_query
        history_query_to_store = original_query
        history_extra_query_data = None
        if latest_history_extra.get("clarification_state") == "asked":
            normalized_original_query = original_query.strip()
            normalized_processed_query = search_query.strip()
            if normalized_processed_query and normalized_processed_query != normalized_original_query:
                history_extra_query_data = {
                    "clarification_processed_query": normalized_processed_query,
                }
        else:
            history_query_to_store = search_query
        if skip_llm:
            matched_intent = match_performance_intent(search_query)
            if matched_intent is not None:
                _delay = random.uniform(5, 12)
                logger.info(f"[PERF] Fuzzy match → intent='{matched_intent}', simulated_delay={_delay:.2f}s")
                await asyncio.sleep(_delay)
                return OutputValidator.validate_response({
                    "title": f"[PERF TEST] {matched_intent}",
                    "response_summary": f"Performance test matched intent: {matched_intent}",
                    "full_summary": f"Performance test matched intent: {matched_intent}",
                    "sms_summary": f"[PERF] {matched_intent}",
                    "language_code": language,
                    "primary_intent": matched_intent,
                    "secondary_intent": None,
                    "blocks": [],
                    "intent_response": None,
                    "timings": {"Intent detection": round(_delay, 3), "Total": round(_delay, 3)},
                    "intent_time": _delay,
                    "benefits_time": 0,
                    "findcare_time": 0,
                    "gateway_time": 0,
                    "claim_explainability_time": 0,
                    "pharmacy_time": 0,
                    "spending_account_time": 0,
                    "prior_auth_time": 0,
                    "id_card_time": 0,
                    "document_time": 0,
                    "claims_submission_time": 0,
                    "plan_info_time": 0,
                    "summarization_time": 0,
                    "total_time": _delay,
                }, locale=locale)
            logger.info("[PERF] No fuzzy match found — returning controlled no-match response")
            return OutputValidator.validate_response({
                "title": "[PERF TEST] No Match",
                "response_summary": "Performance test: no intent matched for this query.",
                "full_summary": "Performance test: no intent matched for this query.",
                "sms_summary": "[PERF] No match",
                "language_code": language,
                "primary_intent": "UNIDENTIFIED",
                "secondary_intent": None,
                "blocks": [],
                "intent_response": None,
                "timings": {"Total": 0},
                "intent_time": 0,
                "benefits_time": 0,
                "findcare_time": 0,
                "gateway_time": 0,
                "claim_explainability_time": 0,
                "pharmacy_time": 0,
                "spending_account_time": 0,
                "prior_auth_time": 0,
                "id_card_time": 0,
                "document_time": 0,
                "claims_submission_time": 0,
                "plan_info_time": 0,
                "summarization_time": 0,
                "total_time": 0,
            }, locale=locale)
        # Call LLM directly to see raw response
        try:
            # Format previous 2 conversations for context
            previous_conversations = format_previous_conversations(history, max_conversations=2)
            
            # Build enriched query with previous 2 conversation history
            enriched_query_prev_chat = enriched_query
            if previous_conversations:
                enriched_query_prev_chat = f"{enriched_query}\n\n## PREVIOUS CONVERSATIONS (for clarification context)\n{previous_conversations}"
            
            # Use the agent's method to get raw response
            response = self.orchestrator.structured_output(
                output_model=HealthCareAgent,
                prompt=enriched_query_prev_chat
            )
            # Log the parsed response
            print(f"[ORCHESTRATOR DEBUG] LLM Response received")
            response_dict = response.model_dump() if hasattr(response, 'model_dump') else vars(response)
            print(f"[ORCHESTRATOR DEBUG] LLM Response keys: {list(response_dict.keys())}")
            print(f"[ORCHESTRATOR DEBUG] member_name_filter in response: {'member_name_filter' in response_dict}")
            print(f"[ORCHESTRATOR DEBUG] member_name_filter value: {response_dict.get('member_name_filter')}")
        except Exception as e:
            logger.info(f"[ORCHESTRATOR DEBUG] Error during LLM call: {e}")
            raise
        intent_time = round(time.time() - total_start, 3)
        selected_language = resolve_runtime_language(getattr(response, 'language', language), channel=channel)
        try:
            # Keep downstream planner/localization on English-only mode for now even
            # if Horizon returns Spanish in the structured intent response.
            setattr(response, 'language', selected_language)
        except (AttributeError, TypeError, ValueError):
            logger.warning("[ORCHESTRATOR] Unable to override response.language; using selected language only")
        RequestContext.set_language(selected_language)
        primary_intent = getattr(response, 'primary_intent', None)
        secondary_intent = getattr(response, 'secondary_intent', None)
        logger.info(f"[ORCHESTRATOR] Intent detection completed in {intent_time}s")
        claim_type_filter = getattr(response, 'claim_type_filter', None)
        if claim_type_filter:
            logger.info(f"[ORCHESTRATOR] Filter Subintent: {claim_type_filter}")
        member_name_filter = getattr(response, 'member_name_filter', None)
        if member_name_filter:
            logger.info(f"[ORCHESTRATOR] Member Name Filter: {member_name_filter}")
        else:
            logger.debug(f"[ORCHESTRATOR] Member Name Filter is NULL - LLM did not detect member name")
            logger.debug(f"[ORCHESTRATOR] Checking if field exists in response object: {hasattr(response, 'member_name_filter')}")
        provider_name_filter = getattr(response, 'provider_name_filter', None)
        if provider_name_filter:
            logger.info(f"[ORCHESTRATOR] Provider Name Filter: {provider_name_filter}")
        else:
            logger.debug(f"[ORCHESTRATOR] Provider Name Filter is NULL - LLM did not detect provider name")
        network_filter = getattr(response, 'network_filter', None)
        if network_filter:
            logger.info(f"[ORCHESTRATOR] Network Filter : {network_filter}")
        else:
            logger.debug(f"[ORCHESTRATOR] Network Filter is NULL - LLM did not detect network preference")
        logger.info(f"[ORCHESTRATOR] Primary Intent: {primary_intent}")
        if secondary_intent:
            logger.info(f"[ORCHESTRATOR] Secondary Intent: {secondary_intent}")
        clarification_question = getattr(response, 'clarification_question', None)
        confidence = float(getattr(response, 'confidence', 0) or 0)
        if clarification_question and confidence < 0.6:
            logger.info(
                f"[ORCHESTRATOR] Returning clarification response for ambiguous low-confidence intent: {clarification_question}"
            )
            clarification_text = str(clarification_question).strip()
            clarification_block = {
                "success": True,
                "extracted_text": clarification_text,
                "requires_selection": True,
                "_agent_name": "CLARIFICATION",
                "_agent_label": "Clarification Response",
                "_intent_priority": "primary",
            }
            self._save_history_entry(
                session_id=session_id,
                conversation_id=conversation_id,
                member_id=member_id,
                query=history_query_to_store,
                response_summary=clarification_text,
                intent=primary_intent,
                extra_data={
                    "clarification_state": "asked",
                    "clarification_type": "choice",
                    "clarification_question": clarification_text,
                    **({
                        "clarification_previous_question": latest_history_extra.get("clarification_question") or latest_history_entry.get("response_summary", ""),
                        "clarification_answer": original_query.strip(),
                    } if latest_history_extra.get("clarification_state") == "asked" else {}),
                    **(history_extra_query_data or {}),
                },
            )
            return OutputValidator.validate_response({
                "title": "Clarification",
                "response_summary": clarification_text,
                "full_summary": clarification_text,
                "sms_summary": clarification_text,
                "language_code": selected_language,
                "primary_intent": primary_intent,
                "secondary_intent": secondary_intent,
                "blocks": [clarification_block],
                "intent_response": response,
                "timings": {
                    "Intent detection": round(intent_time, 3),
                    "Total": round(time.time() - total_start, 3),
                },
                "intent_time": intent_time,
                "benefits_time": 0,
                "findcare_time": 0,
                "gateway_time": 0,
                "claim_explainability_time": 0,
                "pharmacy_time": 0,
                "spending_account_time": 0,
                "prior_auth_time": 0,
                "id_card_time": 0,
                "document_time": 0,
                "summarization_time": 0,
                "total_time": time.time() - total_start,
            }, locale=locale)
        routing_text = (getattr(response, 'routing_response', None) or "").strip()
        if primary_intent == "unidentified" and routing_text and not clarification_question:
            locale_data = es.LOCALES if selected_language == "es" else en.LOCALES
            logger.info("[ORCHESTRATOR] Unidentified intent with direct routing response — returning without downstream planning")
            return OutputValidator.validate_response({
                "title": locale_data.get("general", {}).get("title", "Response"),
                "response_summary": routing_text,
                "full_summary": routing_text,
                "sms_summary": routing_text,
                "language_code": selected_language,
                "primary_intent": primary_intent,
                "secondary_intent": None,
                "blocks": [],
                "intent_response": response,
                "timings": {"Intent detection": round(intent_time, 3), "Total": round(time.time() - total_start, 3)},
                "intent_time": intent_time,
                "benefits_time": 0,
                "findcare_time": 0,
                "gateway_time": 0,
                "claim_explainability_time": 0,
                "pharmacy_time": 0,
                "spending_account_time": 0,
                "prior_auth_time": 0,
                "id_card_time": 0,
                "document_time": 0,
                "summarization_time": 0,
                "total_time": time.time() - total_start,
            }, locale=locale)
        # GREETING fast-path: return routing_response (or localized fallback) immediately
        if primary_intent == "GREETING":
            locale_data = es.LOCALES if selected_language == "es" else en.LOCALES
            localized_greeting = get_localized_message("general", "greeting_response", selected_language)
            localized_thanks = get_localized_message("general", "thanks_response", selected_language)
            normalized_routing_text = " ".join((routing_text or "").strip().lower().split())
            known_thanks_responses = {
                " ".join(str(text).strip().lower().split())
                for text in (
                    en.LOCALES.get("general", {}).get("thanks_response", ""),
                    es.LOCALES.get("general", {}).get("thanks_response", ""),
                )
                if text
            }
            if normalized_routing_text in known_thanks_responses and localized_thanks:
                routing_text = localized_thanks
            elif localized_greeting:
                routing_text = localized_greeting
            logger.info(f"[ORCHESTRATOR] GREETING intent — returning routing response directly")
            return OutputValidator.validate_response({
                "title": locale_data.get("general", {}).get("title", "Response"),
                "response_summary": routing_text,
                "full_summary": routing_text,
                "sms_summary": routing_text,
                "language_code": selected_language,
                "primary_intent": "GREETING",
                "secondary_intent": None,
                "blocks": [],
                "intent_response": response,
                "timings": {"Intent detection": round(intent_time, 3), "Total": round(time.time() - total_start, 3)},
                "intent_time": intent_time,
                "benefits_time": 0,
                "findcare_time": 0,
                "gateway_time": 0,
                "claim_explainability_time": 0,
                "pharmacy_time": 0,
                "spending_account_time": 0,
                "prior_auth_time": 0,
                "id_card_time": 0,
                "document_time": 0,
                "summarization_time": 0,
                "total_time": time.time() - total_start,
            }, locale=locale)

        # Log BillPay type if detected
        billpay_type = getattr(response, 'billpay_type', None)
        logger.info(f"[ORCHESTRATOR] BillPay Type from LLM: {billpay_type!r}")
        logger.info(f"[ORCHESTRATOR] DEBUG: channel parameter received: {repr(channel)}")
        print(f"[ORCHESTRATOR] DEBUG: channel parameter received: {repr(channel)}")
        normalized_channel = (channel or "").strip().lower() or None
        print(f"[ORCHESTRATOR] DEBUG: normalized_channel after processing: {repr(normalized_channel)}")
        # Get ALL credentials for this channel in one call
        channel_auth = get_channel_auth(normalized_channel)
        access_token = channel_auth.tool_access_token
        print(f"Channel Received: {normalized_channel}")
        print(f"Selected Language: {selected_language}")
        # Handle IMAGE_UPLOAD_REQUEST intent - Generic upload manager
        if primary_intent == "IMAGE_UPLOAD_REQUEST":
            return handle_upload_request(
                primary_intent=primary_intent,
                normalized_channel=normalized_channel,
                session_id=session_id,
                original_query=original_query,
                conversation_id=conversation_id,
                member_id=member_id,
                history_manager=self.history_manager,
                intent_time=intent_time,
                total_start=total_start,
                language=selected_language
            )
        # Handle IMAGE_UPLOAD_CONFIRMATION intent - Generic upload manager with healthcare document handler
        elif primary_intent == "IMAGE_UPLOAD_CONFIRMATION":
            # The confirmation keyword ("uploaded") is not a reliable language signal,
            # so reuse the language the upload link was requested in.
            upload_language = get_upload_request_language(
                session_id=session_id,
                history_manager=self.history_manager,
                default=selected_language,
                channel=channel,
            )
            RequestContext.set_language(upload_language)
            result = handle_upload_confirmation(
                primary_intent=primary_intent,
                session_id=session_id,
                history_manager=self.history_manager,
                response=response,
                intent_time=intent_time,
                total_start=total_start,
                document_handler=process_healthcare_document,  # Healthcare document handler
                language=upload_language
            )
            # If result is not None, return it (error or invalid document)
            if result is not None:
                return result
            # Valid healthcare document - create natural query based on document type
            # This makes the system generic - any agent can handle the extracted data
            if hasattr(response, 'dcn') and response.dcn:
                identifier_id = response.dcn
                document_intent = getattr(response, 'primary_intent', 'CLAIMS_DETAILS')
                record_type = getattr(response, 'record_type', 'EOB')
                # Create appropriate follow-up query based on document type and intent
                if document_intent == 'REVIEW_PROVIDER':
                    follow_up_key = "follow_up_provider_details_query"
                elif document_intent == 'CLAIMS_DETAILS':
                    follow_up_key = "follow_up_claim_details_query"
                else:
                    # Generic fallback
                    follow_up_key = "follow_up_generic_details_query"
                follow_up_query = get_localized_message(IMAGE_UPLOAD_LOCALE_CATEGORY, follow_up_key, upload_language).format(
                    record_type=record_type,
                    identifier_id=identifier_id,
                )
                logger.info(
                    f"[ORCHESTRATOR] Document processed successfully. "
                    f"record_type={record_type}, intent={document_intent}, "
                    f"Re-routing query: '{follow_up_query}'"
                )
                # Recursively call orchestrator with the new query
                # Let it detect intent and route to appropriate agent (claims, benefits, etc.)
                return await self.detect_intent_and_call_agents(
                    search_query=follow_up_query,
                    conversation_id=conversation_id,
                    session_id=session_id,
                    member_id=member_id,
                    message_id=message_id,
                    authenticated=authenticated,
                    language=upload_language,
                    channel=channel
                )
            else:
                # No identifier extracted, return generic success
                logger.warning(f"[ORCHESTRATOR] Document processed but no identifier found")
                return result
        # Plan tool calls
        planner = PlannerAgent()
        plans = await planner.plan(response, channel=normalized_channel, member_id=member_id, user_query=enriched_query, conversation_id=conversation_id, conversation_history=history)
        logger.info(f"[ORCHESTRATOR] Planner generated {len(plans)} plan(s) for execution")
        for i, plan in enumerate(plans):
            logger.debug(f"[ORCHESTRATOR] Plan {i+1}: agent={plan.get('agent')}, label={plan.get('label')}")

        # Check for live agent connection - if any plan has LIVE_AGENT_CONNECTION flag, return payload directly
        for plan in plans:
            logger.info(f"[ORCHESTRATOR] Checking plan for live_agent_connection: {plan.get('live_agent_connection')}")
            if plan.get("live_agent_connection"):
                live_agent_payload = plan.get("live_agent_payload")
                logger.info(f"[ORCHESTRATOR] Live agent connection detected - returning payload directly")
                return {
                    "live_agent_connection": True,
                    "live_agent_payload": live_agent_payload
                }
        # â”€â”€ Capture ID card selection metadata for enrichment on the next turn â”€â”€
        _id_card_plan_selection_extra: dict | None = None
        for plan in plans:
            if plan.get("requires_id_card_selection") and plan.get("active_cards"):
                _id_card_plan_selection_extra = {
                    "id_card_plans": plan["active_cards"],
                    "id_card_mbr_uid": plan.get("id_card_mbr_uid", member_id or ""),
                }
                logger.info(
                    f"[ORCHESTRATOR] ID card-selection prompt detected â€” will attach "
                    f"id_card_plans({len(plan['active_cards'])}) to history for enrichment"
                )
                break
        # â”€â”€ Capture member-selection metadata for enrichment on the next turn â”€
        for plan in plans:
            if not plan.get("requires_member_selection"):
                continue
            candidates_key = (
                "id_card_member_candidates"
                if plan.get("id_card_member_candidates")
                else "claims_member_candidates"
                if plan.get("claims_member_candidates")
                else None
            )
            if candidates_key:
                member_selection_extra = {
                    candidates_key: plan[candidates_key],
                    "id_card_mbr_uid": plan.get("id_card_mbr_uid", member_id or ""),
                    "id_card_sub_group_id": plan.get("id_card_sub_group_id", ""),
                }
                # Carry forward id_card_plans when both member and plan are ambiguous
                # so that after the user picks a member, the plan-selection prompt fires.
                if plan.get("id_card_plans"):
                    member_selection_extra["id_card_plans"] = plan["id_card_plans"]
                _id_card_plan_selection_extra = (
                    {**_id_card_plan_selection_extra, **member_selection_extra}
                    if _id_card_plan_selection_extra
                    else member_selection_extra
                )
                logger.info(
                    f"[ORCHESTRATOR] Member-selection prompt detected — will attach "
                    f"{candidates_key}({len(plan[candidates_key])}) to history for enrichment"
                )
                break
        results = []
        agent_timings = init_agent_timings()
        def gateway_tool_wrapper(*args, **kwargs):
            # Remove 'channel' from kwargs to avoid duplicate argument error
            filtered_kwargs = {k: v for k, v in kwargs.items() if k != 'channel'}
            return call_gateway_agent(
                access_token,
                *args,  # service_domain and intent from planner
                member_id=member_id,
                search_query=search_query,
                selected_language=selected_language,
                specialty=response.specialty,
                intent_response=response,  # NEW: Pass full intent response with claim_type_filter
                service_name=response.service_name,
                conversation_id=conversation_id,  # NEW: Pass conversation_id for session tracking
                message_id=message_id,
                channel=kwargs.get('channel', normalized_channel),
                **filtered_kwargs,
            )
        tool_map = {
            'findcare': lambda *args, **kwargs: call_findcare_tool(*args, member_id=member_id, channel=normalized_channel, message_id=message_id, **kwargs),
            'gateway': gateway_tool_wrapper
        }
        async def run_plan(plan):
            # Handle error agent type (e.g., eligibility check failure)
            if plan['agent'] == 'error':
                # Determine agent name from plan label or use generic 'ERROR'
                agent_name = plan.get('_agent_name', 'ERROR')
                error_result = {
                    'extracted_text': plan.get('extracted_text', 'An error occurred'),
                    '_agent_name': agent_name,
                    'error': True
                }
                if 'skip_summarization' in plan:
                    error_result['skip_summarization'] = plan['skip_summarization']
                return error_result, plan['label'], plan['agent'], time.time(), plan
            tool_func = tool_map.get(plan['agent'])
            if tool_func is None:
                return None, plan['label'], plan['agent'], 0.0, plan
            phase_start = time.time()
            plan_args = plan.get('args', ())
            plan_kwargs = plan.get('kwargs', {}) or {}
            print(f"[ORCHESTRATOR] Invoking {plan['agent']} agent for plan '{plan['label']}' with args={plan_args} kwargs={plan_kwargs}")
            result = await asyncio.to_thread(tool_func, *plan_args, **plan_kwargs)
            return result, plan['label'], plan['agent'], phase_start, plan
        plan_results = await asyncio.gather(
            *[run_plan(plan) for plan in plans],
            return_exceptions=True
        )
        for item in plan_results:
            label, agent_type, phase_start, plan = "", "", 0.0, {}
            try:
                if isinstance(item, BaseException):
                    raise item
                result, label, agent_type, phase_start, plan = item
                elapsed = round(time.time() - phase_start, 3)

                # Generic live chat topic handler - works for all agents.
                # Agents (e.g. spending accounts) return live_chat_topic_required=True and
                # live_chat_topic_to_connect=<topic> in their result dict. We store the topic
                # in session storage here (post-execution) so it persists across requests.
                if isinstance(result, dict) and result.get("live_chat_topic_required"):
                    topic = result.get("live_chat_topic_to_connect")
                    if topic:
                        setLiveChatTopic(topic)
                        logger.info(f"[ORCHESTRATOR] Live chat topic set from agent response: {topic}")

                # Add agent metadata to result and determine timing category
                actual_agent_name = agent_type  # Default to agent_type
                if isinstance(result, dict):
                    # For gateway calls, use the service_domain as agent_name instead of "gateway"
                    if agent_type == 'gateway':
                        plan_args = plan.get('args', ())
                        service_domain = plan_args[0] if len(plan_args) > 0 else 'gateway'
                        agent_name = AgentNameMapping.get_agent_name(service_domain)
                        result['_agent_name'] = agent_name  # e.g., 'BENEFITS_OVERVIEW', 'CLAIMS_DETAIL', 'REVIEW_PROVIDERS'
                        actual_agent_name = agent_name  # Use mapped name for timing
                        print(f"[ORCHESTRATOR] Gateway call - mapped service_domain '{service_domain}' to _agent_name '{agent_name}'")
                    elif agent_type == 'claim_explainability':
                        # Map claim_explainability to 'CLAIMS_DETAIL' for consistency
                        result['_agent_name'] = 'CLAIMS_DETAIL'
                        actual_agent_name = 'CLAIMS_DETAIL'  # Use 'CLAIMS_DETAIL' for timing
                        print(f"[ORCHESTRATOR] Mapped agent_type 'claim_explainability' to _agent_name 'CLAIMS_DETAIL'")
                    elif agent_type == 'findcare':
                        # Map findcare to 'REVIEW_PROVIDERS' for consistency
                        result['_agent_name'] = 'REVIEW_PROVIDERS'
                        actual_agent_name = 'REVIEW_PROVIDERS'
                        print(f"[ORCHESTRATOR] Mapped agent_type 'findcare' to _agent_name 'REVIEW_PROVIDERS'")
                    elif agent_type == 'error':
                        # Error agent already has _agent_name set
                        actual_agent_name = result.get('_agent_name', 'error')
                        print(f"[ORCHESTRATOR] Error agent with _agent_name '{actual_agent_name}'")
                    else:
                        result['_agent_name'] = agent_type
                accumulate_agent_timing(actual_agent_name, elapsed, agent_timings)
                logger.info(f"[ORCHESTRATOR] {actual_agent_name} completed in {elapsed}s")
                print(f"[ORCHESTRATOR] {actual_agent_name} completed in {elapsed}s")
                # Add additional metadata to result
                if isinstance(result, dict):
                    result['_agent_label'] = label
                    # Determine if this is primary or secondary intent
                    if '(Secondary)' in label:
                        result['_intent_priority'] = 'secondary'
                    else:
                        result['_intent_priority'] = 'primary'
                    logger.info(f"[ORCHESTRATOR] Tagged {agent_type} result with priority: {result['_intent_priority']}")
                    print(f"[ORCHESTRATOR] Tagged {result.get('_agent_name', agent_type)} result with priority: {result['_intent_priority']}")
                results.append(result)
            except Exception as e:
                elapsed = round(time.time() - phase_start, 3)
                logger.error(f"[ORCHESTRATOR] {agent_type} failed after {elapsed}s: {str(e)}", exc_info=True)
                print(f"[ORCHESTRATOR] {agent_type} failed after {elapsed}s: {e}")
                results.append(None)
        blocks = []
        has_error = False
        error_messages = []
        for r in results:
            # If result is a string, try to parse as JSON
            if isinstance(r, str):
                try:
                    r = json.loads(r)
                except Exception as e:
                    print(f"[ERROR] Failed to parse result as JSON: {r}\nException: {e}")
                    continue
            if isinstance(r, dict):
                # Simple success/failure check - agents handle their own error classification
                # Orchestrator only cares if the agent completed successfully or had a system failure
                if r.get('success') is False and not r.get('extracted_text'):
                    # Only treat as system error if no user-facing content was provided
                    has_error = True
                    error_msg = r.get('response_summary') or r.get('response') or r.get('error', 'Unknown error occurred')  # CHANGED: Use response_summary first
                    error_messages.append(error_msg)
                    logger.error(f"[ORCHESTRATOR] Error detected in result: {error_msg}")
                    print(f"[ORCHESTRATOR] Error detected in result: {error_msg}")
                r.pop('title', None)
                r.pop('summary', None)
                # Log if result contains combined chunks
                if "total_chunks" in r:
                    logger.info(f"[ORCHESTRATOR] Result contains combined text from {r.get('total_chunks')} chunks")
                    print(f"[ORCHESTRATOR] Result contains combined text from {r.get('total_chunks')} chunks")
                # Add the result as a single block
                blocks.append(r)
        # Check if both primary and secondary intents are unidentified
        primary_intent = getattr(response, 'primary_intent', None)
        secondary_intent = getattr(response, 'secondary_intent', None)
        both_intents_unidentified = (
            primary_intent == 'unidentified' and
            (secondary_intent == 'unidentified' or secondary_intent is None)
        )
          # If there's an error OR both intents are unidentified, skip LLM summarization and use fallback
        if has_error or both_intents_unidentified:
            reason = "errors in results" if has_error else "unidentified intents"
            logger.warning(f"[ORCHESTRATOR] Skipping summarization due to {reason}, using fallback message")
            print(f"[ORCHESTRATOR] Skipping summarization due to {reason}, using fallback message")
            # Use general title for all error cases - agents should handle domain-specific titles
            locale_data = es.LOCALES if selected_language == "es" else en.LOCALES
            title = locale_data["general"]["title"]
            # Remove secondary_intent for SMS channel
            fallback_secondary = None if normalized_channel == Channel.SMS.value else secondary_intent
            # Build timings dict for error fallback - only non-zero agents
            fallback_total_time = time.time() - total_start
            fallback_timings = {"Intent detection": round(intent_time, 3)}
            if agent_timings['benefits_time'] > 0:
                fallback_timings["Benefits agent"] = round(agent_timings['benefits_time'], 3)
            if agent_timings['findcare_time'] > 0:
                fallback_timings["FindCare agent"] = round(agent_timings['findcare_time'], 3)
            if agent_timings['claim_explainability_time'] > 0:
                fallback_timings["Claims agent"] = round(agent_timings['claim_explainability_time'], 3)
            if agent_timings['pharmacy_time'] > 0:
                fallback_timings["Pharmacy agent"] = round(agent_timings['pharmacy_time'], 3)
            if agent_timings['spending_account_time'] > 0:
                fallback_timings["Spending Account agent"] = round(agent_timings['spending_account_time'], 3)
            if agent_timings['prior_auth_time'] > 0:
                fallback_timings["Prior Authorization agent"] = round(agent_timings['prior_auth_time'], 3)
            if agent_timings['id_card_time'] > 0:
                fallback_timings["ID Card agent"] = round(agent_timings['id_card_time'], 3)
            if agent_timings['document_time'] > 0:
                fallback_timings["Documents agent"] = round(agent_timings['document_time'], 3)
            if agent_timings['symptom_inquiry_time'] > 0:
                fallback_timings["Symptom Inquiry agent"] = round(agent_timings['symptom_inquiry_time'], 3)
            if agent_timings['imaging_inquiry_time'] > 0:
                fallback_timings["Imaging Inquiry agent"] = round(agent_timings['imaging_inquiry_time'], 3)
            if agent_timings['claims_submission_time'] > 0:
                fallback_timings["Claims Submission agent"] = round(agent_timings['claims_submission_time'], 3)
            if agent_timings['live_agent_time'] > 0:
                fallback_timings["Documents agent"] = round(agent_timings['live_agent_time'], 3)
            if agent_timings['billpay_time'] > 0:
                fallback_timings["BillPay agent"] = round(agent_timings['billpay_time'], 3)
            if agent_timings['plan_info_time'] > 0:
                fallback_timings["Plan Info agent"] = round(agent_timings['plan_info_time'], 3)
            fallback_timings["Total"] = round(fallback_total_time, 3)
            # Use the error message from the response if available
            error_response_summary = error_messages[0] if error_messages else ""
            if session_id or conversation_id or member_id:
                try:
                    logger.info(f"[MEMORY] Saving unidentified/error response to history")
                    self.history_manager.add_conversation(
                        session_id=session_id or f"session_{member_id}",
                        query=search_query,  # Use enriched query to preserve identifiers
                        response_summary=error_response_summary,
                        intent=primary_intent,
                        conversation_id=conversation_id,
                        member_id=member_id,
                    )
                    logger.info(f"[MEMORY] ✓ Saved unidentified intent to history for consecutive detection")
                except Exception as e:
                    logger.error(f"[MEMORY] ✗ Failed to save unidentified to history: {e}")
            return OutputValidator.validate_response({
                "title": title,
                "response_summary": error_response_summary,  # Empty to trigger fallback
                "full_summary": "",
                "sms_summary": "",
                "language_code": selected_language,
                "primary_intent": primary_intent,
                "secondary_intent": fallback_secondary,
                "blocks": blocks,
                "intent_response": response,
                "timings": fallback_timings,
                "intent_time": intent_time,
                "benefits_time": agent_timings['benefits_time'],
                "findcare_time": agent_timings['findcare_time'],
                "gateway_time": agent_timings['gateway_time'],
                "claim_explainability_time": agent_timings['claim_explainability_time'],
                "pharmacy_time": agent_timings['pharmacy_time'],
                "spending_account_time": agent_timings['spending_account_time'],
                "prior_auth_time": agent_timings['prior_auth_time'],
                "claims_submission_time": agent_timings['claims_submission_time'],
                "live_agent_time": agent_timings['live_agent_time'],
                "id_card_time": agent_timings['id_card_time'],
                "document_time": agent_timings['document_time'],
                "plan_info_time": agent_timings['plan_info_time'],
                "summarization_time": None,
                "total_time": fallback_total_time,
            }, locale=locale)
        print("\nSummarizing response...\n")
        # Extract intent names early for response building
        primary_intent_name = getattr(response, 'primary_intent', None)
        secondary_intent_name = getattr(response, 'secondary_intent', None)
        # Log intent priorities for blocks
        primary_blocks = [b for b in blocks if b.get('_intent_priority') == 'primary']
        secondary_blocks = [b for b in blocks if b.get('_intent_priority') == 'secondary']
        logger.info(f"[ORCHESTRATOR] ========================================")
        logger.info(f"[ORCHESTRATOR] BLOCKS BEING PASSED TO SUMMARIZER:")
        logger.info(f"[ORCHESTRATOR] ========================================")
        logger.info(f"[ORCHESTRATOR] Blocks summary: {len(primary_blocks)} primary, {len(secondary_blocks)} secondary")
        print(f"[ORCHESTRATOR] ========================================")
        print(f"[ORCHESTRATOR] BLOCKS BEING PASSED TO SUMMARIZER:")
        print(f"[ORCHESTRATOR] ========================================")
        print(f"[ORCHESTRATOR] Blocks summary: {len(primary_blocks)} primary, {len(secondary_blocks)} secondary")
        for idx, block in enumerate(blocks):
            agent_name = block.get('_agent_name', 'unknown')
            priority = block.get('_intent_priority', 'unknown')
            logger.info(f"[ORCHESTRATOR] Block #{idx + 1}: {agent_name} ({priority})")
            print(f"[ORCHESTRATOR] Block #{idx + 1}: {agent_name} ({priority})")
            # Log key fields in the block
            if 'extracted_text' in block and block.get('extracted_text') is not None:
                print(f"[ORCHESTRATOR]   - extracted_text: {len(block.get('extracted_text'))} chars")
            if 'plan_info' in block:
                print(f"[ORCHESTRATOR]   - plan_info: {len(block.get('plan_info', []))} items")
            if 'follow_up_questions' in block:
                print(f"[ORCHESTRATOR]   - follow_up_questions: {block.get('follow_up_questions', [])}")
            if 'prior_authorization' in block:
                print(f"[ORCHESTRATOR]   - prior_authorization: {len(block.get('prior_authorization', []))} items")
            if 'errors' in block:
                print(f"[ORCHESTRATOR]   - errors: {len(block.get('errors', []))} errors")
            # Skip logging complete block JSON to avoid base64 image data in logs
        summarization_start = time.time()
        # ========================================================================
        # CHANNEL-SPECIFIC SUMMARIZATION USING ADAPTERS
        # ========================================================================
        print(f"\n{'='*80}")
        print(f"[ORCHESTRATOR] Using channel adapter for: {normalized_channel}")
        print(f"{'='*80}")
        # Get appropriate adapter for channel
        adapter = get_channel_adapter(normalized_channel)
        # Check if we have blocks to summarize
        if not primary_blocks:
            logger.error(f"[ORCHESTRATOR] No primary blocks available for {normalized_channel} channel")
            print(f"[ORCHESTRATOR] âŒ No primary blocks - returning error response")
            # Get localized error message
            locale_data = es.LOCALES if selected_language == "es" else en.LOCALES
            error_message = locale_data.get("general", {}).get("fallback_response",
                "We couldn't process your request at this time. Please try again later.")
            # Return error response early
            return OutputValidator.validate_response({
                "title": locale_data.get("general", {}).get("title", "Response"),
                "response_summary": error_message,
                "language_code": selected_language,
                "primary_intent": primary_intent_name,
                "secondary_intent": None,
                "blocks": [],
                "timings": {
                    "Intent detection": round(intent_time, 3),
                    "Total": round(time.time() - total_start, 3)
                },
                "error": "no_data_available",
                "message_id": message_id,
                "member_id": member_id
            }, locale=locale)
        # Get channel-specific summarizer
        if normalized_channel == Channel.SMS.value:
            # SMS needs Horizon model
            horizon_model = await build_llm_model(channel=normalized_channel)
            summarizer = adapter.get_summarizer(horizon_model=horizon_model)
        else:
            # Web doesn't need model
            summarizer = adapter.get_summarizer()
        # Get blocks to summarize (channel-specific logic)
        blocks_for_summary, secondary_for_summary = adapter.get_blocks_for_summary(
            blocks=blocks,
            channel=normalized_channel,
            secondary_intent=getattr(response, 'secondary_intent', None)
        )
        # Generate summary based on channel
        response_summary = ""
        if normalized_channel == Channel.SMS.value:
            # SMS: Summarize single block
            if blocks_for_summary:
                block = blocks_for_summary[0]
                # Always use summarizer - it handles requires_selection internally
                print(f"[ORCHESTRATOR] SMS: Summarizing single block (message_id={message_id})")
                sms_user_query = search_query
                agent_name = block.get("_agent_name", "")
                use_history_for_followups = agent_name in USE_HISTORY_FOR_FOLLOWUPS_AGENT_NAMES
                if authenticated and has_history and history and use_history_for_followups:
                    recent_history = history[-3:]
                    ordered = list(reversed(recent_history))
                    history_lines = []
                    for idx, entry in enumerate(ordered, start=1):
                        q = (entry.get("query") or "").replace("\n", " ").strip()
                        r_full = entry.get("response_summary") or ""
                        r_main = r_full.split("\n\nView", 1)[0].replace("\n", " ").strip()
                        history_lines.append(f"{idx}. User: {q} | Assistant: {r_main}")
                    sms_user_query = (
                        f"{search_query}\n\n"
                        f"Conversation History (last {len(recent_history)} turns, most recent first):\n"
                        f"{chr(10).join(history_lines)}"
                    )
                prompt_to_log = sms_user_query or ""
                logger.info(
                    f"[ORCHESTRATOR] SMS summarization user_query (with history) for message_id={message_id} "
                    f"(length={len(prompt_to_log)} chars) full prompt:\n{prompt_to_log}"
                )
                result = await summarizer.summarize(
                    block=block,
                    user_query=sms_user_query,
                    language=selected_language,
                    member_id=member_id,
                    message_id=message_id,
                    conversation_id=conversation_id,
                    original_query=original_query,
                )
                response_summary = result["sms_summary"]
                print(f"[ORCHESTRATOR] SMS: Generated summary ({len(response_summary)} chars)")
        else:
            # Web: Summarize all selected blocks
            print(f"[ORCHESTRATOR] Web: Summarizing {len(blocks_for_summary)} blocks")
            summary_result = await summarizer.summarize(
                blocks=blocks_for_summary,
                specialty=getattr(response, 'specialty', None) if hasattr(response, 'specialty') else None,
                language=selected_language,
                primary_intent=getattr(response, 'primary_intent', None),
                secondary_intent=secondary_for_summary,
                member_id=member_id,
                conversation_id=conversation_id,
                message_id=message_id,
                query=original_query
            )
            response_summary = summary_result.get("summary", "")
            print(f"[ORCHESTRATOR] Web: Generated summary ({len(response_summary)} chars)")
        logger.info(f"[ORCHESTRATOR] Summarization completed in {round(time.time() - summarization_start, 3)}s")
        # ========================================================================
        # END CHANNEL-SPECIFIC SUMMARIZATION
        # ========================================================================
        summarization_time = round(time.time() - summarization_start, 3)
        total_time = round(time.time() - total_start, 3)
        print(f"[ORCHESTRATOR] Primary Intent: {primary_intent_name}, Secondary Intent: {secondary_intent_name}")
        print(f"[ORCHESTRATOR] Response summary ({len(response_summary)} chars): {response_summary}")
        # Build timings dict dynamically - only include non-zero agents
        timings = {
            "Intent detection": round(intent_time, 3),
        }
        # Add agent timings only if non-zero
        if agent_timings['benefits_time'] > 0:
            timings["Benefits agent"] = round(agent_timings['benefits_time'], 3)
        if agent_timings['findcare_time'] > 0:
            timings["FindCare agent"] = round(agent_timings['findcare_time'], 3)
        if agent_timings['claim_explainability_time'] > 0:
            timings["Claims agent"] = round(agent_timings['claim_explainability_time'], 3)
        if agent_timings['pharmacy_time'] > 0:
            timings["Pharmacy agent"] = round(agent_timings['pharmacy_time'], 3)
        if agent_timings['spending_account_time'] > 0:
            timings["Spending Account agent"] = round(agent_timings['spending_account_time'], 3)
        if agent_timings['prior_auth_time'] > 0:
            timings["Prior Authorization agent"] = round(agent_timings['prior_auth_time'], 3)
        if agent_timings['id_card_time'] > 0:
            timings["ID Card agent"] = round(agent_timings['id_card_time'], 3)
        if agent_timings['document_time'] > 0:
            timings["Documents agent"] = round(agent_timings['document_time'], 3)
        if agent_timings['symptom_inquiry_time'] > 0:
            timings["Symptom Inquiry agent"] = round(agent_timings['symptom_inquiry_time'], 3)
        if agent_timings['imaging_inquiry_time'] > 0:
            timings["Imaging Inquiry agent"] = round(agent_timings['imaging_inquiry_time'], 3)
        if agent_timings['claims_submission_time'] > 0:
            timings["Claims Explainability agent"] = round(agent_timings['claims_submission_time'], 3)
        if agent_timings['live_agent_time'] > 0:
            timings["Live agent"] = round(agent_timings['live_agent_time'], 3)
        if agent_timings['billpay_time'] > 0:
            timings["BillPay agent"] = round(agent_timings['billpay_time'], 3)
        if agent_timings['plan_info_time'] > 0:
            timings["Plan Info agent"] = round(agent_timings['plan_info_time'], 3)
        # Add summarization timing for both channels
        if summarization_time > 0:
            timings["Summarization"] = round(summarization_time, 3)
        timings["Total"] = round(total_time, 3)
        logger.info(f"[ORCHESTRATOR] Total time: {timings['Total']}s (Intent: {timings['Intent detection']}s, Agents: {agent_timings['benefits_time'] + agent_timings['findcare_time'] + agent_timings['claims_submission_time'] + agent_timings['live_agent_time'] + agent_timings['claim_explainability_time'] + agent_timings['pharmacy_time'] + agent_timings['spending_account_time'] + agent_timings['prior_auth_time'] + agent_timings['id_card_time'] + agent_timings['billpay_time'] + agent_timings['document_time'] + agent_timings['symptom_inquiry_time'] + agent_timings['imaging_inquiry_time'] + agent_timings['plan_info_time']}s, Summarization: {summarization_time}s)")
        print(f"[ORCHESTRATOR] Timings: {json.dumps(timings, indent=2)}")
        # ========================================================================
        # BUILD CHANNEL-SPECIFIC RESPONSE USING ADAPTER
        # ========================================================================
        # Use adapter to build channel-specific response structure
        response_data = adapter.build_response(
            blocks=blocks,
            primary_intent=primary_intent_name,
            secondary_intent=secondary_intent_name,
            timings=timings,
            message_id=message_id,
            member_id=member_id,
            conversation_id=conversation_id,
            response_summary=response_summary,
            language=selected_language,
        )
        logger.info(f"[ORCHESTRATOR] Channel adapter built response for {normalized_channel}")
        print(f"[ORCHESTRATOR] Response ready: {response_data.get('title')}")
        # Add common fields to response
        response_data.update({
            "intent_response": response,
            "language_code": selected_language,
            "intent_time": intent_time,
            "benefits_time": agent_timings['benefits_time'],
            "findcare_time": agent_timings['findcare_time'],
            "claim_explainability_time": agent_timings['claim_explainability_time'],
            "pharmacy_time": agent_timings['pharmacy_time'],
            "spending_account_time": agent_timings['spending_account_time'],
            "document_time": agent_timings['document_time'],
            "prior_auth_time": agent_timings['prior_auth_time'],
            "claims_submission_time": agent_timings['claims_submission_time'],
            "gateway_time": agent_timings['gateway_time'],
            "plan_info_time": agent_timings['plan_info_time'],
            "summarization_time": summarization_time,
            "total_time": total_time
        })
        history_extra = dict(_id_card_plan_selection_extra or {})
        if latest_history_extra.get("clarification_state") == "asked":
            history_extra.update({
                "clarification_state": "answered",
                "clarification_type": latest_history_extra.get("clarification_type"),
                "clarification_question": latest_history_extra.get("clarification_question") or latest_history_entry.get("response_summary", ""),
                "clarification_answer": original_query.strip(),
                "clarification_resolution": primary_intent_name,
            })
        if history_extra_query_data:
            history_extra.update(history_extra_query_data)
        if primary_intent_name == Intent.EOB_HELP.value:
            history_extra["language"] = selected_language
        # =============================================== (ONLY for authenticated users)=============================
        # MEMORY MANAGEMENT: Save conversation to history
        if session_id or conversation_id or member_id:
            try:
                logger.info(f"[MEMORY] ================= (authenticated user)==========================")
                logger.info(f"[MEMORY] SAVING TO HISTORY")
                logger.info(f"[MEMORY] Storing under session_id: {session_id}")
                logger.info(f"[MEMORY] message_id (unique for this request): {message_id}")
                logger.info(f"[MEMORY] conversation_id (from auth): {conversation_id}")
                logger.info(f"[MEMORY] Original user query: {original_query}")
                logger.info(f"[MEMORY] Query being stored: {history_query_to_store}")
                logger.info(f"[MEMORY] Intent: {primary_intent_name}")
                print("===== SAVING TO HISTORY =====")
                print(f"SESSION ID: {session_id}")
                print(f"MESSAGE ID: {message_id}")
                print(f"CONVERSATION ID: {conversation_id}")
                print(f"MEMBER ID: {member_id}")
                print(f"ORIGINAL USER QUERY: {original_query}")
                print(f"QUERY BEING STORED: {history_query_to_store}")
                print(f"INTENT: {primary_intent_name}")
                self._save_history_entry(
                    session_id=session_id,
                    conversation_id=conversation_id,
                    member_id=member_id,
                    query=history_query_to_store,
                    response_summary=response_data.get("response_summary", ""),
                    intent=primary_intent_name,
                    extra_data=history_extra or None,
                )
                logger.info(f"[MEMORY] âœ“ Saved to Redis/in-memory under session_id: {session_id}")
                logger.info(f"[MEMORY] ===========================================")
            except Exception as e:
                logger.error(f"[MEMORY] âœ— Failed to save: {e}", exc_info=True)
        elif not authenticated:
            logger.info(f"[MEMORY] Skipping history save - user not authenticated")
            print(f"[MEMORY] Skipping conversation history - user not authenticated")
        # Log final response summary
        logger.info(f"[ORCHESTRATOR] Returning response: channel={normalized_channel}, summary_length={len(response_data.get('response_summary', ''))}")
        print(f"[ORCHESTRATOR] Final response ready: {response_data.get('title')}")
        print(f"[ORCHESTRATOR] Response summary preview: {response_data.get('response_summary', '')[:100]}...")
        return OutputValidator.validate_response(response_data, locale=locale)

    def _save_history_entry(
        self,
        session_id: str | None,
        conversation_id: str | None,
        member_id: str | None,
        query: str,
        response_summary: str,
        intent: str | None,
        extra_data: dict | None = None,
    ) -> None:
        logger.info("===== HISTORY ENTRY SAVE =====")
        logger.info(f"HISTORY SESSION ID: {session_id or f'session_{member_id}'}")
        logger.info(f"HISTORY CONVERSATION ID: {conversation_id}")
        logger.info(f"HISTORY MEMBER ID: {member_id}")
        logger.info(f"HISTORY QUERY: {query}")
        logger.info(f"HISTORY INTENT: {intent}")
        logger.info(f"HISTORY RESPONSE SUMMARY: {response_summary}")
        logger.info(f"HISTORY EXTRA DATA: {extra_data}")
        print("===== HISTORY ENTRY SAVE =====")
        print(f"HISTORY SESSION ID: {session_id or f'session_{member_id}'}")
        print(f"HISTORY CONVERSATION ID: {conversation_id}")
        print(f"HISTORY MEMBER ID: {member_id}")
        print(f"HISTORY QUERY: {query}")
        print(f"HISTORY INTENT: {intent}")
        print(f"HISTORY RESPONSE SUMMARY: {response_summary}")
        print(f"HISTORY EXTRA DATA: {extra_data}")
        self.history_manager.add_conversation(
            session_id=session_id or f"session_{member_id}",
            query=query,
            response_summary=response_summary,
            intent=intent,
            conversation_id=conversation_id,
            member_id=member_id,
            extra_data=extra_data,
        )

    async def _try_demo_handler(
        self,
        member_id: str | None,
        hcid: str | None,
        original_query: str,
        language: str,
        history: list,
        channel: str | None,
        authenticated: bool,
        session_id: str | None,
        conversation_id: str | None
    ) -> dict | None:
        """
        Attempt to handle request via demo layer.
        Returns:S
            Demo response dict if matched, None for production fallback
        """
        try:
            # Guard: Skip in PROD environment
            env = os.getenv('PROJECT_ENV', 'DEV').upper()
            if env == 'PROD':
                logger.info("[DEMO] PROD environment - demo layer skipped")
                return None
            # Guard: Must have HCID (non-PHI identifier for demo matching)
            if not hcid:
                return None
            # Try demo request using HCID
            demo_handler = get_demo_handler()
            demo_response = await demo_handler.handle_demo_request(
                member_id=hcid,
                query=original_query,
                language=language,
                conversation_history=history,
                channel=channel
            )
            # No match - fallback to production
            if not demo_response:
                logger.info("[DEMO] No demo intent matched - continuing to production flow")
                return None
            # Demo matched - save to history and return
            logger.info("[DEMO] âœ“ Returning demo response - bypassing production orchestrator")
            self._save_demo_to_history(
                authenticated=authenticated,
                session_id=session_id,
                original_query=original_query,
                demo_response=demo_response,
                conversation_id=conversation_id,
                member_id=member_id
            )
            return demo_response
        except Exception as demo_err:
            logger.error(
                f"[DEMO] Demo layer error - falling back to production: {demo_err}",
                exc_info=True
            )
            return None
    def _save_demo_to_history(
        self,
        authenticated: bool,
        session_id: str | None,
        original_query: str,
        demo_response: dict,
        conversation_id: str | None,
        member_id: str | None
    ):
        """Save demo response to conversation history."""
        if not authenticated or not session_id:
            return
        try:
            self.history_manager.add_conversation(
                session_id=session_id,
                query=original_query,
                response_summary=demo_response.get("response_summary", ""),
                intent=demo_response.get("primary_intent"),
                conversation_id=conversation_id,
                member_id=member_id
            )
        except Exception as hist_err:
            logger.warning(f"[DEMO] Failed to save history: {hist_err}")

=================================================================================================================

"""Orchestrator constants and enums."""

from enum import Enum


class AgentNameMapping(str, Enum):
    """Agent service domain to display name mapping."""
    
    BENEFITS_EXPLAINABILITY = "BENEFITS_OVERVIEW"
    CLAIMS_EXPLAINABILITY = "CLAIMS_DETAIL"
    FINDCARE = "REVIEW_PROVIDERS"
    PHARMACY = "PHARMACY"
    SPENDING_ACCOUNT = "SPENDING_ACCOUNT"
    PRIOR_AUTHORIZATION_EXPLAINABILITY = "PRIOR_AUTHORIZATION_OVERVIEW"
    PLAN_INFO = "PLAN_INFO"
    ID_CARD = "ID_CARD"
    DOCUMENTS = "DOCUMENTS"
    SYMPTOM_INQUIRY = "SYMPTOM_INQUIRY"
    IMAGING_INQUIRY = "IMAGING_INQUIRY"
    CLAIMS_SUBMISSION = "CLAIMS_SUBMISSION"
    LIVE_CHAT = "LIVE_CHAT"
    
    @classmethod
    def get_agent_name(cls, service_domain: str) -> str:
        """Get agent name from service domain, with fallback."""
        try:
            return cls[service_domain].value
        except KeyError:
            return service_domain.lower()


__all__ = ["AgentNameMapping"]

=============================================================================================================


from strands import Agent, tool

from models.writer.writer_model import model as writer_model
from prompts.multi_agent_prompts import FINDCARE_ASSISTANT_SYSTEM_PROMPT
from tools.findcare_tool import call_findcare_tool


@tool
async def findcare_assistant(specialty: str, token: str = None) -> dict:
    """Process and respond to provider search questions using a specialized agent with API tool access."""
    import ast
    import json
    import re
    prompt = (
        f"A user is asking to find providers. "
        f"Specialty: {specialty}. "
        f"The user's API token is: {token}. "
        f"Use the call_findcare_tool tool to answer."
    )
    agent = Agent(
        model=writer_model,
        system_prompt=FINDCARE_ASSISTANT_SYSTEM_PROMPT.format(token=token),
        tools=[call_findcare_tool],
    )
    response = agent(prompt)
    max_depth = 5
    depth = 0
    while depth < max_depth:
        # If AgentResult, extract JSON string from message['content'][0]['text']
        if hasattr(response, 'message') and isinstance(response.message, dict):
            try:
                content = response.message.get('content')
                if isinstance(content, list) and content and 'text' in content[0]:
                    response = content[0]['text']
                    depth += 1
                    continue
            except Exception:
                pass
        if hasattr(response, 'result'):
            response = getattr(response, 'result', response)
            depth += 1
            continue
        if isinstance(response, dict):
            return response
        if isinstance(response, str):
            try:
                json_obj = json.loads(response)
                if isinstance(json_obj, dict):
                    return json_obj
                response = json_obj
                depth += 1
                continue
            except Exception:
                pass
            dict_match = re.search(r'\{.*\}', response, re.DOTALL)
            if dict_match:
                dict_str = dict_match.group(0)
                try:
                    py_obj = ast.literal_eval(dict_str)
                    if isinstance(py_obj, dict):
                        return py_obj
                    response = py_obj
                    depth += 1
                    continue
                except Exception:
                    pass
        break
    return None

============================================================================================================

import asyncio

from strands import Agent, tool

from agents.strands_multi_agent.findcare_agent import findcare_assistant
from agents.strands_multi_agent.planner_agent import planner_assistant
from agents.strands_multi_agent.summarization_agent import summarization_assistant
from prompts.multi_agent_prompts import ORCHESTRATOR_ASSISTANT_SYSTEM_PROMPT


@tool
async def orchestrator_assistant(search_query: str, token: str = None, language: str = "English") -> dict:
    """
    Orchestrate the multi-agent workflow for a healthcare query (async version).
    """
    import time
    timings = {}
    total_start = time.time()
    agent = Agent(
        system_prompt=ORCHESTRATOR_ASSISTANT_SYSTEM_PROMPT,
        tools=[planner_assistant, findcare_assistant, summarization_assistant]
    )
    # Step 1: Intent detection (planner)
    intent_start = time.time()
    plan = planner_assistant(search_query)
    # Deduplicate plan steps by agent and args
    seen = set()
    deduped_plan = []
    for step in plan:
        key = (step['agent'], tuple(step['args']))
        if key not in seen:
            deduped_plan.append(step)
            seen.add(key)
    plan = deduped_plan
    primary_intent = next((step.get('intent_name') for step in plan if step.get('intent_priority') == 'primary'), None)
    secondary_intent = next((step.get('intent_name') for step in plan if step.get('intent_priority') == 'secondary'), None)
    intent_end = time.time()
    timings['Intent detection'] = intent_end - intent_start
    blocks = []
    # Step 2: Call agents as per plan (parallel execution, async)
    benefits_time = 0.0
    findcare_time = 0.0
    tasks = []
    benefits_indices = []
    findcare_indices = []
    for idx, step in enumerate(plan):
        if step['agent'] == 'benefits':
            pass  # Skip benefits - not implemented
        elif step['agent'] == 'findcare':
            findcare_indices.append(idx)
            tasks.append(
                findcare_assistant(
                    specialty=step['args'][0],
                    token=token
                )
            )
    # Step 2 timings
    step2_start = time.time()
    if tasks:
        results = await asyncio.gather(*tasks)
        import json
        for i, r in enumerate(results):
            plan_index = findcare_indices[i] if i < len(findcare_indices) else None
            step = plan[plan_index] if plan_index is not None and plan_index < len(plan) else {}
            # Assign timings for each agent type
            # For simplicity, measure total time for all benefits/findcare agents
            if i in benefits_indices:
                # Not precise per agent, but for demo
                pass
            elif i in findcare_indices:
                pass
            if isinstance(r, dict):
                r['_agent_name'] = step.get('intent_name', step.get('agent', 'unknown'))
                r['_agent_label'] = step.get('label', '')
                r['_intent_priority'] = step.get('intent_priority', 'primary')
                blocks.append(r)
            elif isinstance(r, str):
                try:
                    obj = json.loads(r)
                    if isinstance(obj, dict):
                        obj['_agent_name'] = step.get('intent_name', step.get('agent', 'unknown'))
                        obj['_agent_label'] = step.get('label', '')
                        obj['_intent_priority'] = step.get('intent_priority', 'primary')
                        blocks.append(obj)
                except Exception:
                    pass
    step2_end = time.time()
    # Split time for benefits/findcare agents
    if benefits_indices:
        timings['Benefits agent'] = (step2_end - step2_start) / (len(benefits_indices) + len(findcare_indices)) * len(benefits_indices)
    if findcare_indices:
        timings['FindCare agent'] = (step2_end - step2_start) / (len(benefits_indices) + len(findcare_indices)) * len(findcare_indices)
    # Step 3: Summarization
    summarization_start = time.time()
    summary = await summarization_assistant(blocks, language=language)
    summarization_end = time.time()
    timings['Summarization'] = summarization_end - summarization_start
    timings['Total'] = time.time() - total_start
    return {
        "title": summary.get("title", ""),
        "response_summary": summary.get("response_summary", ""),
        "primary_intent": primary_intent,
        "secondary_intent": secondary_intent,
        "blocks": blocks,
        "timings": timings
    }

===============================================================================================================



from dotenv import load_dotenv

load_dotenv()
import asyncio
import json

from agents.strands_multi_agent.orchestrator_agent import orchestrator_assistant
from utils.token_utils import get_access_token


async def main():
    token = get_access_token()
    while True:
        search_query = input("How can I assist you (or type 'exit' to quit): ")
        if search_query.lower() == "exit":
            break
        result = await orchestrator_assistant(search_query, token=token)
        # Print the result (pretty if possible)
        if result:
            try:
                # Print the rest of the result (excluding timings)
                result_to_print = dict(result)
                result_to_print.pop('timings', None)
                print("\n" + json.dumps(result_to_print, indent=2))
            except Exception:
                print(result)
            timings = result.get('timings')
            if timings:
                print("\n=== TIMINGS (seconds) ===")
                if 'Intent detection' in timings:
                    print(f"Intent detection: {timings['Intent detection']:.3f}")
                if 'Benefits agent' in timings:
                    print(f"Benefits agent: {timings['Benefits agent']:.3f}")
                if 'FindCare agent' in timings:
                    print(f"FindCare agent: {timings['FindCare agent']:.3f}")
                if 'Summarization' in timings:
                    print(f"Summarization: {timings['Summarization']:.3f}")
                if 'Total' in timings:
                    print(f"Total: {timings['Total']:.3f}")
        # Print prompt on a new line after output
        print("\nHow can I assist you (or type 'exit' to quit): ", end="")

if __name__ == "__main__":
    asyncio.run(main())

==============================================================================================================

from strands import Agent, tool

from prompts.multi_agent_prompts import PLANNER_ASSISTANT_SYSTEM_PROMPT


def _build_plan_step(label: str, agent: str, args: tuple, intent_name: str, intent_priority: str) -> dict:
    return {
        'label': label,
        'agent': agent,
        'args': args,
        'intent_name': intent_name,
        'intent_priority': intent_priority,
    }


@tool
def planner_assistant(search_query: str) -> list:
    """
    Analyze the query and return a plan (list of steps) for orchestrating benefits and find care agents.
    """
    from agents.agent_writer import HealthCareAgent
    from agents.agent_writer import agent as writer_agent
    from models.writer.writer_model import model as writer_model
    agent = Agent(
        model=writer_model,
        system_prompt=PLANNER_ASSISTANT_SYSTEM_PROMPT,
        tools=[],
    )
    response = writer_agent.structured_output(
        output_model=HealthCareAgent,
        prompt=search_query
    )
    plans = []
    # Primary intent
    if getattr(response, 'primary_intent', None) == "BENEFITS_OVERVIEW":
        plans.append(_build_plan_step(
            'Benefits Agent Result',
            'benefits',
            (response.specialty, response.benefitsType, response.placeOfService, response.network),
            'BENEFITS_OVERVIEW',
            'primary',
        ))
    elif getattr(response, 'primary_intent', None) == "REVIEW_PROVIDERS":
        plans.append(_build_plan_step(
            'FindCare Agent Result',
            'findcare',
            (response.specialty,),
            'REVIEW_PROVIDERS',
            'primary',
        ))
    # Secondary intent
    if getattr(response, 'secondary_intent', None) == "BENEFITS_OVERVIEW":
        plans.append(_build_plan_step(
            'Benefits Agent Result (Secondary)',
            'benefits',
            (response.specialty, response.benefitsType, response.placeOfService, response.network),
            'BENEFITS_OVERVIEW',
            'secondary',
        ))
    elif getattr(response, 'secondary_intent', None) == "REVIEW_PROVIDERS":
        plans.append(_build_plan_step(
            'FindCare Agent Result (Secondary)',
            'findcare',
            (response.specialty,),
            'REVIEW_PROVIDERS',
            'secondary',
        ))
    return plans

==============================================================================================================

from pydantic import BaseModel
from strands import Agent, tool
from toon import encode

from locales import en, es
from models.writer.writer_model import model as writer_model

_PROVIDER_RESULTS_TITLES = (
    en.LOCALES["find_care"]["results_title"],
    es.LOCALES["find_care"]["results_title"],
)


@tool
def summarization_assistant(blocks: list) -> dict:
    class SummaryResponse(BaseModel):
        title: str = ""
        summary: str = ""
    """
    Summarize the blocks and return a title and summary for the user.
    """

    # Only keep dict blocks
    dict_blocks = [block for block in blocks if isinstance(block, dict)]
    # Use specialty from first valid block if available
    specialty = "unidentified"
    if dict_blocks:
        for block in dict_blocks:
            if 'header' in block and 'title' in block['header']:
                specialty = block['header']['title'].replace('Your Benefits for ', '')
                for provider_title in _PROVIDER_RESULTS_TITLES:
                    specialty = specialty.replace(provider_title, '')
                specialty = specialty.strip() or "unidentified"
                break
    try:
        blocks_json = encode(dict_blocks)
    except Exception:
        blocks_json = "[]"
    writer_prompt = (
        "Please compose a response containing a title and a verbose, friendly summary in JSON form like so:\n"
        '{"title":"Your Title","summary":"Your Summary"}'
        "\n\n"
        "Instructions for the summary:\n"
        "- Write in a warm, reassuring, and conversational tone, as if you are speaking directly to the user (e.g., 'Good news Alex, getting an arm MRI at an in-network doctor’s office is covered under your advanced imaging benefit.').\n"
        "- For each user journey present in the widgets (blocks), synthesize a summary in the same order as they appear in the blocks list. Each journey should be covered in its own paragraph(s), and the order of the summary must match the order of the blocks.\n"
        "- For each journey, write the summary in multiple paragraphs, with each important section (coverage, cost, requirements) as its own paragraph. Also each journey should have it's own paragraph.\n"
        "- Start each journey with a positive, friendly sentence about coverage.\n"
        "- In a new paragraph, clearly explain the costs step by step, including what the user will pay before and after meeting the deductible, and how the out-of-pocket maximum works, using real numbers from the data if available.\n"
        "- In a final paragraph for each journey, mention any important requirements (such as prior authorization) in a friendly, reassuring way (e.g., 'your doctor will take care of that for you!').\n"
        "- Use the specialty in the title and summary. The specialty name must be explicitly mentioned in the summary at least once, in a natural and relevant way.\n"
        "- Do NOT rely on the user's original utterance for the title; always use the specialty provided.\n"
        "- Synthesize all substantive information from the response_content and widgets into a natural, humanized summary, always mentioning the specialty and intent-based phrasing.\n"
        "- Avoid technical jargon and system/internal details. Do not expose unique identifiers or internal codes.\n\n"
        "- Do not include any emdashes in the summary.\n\n"
        "Provider summary update:\n"
        "- If the provider journey contains more than one provider, mention a few provider names (up to three) in the summary, instead of just stating the total number of providers. For example: 'There are few in-network providers near you, including Dr. Smith, Dr. Lee, and Dr. Patel.'\n"
        "- If only one provider is found, mention that provider by name. If none are found, state that no in-network providers were found.\n\n"
        "Formatting:\n"
        "- The summary must be returned as well-written paragraphs, with each important section as its own paragraph. Do not use headings, bullet points, or tables. Ensure the text is visually organized and easy to read, with clear separation between sections using paragraph breaks.\n"
        "- Each paragraph must be separated by a double newline ('\\n\\n').\n"
        "- The summary must include all user journeys in the order they are present in the widgets (blocks) response.\n\n"
        "Here is a sample summary for reference. Your output should closely follow this structure:\n\n"
        "Good news Alex, getting an arm MRI at an in-network doctor’s office is covered under your advanced imaging benefit.\n\n"
        "Since you haven’t met your $5,000 deductible yet, you would pay the full cost of the MRI until you meet your deductible. Once you meet your deductible, you would pay 20% of the cost of the MRI until you hit your $7,000 out-of-pocket max.\n\n\n"
        f"Widgets: {blocks_json}"
    )
    
    summarizer_agent = Agent(
        model=writer_model,
        system_prompt="You are a summarization expert for healthcare journeys. Return only the JSON object as specified in the prompt. Do not include any extra text.",
        tools=[]
    )
    writer_response = summarizer_agent.structured_output(
        output_model=SummaryResponse,
        prompt=writer_prompt
    )
    return {
        "title": writer_response.title,
        "response_summary": writer_response.summary,
        "blocks": dict_blocks
    }
================================================================================================================



