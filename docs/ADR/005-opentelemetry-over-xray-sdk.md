# ADR 005 — OpenTelemetry over AWS X-Ray SDK Directly

**Status**: Accepted  
**Date**: 2026-05-07

## Context

The platform needs distributed tracing across Lambda, SQS, Kafka, and MongoDB. AWS X-Ray is the target backend. Options: AWS X-Ray SDK directly, OpenTelemetry SDK with OTLP → X-Ray.

## Decision

Use **OpenTelemetry SDK** with `OTLPTraceExporter` pointing at AWS CloudWatch's native OTLP endpoint.

## Rationale

**Vendor neutrality**: OTel traces can be redirected to Jaeger, Zipkin, Grafana Tempo, or Datadog by changing one env var. The X-Ray SDK would require a complete instrumentation rewrite.

**Unified pipeline**: OTel covers traces + metrics + logs in a single SDK. The X-Ray SDK only does traces.

**Better auto-instrumentation**: `@opentelemetry/instrumentation-mongoose` and `@opentelemetry/instrumentation-http` provide richer spans than X-Ray's equivalents.

**AWS support**: AWS announced CloudWatch native OTLP endpoint (GA 2024). X-Ray now accepts OTLP directly — no need for an OTel Collector sidecar in Lambda.

**Kafka propagation**: OTel's `W3CTraceContextPropagator` injects `traceparent` into Kafka message headers. X-Ray SDK has no Kafka support.

## Trade-offs

- Bundle size slightly larger than X-Ray SDK.
- OTLP → X-Ray means X-Ray console still works (service map, traces), but some X-Ray-specific features (annotations, segments) require extra SDK calls.

## Consequences

- `initTracer()` must be called before any other import in Lambda handlers (OTel patching requires early init).
- SQS message attributes carry `traceparent` header for cross-Lambda trace continuity.
- Kafka message headers carry `traceparent` for consumer-side span linking.
