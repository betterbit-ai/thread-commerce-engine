# ADR-0001: Git-backed append-oriented records

Status: Accepted — 2026-08-21

## Decision

Use versioned JSON/JSONL/YAML records in Git as source of truth and regenerate analytics/storefront projections. Serialize repository-writing Actions with one shared concurrency group and make each use-case idempotent.

## Rationale

This meets the no-external-infrastructure constraint, preserves a reviewable audit log, and keeps adapters/test fixtures deterministic. JSONL minimizes conflicts for immutable events; JSON/YAML remain appropriate for entity snapshots and human-edited labels/experience.

## Consequences

Repository growth must be monitored and old raw payloads compacted only through a documented migration. The system is batch-oriented, not a low-latency transactional database.
