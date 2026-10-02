"""
Rule Engine Tools — LangGraph-compatible.

These are the 5 standard engine control tools, exposed as plain Python functions
(no @tool decorator) so they can be wrapped with LangChain's StructuredTool or
called directly from LangGraph nodes.

The agent's loop is always:
    engine_get_next_step() → [agent executes prescribed MCP/A2A call] → engine_execute_step(result_json)

Import and use:
    from engine.engine_tools import (
        engine_load_workflow,
        engine_get_next_step,
        engine_execute_step,
        engine_get_state,
        engine_set_context,
        get_workflow_engine,
        set_workflow_engine,
    )
"""

import json
import os
from pathlib import Path
from typing import Any, Optional

from engine.stateful_engine import StatefulEngine

# ── Singleton engine instance (one per request, reset at /deliver) ────────────

_engine: Optional[StatefulEngine] = None

WORKFLOWS_DIR = Path(__file__).resolve().parent / "workflows"

# CPT → workflow file mapping
CPT_TO_WORKFLOW = {
    "73721": "mri-lower-limb.workflow.json",
    "27447": "knee-replacement.workflow.json",
    "29881": "knee-replacement.workflow.json",
}

# Pathway keyword → workflow file mapping (fallback when no CPT)
PATHWAY_TO_WORKFLOW = {
    "mri": "mri-lower-limb.workflow.json",
    "mri-lower-limb": "mri-lower-limb.workflow.json",
    "knee": "knee-replacement.workflow.json",
    "knee-replacement": "knee-replacement.workflow.json",
    "knee-surgery": "knee-replacement.workflow.json",
}


def get_workflow_engine() -> Optional[StatefulEngine]:
    return _engine


def set_workflow_engine(engine: StatefulEngine):
    global _engine
    _engine = engine


def reset_workflow_engine():
    global _engine
    _engine = None


# ── Workflow selection ─────────────────────────────────────────────────────────

def resolve_workflow_path(cpt: Optional[str] = None, pathway: Optional[str] = None) -> str:
    """
    Resolve the workflow JSON file path from a CPT code or pathway identifier.
    Returns the absolute path to the workflow file.
    Raises FileNotFoundError if no matching workflow is found.
    """
    filename = None

    if cpt:
        filename = CPT_TO_WORKFLOW.get(str(cpt).strip())

    if not filename and pathway:
        key = str(pathway).lower().strip()
        filename = PATHWAY_TO_WORKFLOW.get(key)
        if not filename:
            # Partial match
            for k, v in PATHWAY_TO_WORKFLOW.items():
                if k in key or key in k:
                    filename = v
                    break

    if not filename:
        raise FileNotFoundError(
            f"No workflow found for CPT={cpt!r}, pathway={pathway!r}. "
            f"Available CPTs: {list(CPT_TO_WORKFLOW)}, pathways: {list(PATHWAY_TO_WORKFLOW)}"
        )

    path = WORKFLOWS_DIR / filename
    if not path.exists():
        raise FileNotFoundError(f"Workflow file not found: {path}")

    return str(path)


# ── Engine tool functions (plain Python — wrap as StructuredTool in app.py) ───

def engine_load_workflow(cpt: Optional[str] = None,
                         pathway: Optional[str] = None,
                         initial_context: Optional[dict] = None) -> str:
    """
    Initialize the rule engine for a specific care pathway.

    Must be called once at the start of each /deliver request before any
    engine_get_next_step calls.

    Args:
        cpt: CPT procedure code (e.g. '73721', '27447'). Used to select workflow.
        pathway: Pathway identifier (e.g. 'knee-replacement', 'mri-lower-limb').
                 Used as fallback if CPT is not provided or not recognized.
        initial_context: Dict of context values to pre-load (member_id, mcid,
                         auth_id, signal_data, etc.).

    Returns:
        JSON string with workflow info and the first step to execute.
    """
    global _engine

    print(f"[RULES ENGINE] engine_load_workflow called — CPT={cpt!r}, pathway={pathway!r}")

    try:
        workflow_path = resolve_workflow_path(cpt=cpt, pathway=pathway)
    except FileNotFoundError as e:
        print(f"[RULES ENGINE] Workflow file not found: {e}")
        return json.dumps({"status": "error", "message": str(e)})

    print(f"[RULES ENGINE] Loading workflow: {os.path.basename(workflow_path)}")
    _engine = StatefulEngine(workflow_path)

    if initial_context:
        for key, value in initial_context.items():
            _engine.set_context(key, value)
        print(f"[RULES ENGINE] Pre-loaded context keys: {list(initial_context.keys())}")

    first_step = _engine.get_current_step()
    print(f"[RULES ENGINE] Workflow ready — first step: [{first_step.get('step_index', '?')}] {first_step.get('node_name', '?')} (tool={first_step.get('tool', '?')})")

    return json.dumps({
        "status": "loaded",
        "workflow": os.path.basename(workflow_path),
        "cpt": cpt,
        "pathway": pathway,
        "first_step": first_step,
    }, indent=2)


def engine_get_next_step() -> str:
    """
    Get the current step the agent must execute.

    The engine controls step order. Each call returns exactly one step with:
      - tool: the tool the agent should call
      - description: what the step does
      - instructions: specific rules for this step (question wording, field selection, etc.)
      - context_key: where to store the result when calling engine_execute_step

    Returns:
        JSON with step details. If status == 'complete', the workflow is done
        and the agent should assemble and return the final care package.
    """
    if not _engine:
        print("[RULES ENGINE] ERROR: engine_get_next_step called but engine is not initialized.")
        return json.dumps({"status": "error", "message": "Engine not initialized. Call engine_load_workflow first."})

    step = _engine.get_current_step()
    if step.get("status") == "complete":
        print(f"[RULES ENGINE] engine_get_next_step → COMPLETE ({step.get('steps_completed', '?')} steps finished)")
    else:
        print(f"[RULES ENGINE] engine_get_next_step → step [{step.get('step_index', '?')}] "
              f"\"{step.get('node_name', '?')}\" (tool={step.get('tool', '?')})")
    return json.dumps(step, indent=2)


def engine_execute_step(result_json: str) -> str:
    """
    Submit the result of the current step and advance the engine.

    The result must include any values the engine needs for branching:
      - For the auth step: include {"auth_status": "approved"|"denied"|"pending", ...}
      - For all other steps: include the raw tool response

    Args:
        result_json: JSON string with the tool call result.

    Returns:
        JSON with confirmation, steps_completed, is_complete, and next_action.
        If next_action == 'complete', call engine_get_next_step() to confirm
        and then assemble the care package from accumulated context.
    """
    if not _engine:
        print("[RULES ENGINE] ERROR: engine_execute_step called but engine is not initialized.")
        return json.dumps({"status": "error", "message": "Engine not initialized. Call engine_load_workflow first."})

    # Get current step name before advancing (for logging)
    current_step = _engine.get_current_step()
    current_name = current_step.get("node_name", "?")
    current_tool = current_step.get("tool", "?")

    try:
        result_data = json.loads(result_json)
    except (json.JSONDecodeError, TypeError):
        result_data = result_json

    response = _engine.execute_step(result_data)

    steps_done = response.get("steps_completed", "?")
    is_complete = response.get("is_complete", False)
    next_action = response.get("next_action", "?")

    print(f"[RULES ENGINE] engine_execute_step — recorded \"{current_name}\" (tool={current_tool}) "
          f"| steps_completed={steps_done} | next_action={next_action}"
          + (" ← WORKFLOW COMPLETE" if is_complete else ""))

    return json.dumps(response, indent=2)


def engine_get_state() -> str:
    """
    Get current workflow progress from the rules engine.

    The engine is a pure state machine — it tracks which steps are done and
    what comes next. It does NOT store tool response data. Use this to check
    completion status and the execution trace.

    Returns:
        JSON with step progress, completion flag, and execution trace.
    """
    if not _engine:
        return json.dumps({"status": "ok", "message": "Engine not initialized."})

    state = _engine.get_state()

    return json.dumps({
        "status": "ok",
        "progress": f"{state['current_step_index']} of {state['total_nodes']} steps completed",
        "complete": state["complete"],
        "execution_trace": state["execution_trace"],
    }, indent=2, default=str)


def engine_set_context(key: str, value: Any) -> str:
    """
    Inject a value into the engine context.

    Used to store auth_status, member_id, or other values the engine
    needs for branching before the relevant tool call completes.

    Args:
        key: Context key name (e.g. 'auth_status', 'member_id').
        value: Value to store.

    Returns:
        JSON confirmation.
    """
    if not _engine:
        return json.dumps({"status": "error", "message": "Engine not initialized."})

    _engine.set_context(key, value)
    return json.dumps({"status": "ok", "key": key, "stored": True})

=========================================================================================================

"""
StatefulEngine — Lightweight stateful engine for workflows.

Adapted from agentic-sop-automation/core/engine/gorules_stateful_engine.py.
Simplified for the use case: all nodes are functionNodes (data-retrieval
or assembly steps) or switchNodes (auth-status branching). No user Q&A.

No zen-engine / GoRules dependency — routing is done via simple edge-following
on a plain JSON graph. This keeps the service free of the Rust
zen-engine binary while preserving the same deterministic step-control pattern.

Node types used:
  - functionNode  : a data-retrieval or assembly step the agent must execute
  - switchNode    : branches on a context value (e.g. auth_status)
  - inputNode     : entry point (auto-skipped)
  - outputNode    : terminal node (signals completion)
"""

import json
import os
from collections import deque
from datetime import datetime
from typing import Any, Dict, List, Optional, Set


class StatefulEngine:
    """
    Edge-following stateful engine for data-gathering workflows.

    The agent loop is always:
        get_current_step() → [agent calls the prescribed MCP/A2A tool] → execute_step(result)

    The engine controls ordering and branching; the LLM controls execution.
    """

    def __init__(self, workflow_path: str):
        self._workflow_path = workflow_path

        with open(workflow_path) as f:
            self._workflow = json.load(f)

        self._nodes: Dict[str, dict] = {n["id"]: n for n in self._workflow["nodes"]}
        self._edges: List[dict] = self._workflow["edges"]

        # Adjacency maps
        self._outgoing: Dict[str, List[dict]] = {}   # node_id → [edge objects]
        self._incoming: Dict[str, List[str]] = {}    # node_id → [source node_ids]
        for edge in self._edges:
            self._outgoing.setdefault(edge["sourceId"], []).append(edge)
            self._incoming.setdefault(edge["targetId"], []).append(edge["sourceId"])

        # Traversal state
        self._current_node_id: Optional[str] = None
        self._pending: deque = deque()
        self._completed: Set[str] = set()
        self._waiting: Dict[str, Set[str]] = {}

        # Runtime context (populated by the agent via execute_step)
        self._context: Dict[str, Any] = {}
        self._execution_trace: List[dict] = []
        self._steps_completed: int = 0
        self._complete: bool = False

        self._initialize_traversal()

    @classmethod
    def from_dict(cls, workflow: dict) -> "StatefulEngine":
        """Initialise the engine from a workflow dict (no file required)."""
        instance = cls.__new__(cls)
        instance._workflow_path = "<in-memory>"
        instance._workflow = workflow
        instance._nodes = {n["id"]: n for n in workflow["nodes"]}
        instance._edges = workflow["edges"]
        instance._outgoing = {}
        instance._incoming = {}
        for edge in instance._edges:
            instance._outgoing.setdefault(edge["sourceId"], []).append(edge)
            instance._incoming.setdefault(edge["targetId"], []).append(edge["sourceId"])
        instance._current_node_id = None
        instance._pending = deque()
        instance._completed = set()
        instance._waiting = {}
        instance._context = {}
        instance._execution_trace = []
        instance._steps_completed = 0
        instance._complete = False
        instance._initialize_traversal()
        return instance

    # ──────────────────────────────────────────────────────────────
    # INITIALIZATION
    # ──────────────────────────────────────────────────────────────

    def _initialize_traversal(self):
        """Find inputNode and enqueue its successors to start traversal."""
        for nid, node in self._nodes.items():
            if node["type"] == "inputNode":
                self._completed.add(nid)
                self._enqueue_successors(nid, None)
                break
        self._advance_to_next()

    # ──────────────────────────────────────────────────────────────
    # TRAVERSAL HELPERS
    # ──────────────────────────────────────────────────────────────

    def _enqueue_successors(self, node_id: str, switch_value: Optional[str]):
        """
        Follow outgoing edges from node_id and enqueue reachable successors.
        For switchNodes: only follow edges whose condition matches switch_value.
        For all others: follow all outgoing edges.
        """
        outgoing = self._outgoing.get(node_id, [])
        node = self._nodes.get(node_id, {})

        if node.get("type") == "switchNode":
            # Only follow edges that match the switch value
            matched = False
            for edge in outgoing:
                condition = edge.get("condition")  # e.g. "approved", "denied", "pending"
                if condition is None or condition == switch_value or condition == "*":
                    target_id = edge["targetId"]
                    if target_id not in self._completed:
                        self._try_enqueue(target_id)
                    matched = True
            if not matched:
                # Default: follow all edges (fail-open so workflow doesn't stall)
                for edge in outgoing:
                    target_id = edge["targetId"]
                    if target_id not in self._completed:
                        self._try_enqueue(target_id)
        else:
            for edge in outgoing:
                target_id = edge["targetId"]
                if target_id not in self._completed:
                    self._try_enqueue(target_id)

    def _try_enqueue(self, node_id: str):
        """Enqueue a node only if all its predecessors are already completed."""
        if node_id in self._completed:
            return
        if node_id in self._pending:
            return

        predecessors = self._incoming.get(node_id, [])
        unmet = [p for p in predecessors if p not in self._completed]

        if not unmet:
            self._pending.append(node_id)
        else:
            self._waiting[node_id] = set(unmet)

    def _check_waiting(self):
        """After completing a node, promote any waiting nodes that are now unblocked."""
        newly_ready = []
        for node_id in list(self._waiting):
            remaining = {p for p in self._incoming.get(node_id, []) if p not in self._completed}
            if not remaining:
                newly_ready.append(node_id)

        for node_id in newly_ready:
            del self._waiting[node_id]
            if node_id not in self._completed and node_id not in self._pending:
                self._pending.append(node_id)

    def _advance_to_next(self):
        """
        Advance internal pointer to the next node that requires agent action.
        Auto-skips terminal nodes (inputNode, outputNode).
        Handles switchNodes inline (reads auth_status from context, follows edge).
        """
        while self._pending:
            candidate = self._pending[0]
            node = self._nodes.get(candidate)
            if not node:
                self._pending.popleft()
                continue

            ntype = node["type"]

            # Skip terminal/pass-through nodes
            if ntype in ("inputNode", "outputNode"):
                self._pending.popleft()
                self._completed.add(candidate)
                if ntype == "outputNode":
                    self._complete = True
                else:
                    self._enqueue_successors(candidate, None)
                    self._check_waiting()
                continue

            # SwitchNode: evaluate inline, follow the matching edge
            if ntype == "switchNode":
                self._pending.popleft()
                context_key = node.get("content", {}).get("context_key", "auth_status")
                switch_value = self._context.get(context_key)
                print(f"[RULES ENGINE] SwitchNode \"{node['name']}\" — "
                      f"context_key={context_key!r}, value={switch_value!r} "
                      f"→ following '{switch_value}' branch")
                self._completed.add(candidate)
                self._steps_completed += 1
                self._execution_trace.append({
                    "step_index": self._steps_completed,
                    "node_id": candidate,
                    "node_name": node["name"],
                    "node_type": "switchNode",
                    "switch_value": switch_value,
                    "timestamp": datetime.now().isoformat(),
                })
                self._enqueue_successors(candidate, switch_value)
                self._check_waiting()
                continue

            # functionNode — requires agent execution; stop here
            self._current_node_id = self._pending.popleft()
            node_content = self._nodes[self._current_node_id].get("content", {})
            print(f"[RULES ENGINE] Next step for agent: "
                  f"[{self._steps_completed + 1}] \"{self._nodes[self._current_node_id]['name']}\" "
                  f"(tool={node_content.get('tool', '?')})")
            return

        # Queue empty
        self._current_node_id = None
        self._complete = True
        print("[RULES ENGINE] Workflow traversal complete — all steps finished.")

    # ──────────────────────────────────────────────────────────────
    # PUBLIC API
    # ──────────────────────────────────────────────────────────────

    def get_current_step(self) -> dict:
        """Return the current step the agent should execute."""
        if self._complete or self._current_node_id is None:
            self._complete = True
            return {
                "status": "complete",
                "message": "Workflow execution is complete. Assemble and return the care package.",
                "steps_completed": self._steps_completed,
                "context_keys": list(self._context.keys()),
            }

        node = self._nodes[self._current_node_id]
        content = node.get("content", {})

        return {
            "status": "pending",
            "step_index": self._steps_completed + 1,
            "node_id": self._current_node_id,
            "node_name": node["name"],
            "node_type": node["type"],
            "tool": content.get("tool"),
            "description": content.get("description", node["name"]),
            "instructions": content.get("instructions", ""),
            "context_key": content.get("context_key"),   # where to store the result
            "available_context_keys": list(self._context.keys()),
        }

    def execute_step(self, result: Any) -> dict:
        """
        Mark the current step as done and advance the engine.

        The engine is a pure state machine tracking workflow graph progress.
        It does NOT store tool response data. The only exception is auth_status
        for switchNode branching — pass {"auth_status": "approved"|"denied"|"pending"}
        when completing an auth step so the engine can follow the correct branch.

        Args:
            result: Ignored for data steps. For auth/switch steps, pass a dict
                    with {"auth_status": "approved"|"denied"|"pending"}.

        Returns:
            dict with status, next_action, and whether the workflow is complete.
        """
        if self._complete or self._current_node_id is None:
            return {"status": "error", "message": "Workflow is already complete or not started."}

        node_id = self._current_node_id
        node = self._nodes[node_id]
        content = node.get("content", {})
        context_key = content.get("context_key")

        # The engine only extracts auth_status from the result for switchNode branching.
        # All other data stays in the LLM's conversation history — never in engine state.
        switch_value = None
        if isinstance(result, dict):
            switch_value = result.get("auth_status")

        # Record trace (step name + key only — no data values)
        self._completed.add(node_id)
        self._steps_completed += 1
        self._execution_trace.append({
            "step_index": self._steps_completed,
            "node_id": node_id,
            "node_name": node["name"],
            "node_type": node["type"],
            "context_key": context_key,
            "timestamp": datetime.now().isoformat(),
        })

        # Advance
        self._enqueue_successors(node_id, switch_value)
        self._check_waiting()
        self._advance_to_next()

        return {
            "status": "success",
            "recorded_step": node["name"],
            "steps_completed": self._steps_completed,
            "is_complete": self._complete,
            "next_action": "complete" if self._complete else "get_next_step",
        }

    def set_context(self, key: str, value: Any):
        """Inject a value into context (used at workflow init)."""
        self._context[key] = value

    def get_context(self) -> dict:
        # Engine context holds only auth_status for switchNode branching.
        # Data from tool responses is never stored here.
        return {"context_keys": list(self._context.keys())}

    def get_state(self) -> dict:
        return {
            "current_step_index": self._steps_completed,
            "total_nodes": len([n for n in self._nodes.values() if n["type"] == "functionNode"]),
            "complete": self._complete,
            "pending_count": len(self._pending),
            "waiting_count": len(self._waiting),
            "execution_trace": self._execution_trace,
        }

===========================================================================================================

"""
step_generator.py
=================
Two-stage LLM pipeline: SKILL.md → notepad_steps.md → workflow.json

Stage 1 — Steps LLM
    Reads the SKILL.md business document and produces a plain-English
    numbered step list written to notepad/notepad_steps.md.

Stage 2 — Workflow LLM
    Reads notepad_steps.md and produces a GoRules-compatible workflow JSON
    written to notepad/workflow.json.

    After writing, the JSON is validated by attempting to load it into a
    StatefulEngine. If the engine raises an error the failure message
    is fed back to the Workflow LLM for a corrected attempt (up to MAX_RETRIES).

Both files are written to disk for auditability and can be inspected after
any run. They are overwritten on each load_skill call.
"""

import json
import os
from pathlib import Path

from horizon_llm import HorizonAnthropicModel
from langchain_core.messages import HumanMessage, SystemMessage

MAX_RETRIES = 3  # max JSON fix attempts if validation fails

# ── Available tools catalogue (shown to both LLMs) ───────────────────────────

TOOLS_CATALOGUE = """\
Available tools and their context_key:
  get_prior_auth                  → context_key: prior_auth
  send_to_benefits_agent          → context_key: benefits
  get_member                      → context_key: member_info
  get_member_contact_preferences  → context_key: contact_prefs
  get_provider_network            → context_key: providers
  assemble_care_package           → context_key: care_package
  assemble_denial_package         → context_key: care_package
"""

# ── Stage 1 prompt: business doc → plain-English steps ───────────────────────

STEPS_SYSTEM_PROMPT = f"""\
You are a workflow analyst for a health-care AI agent platform.

You will be given a SKILL.md — a business document describing what a Pre-Care
agent must deliver to a health-plan member: which data is required, what
sections go in the output, tone rules, and data-integrity rules.

Your task: read the document and write a numbered plain-English step list that
covers every data-gathering action the agent must take, followed by an assembly
step. This list will later be converted into an executable workflow.

Rules:
- Use only the tools listed in the catalogue below. Map each data need to the
  correct tool. Do not invent tools.
- get_prior_auth always comes first. If the skill mentions a denial path,
  note it: "If auth is denied → assemble_denial_package. Otherwise continue."
- Include get_member_contact_preferences when state, contact channel, or
  benefits preamble is mentioned.
- Include send_to_benefits_agent when cost share, deductible, coinsurance, or
  spending account data is needed.
- Include get_member when member name, plan, or eligibility is needed.
- Include get_provider_network only when the skill explicitly requires
  in-network providers or imaging centers. If the skill says leave providers
  empty, do NOT include this step.
- The last step is always assemble_care_package.
- Keep instructions concrete and derived from the skill — include the exact
  question wording, field-selection rules, and key caveats from the skill.
- CRITICAL: For the final assemble_care_package step, you MUST copy the ENTIRE
  contents of the "## Required JSON Output Format" section from the skill file
  verbatim into the Instructions field. This includes the full JSON schema
  example, all field names, all placeholder values, and all inline data-source
  instructions. Do NOT summarize or paraphrase it — the agent must see the
  exact field names (e.g. "table" not "table_rows", "amount" not "value_low")
  to produce a correctly structured output.

{TOOLS_CATALOGUE}

Output format — write ONLY the numbered steps, no preamble:

Step 1: <name>
Tool: <tool_name>
Instructions: <what the agent must do, derived from the skill document>
Branch (if applicable): If auth denied → assemble_denial_package. Otherwise continue.

Step 2: <name>
Tool: <tool_name>
Instructions: <...>

...

Step N: Assemble care package
Tool: assemble_care_package
Instructions: <COPY the full "## Required JSON Output Format" section from the skill file here verbatim>
"""

# ── Stage 2 prompt: plain-English steps → GoRules JSON ───────────────────────

WORKFLOW_SYSTEM_PROMPT = f"""\
You are a workflow engineer for a health-care AI agent platform.

You will be given a plain-English step list. Convert it into a valid GoRules-
compatible workflow JSON that can be loaded by the StatefulEngine.

Schema rules:
- Top-level keys: "description" (string), "nodes" (array), "edges" (array).
- Every node MUST have these top-level fields: "id", "type", and "name".
  "name" is a human-readable label (e.g. "Get Prior Auth Status"). Do NOT omit it.
- Node types:
    inputNode   — exactly one, id="start", name="Start", no "content"
    outputNode  — exactly one, id="end", name="End", no "content"
    functionNode — one per data-gathering or assembly step; top-level fields: id, type, name;
        plus "content" with:
        "tool"        (string, from catalogue)
        "description" (string, one sentence)
        "instructions" (string, detailed)
        "context_key" (string, from catalogue)
    switchNode  — inserted after get_prior_auth when a denial branch exists:
        id="auth_branch", name="Auth Branch", content has "context_key": "auth_status"
- Edge keys: "id" (string), "sourceId", "targetId", optional "condition"
  ("approved"/"pending"/"denied" on edges from auth_branch only).
- Denial path: auth_branch denied edge → a denial functionNode
  (tool: assemble_denial_package), then → end.
- Approved/pending edges from auth_branch both go to the next regular step.
- All other edges are unconditional (no "condition" key).
- Node ids must be unique snake_case strings.
- Edge ids must be unique: e1, e2, e3, ...

Example node structure:
{{
  "id": "get_prior_auth",
  "type": "functionNode",
  "name": "Get Prior Auth Status",
  "content": {{
    "tool": "get_prior_auth",
    "description": "Retrieve current prior authorization status.",
    "instructions": "Call get_prior_auth to retrieve the auth status for the member.",
    "context_key": "prior_auth"
  }}
}}

{TOOLS_CATALOGUE}

Return ONLY the raw JSON object — no markdown, no explanation, no code fences.
Start with {{ and end with }}.
"""

WORKFLOW_FIX_PROMPT = """\
The workflow JSON you produced failed validation with this error:

{error}

Here is the JSON that failed:

{bad_json}

Fix the JSON so it passes validation. Return ONLY the corrected raw JSON object.
Start with {{ and end with }}.
"""


def _llm(max_tokens: int = 2000) -> HorizonAnthropicModel:
    return HorizonAnthropicModel(model="claude-sonnet-4-6", max_tokens=max_tokens, timeout=120)


def _call(system: str, user: str, max_tokens: int = 2000) -> str:
    result = _llm(max_tokens).invoke([
        SystemMessage(content=system),
        HumanMessage(content=user),
    ])
    return result.content.strip()


def _normalise_workflow(workflow: dict) -> dict:
    """
    Auto-repair common LLM omissions before validation:
    - Inject a top-level "name" field for any node missing it,
      derived from content.description or the node id.
    """
    for node in workflow.get("nodes", []):
        if "name" not in node:
            content = node.get("content") or {}
            node["name"] = (
                content.get("description")
                or node.get("id", "step").replace("_", " ").title()
            )
    return workflow


def _validate_workflow(workflow: dict) -> str | None:
    """
    Try to load the workflow dict into StatefulEngine.
    Returns None if valid, or an error string if not.
    """
    try:
        from engine.stateful_engine import StatefulEngine
        StatefulEngine.from_dict(workflow)
        return None
    except Exception as e:
        return str(e)


def generate_workflow(
    skill_content: str,
    skill_name: str,
    notepad_dir: str,
) -> dict:
    """
    Full two-stage pipeline: SKILL.md → notepad_steps.md → workflow.json.

    Args:
        skill_content:  Full text of the SKILL.md business document.
        skill_name:     Human-readable name (used in descriptions and headers).
        notepad_dir:    Absolute path to the notepad/ directory.

    Returns:
        Validated workflow dict ready for StatefulEngine.from_dict().

    Raises:
        RuntimeError if the workflow cannot be validated after MAX_RETRIES.
    """
    notepad_path = Path(notepad_dir)
    notepad_path.mkdir(parents=True, exist_ok=True)

    # ── Stage 1: business doc → plain-English steps ──────────────────────────
    print(f"[STEP GEN] Stage 1: deriving steps from skill '{skill_name}'")
    steps_text = _call(
        system=STEPS_SYSTEM_PROMPT,
        user=f"Skill: {skill_name}\n\n---\n\n{skill_content}",
        max_tokens=1500,
    )

    steps_file = notepad_path / "notepad_steps.md"
    steps_file.write_text(
        f"# notepad_steps.md\n"
        f"# Auto-generated from skill: {skill_name}\n"
        f"# DO NOT HAND-EDIT — regenerated on every load_skill call.\n\n"
        + steps_text + "\n"
    )
    print(f"[STEP GEN] Stage 1 complete — steps written to {steps_file.name}")

    # ── Stage 2: plain-English steps → GoRules JSON (with validation loop) ───
    print(f"[STEP GEN] Stage 2: converting steps to workflow JSON")
    raw_json = _call(
        system=WORKFLOW_SYSTEM_PROMPT,
        user=f"Convert these steps for skill '{skill_name}' to workflow JSON:\n\n{steps_text}",
        max_tokens=4096,
    )

    for attempt in range(1, MAX_RETRIES + 2):  # +1 for initial attempt
        # Strip any accidental markdown fences
        raw_json = raw_json.strip()
        if raw_json.startswith("```"):
            raw_json = "\n".join(
                l for l in raw_json.splitlines()
                if not l.strip().startswith("```")
            ).strip()

        try:
            workflow = json.loads(raw_json)
            workflow = _normalise_workflow(workflow)
        except json.JSONDecodeError as e:
            error_msg = f"JSON parse error: {e}"
            print(f"[STEP GEN] Attempt {attempt}: JSON parse failed — {e}")
        else:
            error_msg = _validate_workflow(workflow)
            if error_msg is None:
                print(f"[STEP GEN] Stage 2 complete — workflow valid on attempt {attempt}")
                break
            print(f"[STEP GEN] Attempt {attempt}: engine validation failed — {error_msg}")

        if attempt > MAX_RETRIES:
            raise RuntimeError(
                f"Could not generate a valid workflow JSON for skill '{skill_name}' "
                f"after {MAX_RETRIES + 1} attempts. Last error: {error_msg}"
            )

        # Ask the LLM to fix its output
        print(f"[STEP GEN] Asking LLM to fix workflow JSON (attempt {attempt + 1})")
        raw_json = _call(
            system=WORKFLOW_SYSTEM_PROMPT,
            user=WORKFLOW_FIX_PROMPT.format(error=error_msg, bad_json=raw_json),
            max_tokens=4096,
        )

    # Write validated workflow to disk
    workflow_file = notepad_path / "workflow.json"
    workflow_file.write_text(json.dumps(workflow, indent=2))
    step_count = sum(1 for n in workflow["nodes"] if n["type"] == "functionNode")
    print(f"[STEP GEN] Wrote workflow.json ({step_count} functionNodes) to {notepad_dir}/")

    return workflow
========================================================================================================

# Journey Executor — Available Tools

This document is the authoritative reference for every tool the Journey Executor agent can call.
Workflow JSON files must use the exact tool names listed here.

---

## 1. EDP Member MCP

**Source:** `edpmcp/app.py`
**Transport:** streamable-http MCP

### `get_member`

Retrieves member eligibility and demographics from the EDP Member API. Returns member name, MCID, member UID, source system ID, coverage details (contract code, group ID, network code, effective/termination dates), and contract group information.

**Signature:**
```
get_member(member_id: str, environment: str = "UAT", consolidate: bool = True) -> dict
```

**Arguments:**
| Argument | Type | Required | Description |
|---|---|---|---|
| `member_id` | `str` | Yes | Health Card ID (HCID), e.g. `"141Y36060"` |
| `environment` | `str` | No | `"UAT"` (default) or `"SIT"` |
| `consolidate` | `bool` | No | `true` (default) — returns simplified structure |

**Workflow usage:**
```json
{
  "tool": "get_member",
  "context_key": "member_info"
}
```

**Notes:**
- Always read the actual `member_id` value from engine context before calling (use `engine_get_state`).
- Do NOT pass the string `"member_id"` — pass its value, e.g. `"141Y36060"`.
- Returns `{"status": "not_found", ...}` if no member is found for the given HCID.

---

## 2. EDP Contact Preferences MCP

**Source:** `edp_contact_pref/app.py`
**Transport:** streamable-http MCP

### `get_member_contact_preferences`

Retrieves the member's contact channel preferences from the EDP Contact Preferences API. Returns outreach channels (email, SMS, push), opt-in flags, preferred address, language preferences, and member identifiers.

**Signature:**
```
get_member_contact_preferences(mcid: str, consolidate: bool = True) -> dict
```

**Arguments:**
| Argument | Type | Required | Description |
|---|---|---|---|
| `mcid` | `str` | Yes | Member Contract ID (MCID), e.g. `"389852203"` |
| `consolidate` | `bool` | No | `true` (default) — returns simplified structure |

**Workflow usage:**
```json
{
  "tool": "get_member_contact_preferences",
  "context_key": "contact_prefs"
}
```

**Notes:**
- Always read the actual `mcid` value from engine context before calling (use `engine_get_state`).
- Do NOT pass the string `"mcid"` — pass its value, e.g. `"389852203"`.
- Returns `{"status": "no_preferences", ...}` if no preferences are found.

---

## 3. Benefits A2A Agent

**Source:** `benefitsagent/app.py`
**Transport:** A2A / JSONRPC

### `send_to_benefits_agent`

Delegates a natural-language benefits inquiry to the 5W A2A Healthcare Benefits Agent. Returns structured cost-share data including deductible, coinsurance percentage, out-of-pocket maximum (total, accumulated, and remaining), plan details, and a natural-language benefit explanation.

**Signature:**
```
send_to_benefits_agent(task: str) -> str
```

**Arguments:**
| Argument | Type | Required | Description |
|---|---|---|---|
| `task` | `str` | Yes | Natural-language benefits question including the real member_id and procedure name |

**Example task string:**
```
"For member 141Y36060, what are my deductible, coinsurance, and out-of-pocket maximum
for Total Knee Arthroplasty? How much have I met so far this year, and how much is
remaining? Do I have a spending account?"
```

**Workflow usage:**
```json
{
  "tool": "send_to_benefits_agent",
  "context_key": "benefits"
}
```

**Notes:**
- Always substitute the actual `member_id` value into the task string before calling.
- Look up benefits at the journey level (e.g. `"Total Knee Arthroplasty"`), not the imaging stage (not `"MRI Lower Extremity"`).
- The `benefits_summary.cost_shares` array in the response is the primary source for deductible, coinsurance, and OOP max values.

---

## 4. Provider Information MCP

**Source:** `provider_info_mcp/app.py` — DUMMY implementation, real integration pending
**Transport:** streamable-http MCP

### `get_provider_information`

Returns a list of in-network providers matching the given specialty and location, including facility name, address, phone, distance, estimated cost range, and a lowest-cost tag.

**Signature:**
```
get_provider_information(member_id: str, specialty: str = None, location: str = None, network_code: str = None) -> dict
```

**Arguments:**
| Argument | Type | Required | Description |
|---|---|---|---|
| `member_id` | `str` | Yes | Health Card ID (HCID) of the member |
| `specialty` | `str` | No | Clinical specialty, e.g. `"Orthopedic Surgery"`, `"Radiology"` |
| `location` | `str` | No | City, state, or zip, e.g. `"Milwaukee, WI"` |
| `network_code` | `str` | No | Plan network code to filter by, e.g. `"MOPPT100"` |

**Workflow usage:**
```json
{
  "tool": "get_provider_information",
  "context_key": "providers"
}
```

---

## 5. Claims Information MCP

**Source:** `claims_info_mcp/app.py` — DUMMY implementation, real integration pending
**Transport:** streamable-http MCP

### `get_claims_information`

Returns a member's claims history including dates, procedure codes, provider names, amounts billed, plan paid, member responsibility, and year-to-date deductible/OOP accumulations.

**Signature:**
```
get_claims_information(member_id: str, claim_type: str = None, date_from: str = None, date_to: str = None) -> dict
```

**Arguments:**
| Argument | Type | Required | Description |
|---|---|---|---|
| `member_id` | `str` | Yes | Health Card ID (HCID) of the member |
| `claim_type` | `str` | No | Filter by type: `"medical"`, `"pharmacy"`, `"dental"` |
| `date_from` | `str` | No | Start date in `YYYY-MM-DD` format |
| `date_to` | `str` | No | End date in `YYYY-MM-DD` format |

**Workflow usage:**
```json
{
  "tool": "get_claims_information",
  "context_key": "claims"
}
```

---

## 6. Medical History MCP

**Source:** `medical_history_mcp/app.py` — DUMMY implementation, real integration pending
**Transport:** streamable-http MCP

### `get_medical_history`

Returns a member's medical history including active diagnoses (ICD-10), past procedures (CPT), current medications, allergies, and relevant clinical context for the care journey.

**Signature:**
```
get_medical_history(member_id: str, category: str = None) -> dict
```

**Arguments:**
| Argument | Type | Required | Description |
|---|---|---|---|
| `member_id` | `str` | Yes | Health Card ID (HCID) of the member |
| `category` | `str` | No | Filter by category: `"diagnoses"`, `"medications"`, `"allergies"`, `"procedures"` |

**Workflow usage:**
```json
{
  "tool": "get_medical_history",
  "context_key": "medical_history"
}
```

---

## 7. Communications Agent

**Source:** `communications_agent/app.py` — DUMMY implementation, real dispatch pending
**Transport:** A2A / JSONRPC

### `send_to_communications_agent`

Sends a structured communication payload to the Communications Agent for dispatch via SMS, push notification, or email. The agent returns a delivery confirmation with a `communication_id`. Currently simulates dispatch without sending real messages.

**Signature:**
```
send_to_communications_agent(payload_json: str) -> str
```

**Arguments:**
| Argument | Type | Required | Description |
|---|---|---|---|
| `payload_json` | `str` | Yes | JSON string containing the full communication payload |

**Payload fields:**
| Field | Type | Required | Description |
|---|---|---|---|
| `member_id` | `str` | Yes | Health Card ID of the member |
| `mcid` | `str` | Yes | Member Contract ID |
| `channel` | `str` | Yes | `"sms"`, `"push"`, or `"email"` |
| `message` | `str` | Yes | Message text to send to the member |
| `template_id` | `str` | No | Template identifier, e.g. `"care-package-ready"` |
| `metadata` | `dict` | No | Any additional context to pass through |

**Example payload:**
```json
{
  "member_id": "141Y36060",
  "mcid": "389852203",
  "channel": "sms",
  "message": "Hi CARL, new information is available to help you review your knee MRI care options. Sign in to your member portal to view your care package.",
  "template_id": "care-package-ready"
}
```

**Workflow usage:**
```json
{
  "tool": "send_to_communications_agent",
  "context_key": "communication_result"
}
```

**Notes:**
- Always build the payload from real context values (member name, member_id, mcid, channel from contact_prefs).
- Check `contact_prefs.contact_preferences.sms_opt_in` before choosing `"sms"` as the channel.
- The response includes a `communication_id` for tracking.

---

## 8. Engine Control Tools

These tools control the rules engine state machine and are always available as part of the standard agent loop.

### `engine_get_next_step`

Returns the next step the agent must execute — including the tool name, instructions, and context key to store the result. When `status == "complete"`, all workflow steps are done.

```
engine_get_next_step() -> str  # JSON
```

---

### `engine_execute_step`

Records the result of the current step and advances the engine to the next node.

```
engine_execute_step(result_json: str) -> str  # JSON
```

| Argument | Type | Description |
|---|---|---|
| `result_json` | `str` | The tool's response serialized as a JSON string |

---

### `engine_get_state`

Returns current engine progress and all accumulated context key-value pairs. **Always call this before any MCP or A2A tool to read actual member_id, mcid, or other context values.**

```
engine_get_state() -> str  # JSON
```

---

### `engine_set_context`

Injects a value directly into the engine context by key. Useful for manually storing intermediate values the engine needs for branching.

```
engine_set_context(key: str, value: Any) -> str  # JSON
```

---

## Tool Registration Summary

All tools are registered with the agent at startup in `app.py`:

```python
agent = create_deep_agent(
    tools=ENGINE_TOOLS + [send_to_benefits_agent, send_to_communications_agent] + MCP_TOOLS
)
```

| Tool name (exact) | Source | Transport | Status |
|---|---|---|---|
| `get_member` | EDP MCP (`edpmcp/app.py`) | streamable-http MCP | Real |
| `get_member_contact_preferences` | Contact Prefs MCP (`edp_contact_pref/app.py`) | streamable-http MCP | Real |
| `send_to_benefits_agent` | Benefits A2A (`benefitsagent/app.py`) | A2A / JSONRPC | Real |
| `get_provider_information` | Provider Info MCP (`provider_info_mcp/app.py`) | streamable-http MCP | DUMMY |
| `get_claims_information` | Claims Info MCP (`claims_info_mcp/app.py`) | streamable-http MCP | DUMMY |
| `get_medical_history` | Medical History MCP (`medical_history_mcp/app.py`) | streamable-http MCP | DUMMY |
| `send_to_communications_agent` | Communications Agent (`communications_agent/app.py`) | A2A / JSONRPC | DUMMY |
| `engine_get_next_step` | `engine/engine_tools.py` | Local Python | Real |
| `engine_execute_step` | `engine/engine_tools.py` | Local Python | Real |
| `engine_get_state` | `engine/engine_tools.py` | Local Python | Real |
| `engine_set_context` | `engine/engine_tools.py` | Local Python | Real |

---

## Workflow JSON Reference

When writing a `.workflow.json` file, the `"tool"` field in each `functionNode` must exactly match one of the tool names in the table above. The `assemble_care_package` step should use `"tool": "engine_get_state"` — the agent calls it to read all accumulated context, then synthesizes the final output JSON from real data.

**Example node:**
```json
{
  "id": "get_member",
  "type": "functionNode",
  "name": "Get Member Information",
  "content": {
    "tool": "get_member",
    "description": "Retrieve member identity and plan details from EDP.",
    "instructions": "Call engine_get_state() first to get the actual member_id value, then call get_member with that value.",
    "context_key": "member_info"
  }
}
```


===============================================================================================================

"""
Journey Executor Agent
Executes pre-built rules engine workflows for member journeys
"""
import os
# Set UTF-8 encoding environment variable before other imports
os.environ['PYTHONIOENCODING'] = 'utf-8'

import sys
import json
import asyncio
import threading
import requests
import uuid
import httpx
from a2a.client import A2AClient, A2ACardResolver
from a2a.types import (
    AgentCard,
    AgentCapabilities,
    AgentSkill,
    MessageSendParams,
    SendMessageRequest,
    SendMessageResponse,
    SendMessageSuccessResponse,
    Task,
)
import re
from flask import Flask, request, jsonify
from deepagents import create_deep_agent
from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.tools import tool, StructuredTool
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.checkpoint.memory import MemorySaver
from pathlib import Path
from typing import Any, List, Dict, Optional, Union

from horizon_llm import HorizonAnthropicModel
from engine.stateful_engine import StatefulEngine



class RemoteAgentConnection:
    """
    A2A connection to a remote agent.
    Discovers the agent card from the well-known endpoint on first use,
    then sends natural-language tasks using the A2A message protocol.
    """

    def __init__(self, agent_url: str):
        self._base_url = agent_url.rstrip("/")
        self._card: AgentCard | None = None

    def _stub_card(self) -> AgentCard:
        return AgentCard(
            name="5W A2A Healthcare Agent",
            description="A2A-compliant healthcare agent that validates 5W framework messages and provides structured healthcare benefit responses.",
            url=self._base_url,
            version="1.0.0",
            defaultInputModes=["application/json", "text"],
            defaultOutputModes=["application/json", "text"],
            capabilities=AgentCapabilities(streaming=False),
            skills=[
                AgentSkill(
                    id="default",
                    name="Default Skill",
                    description="Default A2A skill for this agent.",
                    tags=["default"],
                )
            ],
        )

    def _resolve_card(self):
        """Lazy-resolve the agent card from the well-known endpoint (sync caller)."""
        if self._card is not None:
            return
        try:
            self._card = asyncio.run_coroutine_threadsafe(
                self._fetch_card(), _bg_loop
            ).result(timeout=30)
            print(f"[JOURNEY EXECUTOR] Agent card resolved: {self._card.name} @ {self._base_url}")
        except Exception as e:
            print(f"[JOURNEY EXECUTOR] Card resolution failed for {self._base_url}: {e} — using stub card")
            self._card = self._stub_card()

    async def _resolve_card_async(self):
        """Lazy-resolve the agent card — awaited on the shared loop (no deadlock)."""
        if self._card is not None:
            return
        try:
            self._card = await self._fetch_card()
            print(f"[JOURNEY EXECUTOR] Agent card resolved: {self._card.name} @ {self._base_url}")
        except Exception as e:
            print(f"[JOURNEY EXECUTOR] Card resolution failed for {self._base_url}: {e} — using stub card")
            self._card = self._stub_card()

    async def _fetch_card(self) -> AgentCard:
        async with httpx.AsyncClient(timeout=30, verify=False) as ac:
            resolver = A2ACardResolver(ac, self._base_url)
            return await resolver.get_agent_card()

    def send_message(self, task: str, context_id: str = None, task_id: str = None) -> list:
        """
        Send a natural-language task to the remote agent and return
        the response artifact parts (list of dicts with 'text' key).

        Args:
            task: Natural-language message to send.
            context_id: Optional context ID to continue an existing conversation.
            task_id: Optional task ID to continue an existing task.

        Returns:
            List of artifact part dicts from the response.
        """
        return asyncio.run_coroutine_threadsafe(
            self.send_message_async(task, context_id=context_id, task_id=task_id),
            _bg_loop
        ).result(timeout=120)

    async def send_message_async(self, task: str, context_id: str = None, task_id: str = None) -> list:
        """Async version of send_message — awaited directly on the journey's event loop."""
        await self._resolve_card_async()

        task_id    = task_id or str(uuid.uuid4())
        context_id = context_id or str(uuid.uuid4())
        message_id = str(uuid.uuid4())

        payload = {
            "message": {
                "role": "user",
                "parts": [{"type": "text", "text": task}],
                "messageId": message_id,
                "taskId": task_id,
                "contextId": context_id,
            }
        }
        message_request = SendMessageRequest(
            id=message_id,
            params=MessageSendParams.model_validate(payload)
        )

        async with httpx.AsyncClient(timeout=60, verify=False) as ac:
            client = A2AClient(ac, self._card, url=self._base_url)
            send_response = await client.send_message(message_request)

        print(f"[JOURNEY EXECUTOR] Response type: {type(send_response.root).__name__}")

        if not isinstance(send_response.root, SendMessageSuccessResponse):
            raise ValueError(f"A2A call failed: {send_response.root}")
        if not isinstance(send_response.root.result, Task):
            raise ValueError("A2A response is not a Task")

        response_json = json.loads(
            send_response.root.model_dump_json(exclude_none=True)
        )
        parts = []
        for artifact in response_json.get("result", {}).get("artifacts", []):
            parts.extend(artifact.get("parts", []))
        return parts

    def send_message_multi_turn(self, initial_task: str, max_turns: int = 3) -> dict:
        """Sync wrapper — delegates to the async implementation on the shared loop."""
        return asyncio.run_coroutine_threadsafe(
            self.send_message_multi_turn_async(initial_task, max_turns),
            _bg_loop
        ).result(timeout=300)

    async def send_message_multi_turn_async(self, initial_task: str, max_turns: int = 3) -> dict:
        """
        Send a task to the remote agent and continue the conversation until we
        get a complete, substantive response — or reach max_turns.

        Turn logic:
          1. Send the initial task.
          2. If the response looks like a deflection ("rephrase", "focus on"),
             resend with a more direct, rephrased version.
          3. If the response is substantive but missing key fields, send a
             targeted follow-up to fill the gaps.
          4. Stop when response is complete or max_turns is reached.

        Returns:
            Dict with keys:
              - "parts": final list of artifact parts
              - "turns": number of turns taken
              - "full_text": the final response text
        """
        # Shared context/task IDs so the agent treats all turns as one conversation
        context_id = str(uuid.uuid4())
        task_id    = str(uuid.uuid4())

        # Phrases that indicate the agent didn't understand the question
        deflection_patterns = [
            r"could you rephrase",
            r"rephrase your question",
            r"please clarify",
            r"not sure what you mean",
            r"could not understand",
            r"please provide more",
        ]

        # Keys we expect in a complete benefits response
        expected_benefit_keys = ["deductible", "out-of-pocket", "coinsurance", "oop"]

        current_task = initial_task
        parts = []
        full_text = ""

        for turn in range(1, max_turns + 1):
            print(f"[JOURNEY EXECUTOR] Benefits A2A — turn {turn}/{max_turns}: {current_task[:120]}")
            parts = await self.send_message_async(current_task, context_id=context_id, task_id=task_id)

            # The benefits agent returns one artifact ("benefit_response") whose text
            # is the entire JSON response blob. Parse it to extract structured data.
            raw_text = next((p.get("text", "") for p in parts if p.get("text")), "")
            full_text = raw_text

            # Try to parse the full response blob and extract structured plan data
            plan_data   = None
            benefit_explanation = ""
            try:
                blob = json.loads(raw_text)
                # benefits_summary.cost_shares holds the structured cost-share list
                summary = blob.get("benefits_summary", {})
                cost_shares = summary.get("cost_shares", [])
                plan_details = summary.get("plan_details", {})
                benefit_explanation = summary.get("benefit_explanation", "")

                if cost_shares:
                    plan_data = {
                        "plan_details": plan_details,
                        "cost_shares": cost_shares,
                    }
            except (json.JSONDecodeError, AttributeError):
                pass

            print(f"[JOURNEY EXECUTOR] Benefits A2A turn {turn} — has cost-share data: {plan_data is not None}")
            if benefit_explanation:
                print(f"[JOURNEY EXECUTOR] Benefits A2A turn {turn} — explanation: {benefit_explanation[:200]}")

            # If we have real structured cost-share data, we're done
            if plan_data is not None:
                print(f"[JOURNEY EXECUTOR] Benefits A2A — real cost-share data received on turn {turn}. Done.")
                # Omit benefit_explanation — it contains a canned deflection message from
                # the benefits agent even when structured data is successfully returned.
                full_text = json.dumps({
                    "plan_details": plan_data["plan_details"],
                    "cost_shares": plan_data["cost_shares"],
                })
                break

            # No structured data — check if the narrative is a deflection
            is_deflection = any(
                re.search(p, benefit_explanation or raw_text, re.IGNORECASE) for p in deflection_patterns
            )

            if is_deflection and turn < max_turns:
                print(f"[JOURNEY EXECUTOR] Benefits A2A — deflection detected on turn {turn}, rephrasing...")
                current_task = (
                    f"Using the member's plan data already retrieved, please provide: "
                    f"(1) the individual deductible amount and how much has been met so far this year, "
                    f"(2) the out-of-pocket maximum and how much remains, "
                    f"(3) the coinsurance percentage for in-network services, "
                    f"and (4) whether there is a health savings or spending account. "
                    f"Original question: {initial_task}"
                )
                continue

            # Response is as good as it's going to get
            print(f"[JOURNEY EXECUTOR] Benefits A2A — stopping after turn {turn} (deflection={is_deflection}).")
            break

        return {"parts": parts, "turns": turn, "full_text": full_text}


# Tool call recorder for capturing tool invocations
class ToolCallRecorder(BaseCallbackHandler):
    """Records each tool invocation (name, input, output) for trace events."""

    def __init__(self):
        self.calls = []
        self.run_id_to_call = {}  # Map run_id to call object for proper matching

    def on_tool_start(self, serialized, input_str, **kwargs):
        name = (serialized or {}).get("name", "tool")
        run_id = kwargs.get("run_id")
        call = {"name": name, "input": input_str, "output": None}
        self.calls.append(call)
        if run_id:
            self.run_id_to_call[str(run_id)] = call  # Store reference to call object

    def on_tool_end(self, output, **kwargs):
        # Match output to correct call using run_id
        text = getattr(output, "content", output)
        run_id = kwargs.get("run_id")

        if run_id and str(run_id) in self.run_id_to_call:
            # Use run_id to find the correct call
            self.run_id_to_call[str(run_id)]["output"] = str(text)
        else:
            # Fallback: find first call without output (old behavior)
            for call in self.calls:
                if call["output"] is None:
                    call["output"] = str(text)
                    break

app = Flask(__name__)
BASE_DIR = Path(__file__).resolve().parent

import builtins

def safe_print(message):
    """Print message with graceful Unicode error handling"""
    try:
        builtins.print(message)
    except UnicodeEncodeError:
        # Replace Unicode characters with ASCII equivalents for Windows console
        safe_message = str(message).encode('ascii', 'replace').decode('ascii')
        builtins.print(safe_message)

# Override built-in print with safe_print globally for this module
print = safe_print

# MCP URLs — localhost for local testing
EDP_MCP_URL = os.environ.get('EDP_MCP_URL', 'http://localhost:8081')
EDP_CONTACT_PREF_MCP_URL = os.environ.get('EDP_CONTACT_PREF_MCP_URL', 'http://localhost:8086')
BENEFITS_MCP_URL = os.environ.get('BENEFITS_MCP_URL', 'http://localhost:8082')
BENEFITS_A2A_URL = os.environ.get('BENEFITS_A2A_URL', 'http://localhost:8082')
PROVIDER_INFO_MCP_URL = os.environ.get('PROVIDER_INFO_MCP_URL', 'http://localhost:8083')
CLAIMS_INFO_MCP_URL = os.environ.get('CLAIMS_INFO_MCP_URL', 'http://localhost:8084')
MEDICAL_HISTORY_MCP_URL = os.environ.get('MEDICAL_HISTORY_MCP_URL', 'http://localhost:8085')
COMMUNICATIONS_A2A_URL = os.environ.get('COMMUNICATIONS_A2A_URL', 'http://localhost:8087')

_benefits_agent = RemoteAgentConnection(BENEFITS_A2A_URL)
_communications_agent = RemoteAgentConnection(COMMUNICATIONS_A2A_URL)

print(f"[JOURNEY EXECUTOR] Using EDP_MCP_URL={EDP_MCP_URL}, EDP_CONTACT_PREF_MCP_URL={EDP_CONTACT_PREF_MCP_URL}, BENEFITS_MCP_URL={BENEFITS_MCP_URL}")
print(f"[JOURNEY EXECUTOR] Using PROVIDER_INFO_MCP_URL={PROVIDER_INFO_MCP_URL}, CLAIMS_INFO_MCP_URL={CLAIMS_INFO_MCP_URL}, MEDICAL_HISTORY_MCP_URL={MEDICAL_HISTORY_MCP_URL}")
print(f"[JOURNEY EXECUTOR] Using COMMUNICATIONS_A2A_URL={COMMUNICATIONS_A2A_URL}")

# ── MCP Client Setup (streamable-http transport) ─────────────────────────────
_bg_loop = asyncio.new_event_loop()
threading.Thread(target=lambda: (_bg_loop.run_forever()), daemon=True).start()

def _run_async(coro):
    return asyncio.run_coroutine_threadsafe(coro, _bg_loop).result(timeout=120)

async def _load_mcp_tools():
    client = MultiServerMCPClient({
        "edp":              {"transport": "streamable_http", "url": f"{EDP_MCP_URL}/mcp"},
        "edp_contact_pref": {"transport": "streamable_http", "url": f"{EDP_CONTACT_PREF_MCP_URL}/mcp"},
        "provider_info":    {"transport": "streamable_http", "url": f"{PROVIDER_INFO_MCP_URL}/mcp"},
        "claims_info":      {"transport": "streamable_http", "url": f"{CLAIMS_INFO_MCP_URL}/mcp"},
        "medical_history":  {"transport": "streamable_http", "url": f"{MEDICAL_HISTORY_MCP_URL}/mcp"},
    })
    return await client.get_tools()

def _make_sync_tool(atool):
    def _fn(**kwargs):
        try:
            result = _run_async(atool.ainvoke(kwargs))

            # Normalise — result may be a ToolMessage, string, dict, or list
            if hasattr(result, "content"):
                raw = result.content
            else:
                raw = result

            # LangChain MCP tools return a list of content blocks: [{"type": "text", "text": "<json>"}]
            # Unwrap to the inner JSON string
            if isinstance(raw, list):
                text_blocks = [b.get("text", "") for b in raw if isinstance(b, dict) and b.get("type") == "text"]
                raw = text_blocks[0] if text_blocks else str(raw)

            output = json.dumps(raw) if isinstance(raw, (dict, list)) else str(raw)
            print(f"[JOURNEY EXECUTOR MCP RESULT] {atool.name}: {output[:500]}")
            return output
        except Exception as e:
            return json.dumps({"error": str(e), "tool": atool.name})
    return StructuredTool.from_function(
        func=_fn, name=atool.name,
        description=atool.description, args_schema=atool.args_schema
    )

def _make_async_tool(atool):
    async def _fn(**kwargs):
        try:
            result = await atool.ainvoke(kwargs)

            # Normalise — result may be a ToolMessage, string, dict, or list
            if hasattr(result, "content"):
                raw = result.content
            else:
                raw = result

            # LangChain MCP tools return a list of content blocks: [{"type": "text", "text": "<json>"}]
            # Unwrap to the inner JSON string
            if isinstance(raw, list):
                text_blocks = [b.get("text", "") for b in raw if isinstance(b, dict) and b.get("type") == "text"]
                raw = text_blocks[0] if text_blocks else str(raw)

            output = json.dumps(raw) if isinstance(raw, (dict, list)) else str(raw)
            print(f"[JOURNEY EXECUTOR MCP RESULT] {atool.name}: {output[:500]}")
            return output
        except Exception as e:
            return json.dumps({"error": str(e), "tool": atool.name})
    return StructuredTool.from_function(
        coroutine=_fn, name=atool.name,
        description=atool.description, args_schema=atool.args_schema
    )

try:
    _async_mcp_tools = _run_async(_load_mcp_tools())
    MCP_TOOLS = [_make_sync_tool(t) for t in _async_mcp_tools]
    MCP_TOOLS_ASYNC = [_make_async_tool(t) for t in _async_mcp_tools]
    print(f"[JOURNEY EXECUTOR] MCP tools loaded via SSE: {[t.name for t in MCP_TOOLS_ASYNC]}")
except Exception as e:
    print(f"[JOURNEY EXECUTOR] WARNING: Could not load MCP tools: {e}")
    MCP_TOOLS = []
    MCP_TOOLS_ASYNC = []


@tool
async def send_to_benefits_agent(task: str) -> str:
    """
    Delegate a complete benefits inquiry to the 5W A2A Healthcare Benefits Agent.

    The agent autonomously handles member lookup, cost-share calculation, and
    response formatting — pass a single natural-language task string.

    Args:
        task: Natural-language benefits question including member ID and procedure name

    Returns:
        JSON string with structured benefits response
    """
    print(f"[JOURNEY EXECUTOR] Delegating to Benefits A2A agent (multi-turn): {task[:120]}")
    try:
        result = await _benefits_agent.send_message_multi_turn_async(task, max_turns=3)
        turns = result["turns"]
        full_text = result["full_text"]
        parts = result["parts"]

        print(f"[JOURNEY EXECUTOR] Benefits A2A completed in {turns} turn(s)")

        if full_text:
            print(f"[JOURNEY EXECUTOR] Benefits A2A response ({len(full_text)} chars):\n{full_text}")
            return full_text

        if parts:
            return json.dumps(parts)

        return json.dumps({"error": "No response from Benefits agent"})
    except Exception as e:
        print(f"[JOURNEY EXECUTOR] Benefits A2A error: {str(e)}")
        return json.dumps({
            "error": str(e),
            "instruction": "Benefits agent unavailable."
        })


@tool
async def send_to_communications_agent(payload_json: str) -> str:
    """
    Send a structured communication payload to the Communications Agent.

    The agent handles dispatch via SMS, push notification, or email.
    Pass a JSON string with the full communication payload.

    Args:
        payload_json: JSON string containing the communication payload with fields:
            - member_id (str): Health Card ID of the member
            - mcid (str): Member Contract ID
            - channel (str): 'sms', 'push', or 'email'
            - message (str): The message text to send to the member
            - template_id (str, optional): Template identifier
            - metadata (dict, optional): Any additional context

    Returns:
        JSON string with delivery confirmation and communication_id
    """
    print(f"[JOURNEY EXECUTOR] Sending communication payload to Communications Agent")
    try:
        # Validate it's parseable JSON before sending
        try:
            payload_dict = json.loads(payload_json)
        except (json.JSONDecodeError, TypeError):
            payload_dict = {"message": str(payload_json)}

        print(f"[JOURNEY EXECUTOR] Communications Agent payload: {json.dumps(payload_dict, indent=2)}")
        parts = await _communications_agent.send_message_async(json.dumps(payload_dict))
        for part in parts:
            text = part.get("text", "")
            if text:
                print(f"[JOURNEY EXECUTOR] Communications Agent response ({len(text)} chars)")
                return text

        return json.dumps({"error": "No response from Communications Agent"})
    except Exception as e:
        print(f"[JOURNEY EXECUTOR] Communications Agent error: {str(e)}")
        return json.dumps({
            "error": str(e),
            "instruction": "Communications Agent unavailable."
        })


# ── Engine tool factory (per-journey — no shared engine state) ───────────────

from pydantic import BaseModel

class _EngineExecuteInput(BaseModel):
    result_json: str

class _EngineSetContextInput(BaseModel):
    key: str
    value: Any

def build_engine_tools(engine: StatefulEngine) -> list:
    """
    Build the engine control tools bound to ONE journey's engine instance.

    Each journey gets its own StatefulEngine, so the tools are closures over
    that specific engine — no module-level singleton, safe for concurrent runs.
    """
    def _get_next_step() -> str:
        step = engine.get_current_step()
        if step.get("status") == "complete":
            print(f"[RULES ENGINE] engine_get_next_step → COMPLETE ({step.get('steps_completed', '?')} steps finished)")
        else:
            print(f"[RULES ENGINE] engine_get_next_step → step [{step.get('step_index', '?')}] "
                  f"\"{step.get('node_name', '?')}\" (tool={step.get('tool', '?')})")
        return json.dumps(step, indent=2)

    def _execute_step(result_json: str) -> str:
        current_step = engine.get_current_step()
        current_name = current_step.get("node_name", "?")
        current_tool = current_step.get("tool", "?")

        try:
            result_data = json.loads(result_json)
        except (json.JSONDecodeError, TypeError):
            result_data = result_json

        response = engine.execute_step(result_data)

        next_step = engine.get_current_step()
        if not response.get("is_complete") and next_step.get("status") != "complete":
            print(f"[RULES ENGINE] Next step for agent: [{next_step.get('step_index', '?')}] "
                  f"\"{next_step.get('node_name', '?')}\" (tool={next_step.get('tool', '?')})")

        print(f"[RULES ENGINE] engine_execute_step — recorded \"{current_name}\" (tool={current_tool}) "
              f"| steps_completed={response.get('steps_completed', '?')} | next_action={response.get('next_action', '?')}"
              + (" ← WORKFLOW COMPLETE" if response.get("is_complete") else ""))

        return json.dumps(response, indent=2)

    def _get_state() -> str:
        state = engine.get_state()
        return json.dumps({
            "status": "ok",
            "progress": f"{state['current_step_index']} of {state['total_nodes']} steps completed",
            "complete": state["complete"],
            "execution_trace": state["execution_trace"],
        }, indent=2, default=str)

    def _set_context(key: str, value: Any) -> str:
        engine.set_context(key, value)
        return json.dumps({"status": "ok", "key": key, "stored": True})

    return [
        StructuredTool.from_function(
            func=_get_next_step,
            name="engine_get_next_step",
            description=(
                "Get the current step from the rule engine. "
                "Returns the tool to call, instructions, and where to store the result. "
                "When status == 'complete', all data-gathering steps are done — assemble the output."
            ),
        ),
        StructuredTool.from_function(
            func=_execute_step,
            name="engine_execute_step",
            description=(
                "Mark the current step as done and advance the engine. "
                "Pass a JSON string — for auth steps include auth_status for branching."
            ),
            args_schema=_EngineExecuteInput,
        ),
        StructuredTool.from_function(
            func=_get_state,
            name="engine_get_state",
            description="Check workflow progress — steps completed, execution trace, completion flag.",
        ),
        StructuredTool.from_function(
            func=_set_context,
            name="engine_set_context",
            description="Inject a value into the engine context by key (e.g. auth_status for branching).",
            args_schema=_EngineSetContextInput,
        ),
    ]


# Shared stateless singletons — safe across concurrent journeys
model = HorizonAnthropicModel(model="claude-sonnet-4-6", max_tokens=6000, timeout=1800)

# Per-journey engine registry for observability endpoints
_JOURNEY_ENGINES: Dict[str, StatefulEngine] = {}
_LAST_THREAD_ID: Optional[str] = None


async def run_journey(initial_context: dict, workflow_path: str) -> dict:
    """
    Run one complete member journey end-to-end (async).

    Fully self-contained: creates its own StatefulEngine, engine tools,
    checkpointer, and agent. No module-level journey state — multiple journeys
    can run concurrently on the shared event loop via asyncio.gather or
    concurrent HTTP requests.

    Args:
        initial_context: member identifiers and other run inputs
                         (e.g. {"member_id": ..., "mcid": ...})
        workflow_path:   path to the workflow JSON to execute

    Returns:
        dict with thread_id, agent result, and final engine state.
    """
    # Per-journey engine — the rules engine tracks graph state only
    engine = StatefulEngine(workflow_path)

    engine_tools = build_engine_tools(engine)
    tools = engine_tools + [send_to_benefits_agent, send_to_communications_agent] + MCP_TOOLS_ASYNC

    # Per-journey agent + checkpointer
    agent = create_deep_agent(
        model=model,
        system_prompt=SYSTEM_PROMPT,
        tools=tools,
        checkpointer=MemorySaver(),
    )

    thread_id = str(uuid.uuid4())

    # Member identifiers go in the agent's initial message — never in engine context
    context_lines = "\n".join(f"  {k}: {v}" for k, v in initial_context.items())
    initial_message = (
        f"Execute the loaded workflow. The following member identifiers are available for this run:\n"
        f"{context_lines}\n\n"
        f"Use these values when calling MCP tools and A2A agents as needed."
    )
    print(f"[JOURNEY EXECUTOR] run_journey thread={thread_id[:8]} initial message: {initial_message[:200]}")

    result = await agent.ainvoke(
        {"messages": [{"role": "user", "content": initial_message}]},
        config={"configurable": {"thread_id": thread_id}},
    )

    global _LAST_THREAD_ID
    _JOURNEY_ENGINES[thread_id] = engine
    _LAST_THREAD_ID = thread_id

    return {
        "thread_id": thread_id,
        "engine_state": engine.get_state(),
        "result": result,
    }

SYSTEM_PROMPT = """You are the Journey Executor Agent. Your job is to execute a pre-built rules engine workflow for a member journey by calling real MCP tools and A2A agents in the order the engine prescribes.

## Your Loop

1. Call engine_get_next_step() to get the current step. It returns the tool name, instructions, and context_key.
2. Execute the prescribed tool call EXACTLY as instructed. Use the tool name from the step — map it to the available tools:
   - "get_member" → call the get_member MCP tool with the member_id provided in the initial message
   - "get_member_contact_preferences" → call the get_member_contact_preferences MCP tool with the mcid provided in the initial message
   - "get_provider_information" → call the get_provider_information MCP tool
   - "get_claims_information" → call the get_claims_information MCP tool
   - "get_medical_history" → call the get_medical_history MCP tool
   - "send_to_benefits_agent" → call send_to_benefits_agent with the natural-language question in the instructions, substituting the real member_id
   - "send_to_communications_agent" → call send_to_communications_agent with a JSON payload string containing member_id, mcid, channel, and message
   - "engine_get_state" → call engine_get_state to check workflow progress, then assemble the final output JSON from real tool response data
3. Call engine_execute_step(result_json) with the tool's JSON response as a string — this records the step result and advances the engine.
4. Repeat until engine_get_next_step() returns status == "complete".
5. Return the final assembled output JSON as your response.

## Critical Rules

- NEVER invent or hallucinate data. Every field in the final output must come from a real tool response.
- NEVER skip a step or reorder steps — the engine controls sequencing.
- The member_id and mcid are provided to you in the initial message — use those values directly when calling tools. Do NOT call engine_get_state() to look up member identifiers; they are in your conversation context.
- For get_member: pass the member_id exactly as given in the initial message.
- For get_member_contact_preferences: pass the mcid exactly as given in the initial message.
- For send_to_benefits_agent: substitute the real member_id into the task string before sending.
- The engine tracks only workflow graph state (which steps are done, what is next). It does not hold member data.
- For the final assembly step (tool=engine_get_state): call engine_get_state to confirm all steps are complete, then construct the output JSON using the REAL data returned by the previous tool calls in this conversation.

## Output Format

Return ONLY valid JSON. No markdown, no prose, no code fences. Raw JSON starting with { and ending with }. If a tool returned an error, include the error text in the relevant field — never omit or invent data.
"""

print(f"[JOURNEY EXECUTOR] Ready — run_journey() builds a fresh engine + agent per request")

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint for Kubernetes"""
    return jsonify({"status": "healthy", "service": "journey-executor"}), 200

@app.route('/load_workflow', methods=['POST'])
def load_workflow():
    """
    Validate a workflow JSON file (parse + step count).

    Expects JSON: {"workflow_path": "<path to workflow.json>"}
    No engine state is stored — engines are created per journey inside run_journey().
    """
    data = request.json or {}
    workflow_path = data.get('workflow_path')

    if not workflow_path:
        return jsonify({"error": "workflow_path is required"}), 400

    try:
        with open(workflow_path, 'r') as f:
            workflow = json.load(f)
        step_count = sum(1 for n in workflow["nodes"] if n["type"] == "functionNode")
        print(f"[JOURNEY EXECUTOR] Workflow validated: {step_count} steps")
        return jsonify({
            "status": "success",
            "workflow_path": workflow_path,
            "steps": step_count,
            "description": workflow.get("description", "")
        }), 200
    except Exception as e:
        print(f"[JOURNEY EXECUTOR] Error validating workflow: {e}")
        return jsonify({"error": str(e)}), 500

DEFAULT_WORKFLOW_PATH = str(BASE_DIR / "engine" / "workflows" / "mri-lower-limb.workflow.json")

@app.route('/execute_workflow', methods=['POST'])
def execute_workflow():
    """
    Execute a workflow for one member journey.

    Expects JSON: {"context": {...}, "workflow_path": "<optional>"}.
    Each call runs a fully isolated journey — its own engine, tools, and agent.
    Safe to call concurrently.
    """
    data = request.json or {}
    initial_context = data.get('context', {})
    workflow_path = data.get('workflow_path', DEFAULT_WORKFLOW_PATH)

    print(f"[JOURNEY EXECUTOR] Executing workflow '{os.path.basename(workflow_path)}' "
          f"with context keys: {list(initial_context.keys())}")

    if not os.path.exists(workflow_path):
        return jsonify({"error": f"Workflow file not found: {workflow_path}"}), 400

    try:
        # All journeys share the single background event loop — concurrent
        # requests overlap as async tasks on one thread.
        journey = asyncio.run_coroutine_threadsafe(
            run_journey(initial_context, workflow_path), _bg_loop
        ).result(timeout=900)
        return jsonify({
            "status": "complete",
            "thread_id": journey["thread_id"],
            "engine_state": journey["engine_state"],
        }), 200
    except Exception as e:
        print(f"[JOURNEY EXECUTOR] Error executing workflow: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/get_engine_state', methods=['GET'])
def get_engine_state():
    """
    Get the engine state for a completed/in-flight journey.

    Query param: ?thread_id=<id>  (defaults to the most recent journey)
    """
    thread_id = request.args.get("thread_id") or _LAST_THREAD_ID
    engine = _JOURNEY_ENGINES.get(thread_id) if thread_id else None
    if not engine:
        return jsonify({"error": "No journey found — pass ?thread_id= or run a workflow first"}), 400

    return jsonify({
        "thread_id": thread_id,
        "state": engine.get_state(),
        "context": engine.get_context(),
    }), 200

@app.route('/reset_engine', methods=['POST'])
def reset_engine():
    """Clear the journey engine registry (engines are per-journey — nothing global to reset)."""
    _JOURNEY_ENGINES.clear()
    print("[JOURNEY EXECUTOR] Journey engine registry cleared")
    return jsonify({"status": "success"}), 200


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8088))
    print(f"[JOURNEY EXECUTOR] Starting Flask HTTP on port {port}")
    app.run(host='0.0.0.0', port=port)

==========================================================================================================

FROM quay-nonprod.elegancehealth.com/multiarchitecture-golden-base-images/ubi8-python-image-with-certs:python3.12

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8088

WORKDIR /app

USER root

COPY requirements.txt .
RUN pip install --upgrade pip setuptools wheel \
    && pip install --no-cache-dir --force-reinstall -r requirements.txt

COPY horizon_llm.py .
COPY app.py .
COPY engine/ ./engine/
COPY skills/ ./skills/

RUN chown -R 1000:1000 /app

USER 1000

EXPOSE 8088

ENTRYPOINT ["python3", "app.py"]

==============================================================================

"""
Horizon LLM wrapper for Anthropic Claude via elegance Horizon API
"""
import os
import json
import time
import random
import asyncio
import httpx
import requests
from typing import Any, List, Optional, Sequence
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.utils.function_calling import convert_to_openai_tool
from pydantic import BaseModel


_token_cache = {"token": None, "expires_at": 0.0}


def get_horizon_credentials():
    """
    Get Horizon API credentials.
    Uses hardcoded credentials for local testing (no Secrets Manager).
    """
    return {
        "client_id": os.environ.get("HORIZON_CLIENT_ID", "n5BqyyBEE5M6vwfctnf5gQdnuGqgsZmA"),
        "client_secret": os.environ.get("HORIZON_CLIENT_SECRET", "TEUDHWJbSsMGJvQMa4PtdJuJE65IH5Wt"),
    }


class HorizonAnthropicModel(BaseChatModel):
    """Horizon LLM wrapper using Anthropic Messages API (with tool support)"""

    model: str = "claude-sonnet-4-6"
    max_tokens: int = 4096
    timeout: int = 300
    tools: Optional[List] = None
    max_retries: int = 5
    base_delay: float = 5.0
    max_delay: float = 90.0

    @property
    def _llm_type(self) -> str:
        return "horizon_anthropic"

    def bind_tools(self, tools: Sequence, **kwargs: Any):
        """Bind tools to the model"""
        anthropic_tools = []
        for t in tools:
            openai_tool = convert_to_openai_tool(t)
            fn = openai_tool["function"]
            anthropic_tools.append({
                "name": fn["name"],
                "description": fn.get("description", ""),
                "input_schema": fn["parameters"],
            })
        return self.bind(tools=anthropic_tools, **kwargs)

    def _get_token(self):
        """Get OAuth token from Horizon API, reusing cached token if still valid."""
        if _token_cache["token"] and time.time() < _token_cache["expires_at"] - 60:
            return _token_cache["token"]

        creds = get_horizon_credentials()
        client_id = creds["client_id"]
        client_secret = creds["client_secret"]

        if not client_id or not client_secret:
            raise ValueError("Missing Horizon credentials")

        response = requests.post(
            'https://api.horizon.elegancehealth.com/v2/oauth2/token',
            data={'grant_type': 'client_credentials'},
            auth=(client_id, client_secret),
            verify=False,
            timeout=30
        )

        if response.status_code != 200:
            print(f"[HORIZON LLM] Token error: {response.status_code} — {response.text}")
        response.raise_for_status()
        token_data = response.json()
        _token_cache["token"] = token_data["access_token"]
        _token_cache["expires_at"] = time.time() + token_data.get("expires_in", 3600)
        return _token_cache["token"]

    def _build_payload(self, messages: List[BaseMessage], stop: Optional[List[str]] = None, **kwargs: Any) -> dict:
        """Build the Anthropic Messages API request body from LangChain messages."""
        system_prompt = None
        eh_messages = []

        for msg in messages:
            if hasattr(msg, 'type') and msg.type == 'system':
                system_prompt = msg.content
            elif isinstance(msg, HumanMessage):
                eh_messages.append({"role": "user", "content": msg.content})
            elif isinstance(msg, AIMessage):
                content = []
                if msg.content:
                    content.append({"type": "text", "text": msg.content})
                for tool_call in msg.tool_calls:
                    content.append({
                        "type": "tool_use",
                        "id": tool_call["id"],
                        "name": tool_call["name"],
                        "input": tool_call["args"],
                    })
                eh_messages.append({"role": "assistant", "content": content if content else msg.content})
            elif isinstance(msg, ToolMessage):
                tool_content = msg.content
                if isinstance(tool_content, dict):
                    tool_content = json.dumps(tool_content)
                eh_messages.append({
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": msg.tool_call_id,
                        "content": tool_content,
                    }]
                })

        payload = {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "messages": eh_messages,
        }

        if system_prompt:
            payload["system"] = system_prompt
        if stop:
            payload["stop_sequences"] = stop

        tools = kwargs.get("tools") or self.tools
        if tools:
            payload["tools"] = tools

        return payload

    def _parse_result(self, result: dict) -> ChatResult:
        """Parse the Anthropic Messages API response into a ChatResult."""
        text_parts = []
        tool_calls = []

        for block in result.get("content", []):
            if block["type"] == "text":
                text_parts.append(block["text"])
            elif block["type"] == "tool_use":
                tool_calls.append({
                    "id": block["id"],
                    "name": block["name"],
                    "args": block["input"],
                })

        message = AIMessage(
            content="\n".join(text_parts),
            tool_calls=tool_calls,
            response_metadata={
                "id": result.get("id"),
                "model": result.get("model"),
                "stop_reason": result.get("stop_reason"),
                "usage": result.get("usage"),
            },
        )

        return ChatResult(generations=[ChatGeneration(message=message)])

    def _retry_wait(self, attempt: int) -> float:
        wait = min(self.base_delay * 2 ** attempt, self.max_delay)
        return wait * (0.5 + random.random() * 0.5)

    def _generate(self, messages: List[BaseMessage], stop: Optional[List[str]] = None, **kwargs: Any) -> ChatResult:
        """Generate response from Horizon Anthropic API (sync)."""
        token = self._get_token()
        payload = self._build_payload(messages, stop, **kwargs)
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01"
        }

        resp = None
        for attempt in range(self.max_retries):
            resp = requests.post(
                "https://api.horizon.elegancehealth.com/anthropic/v1/messages",
                headers=headers,
                json=payload,
                verify=False,
                timeout=self.timeout
            )

            if resp.status_code == 429:
                wait = self._retry_wait(attempt)
                print(f"[HORIZON LLM] Rate limited — retrying in {wait:.1f}s (attempt {attempt + 1}/{self.max_retries})")
                time.sleep(wait)
                continue

            if resp.status_code != 200:
                print(f"[HORIZON LLM] Error {resp.status_code} — {resp.text}")
            resp.raise_for_status()
            break

        return self._parse_result(resp.json())

    async def _agenerate(self, messages: List[BaseMessage], stop: Optional[List[str]] = None, **kwargs: Any) -> ChatResult:
        """Generate response from Horizon Anthropic API (async — true await, no thread)."""
        token = await asyncio.to_thread(self._get_token)
        payload = self._build_payload(messages, stop, **kwargs)
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01"
        }

        resp = None
        async with httpx.AsyncClient(timeout=self.timeout, verify=False) as client:
            for attempt in range(self.max_retries):
                resp = await client.post(
                    "https://api.horizon.elegancehealth.com/anthropic/v1/messages",
                    headers=headers,
                    json=payload,
                )

                if resp.status_code == 429:
                    wait = self._retry_wait(attempt)
                    print(f"[HORIZON LLM] Rate limited — retrying in {wait:.1f}s (attempt {attempt + 1}/{self.max_retries})")
                    await asyncio.sleep(wait)
                    continue

                if resp.status_code != 200:
                    print(f"[HORIZON LLM] Error {resp.status_code} — {resp.text}")
                resp.raise_for_status()
                break

        return self._parse_result(resp.json())

===================================================================================================

flask==3.0.0
deepagents==0.7.14
langchain-core==1.6.3
langchain-mcp-adapters==0.3.2
langgraph==1.2.11
httpx==0.28.1
requests==2.31.0
pydantic==2.13.5
anthropic==1.6.0
a2a-sdk==0.2.9

==================================================================================
===============================================================================================================

# EHAP Horizon API Credentials
HORIZON_CLIENT_ID=your-client-id-here
HORIZON_CLIENT_SECRET=your-client-secret-here

# Application Configuration
PORT=8081

# Service URLs
EXPERIENCE_ORCHESTRATOR_URL=http://experience-orchestrator-service
EDL_MCP_URL=http://edl-mcp-service
CONTACT_PREFS_MCP_URL=http://contact-prefs-mcp-service
ACMP_MCP_URL=http://acmp-mcp-service

# Neptune Graph Database Configuration
NEPTUNE_ENDPOINT=anepdb-apm1082977-devcl02.cluster-c1orsd8u0hmn.us-east-2.neptune.amazonaws.com
NEPTUNE_REGION=us-east-2
NEPTUNE_PORT=8182

=========================================================================================

"""
Journey Orchestrator Agent
Routes signals to appropriate journey paths using Horizon LLM 
trigger
"""
import os
# Set UTF-8 encoding environment variable before other imports
os.environ['PYTHONIOENCODING'] = 'utf-8'

import sys
import json
import asyncio
import threading
import requests
import uuid
import re
from flask import Flask, request, jsonify
from deepagents import create_deep_agent
from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.tools import tool, StructuredTool
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.checkpoint.memory import MemorySaver
from pathlib import Path
from pydantic import BaseModel, Field
from typing import Optional

from horizon_llm import HorizonAnthropicModel
from skills_loader import list_available_skills, select_skill
from neptune_client import NeptuneClient
from session_trace import write_session_trace

# Tool call recorder for capturing tool invocations
class ToolCallRecorder(BaseCallbackHandler):
    """Records each tool invocation (name, input, output) for trace events."""
    
    # Internal DeepAgents tools to filter out from UI trace
    INTERNAL_TOOLS = {
        'task', 'glob', 'ls', 'read_file', 'write_file', 'edit_file', 
        'grep', 'list_skills', 'load_skill', 'write_todos'
    }
    
    def __init__(self):
        self.calls = []
        self.run_id_to_call = {}  # Map run_id to call object for proper matching
    
    def on_tool_start(self, serialized, input_str, **kwargs):
        name = (serialized or {}).get("name", "tool")
        
        # Filter out internal DeepAgents tools
        if name in self.INTERNAL_TOOLS:
            return
        
        run_id = kwargs.get("run_id")
        call = {"name": name, "input": input_str, "output": None}
        self.calls.append(call)
        if run_id:
            self.run_id_to_call[str(run_id)] = call  # Store reference to call object
    
    def on_tool_end(self, output, **kwargs):
        # Match output to correct call using run_id
        text = getattr(output, "content", output)
        run_id = kwargs.get("run_id")
        
        if run_id and str(run_id) in self.run_id_to_call:
            # Use run_id to find the correct call
            self.run_id_to_call[str(run_id)]["output"] = str(text)
        else:
            # Fallback: find first call without output (old behavior)
            for call in self.calls:
                if call["output"] is None:
                    call["output"] = str(text)
                    break

def load_precare_skill(pathway: str, service_name: str = None, primary_cpt: str = None, rationale: str = None):
    """Load the Pre-Care skill file that best matches pathway, CPT, service name, and rationale."""
    from skills_loader import _skill_similarity, _parse_frontmatter
    precare_skills_dir = Path(__file__).resolve().parent / "skills"
    
    if not precare_skills_dir.exists():
        return None
    
    # Collect ALL skill files across all directories — one entry per file
    all_skills = []
    for skill_path in precare_skills_dir.iterdir():
        if skill_path.is_dir():
            seen_paths: set = set()
            for m in skill_path.glob("*_skill.md"):
                if str(m) not in seen_paths:
                    seen_paths.add(str(m))
                    content = m.read_text()
                    metadata, body = _parse_frontmatter(content)
                    all_skills.append({
                        "directory": skill_path.name,
                        "file_name": m.name,
                        "metadata": metadata,
                        "content": body,
                        "file_path": str(m)
                    })
    
    if not all_skills:
        return None
    
    query = " ".join(filter(None, [pathway, rationale]))
    scored_skills = []
    for skill in all_skills:
        score = 0
        meta = skill["metadata"]
        skill_pathway = meta.get("pathway", "").lower()
        skill_name_meta = meta.get("name", skill["file_name"])
        skill_desc = meta.get("description", "")

        # CPT exact match — highest weight
        if primary_cpt and meta.get("primary_cpt", "") == str(primary_cpt):
            score += 150
        elif primary_cpt and meta.get("secondary_cpt", "") == str(primary_cpt):
            score += 60

        # Exact pathway match
        if pathway and skill_pathway == pathway.lower():
            score += 100
        elif pathway and skill_pathway:
            if pathway.lower() in skill_pathway or skill_pathway in pathway.lower():
                score += 50
            else:
                pw = set(pathway.lower().replace('-', ' ').replace('_', ' ').split())
                sw = set(skill_pathway.replace('-', ' ').replace('_', ' ').split())
                score += len(pw & sw) * 15

        # Service name match
        if service_name and meta.get("service_name", "").lower() == service_name.lower():
            score += 50

        # Name + description similarity against pathway + rationale
        score += _skill_similarity(query, skill_name_meta, skill_desc)

        scored_skills.append({"skill": skill, "score": score})
        print(f"[JOURNEY ORCHESTRATOR] Precare skill candidate: {skill['file_name']} score={score}")
    
    scored_skills.sort(key=lambda x: x["score"], reverse=True)
    
    if scored_skills[0]["score"] > 0:
        best = scored_skills[0]["skill"]
        print(f"[JOURNEY ORCHESTRATOR] Selected precare skill: {best['file_name']} (score: {scored_skills[0]['score']})")
        return {
            "skill_name": best["directory"],
            "skill_file_path": best["file_path"],
            "skill_file_name": best["file_name"],
            "metadata": best["metadata"],
            "content": best["content"]
        }
    
    return None

app = Flask(__name__)
BASE_DIR = Path(__file__).resolve().parent

import builtins

def safe_print(message):
    """Print message with graceful Unicode error handling"""
    try:
        builtins.print(message)
    except UnicodeEncodeError:
        # Replace Unicode characters with ASCII equivalents for Windows console
        safe_message = str(message).encode('ascii', 'replace').decode('ascii')
        builtins.print(safe_message)

# Override built-in print with safe_print globally for this module
print = safe_print

# Service URLs
EXPERIENCE_ORCHESTRATOR_URL = os.environ.get('EXPERIENCE_ORCHESTRATOR_URL', 'http://experience-orchestrator-second-service')
EDL_MCP_URL = os.environ.get('EDL_MCP_URL', 'http://edl-mcp-second-service')
CONTACT_PREFS_MCP_URL = os.environ.get('CONTACT_PREFS_MCP_URL', 'http://contact-prefs-mcp-second-service')
ACMP_MCP_URL = os.environ.get('ACMP_MCP_URL', 'http://acmp-mcp-second-service')
print(f"[JOURNEY ORCHESTRATOR] Using EDL_MCP_URL={EDL_MCP_URL}, ACMP_MCP_URL={ACMP_MCP_URL}")

# Neptune Configuration
NEPTUNE_ENDPOINT = os.environ.get('NEPTUNE_ENDPOINT', 'anepdb-apm1082977-devcl02.cluster-c1orsd8u0hmn.us-east-2.neptune.amazonaws.com')
NEPTUNE_REGION = os.environ.get('NEPTUNE_REGION', 'us-east-2')
NEPTUNE_PORT = os.environ.get('NEPTUNE_PORT', '8182')

# Initialize Neptune client
neptune_client = NeptuneClient(NEPTUNE_ENDPOINT, region=NEPTUNE_REGION, port=NEPTUNE_PORT)


# Pydantic model for structured output
class JourneyRoutingDecision(BaseModel):
    member_id: str = Field(description="Member ID")
    mcid: str = Field(description="MCID") # FIX THIS WHEN KNOW MCID
    selected_journey: str = Field(description="Pre-Care, Active Care, Pay My Care, Whole Health, or Support Resolution")
    journey_type: str = Field(description="Specific journey type like Prepare-for-Care")
    pathway: str = Field(description="Specific pathway like knee-replacement")
    pathway_stage: str = Field(description="Stage from the loaded skill")
    episode_id: str = Field(description="Unique episode ID")
    cpt: Optional[str] = Field(default=None, description="CPT code from signal (e.g., '73721', '27447')")
    auth_id: Optional[str] = Field(default=None, description="Authorization ID (e.g., 'UM1234567')")
    rationale: str = Field(description="Why this journey was selected based on skill criteria")
    # --- Optional fields for member-journey DynamoDB record ---
    is_active: Optional[bool] = Field(default=None, description="Whether this journey is currently active for the member")
    # --- Optional fields for clinical-journey DynamoDB record ---
    cpt_codes: Optional[list] = Field(default=None, description="All CPT codes relevant to this clinical journey from the skill (e.g., ['27447', '73700'])")
    icd10_codes: Optional[list] = Field(default=None, description="All ICD-10 codes relevant to this clinical journey from the skill (e.g., ['M17.11', 'M25.561'])")
    signal_categories: Optional[list] = Field(default=None, description="Signal categories applicable to this journey from the skill (e.g., ['auth.approved', 'auth.denied', 'surgery.completed'])")
    stage_count: Optional[int] = Field(default=None, description="Total number of stages in the loaded skill journey")
    urgency_default: Optional[str] = Field(default=None, description="Default urgency level for this journey (e.g., 'HIGH', 'STANDARD')")
    cluster_ref: Optional[str] = Field(default=None, description="Cluster or grouping reference from the skill metadata (e.g., 'knee-surgery')")

# ── MCP Client Setup (streamable-http transport) ─────────────────────────────
_bg_loop = asyncio.new_event_loop()
threading.Thread(target=lambda: (_bg_loop.run_forever()), daemon=True).start()

def _run_async(coro):
    return asyncio.run_coroutine_threadsafe(coro, _bg_loop).result(timeout=120)

async def _load_mcp_tools():
    client = MultiServerMCPClient({
        "edl":  {"transport": "streamable_http", "url": f"{EDL_MCP_URL}/mcp"},
        "acmp": {"transport": "streamable_http", "url": f"{ACMP_MCP_URL}/mcp"},
    })
    return await client.get_tools()

def _make_sync_tool(atool):
    def _fn(**kwargs):
        try:
            result = _run_async(atool.ainvoke(kwargs))
            if isinstance(result, list) and result and all(isinstance(item, dict) and item.get("type") == "text" and "text" in item for item in result):
                text_parts = [item.get("text", "") for item in result]
                return text_parts[0] if len(text_parts) == 1 else "\n".join(text_parts)
            return json.dumps(result) if isinstance(result, (dict, list)) else str(result)
        except Exception as e:
            return json.dumps({"error": str(e), "tool": atool.name})
    return StructuredTool.from_function(
        func=_fn, name=atool.name,
        description=atool.description, args_schema=atool.args_schema
    )

MCP_TOOLS = []
for _attempt in range(5):
    try:
        _async_mcp_tools = _run_async(_load_mcp_tools())
        MCP_TOOLS = [_make_sync_tool(t) for t in _async_mcp_tools]
        print(f"[JOURNEY ORCHESTRATOR] MCP tools loaded via streamable_http: {[t.name for t in MCP_TOOLS]}")
        break
    except Exception as e:
        print(f"[JOURNEY ORCHESTRATOR] WARNING: Could not load MCP tools (attempt {_attempt + 1}/5): {e}")
        if _attempt < 4:
            import time; time.sleep(10)
else:
    print(f"[JOURNEY ORCHESTRATOR] ERROR: All MCP tool load attempts failed. Running without MCP tools.")

# Skill Tools
@tool
def list_skills() -> str:
    """List all available journey skills with descriptions."""
    print(f"[JOURNEY ORCHESTRATOR] Listing available skills")
    result = list_available_skills()
    print(f"[JOURNEY ORCHESTRATOR] Available skills: {result}")
    return result

@tool
def load_skill(skill_name: str, pathway: str = None, primary_cpt: str = None, rationale: str = None) -> str:
    """Load a specific journey skill by name to understand pathway stages and criteria.
    
    Args:
        skill_name: The skill directory name (e.g., 'knee-surgery-journey')
        pathway: Optional pathway filter (e.g., 'knee-replacement' for TKA, 'meniscal-tear' for arthroscopy)
        primary_cpt: Optional CPT code filter (e.g., '27447' for TKA, '29881' for meniscal arthroscopy)
        rationale: Optional rationale from the signal package — used for name/description similarity scoring
                   when multiple skill files share the same directory (e.g., TKA vs meniscal tear)
    
    IMPORTANT: Always pass pathway, primary_cpt, AND rationale to ensure the correct skill file is selected
    when a directory contains multiple skills (e.g., knee-surgery-journey contains both TKA and meniscal tear skills).
    """
    print(f"[JOURNEY ORCHESTRATOR] Loading skill: {skill_name}, pathway: {pathway}, cpt: {primary_cpt}, rationale provided: {bool(rationale)}")
    result = select_skill(skill_name, pathway=pathway, primary_cpt=primary_cpt, rationale=rationale)
    safe_print(f"[JOURNEY ORCHESTRATOR] Loaded skill content: {result}")
    return result

# Neptune Graph Tools
@tool
def get_journey_from_cpt(cpt_code: str) -> str:
    """Query Neptune member graph to get journey information for a CPT procedure code.
    
    Args:
        cpt_code: CPT procedure code (e.g., '27447' for knee replacement, '29881' for knee arthroscopy)
        
    Returns:
        JSON string with journey routing information including:
        - procedure details and label
        - journey name and type
        - handler/agent responsible for this journey
        
    Use this when you need to understand which journey a specific procedure triggers.
    """
    print(f"[JOURNEY ORCHESTRATOR] Querying Neptune for CPT code: {cpt_code}")
    try:
        result = neptune_client.journey_routing(cpt_code)
        print(f"[JOURNEY ORCHESTRATOR] Neptune journey result: {json.dumps(result, indent=2)}")
        return json.dumps(result, indent=2)
    except Exception as e:
        print(f"[JOURNEY ORCHESTRATOR] Neptune query error: {str(e)}")
        error_result = {"error": str(e), "cpt_code": cpt_code, "found": False}
        return json.dumps(error_result, indent=2)

@tool
def get_related_icd10_codes(icd10_code: str) -> str:
    """Query Neptune member graph to get related conditions for an ICD-10 diagnosis code.
    
    Args:
        icd10_code: ICD-10 diagnosis code (e.g., 'M17.11' for knee osteoarthritis, 'M23.21' for meniscus derangement)
        
    Returns:
        JSON string with related conditions including:
        - original condition details
        - related conditions and their ICD-10 codes
        - condition labels and relationships
        
    Use this when you need to understand comorbidities or related conditions for care coordination.
    """
    print(f"[JOURNEY ORCHESTRATOR] Querying Neptune for ICD-10 code: {icd10_code}")
    try:
        result = neptune_client.icd10_related_codes(icd10_code)
        print(f"[JOURNEY ORCHESTRATOR] Neptune ICD-10 result: {json.dumps(result, indent=2)}")
        return json.dumps(result, indent=2)
    except Exception as e:
        print(f"[JOURNEY ORCHESTRATOR] WARNING: Neptune query error (continuing): {str(e)}")
        error_result = {"error": str(e), "icd10_code": icd10_code, "found": False}
        return json.dumps(error_result, indent=2)

SYSTEM_PROMPT = """You are the Journey Orchestrator Agent in elegance Health's Member 360 platform.

Your role is to receive signal packages from the Signal Analyzer and route them to the appropriate journey path.

CRITICAL: You do NOT know the journey stages or criteria up front. You MUST load them from skills.

WORKFLOW (follow this exact order):

0. NEPTUNE GRAPH QUERIES (MANDATORY FIRST STEP - DO THIS BEFORE SKILLS):
   If the signal package contains CPT or ICD-10 codes, query Neptune FIRST to understand the clinical context:
   
   a. Call get_journey_from_cpt(cpt_code) when you have a CPT procedure code to:
      * Understand which journey this procedure triggers (e.g., CPT 27447 → Total Knee Arthroplasty)
      * Identify the appropriate handler/agent for this procedure type
      * Get the clinical pathway associated with this procedure
      
   b. Call get_related_icd10_codes(icd10_code) when you have an ICD-10 diagnosis to:
      * Identify related conditions and comorbidities
      * Understand the full clinical picture for care coordination
      * Find associated conditions that may affect the journey routing
   
   IMPORTANT: Neptune results tell you the EXACT procedure name and pathway. Use this information to select the correct skill.

1. JOURNEY SKILL DISCOVERY (MANDATORY SECOND STEP):
   a. Call list_skills() to see all available journey skills with descriptions, pathways, and CPT codes
   b. Select the correct skill file by combining:
      * Neptune query results (CPT → procedure name, pathway)
      * Signal package background (member's condition, diagnosis, procedure type)
      * Member context (authorization details, clinical history)
   c. Match the skill using these criteria in STRICT priority order:
      1. **Primary CPT match**: skill's primary_cpt metadata field EXACTLY matches the CPT from the signal (highest priority)
      2. **Secondary CPT match**: skill's secondary_cpt metadata field matches the CPT from the signal
         - A secondary CPT match means this procedure is a supporting step in that pathway (e.g., pre-surgical imaging)
      3. **ICD-10 diagnosis match** (TIEBREAKER when multiple skills match the same CPT):
         - If multiple skills match the same CPT code (primary or secondary), read each skill's clinical_scenario
           and icd10_codes metadata fields to find which skill's clinical context best matches the signal's ICD-10
         - Do NOT assume which ICD-10 maps to which pathway — read it from the skill metadata
      4. **Pathway match**: skill's pathway metadata field matches the pathway returned by Neptune
      5. **Service name match**: skill's service_name metadata field matches the procedure description from Neptune

      🔴 CRITICAL RULE: If NO skill file matches the CPT code (neither primary nor secondary),
      return an error response indicating no matching skill was found for the given CPT and pathway.

   d. Call load_skill(skill_name, pathway, primary_cpt, rationale) with the skill name AND pathway/CPT/rationale from the signal
      CRITICAL: ALWAYS pass pathway, primary_cpt, AND rationale parameters to ensure correct skill file selection
      The rationale field (from the signal package) is used for similarity scoring when multiple skills share the same directory
      Use the actual values from the signal and Neptune results — never hardcode procedure names or pathways
   
   e. The returned content contains:
      - Care Pathway Stages: The sequential stages of the journey with member experience descriptions
      - Authorization Criteria: What triggers each stage and what the member needs
      - Decision Trees: How to handle denials, appeals, and escalations
   f. READ THE LOADED SKILL CONTENT CAREFULLY. Use it to determine:
      - Where the member currently is in the pathway (which stage)
      - What the next action should be based on the signal
      - Which agent should handle this stage

   DO NOT PROCEED without loading a skill. The skill content is the source of truth.

2. GATHER MEMBER CONTEXT (use this data to inform routing decisions):
   
   a. Call get_member(member_id) to get eligibility, plan, and contract details
      USE THIS TO:
      - Verify the member is actively eligible (check effective date, termination date)
      - Identify the member's name, plan, group, and contract for personalization
      - Determine if there's an active journey already in progress
      - Understand the member's clinical conditions and history to identify their pathway stage
      
   b. Call get_prior_auth(member_id) to see authorization history
      USE THIS TO:
      - Check if this is a NEW denial or part of an existing auth case
      - Identify the specific procedure, CPT codes, and denial reasons
      - Determine if the member is in an appeals process or needs escalation
      - Understand the timeline (when was auth requested, denied, etc.)
      - Decide between Pre-Care (new procedure) vs Active Care (ongoing case) vs Support Resolution (denial)
      NOTE: Prior auth data may not exist for all members - handle gracefully if 404/empty
      
3. DETERMINE ROUTING using the loaded skill + member context:
   - Use the skill's pathway stages to identify where the member is
   - Use the skill's decision tree to determine the next action
   - Map to the appropriate journey agent using these SPECIFIC RULES:
   
     **Pre-Care Journey**:
     - Member is preparing for a procedure or treatment
     - Member needs education, cost transparency, provider selection, benefits information, or pre-operative preparation
     - Typical stages: Initial Presentation, Conservative Treatment, Imaging Authorization, Imaging Completed, Surgical Decision & Authorization, Pre-Operative Preparation
     - Signal types: new diagnosis, auth.submitted, auth.approved (for imaging/surgery), cost inquiry, pre-op checklist needed
     - Key indicator: Member has NOT yet had the procedure/surgery
     
     **Active Care Journey**:
     - Member is in post-surgical/post-procedure recovery and rehabilitation phase
     - Typical stages: Surgery & Recovery, Post-Operative Follow-up, Rehabilitation
     - Signal types: surgery.completed, discharge.completed, post-op follow-up, recovery support, PT visits
     - Key indicator: Procedure/surgery has been COMPLETED
     
     **Support Resolution Journey**:
     - auth.denied signal received
     - Member needs help with denial, appeal, or peer-to-peer review
     
     **Whole Health Journey**:
     - care-gap signals (missed appointments, medication non-adherence)
     
     **Pay My Care Journey**:
     - billing-event signals (claims, EOBs, payment issues)
   
   - The pathway_stage field MUST come from the loaded skill's stage names
   - Route based on the stage DESCRIPTION and member status, not stage numbers

3. MINT EPISODE ID: Create a unique episode ID like "EP-{member_id}-{journey_type}-{timestamp}"

Note: MCID should come directly from the input payload. 

Return your routing decision in JSON format:
{
    "member_id": "string",
    "mcid": "string",
    "selected_journey": "Pre-Care" | "Active Care" | "Pay My Care" | "Whole Health" | "Support Resolution",
    "journey_type": "Prepare-for-Care" | "Auth-Denial-Resolution" | etc,
    "pathway": "<exact pathway value from the loaded skill's metadata>",
    "pathway_stage": "<exact Journey ID value from the loaded skill stage table, e.g. 'meniscal-tear-stage-3-mri-authorization'>",
    "episode_id": "EP-{member_id}-{type}-{timestamp}",
    "cpt": "{add cpt code here}" (CRITICAL: Extract from signal_package - this is the CPT code for the procedure),
    "auth_id": "UM1234567" (CRITICAL: Use the auth_id from the input signal_package — do NOT use a case_id from get_prior_auth or get_case_details. The signal_package auth_id is the authoritative value passed from upstream agents),
    "rationale": "Explain which skill you loaded, which stage the member is in based on the signal and skill criteria, and why this journey agent was selected",
    "is_active": true,
    "cpt_codes": ["<primary_cpt from skill>", "<secondary_cpt from skill if present>"],
    "icd10_codes": ["<primary_icd10 from skill>", "<related_icd10 values from skill if present>"],
    "signal_categories": ["<signal types listed in the skill stages, e.g. auth.approved, auth.denied>"],
    "stage_count": <total number of stages in the loaded skill>,
    "urgency_default": "<urgency level for this pathway, e.g. HIGH or STANDARD>",
    "cluster_ref": "<skill metadata journey_type value, e.g. knee_surgery>"
}

IMPORTANT for optional fields (cpt_codes, icd10_codes, signal_categories, stage_count, urgency_default, cluster_ref, is_active):
- ONLY populate these if the information is explicitly present in the loaded skill content or signal package.
- Do NOT invent or guess values. If a field cannot be determined from the skill or signal, omit it entirely (set to null).
- pathway_stage MUST be the exact Journey ID string from the skill stage table (e.g., 'meniscal-tear-stage-3-mri-authorization'), not a free-form description.

REMEMBER: Always load the skill FIRST. The skill content tells you the stages, criteria, and routing logic."""

model = HorizonAnthropicModel(model="claude-sonnet-4-6", max_tokens=8192, timeout=1800)
checkpointer = MemorySaver()

agent = create_deep_agent(
    model=model,
    system_prompt=SYSTEM_PROMPT,
    tools=MCP_TOOLS + [list_skills, load_skill, get_journey_from_cpt, get_related_icd10_codes],
    checkpointer=checkpointer
)

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "healthy", "agent": "journey-orchestrator"}), 200

@app.route('/route', methods=['POST'])
def route():
    """Route signal package to appropriate journey."""
    data = request.json or {}
    signal_package = data.get("signal_package", {})
    member_id = data.get("member_id", "")
    thread_id = data.get("thread_id") or str(uuid.uuid4())
    skip_experience_forwarding = bool(data.get("skip_experience_forwarding"))
    from datetime import datetime, timezone
    _run_start = datetime.now(timezone.utc).isoformat()
    
    print(f"[JOURNEY ORCHESTRATOR] Routing signal for member: {member_id}")
    safe_print(f"[JOURNEY ORCHESTRATOR] Signal package: {json.dumps(signal_package, indent=2)}")
    
    # Initialize trace events list
    trace_events = []
    
    # Emit input trace event
    trace_events.append({
        "kind": "orchestrator_input",
        "title": "Signal Package Received",
        "extra": ["input", "signal_package"],
        "body": f"Received signal package for routing\n\nMember ID: {member_id}\nThread ID: {thread_id}\n\nSignal Package:\n```json\n{json.dumps(signal_package, indent=2)}\n```"
    })
    
    prompt = f"""Route this signal package to the appropriate journey:

Signal Package: {json.dumps(signal_package, indent=2)}
Member ID: {member_id}

Use the tools to gather member context, then determine the best journey path.
Return your routing decision in the specified JSON format."""
    
    # Emit thinking trace event with properly formatted signal package
    signal_package_formatted = json.dumps(signal_package, indent=2, ensure_ascii=False)
    trace_events.append({
        "kind": "orchestrator_thinking",
        "title": "Journey Routing Analysis",
        "extra": ["thinking", "llm_analysis"],
        "body": f"Analyzing signal and routing to appropriate journey\n\nPrompt:\nAnalyze this signal package and determine the appropriate journey:\n\nMember ID: {member_id}\n\nSignal Package:\n```json\n{signal_package_formatted}\n```\n\nDetermine the journey type, pathway, and any required skill information.\n\nReturn your routing decision in the specified JSON format."
    })
    
    try:
        # Create callback recorder to capture tool calls
        tool_recorder = ToolCallRecorder()
        
        result = agent.invoke(
            {"messages": [{"role": "user", "content": prompt}]},
            config={"configurable": {"thread_id": thread_id}, "callbacks": [tool_recorder]}
        )
        llm_response = result['messages'][-1].content
        
        # Convert captured tool calls to trace events (filter duplicates)
        seen_tools = set()
        for call in tool_recorder.calls:
            tool_name = call["name"]
            tool_input = call["input"]
            tool_output = call["output"]
            
            # Skip write_todos internal tool and duplicates
            if tool_name == "write_todos":
                continue
            
            # Create unique key for this tool call
            tool_key = f"{tool_name}:{tool_input}"
            if tool_key in seen_tools:
                continue
            seen_tools.add(tool_key)
            
            # Format tool input and output as proper JSON
            try:
                if isinstance(tool_input, str):
                    tool_input_parsed = json.loads(tool_input) if tool_input.strip().startswith(('{', '[')) else eval(tool_input)
                    tool_input_formatted = json.dumps(tool_input_parsed, indent=2, ensure_ascii=False)
                else:
                    tool_input_formatted = json.dumps(tool_input, indent=2, ensure_ascii=False)
            except:
                tool_input_formatted = str(tool_input)
            
            try:
                if isinstance(tool_output, str):
                    # Try to parse as JSON
                    tool_output_parsed = json.loads(tool_output)
                    # Check if the result field contains escaped JSON string
                    if isinstance(tool_output_parsed, dict) and "result" in tool_output_parsed:
                        result_value = tool_output_parsed["result"]
                        if isinstance(result_value, str) and result_value.strip().startswith(('{', '[')):
                            # Parse the nested JSON string
                            tool_output_parsed["result"] = json.loads(result_value)
                    
                    # Format with full content - no truncation
                    tool_output_formatted = json.dumps(tool_output_parsed, indent=2, ensure_ascii=False)
                else:
                    tool_output_formatted = json.dumps(tool_output, indent=2, ensure_ascii=False)
            except:
                tool_output_formatted = str(tool_output) if tool_output else 'No output'
            
            if 'skill' in tool_name.lower():
                safe_print(f"[JOURNEY ORCHESTRATOR] Adding skill trace event: {tool_name}")
                trace_events.append({
                    "kind": "orchestrator_skill",
                    "title": f"Skill: {tool_name}",
                    "extra": ["skill", tool_name],
                    "body": f"Skill loading\n\nSkill: {tool_name}\n\n**Input:**\n```json\n{tool_input_formatted}\n```\n\n**Output:**\n```json\n{tool_output_formatted}\n```"
                })
            else:
                safe_print(f"[JOURNEY ORCHESTRATOR] Adding tool trace event: {tool_name}")
                trace_events.append({
                    "kind": "orchestrator_tool",
                    "title": f"Tool: {tool_name}",
                    "extra": ["tool", tool_name],
                    "body": f"Tool invocation\n\nTool: {tool_name}\n\n**Input:**\n```json\n{tool_input_formatted}\n```\n\n**Output:**\n```json\n{tool_output_formatted}\n```"
                })
        
        safe_print(f"[JOURNEY ORCHESTRATOR] LLM Response: {llm_response}")
        
        try:
            # Extract JSON using regex (handles markdown code fences)
            json_match = re.search(r"```json\s*(.*?)\s*```", llm_response, re.DOTALL)
            cleaned = json_match.group(1).strip() if json_match else llm_response.strip()
            
            # If no markdown fences, try to extract JSON object
            if not json_match:
                start_idx = cleaned.find('{')
                end_idx = cleaned.rfind('}')
                if start_idx != -1 and end_idx != -1:
                    cleaned = cleaned[start_idx:end_idx+1]
            
            # Validate with Pydantic
            routing_obj = JourneyRoutingDecision.model_validate_json(cleaned)
            routing_decision = routing_obj.model_dump()
            safe_print(f"[JOURNEY ORCHESTRATOR] Routing decision: {routing_decision}")
            
            # Override MCID with the correct value from signal_package (LLM may incorrectly set it)
            # Make sure to edit this
            if signal_package.get("mcid"):
                routing_decision["mcid"] = signal_package.get("mcid")
                print(f"[JOURNEY ORCHESTRATOR] Overriding MCID with value from signal_package: {signal_package.get('mcid')}")
            
            # Override auth_id with the authoritative value from signal_package (LLM may pick a different case from get_prior_auth)
            if signal_package.get("auth_id"):
                routing_decision["auth_id"] = signal_package.get("auth_id")
                print(f"[JOURNEY ORCHESTRATOR] Overriding auth_id with value from signal_package: {signal_package.get('auth_id')}")
            
        except Exception as e:
            print(f"[JOURNEY ORCHESTRATOR] JSON parsing error: {str(e)}")
            routing_decision = {
                "member_id": member_id,
                "mcid": signal_package.get("mcid"),
                "selected_journey": "Pre-Care",
                "journey_type": "Prepare-for-Care",
                "pathway": signal_package.get("pathway", "unknown"),
                "pathway_stage": "initial",
                "episode_id": f"EP-{member_id}-{str(uuid.uuid4())[:8]}",
                "rationale": "Fallback routing"
            }
        
        # Load Pre-Care skill info if routing to Pre-Care
        precare_skill_info = None
        if routing_decision.get("selected_journey") == "Pre-Care":
            pathway = routing_decision.get("pathway", "")
            # Extract CPT and service from signal_package (note: signal uses "cpt" not "primary_cpt")
            primary_cpt = signal_package.get("cpt") or signal_package.get("primary_cpt")
            service_name = signal_package.get("service_name")
            precare_skill = load_precare_skill(pathway, service_name=service_name, primary_cpt=primary_cpt)
            if precare_skill:
                # Extract just the file name from the full path
                skill_file_name = Path(precare_skill['skill_file_path']).name
                precare_skill_info = {
                    "skill_directory": precare_skill['skill_name'],
                    "skill_file_name": skill_file_name
                }
                print(f"[JOURNEY ORCHESTRATOR] Found Pre-Care skill: {precare_skill['skill_name']}/{skill_file_name}")

        trace_events.append({
            "kind": "orchestrator_output",
            "title": "Routing Complete",
            "extra": ["output", "routing_decision"],
            "body": f"Journey routing completed\n\nRouting Decision:\n```json\n{json.dumps(routing_decision, indent=2)}\n```"
        })

        # --- Write journey record to DynamoDB ---
        """
        try:
            import boto3 as _boto3
            from datetime import datetime as _dt, timezone as _tz
            _JOURNEY_TABLE = "apm1082977-mxp-silver-member-journey-dev01"
            _selected = routing_decision.get("selected_journey", "Unknown")
            _pathway = routing_decision.get("pathway", "unknown")
            _journey_type = routing_decision.get("journey_type", "")
            _pathway_stage = routing_decision.get("pathway_stage", "")
            _state_label = f"{_selected} — {_journey_type} ({_pathway_stage})" if _journey_type else _selected
            _now = _dt.now(_tz.utc).isoformat()
            _stage_raw = routing_decision.get("pathway_stage", "")
            _journey_id = _stage_raw if _stage_raw and _stage_raw.startswith((_pathway, "tka-", "meniscal-")) else f"JRN-{member_id}-{str(uuid.uuid4())[:8]}"
            _history_entry = {
                "timestamp": _now,
                "action": "journey_routed",
                "pathway": _pathway,
                "episode_id": routing_decision.get("episode_id", ""),
                "rationale": routing_decision.get("rationale", "")
            }
            if precare_skill_info:
                _history_entry["skill"] = f"{precare_skill_info.get('skill_directory','')}/{precare_skill_info.get('skill_file_name','')}"
            _is_active = routing_decision.get("is_active")
            _journey_item = {
                "member_id": member_id,
                "journey_id": _journey_id,
                "state": _state_label,
                "is_active": _is_active if _is_active is not None else True,
                "created_at": _now,
                "updated_at": _now,
                "history": [_history_entry],
            }
            _ddb = _boto3.resource("dynamodb", region_name="us-east-2")
            _ddb.Table(_JOURNEY_TABLE).put_item(Item=_journey_item)
            print(f"[JOURNEY ORCHESTRATOR] ✅ Member journey record written — member={member_id}, journey_id={_journey_id}, state={_state_label!r}")
        except Exception as _jdb_err:
            print(f"[JOURNEY ORCHESTRATOR] ⚠️ Failed to write member journey to DynamoDB — {str(_jdb_err)}. Continuing execution.")
        # --- End member journey DynamoDB write ---

        # --- Write clinical journey record to DynamoDB ---
        try:
            import boto3 as _boto3_cj
            from decimal import Decimal as _Decimal
            _CLINICAL_TABLE = "apm1082977-mxp-silver-clinical-journey-dev01"
            _cj_journey_id = routing_decision.get("pathway_stage") or _journey_id
            _cj_item = {
                "journey_id": _cj_journey_id,
                "version": _Decimal("1"),
            }
            _cpt_codes = routing_decision.get("cpt_codes")
            _icd10_codes = routing_decision.get("icd10_codes")
            _signal_cats = routing_decision.get("signal_categories")
            _stage_count = routing_decision.get("stage_count")
            _urgency = routing_decision.get("urgency_default")
            _cluster = routing_decision.get("cluster_ref")
            _pathway_val = routing_decision.get("pathway")
            _jtype_val = routing_decision.get("journey_type")
            if _pathway_val:
                _cj_item["pathway"] = _pathway_val
            if _jtype_val:
                _cj_item["journey_type"] = _jtype_val
            if _cpt_codes and isinstance(_cpt_codes, list) and len(_cpt_codes) > 0:
                _cj_item["cpt_codes"] = set(_cpt_codes)
            if _icd10_codes and isinstance(_icd10_codes, list) and len(_icd10_codes) > 0:
                _cj_item["icd10_codes"] = set(_icd10_codes)
            if _signal_cats and isinstance(_signal_cats, list) and len(_signal_cats) > 0:
                _cj_item["signal_categories"] = set(_signal_cats)
            if _stage_count is not None:
                _cj_item["stage_count"] = _Decimal(str(_stage_count))
            if _urgency:
                _cj_item["urgency_default"] = _urgency
            if _cluster:
                _cj_item["cluster_ref"] = _cluster
            _cj_item["active"] = True
            _cj_item["updated_at"] = _now
            _ddb_cj = _boto3_cj.resource("dynamodb", region_name="us-east-2")
            _ddb_cj.Table(_CLINICAL_TABLE).put_item(Item=_cj_item)
            print(f"[JOURNEY ORCHESTRATOR] ✅ Clinical journey record written — journey_id={_cj_journey_id}, pathway={_pathway_val}")
        except Exception as _cj_err:
            print(f"[JOURNEY ORCHESTRATOR] ⚠️ Failed to write clinical journey to DynamoDB — {str(_cj_err)}. Continuing execution.")
        # --- End clinical journey DynamoDB write ---
        """

        if skip_experience_forwarding:
            final_response = {
                "routing_decision": routing_decision,
                "precare_skill_info": precare_skill_info,
                "status": "routing_only",
                "trace_events": trace_events
            }
            print(f"[JOURNEY ORCHESTRATOR] Returning routing-only response with {len(trace_events)} trace events")
            write_session_trace(
                session_id=thread_id,
                run_start=_run_start,
                agent_name="journey-orchestrator",
                attr_prefix="journey_orchestrator",
                member_id=member_id,
                trace_events=trace_events,
                extra_attrs={
                    "selected_journey": routing_decision.get("selected_journey"),
                    "pathway": routing_decision.get("pathway"),
                    "pathway_stage": routing_decision.get("pathway_stage"),
                    "episode_id": routing_decision.get("episode_id"),
                    "status": "routing_only",
                }
            )
            return jsonify(final_response), 200
        
        # Forward to Experience Orchestrator
        try:
            print(f"[JOURNEY ORCHESTRATOR] Forwarding to Experience Orchestrator: {EXPERIENCE_ORCHESTRATOR_URL}")
            
            # Build request with Pre-Care skill info if available
            orchestrate_request = {
                "routing_decision": routing_decision,
                "signal_package": signal_package,
                "member_id": member_id,
                "thread_id": thread_id
            }
            
            if precare_skill_info:
                orchestrate_request["precare_skill_info"] = precare_skill_info
            
            response = requests.post(
                f"{EXPERIENCE_ORCHESTRATOR_URL}/orchestrate",
                json=orchestrate_request,
                timeout=1800
            )
            response.raise_for_status()
            
            experience_result = response.json()

            # Build final response to return to Signal Analyzer
            final_response = {
                "routing_decision": routing_decision,
                "precare_skill_info": precare_skill_info,
                "experience_result": experience_result,
                "status": "routed",
                "trace_events": trace_events
            }
            
            print(f"[JOURNEY ORCHESTRATOR] Returning to Signal Analyzer with {len(trace_events)} trace events")
            
            write_session_trace(
                session_id=thread_id,
                run_start=_run_start,
                agent_name="journey-orchestrator",
                attr_prefix="journey_orchestrator",
                member_id=member_id,
                trace_events=trace_events,
                extra_attrs={
                    "selected_journey": routing_decision.get("selected_journey"),
                    "pathway": routing_decision.get("pathway"),
                    "pathway_stage": routing_decision.get("pathway_stage"),
                    "episode_id": routing_decision.get("episode_id"),
                    "status": "routed",
                }
            )
            
            return jsonify(final_response), 200
            
        except Exception as e:
            print(f"[JOURNEY ORCHESTRATOR] Error calling Experience Orchestrator: {str(e)}")
            return jsonify({
                "routing_decision": routing_decision,
                "error": f"Failed to route to experience orchestrator: {str(e)}",
                "status": "routing_only",
                "trace_events": trace_events
            }), 200
            
    except Exception as e:
        import traceback as _tb
        import sys as _sys
        _error_type = type(e).__name__
        _sys.stderr.write(f"[JOURNEY ORCHESTRATOR] !!! EXCEPTION CAUGHT !!!\n")
        _sys.stderr.write(f"[JOURNEY ORCHESTRATOR] Error type: {_error_type}\n")
        _sys.stderr.write(f"[JOURNEY ORCHESTRATOR] Full traceback:\n{_tb.format_exc()}\n")
        _sys.stderr.flush()
        print(f"[JOURNEY ORCHESTRATOR] ERROR — {_error_type}. See stderr for details.")
        return jsonify({
            "error": "Journey routing failed due to an internal error.",
            "error_type": _error_type,
            "status": "error",
            "trace_events": trace_events
        }), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8081))
    app.run(host='0.0.0.0', port=port, threaded=True)

======================================================================================

FROM quay-nonprod.elegancehealth.com/multiarchitecture-golden-base-images/ubi8-python-image-with-certs:python3.12

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8081

WORKDIR /app

USER root

COPY requirements.txt .
RUN pip install --upgrade pip setuptools wheel \
    && pip install --no-cache-dir -r requirements.txt

COPY horizon_llm.py .
COPY skills_loader.py .
COPY neptune_client.py .
COPY session_trace.py .
COPY app.py .
COPY skills/ ./skills/

RUN chown -R 1000:1000 /app

USER 1000

EXPOSE 8080

ENTRYPOINT ["python3", "app.py"]

=========================================================================================

"""
Horizon LLM wrapper for Anthropic Claude via elegance Horizon API
"""
import os
import json
import requests
from typing import Any, Dict, List, Optional, Sequence, Type, Union
from functools import lru_cache
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.utils.function_calling import convert_to_openai_tool
from pydantic import BaseModel


@lru_cache(maxsize=1)
def get_horizon_credentials():
    """
    Get Horizon API credentials.
    """
    
    
    secret_name = os.environ.get("HORIZON_SECRET_NAME", "dev/api/mbrexp")
    
    try:
        import boto3
    except ImportError as e:
        raise ImportError("boto3 is required to read secrets from Secrets Manager.") from e
    
    region = os.environ.get("AWS_REGION", "us-east-2")
    client = boto3.client("secretsmanager", region_name=region)
    resp = client.get_secret_value(SecretId=secret_name)
    
    try:
        data = json.loads(resp["SecretString"])
    except (KeyError, ValueError) as e:
        raise ValueError(
            f"Horizon secret {secret_name!r} is not valid JSON. "
            "Expected a JSON object with keys: client_id, client_secret."
        ) from e
    
    return {
        "client_id": data.get("client_id", "").strip(),
        "client_secret": data.get("client_secret", "").strip(),
    }


class HorizonAnthropicModel(BaseChatModel):
    """Horizon LLM wrapper using Anthropic Messages API (with tool support)"""
    
    model: str = "claude-sonnet-4-6"
    max_tokens: int = 4096
    timeout: int = 300
    tools: Optional[List] = None
    max_retries: int = 3
    base_delay: float = 1.0
    max_delay: float = 60.0
    
    @property
    def _llm_type(self) -> str:
        return "horizon_anthropic"
    
    def bind_tools(self, tools: Sequence, **kwargs: Any):
        """Bind tools to the model"""
        anthropic_tools = []
        for t in tools:
            openai_tool = convert_to_openai_tool(t)
            fn = openai_tool["function"]
            anthropic_tools.append({
                "name": fn["name"],
                "description": fn.get("description", ""),
                "input_schema": fn["parameters"],
            })
        return self.bind(tools=anthropic_tools, **kwargs)
    
    def _get_token(self):
        """Get OAuth token from Horizon API using credentials from Secrets Manager"""
        creds = get_horizon_credentials()
        client_id = creds["client_id"]
        client_secret = creds["client_secret"]
        
        if not client_id or not client_secret:
            raise ValueError("Missing Horizon credentials in Secrets Manager")
        
        response = requests.post(
            'https://api.horizon.elegancehealth.com/v2/oauth2/token',
            data={'grant_type': 'client_credentials'},
            auth=(client_id, client_secret),
            verify=False,
            timeout=30
        )
        
        response.raise_for_status()
        return response.json()['access_token']
    
    def _generate(self, messages: List[BaseMessage], stop: Optional[List[str]] = None, **kwargs: Any) -> ChatResult:
        """Generate response from Horizon Anthropic API"""
        token = self._get_token()
        
        system_prompt = None
        eh_messages = []
        
        for msg in messages:
            if hasattr(msg, 'type') and msg.type == 'system':
                system_prompt = msg.content
            elif isinstance(msg, HumanMessage):
                eh_messages.append({"role": "user", "content": msg.content})
            elif isinstance(msg, AIMessage):
                content = []
                if msg.content:
                    content.append({"type": "text", "text": msg.content})
                
                for tool_call in msg.tool_calls:
                    content.append({
                        "type": "tool_use",
                        "id": tool_call["id"],
                        "name": tool_call["name"],
                        "input": tool_call["args"],
                    })
                
                eh_messages.append({"role": "assistant", "content": content if content else msg.content})
            elif isinstance(msg, ToolMessage):
                eh_messages.append({
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": msg.tool_call_id,
                        "content": msg.content,
                    }]
                })
        
        payload = {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "messages": eh_messages,
        }
        
        if system_prompt:
            payload["system"] = system_prompt
        
        if stop:
            payload["stop_sequences"] = stop
        
        tools = kwargs.get("tools") or self.tools
        if tools:
            payload["tools"] = tools
        
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01"
        }

        import time
        import requests
        
        for attempt in range(self.max_retries):
            resp = requests.post(
                    "https://api.horizon.elegancehealth.com/anthropic/v1/messages",
                    headers=headers,
                    json=payload,
                    verify=False,
                    timeout=self.timeout
                )
            if resp.status_code == 429:
                wait = min(self.base_delay * 2**attempt, self.max_delay)
                time.sleep(wait)
                continue
            resp.raise_for_status()
            break
        
        
        result = resp.json()
        
        text_parts = []
        tool_calls = []
        
        for block in result.get("content", []):
            if block["type"] == "text":
                text_parts.append(block["text"])
            elif block["type"] == "tool_use":
                tool_calls.append({
                    "id": block["id"],
                    "name": block["name"],
                    "args": block["input"],
                })
        
        message = AIMessage(
            content="\n".join(text_parts),
            tool_calls=tool_calls,
            response_metadata={
                "id": result.get("id"),
                "model": result.get("model"),
                "stop_reason": result.get("stop_reason"),
                "usage": result.get("usage"),
            },
        )
        
        return ChatResult(generations=[ChatGeneration(message=message)])



==========================================================================================================

"""
Neptune Graph Client
Provides functions to query Neptune graph database for healthcare data.
Use this in your agent code to get journey routing and related ICD-10 codes.
"""

import json
import os
import urllib.parse
import urllib.request
import boto3
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest


class NeptuneClient:
    """Client for querying Neptune graph database"""
    
    def __init__(self, neptune_endpoint, region="us-east-2", port="8182"):
        """
        Initialize Neptune client
        
        Args:
            neptune_endpoint: Neptune cluster endpoint (without https:// or port)
            region: AWS region (default: us-east-2)
            port: Neptune port (default: 8182)
        """
        self.neptune_endpoint = neptune_endpoint
        self.region = region
        self.port = port
        self.sparql_url = f"https://{neptune_endpoint}:{port}/sparql"
        self.session = boto3.Session()
        
        # SPARQL prefixes for the healthcare graph
        self.prefixes = """\
PREFIX :     <http://elegance.com/graph#>
PREFIX rdf:  <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX owl:  <http://www.w3.org/2002/07/owl#>
PREFIX xsd:  <http://www.w3.org/2001/XMLSchema#>
PREFIX sct:  <http://snomed.info/id/>
PREFIX fhir: <http://hl7.org/fhir/>
"""
    
    def _execute_sparql(self, query):
        """
        Execute a SPARQL query against Neptune
        
        Args:
            query: SPARQL query string
            
        Returns:
            dict: Query results
        """
        # Add prefixes if not already present
        if not query.strip().upper().startswith("PREFIX"):
            query = self.prefixes + query
        
        # Prepare request
        body = urllib.parse.urlencode({"query": query}).encode()
        headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/sparql-results+json"
        }
        
        # Sign request with AWS SigV4
        signed = AWSRequest(method="POST", url=self.sparql_url, data=body, headers=headers)
        SigV4Auth(self.session.get_credentials(), "neptune-db", self.region).add_auth(signed)
        
        # Execute request
        http_req = urllib.request.Request(
            self.sparql_url, 
            data=body, 
            headers=dict(signed.headers), 
            method="POST"
        )
        
        with urllib.request.urlopen(http_req, timeout=60) as resp:
            raw = resp.read().decode()
        
        return json.loads(raw) if raw.strip() else {}
    
    def _parse_results(self, sparql_result):
        """
        Parse SPARQL JSON results into a list of dicts
        
        Args:
            sparql_result: Raw SPARQL JSON result
            
        Returns:
            list: List of result rows as dictionaries
        """
        rows = []
        for binding in sparql_result.get("results", {}).get("bindings", []):
            rows.append({var: cell.get("value") for var, cell in binding.items()})
        return rows
    
    def journey_routing(self, cpt_code):
        """
        Get journey information for a given CPT code
        
        Args:
            cpt_code: CPT procedure code (e.g., "27447")
            
        Returns:
            dict: Journey information with keys:
                - procedure: Procedure URI
                - procLabel: Procedure name
                - journey: Journey URI
                - journeyName: Journey name
                - handledBy: Handler/agent name
        """
        query = f"""
        SELECT ?procedure ?procLabel ?journey ?journeyName ?handledBy WHERE {{
          ?procedure :hasCPT "{cpt_code}" .
          OPTIONAL {{ ?procedure rdfs:label ?procLabel }}
          ?journey :triggeredByProcedure ?procedure .
          OPTIONAL {{ ?journey rdfs:label ?journeyName }}
          OPTIONAL {{ ?journey :handledBy ?handledBy }}
        }}
        """
        
        result = self._execute_sparql(query)
        rows = self._parse_results(result)
        
        return {
            "cpt": cpt_code,
            "found": len(rows) > 0,
            "results": rows
        }
    
    def icd10_related_codes(self, icd10_code):
        """
        Get related conditions for a given ICD-10 code
        
        Args:
            icd10_code: ICD-10 diagnosis code (e.g., "M17.11")
            
        Returns:
            dict: Related conditions with keys:
                - condition: Condition URI
                - condLabel: Condition name
                - icd10: Original ICD-10 code
                - related: Related condition URI
                - relatedLabel: Related condition name
                - relatedICD10: Related ICD-10 code
        """
        query = f"""
        SELECT ?condition ?condLabel ?icd10 ?related ?relatedLabel ?relatedICD10 WHERE {{
          ?condition :hasICD10 "{icd10_code}" .
          OPTIONAL {{ ?condition rdfs:label ?condLabel }}
          ?condition :relatedCondition ?related .
          OPTIONAL {{ ?related rdfs:label ?relatedLabel }}
          ?related :hasICD10 ?relatedICD10 .
        }}
        """
        
        result = self._execute_sparql(query)
        rows = self._parse_results(result)
        
        return {
            "icd10": icd10_code,
            "found": len(rows) > 0,
            "results": rows
        }
    


# ==============================================================================
# STANDALONE TESTING ONLY
# ==============================================================================
# This main() function is NOT used by app.py when imported as a module.
# It only runs when you execute this file directly: python neptune_client.py
# Purpose: Test Neptune queries independently without running the full agent.
# ==============================================================================
if __name__ == "__main__":
    # Set your Neptune endpoint
    NEPTUNE_ENDPOINT = "anepdb-apm1082977-devcl02.cluster-c1orsd8u0hmn.us-east-2.neptune.amazonaws.com"
    
    # Initialize client
    client = NeptuneClient(NEPTUNE_ENDPOINT, region="us-east-2")
    
    print("\n" + "#"*80)
    print("# NEPTUNE CLIENT TEST SUITE")
    print("#"*80)
    
    # CPT to Journey Tests
    print("\n" + "="*80)
    print("CPT CODE TO JOURNEY QUERIES (journey_routing)")
    print("="*80)
    
    print("\nTEST 1: journey_routing(cpt='27447')")
    result = client.journey_routing("27447")
    print(json.dumps(result, indent=2))
    
    print("\nTEST 2: journey_routing(cpt='29881')")
    result = client.journey_routing("29881")
    print(json.dumps(result, indent=2))
    
    print("\nTEST 3: journey_routing(cpt='97110') — not a trigger")
    result = client.journey_routing("97110")
    print(json.dumps(result, indent=2))
    
    # ICD-10 Related Codes Tests
    print("\n" + "="*80)
    print("ICD-10 RELATED CONDITIONS QUERIES (icd10_related_codes)")
    print("="*80)
    
    print("\nTEST 4: icd10_related_codes(icd10='M17.11')")
    result = client.icd10_related_codes("M17.11")
    print(json.dumps(result, indent=2))
    
    print("\nTEST 5: icd10_related_codes(icd10='M23.21')")
    result = client.icd10_related_codes("M23.21")
    print(json.dumps(result, indent=2))
    
    print("\nTEST 6: icd10_related_codes(icd10='Z99.99') — not in graph")
    result = client.icd10_related_codes("Z99.99")
    print(json.dumps(result, indent=2))
    
    print("\n" + "="*80)
    print("✓ ALL TESTS COMPLETED")
    print("="*80 + "\n")

====================================================================================================

flask==3.1.0
requests==2.32.3
pydantic==2.11.0
deepagents==0.6.4
langgraph==1.2.6
boto3==1.35.0
botocore>=1.34.0

langchain-mcp-adapters==0.3.0
mcp==1.25.0

======================================================================

"""
session_trace.py
----------------
Writes agent session traces to DynamoDB table:
  apm1082977-mxp-silver-platform-session-data-dev01

Schema (Option C — two items per agent per run):

  Item 1 — base record:
    PK  session_id  = thread_id
    SK  timestamp   = "{agent_name}#{run_start_iso}"
    Attributes: agent, member_id, run_start, status, + compact traces
      signal_analyzer_input      (JSON string)
      signal_analyzer_thinking   (JSON string)
      signal_analyzer_output     (JSON string)

  Item 2 — tool calls record:
    PK  session_id  = thread_id
    SK  timestamp   = "{agent_name}#{run_start_iso}#tools"
    Attributes: agent, member_id, run_start
      signal_analyzer_tool_calls (JSON string — full, untruncated)

The attribute name prefix matches the agent name so all 4 agents' records
are distinguishable when queried by session_id.

Usage:
    from session_trace import write_session_trace

    write_session_trace(
        session_id=thread_id,
        run_start=run_start_iso,        # datetime.now(timezone.utc).isoformat()
        agent_name="signal-analyzer",   # used as SK prefix and attr prefix
        attr_prefix="signal_analyzer",  # snake_case prefix for DynamoDB attributes
        member_id=member_id,
        trace_events=trace_events,      # list of trace event dicts
        extra_attrs={                   # optional flat scalar attributes
            "signal_type": signal_type,
            "signal_strength": signal_package.get("signal_strength"),
            "trigger_action": signal_package.get("trigger_action"),
            "status": "completed",
        }
    )
"""

import json
import boto3
from botocore.exceptions import ClientError, NoCredentialsError

_TABLE_NAME = "apm1082977-mxp-silver-platform-session-data-dev01"
_REGION = "us-east-2"

# Maps trace event kind suffixes → which bucket they belong to
_INPUT_SUFFIXES    = ("_input",)
_THINKING_SUFFIXES = ("_thinking",)
_OUTPUT_SUFFIXES   = ("_output",)
_TOOL_SUFFIXES     = ("_tool", "_skill")


def _partition_events(trace_events: list, attr_prefix: str) -> dict:
    """
    Split a flat trace_events list into four buckets based on event kind.
    Returns a dict with keys: input, thinking, output, tool_calls.
    Each value is a list of event dicts (full, untruncated).
    """
    buckets = {"input": [], "thinking": [], "output": [], "tool_calls": []}
    for event in trace_events:
        kind = event.get("kind", "")
        if any(kind.endswith(s) for s in _TOOL_SUFFIXES):
            buckets["tool_calls"].append(event)
        elif any(kind.endswith(s) for s in _INPUT_SUFFIXES):
            buckets["input"].append(event)
        elif any(kind.endswith(s) for s in _THINKING_SUFFIXES):
            buckets["thinking"].append(event)
        elif any(kind.endswith(s) for s in _OUTPUT_SUFFIXES):
            buckets["output"].append(event)
        else:
            buckets["input"].append(event)
    return buckets


def write_session_trace(
    session_id: str,
    run_start: str,
    agent_name: str,
    attr_prefix: str,
    member_id: str,
    trace_events: list,
    extra_attrs: dict = None,
):
    """
    Write two DynamoDB items for this agent run:
      1. Base record  (SK = "{agent_name}#{run_start}")        — input/thinking/output traces
      2. Tools record (SK = "{agent_name}#{run_start}#tools")  — full tool_calls trace

    All writes are best-effort — failures are logged but never raise.

    Args:
        session_id:    thread_id (DynamoDB PK)
        run_start:     ISO-8601 timestamp string (start of this agent's run)
        agent_name:    e.g. "signal-analyzer" (used in SK and log labels)
        attr_prefix:   e.g. "signal_analyzer" (snake_case DynamoDB attribute prefix)
        member_id:     HCID or member identifier
        trace_events:  list of trace event dicts from the agent run
        extra_attrs:   optional dict of additional scalar attributes to store on the base record
    """
    try:
        dynamodb = boto3.resource("dynamodb", region_name=_REGION)
        table = dynamodb.Table(_TABLE_NAME)

        buckets = _partition_events(trace_events or [], attr_prefix)

        sk_base  = f"{agent_name}#{run_start}"
        sk_tools = f"{agent_name}#{run_start}#tools"

        # ── Item 1: base record ───────────────────────────────────────────────
        base_item = {
            "session_id": session_id,
            "timestamp":  sk_base,
            "agent":      agent_name,
            "member_id":  member_id,
            "run_start":  run_start,
        }

        if buckets["input"]:
            base_item[f"{attr_prefix}_input"] = json.dumps(
                buckets["input"], ensure_ascii=False
            )
        if buckets["thinking"]:
            base_item[f"{attr_prefix}_thinking"] = json.dumps(
                buckets["thinking"], ensure_ascii=False
            )
        if buckets["output"]:
            base_item[f"{attr_prefix}_output"] = json.dumps(
                buckets["output"], ensure_ascii=False
            )

        if extra_attrs:
            for k, v in extra_attrs.items():
                if v is not None:
                    if isinstance(v, bool):
                        base_item[k] = v
                    elif isinstance(v, (dict, list)):
                        base_item[k] = json.dumps(v, ensure_ascii=False)
                    else:
                        base_item[k] = str(v)

        # ── Write Item 1: base record ─────────────────────────────────────────
        try:
            table.put_item(Item=base_item)
            print(
                f"[SESSION TRACE] ✅ Base record written — "
                f"agent={agent_name}, session_id={session_id}, SK={sk_base!r}"
            )
        except NoCredentialsError as e:
            print(
                f"[SESSION TRACE] ❌ STORE FAILED (base record) — "
                f"agent={agent_name}, session_id={session_id} — "
                f"No AWS credentials: {e} — continuing execution"
            )
        except ClientError as e:
            code = e.response["Error"]["Code"]
            msg  = e.response["Error"]["Message"]
            print(
                f"[SESSION TRACE] ❌ STORE FAILED (base record) — "
                f"agent={agent_name}, session_id={session_id} — "
                f"DynamoDB {code}: {msg} — continuing execution"
            )
        except Exception as e:
            print(
                f"[SESSION TRACE] ❌ STORE FAILED (base record) — "
                f"agent={agent_name}, session_id={session_id} — "
                f"{type(e).__name__}: {e} — continuing execution"
            )

        # ── Write Item 2: tool calls record ──────────────────────────────────
        if buckets["tool_calls"]:
            tools_item = {
                "session_id": session_id,
                "timestamp":  sk_tools,
                "agent":      agent_name,
                "member_id":  member_id,
                "run_start":  run_start,
                f"{attr_prefix}_tool_calls": json.dumps(
                    buckets["tool_calls"], ensure_ascii=False
                ),
            }
            try:
                table.put_item(Item=tools_item)
                print(
                    f"[SESSION TRACE] ✅ Tools record written — "
                    f"agent={agent_name}, session_id={session_id}, "
                    f"SK={sk_tools!r}, tool_count={len(buckets['tool_calls'])}"
                )
            except NoCredentialsError as e:
                print(
                    f"[SESSION TRACE] ❌ STORE FAILED (tools record) — "
                    f"agent={agent_name}, session_id={session_id} — "
                    f"No AWS credentials: {e} — continuing execution"
                )
            except ClientError as e:
                code = e.response["Error"]["Code"]
                msg  = e.response["Error"]["Message"]
                print(
                    f"[SESSION TRACE] ❌ STORE FAILED (tools record) — "
                    f"agent={agent_name}, session_id={session_id} — "
                    f"DynamoDB {code}: {msg} — continuing execution"
                )
            except Exception as e:
                print(
                    f"[SESSION TRACE] ❌ STORE FAILED (tools record) — "
                    f"agent={agent_name}, session_id={session_id} — "
                    f"{type(e).__name__}: {e} — continuing execution"
                )
        else:
            print(
                f"[SESSION TRACE] ℹ️ No tool calls to write — "
                f"agent={agent_name}, session_id={session_id}"
            )

    except NoCredentialsError as e:
        print(
            f"[SESSION TRACE] ❌ STORE FAILED (setup) — "
            f"agent={agent_name}, session_id={session_id} — "
            f"No AWS credentials: {e} — continuing execution"
        )
    except ClientError as e:
        code = e.response["Error"]["Code"]
        msg  = e.response["Error"]["Message"]
        print(
            f"[SESSION TRACE] ❌ STORE FAILED (setup) — "
            f"agent={agent_name}, session_id={session_id} — "
            f"DynamoDB {code}: {msg} — continuing execution"
        )
    except Exception as e:
        print(
            f"[SESSION TRACE] ❌ STORE FAILED (setup) — "
            f"agent={agent_name}, session_id={session_id} — "
            f"{type(e).__name__}: {e} — continuing execution"
        )

=====================================================================================================

"""
Skills loader for Journey Orchestrator
Loads skill files dynamically for journey-specific context
"""
import os
import json
from pathlib import Path
from typing import Dict, List


def _skill_similarity(query: str, name: str, description: str) -> int:
    """Token-overlap similarity between a query string and a skill's name + description.
    Returns a score 0-80 that can be added to CPT/pathway scores.
    """
    if not query:
        return 0
    def _tokens(s: str):
        return set(s.lower().replace('-', ' ').replace('_', ' ').replace(',', ' ').split())
    q_tokens = _tokens(query)
    candidate_tokens = _tokens(name) | _tokens(description)
    overlap = q_tokens & candidate_tokens
    # Ignore generic stop words that appear in every skill
    _STOP = {'journey', 'stage', 'definitions', 'for', 'with', 'and', 'the', 'a', 'an',
             'carelon', 'aligned', 'utilization', 'management', 'pathway', 'member',
             'experience', 'orchestration', 'knee', 'surgery'}
    meaningful = overlap - _STOP
    return len(meaningful) * 20


def _parse_frontmatter(content: str) -> tuple[Dict, str]:
    """Parse YAML frontmatter from markdown file."""
    if not content.startswith('---'):
        return {}, content
    
    parts = content.split('---', 2)
    if len(parts) < 3:
        return {}, content
    
    frontmatter_text = parts[1].strip()
    body = parts[2].strip()
    
    # Simple YAML parser for frontmatter
    metadata = {}
    for line in frontmatter_text.split('\n'):
        if ':' in line:
            key, value = line.split(':', 1)
            metadata[key.strip()] = value.strip().strip('"\'')
    
    return metadata, body


def list_available_skills() -> str:
    """List all available skills with their metadata."""
    skills_dir = Path(__file__).parent / "skills"
    print(f"[JOURNEY ORCHESTRATOR] Skills directory path: {skills_dir}")
    if not skills_dir.exists():
        print(f"[JOURNEY ORCHESTRATOR] Skills directory does not exist")
        return json.dumps([])
    
    # List all directories
    all_dirs = [d.name for d in skills_dir.iterdir() if d.is_dir()]
    print(f"[JOURNEY ORCHESTRATOR] Available directories: {json.dumps(all_dirs, indent=2)}")
    
    skills = []
    for skill_path in skills_dir.iterdir():
        if skill_path.is_dir():
            # Look for ALL skill files with various naming patterns
            # NAMING CONVENTION OF SKILLS FILES WHEN ADDING - IMPORTANT
            skill_files = []
            for pattern in ["tka_preoperative_ct_skill.md", "SKILL.md", "*_skill.md"]:
                if pattern.startswith("*"):
                    matches = list(skill_path.glob(pattern))
                    skill_files.extend(matches)
                else:
                    candidate = skill_path / pattern
                    if candidate.exists():
                        skill_files.append(candidate)
            
            # Process ALL skill files found in this directory
            if skill_files:
                for skill_file in skill_files:
                    print(f"[JOURNEY ORCHESTRATOR] Found skill file: {skill_path.name}/{skill_file.name}")
                    content = skill_file.read_text()
                    metadata, _ = _parse_frontmatter(content)
                    skills.append({
                        "name": skill_path.name,
                        "description": metadata.get("description", ""),
                        "pathway": metadata.get("pathway", ""),
                        "service_name": metadata.get("service_name", ""),
                        "primary_cpt": metadata.get("primary_cpt", ""),
                        "secondary_cpt": metadata.get("secondary_cpt", ""),
                        "clinical_scenario": metadata.get("clinical_scenario", ""),
                    })
            else:
                print(f"[JOURNEY ORCHESTRATOR] No skill file found in directory: {skill_path.name}")
    
    return json.dumps(skills, indent=2)


def select_skill(skill_name: str, pathway: str = None, primary_cpt: str = None, rationale: str = None) -> str:
    """Load a specific skill by name (directory name), with optional pathway/CPT/rationale filtering."""
    skills_dir = Path(__file__).parent / "skills"
    skill_dir = skills_dir / skill_name
    print(f"[JOURNEY ORCHESTRATOR] Loading skill from directory: {skill_name}")
    
    if skill_dir.exists():
        all_files = [f.name for f in skill_dir.iterdir() if f.is_file()]
        print(f"[JOURNEY ORCHESTRATOR] Available files in {skill_name}: {json.dumps(all_files, indent=2)}")
    else:
        print(f"[JOURNEY ORCHESTRATOR] Directory does not exist: {skill_name}")
    
    # Collect all skill files — deduplicated
    seen_paths = set()
    skill_candidates = []
    for pattern in ["tka_preoperative_ct_skill.md", "SKILL.md", "*_skill.md"]:
        if pattern.startswith("*"):
            for m in skill_dir.glob(pattern):
                if str(m) not in seen_paths:
                    seen_paths.add(str(m))
                    skill_candidates.append(m)
        else:
            candidate = skill_dir / pattern
            if candidate.exists() and str(candidate) not in seen_paths:
                seen_paths.add(str(candidate))
                skill_candidates.append(candidate)
    
    if not skill_candidates:
        return json.dumps({"error": f"Skill '{skill_name}' not found"})
    
    query = " ".join(filter(None, [pathway, rationale]))
    scored_files = []
    for skill_file in skill_candidates:
        content = skill_file.read_text()
        metadata, body = _parse_frontmatter(content)
        score = 0
        skill_pathway = metadata.get("pathway", "").lower()
        skill_name_meta = metadata.get("name", skill_file.stem)
        skill_desc = metadata.get("description", "")

        # CPT exact match — highest weight
        if primary_cpt and metadata.get("primary_cpt", "") == str(primary_cpt):
            score += 150
        elif primary_cpt and metadata.get("secondary_cpt", "") == str(primary_cpt):
            score += 60

        # Exact pathway match
        if pathway and skill_pathway == pathway.lower():
            score += 100
        elif pathway and skill_pathway:
            pathway_lower = pathway.lower()
            if pathway_lower in skill_pathway or skill_pathway in pathway_lower:
                score += 50
            else:
                pw = set(pathway_lower.replace('-', ' ').replace('_', ' ').split())
                sw = set(skill_pathway.replace('-', ' ').replace('_', ' ').split())
                score += len(pw & sw) * 15

        # Name + description similarity against pathway + rationale
        score += _skill_similarity(query, skill_name_meta, skill_desc)

        scored_files.append({"file": skill_file, "metadata": metadata, "body": body, "score": score})
        print(f"[JOURNEY ORCHESTRATOR] Skill candidate: {skill_file.name} score={score}")
    
    scored_files.sort(key=lambda x: x["score"], reverse=True)
    best = scored_files[0]
    print(f"[JOURNEY ORCHESTRATOR] Selected skill file: {best['file'].name} (score: {best['score']})")
    
    return json.dumps({
        "skill_name": skill_name,
        "metadata": best["metadata"],
        "content": best["body"]
    }, indent=2)


def select_skill_by_pathway(pathway: str, service_name: str = None, primary_cpt: str = None, rationale: str = None) -> str:
    """Dynamically select the most relevant skill based on pathway, service, CPT code, and rationale."""
    skills_dir = Path(__file__).parent / "skills"
    if not skills_dir.exists():
        return json.dumps({"error": "No skills directory found"})
    
    # Collect ALL skill files across all directories — one entry per file (not per directory)
    all_skills = []
    for skill_path in skills_dir.iterdir():
        if skill_path.is_dir():
            seen_paths: set = set()
            for pattern in ["tka_preoperative_ct_skill.md", "SKILL.md", "*_skill.md"]:
                if pattern.startswith("*"):
                    for m in skill_path.glob(pattern):
                        if str(m) not in seen_paths:
                            seen_paths.add(str(m))
                            content = m.read_text()
                            metadata, body = _parse_frontmatter(content)
                            all_skills.append({
                                "directory": skill_path.name,
                                "file_name": m.name,
                                "metadata": metadata,
                                "content": body,
                                "file_path": str(m)
                            })
                else:
                    candidate = skill_path / pattern
                    if candidate.exists() and str(candidate) not in seen_paths:
                        seen_paths.add(str(candidate))
                        content = candidate.read_text()
                        metadata, body = _parse_frontmatter(content)
                        all_skills.append({
                            "directory": skill_path.name,
                            "file_name": candidate.name,
                            "metadata": metadata,
                            "content": body,
                            "file_path": str(candidate)
                        })
    
    if not all_skills:
        return json.dumps({"error": "No skills found"})
    
    query = " ".join(filter(None, [pathway, rationale]))
    scored_skills = []
    for skill in all_skills:
        score = 0
        meta = skill["metadata"]
        skill_pathway = meta.get("pathway", "").lower()
        skill_name_meta = meta.get("name", skill["file_name"])
        skill_desc = meta.get("description", "")

        # Primary CPT exact match — highest weight
        if primary_cpt:
            if meta.get("primary_cpt", "") == str(primary_cpt):
                score += 150
            elif meta.get("secondary_cpt", "") == str(primary_cpt):
                score += 60

        # Exact pathway match
        if pathway and skill_pathway == pathway.lower():
            score += 100
        elif pathway and skill_pathway:
            if pathway.lower() in skill_pathway or skill_pathway in pathway.lower():
                score += 25

        # Service name match
        if service_name and meta.get("service_name", "").lower() == service_name.lower():
            score += 50

        # Name + description similarity against pathway + rationale
        score += _skill_similarity(query, skill_name_meta, skill_desc)

        scored_skills.append({"skill": skill, "score": score})
        print(f"[JOURNEY ORCHESTRATOR] Skill candidate: {skill['file_name']} score={score}")
    
    scored_skills.sort(key=lambda x: x["score"], reverse=True)
    
    if scored_skills[0]["score"] > 0:
        best = scored_skills[0]["skill"]
        return json.dumps({
            "skill_name": best["directory"],
            "skill_file": best["file_name"],
            "metadata": best["metadata"],
            "content": best["content"],
            "match_score": scored_skills[0]["score"]
        }, indent=2)
    else:
        fallback = all_skills[0]
        return json.dumps({
            "skill_name": fallback["directory"],
            "skill_file": fallback["file_name"],
            "metadata": fallback["metadata"],
            "content": fallback["content"],
            "match_score": 0,
            "warning": "No exact match found, returning first available skill"
        }, indent=2)

==========================================================================================================


