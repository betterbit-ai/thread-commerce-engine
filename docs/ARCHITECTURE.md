# Architecture

## Boundaries

```text
config + schemas
       ↓
domain (IDs, evidence, scoring, safety, similarity, scheduling, analytics)
       ↓
application ports + use cases
       ↓
infrastructure (repository, Coupang, Groq, Threads)
       ↓
CLI / GitHub Actions / Astro projection
```

The domain never imports HTTP, filesystem, Astro, or Actions. External adapters accept injected `fetch`, clocks, and stores in tests. Every boundary validates unknown JSON before it becomes a domain record.

## Closed loop

1. Ingestion normalizes immutable product snapshots and updates a latest catalog.
2. Deterministic analysis preserves unknown values as null/unknown; prompts cannot upgrade missing evidence.
3. Angle/writer/judge stages record prompt version, model, and input hash.
4. Policy validation runs independently. `hard_fail=true` is final.
5. Campaign ID joins product, offer code, draft, attribution key, social post, and performance.
6. The dispatcher claims all due eligible records. Publication receipts make retries idempotent.
7. Insights/reporting become append-only normalized events; projections calculate commerce outcomes.

## Consistency and idempotency

- Repository writes use same-directory temporary files + atomic rename.
- All writer workflows share `concurrency.group: repository-writer`.
- Generated commits use `data(<area>): ... [skip ci]` messages.
- Publication is two-phase: `publish:prepare` creates a one-time Threads container, then commits its claim before `publish:due` publishes that same container. Campaign IDs and published receipts are idempotency keys. Non-idempotent POSTs have no transport retry; ambiguous outcomes become `publication_unknown` and require reconciliation rather than blind republishing.
- JSONL events are immutable. Corrections are new events/migrations, not silent historical edits.

## Safety

`PUBLISH_ENABLED=true` is necessary but insufficient: mode eligibility, approval/threshold, due time, hard-fail result, disclosure, mapping, URL, and similarity must all pass. CI/default local values cannot publish.

## Scale limits

This is deliberately batch/Git oriented. It is suitable for a small account and hundreds/thousands of experiments, not high-frequency real-time commerce. Monitor repository size and Actions conflicts; migrate only via ADR if scale invalidates Git storage.
