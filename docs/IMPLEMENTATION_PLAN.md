# Implementation Plan

Checked: 2026-08-21 (KST)

## Delivery outcome

Build a strict TypeScript monorepo-style application whose domain logic runs offline, whose external APIs are isolated behind validated adapters, and whose Git-backed data and static Astro storefront can be operated entirely through GitHub Actions.

## Architecture slices

1. **Foundation** — pnpm, strict TypeScript, ESLint/Prettier, Vitest, versioned Zod schemas, typed errors, structured redacted logging, configuration with environment interpolation.
2. **Domain** — products, evidence, campaigns, offer codes, drafts, scoring, deterministic hard-fail policies, similarity, queues, metrics, analytics, and immutable events.
3. **Infrastructure** — append-oriented repository datastore plus Coupang, Groq, and Threads interfaces with production HTTP clients and offline fixture clients.
4. **Application pipelines** — ingest, analyze/generate/judge, calibration and labels, publishing selection/dispatcher, metrics collection, analytics/optimization recommendations, connectivity checks, and a complete fixture dry run.
5. **Storefront** — Astro static output generated from repository campaign/product data with Korean mobile-first offer-code search, offer pages, disclosure, snapshot timestamps, and outbound affiliate links.
6. **Operations** — separate GitHub workflows, writer concurrency, Pages deployment, KST dispatcher schedules, production publication gate, secret-dependent manual contract tests, token-health warnings, and audit-friendly generated commits.
7. **Evidence** — fixtures, unit/integration/E2E tests, lint/typecheck/format/build gates, API research, ADRs, operator documentation, Day-1 runbook, and an honest live-verification matrix.

## Dependency direction

`config/schemas -> domain -> application ports/use-cases -> infrastructure adapters -> CLI/workflows/storefront`

Domain modules do not import HTTP, filesystem, GitHub Actions, or Astro code. Production adapters validate all external responses and use injected clocks/fetch functions where determinism matters.

## Key decisions

- JSON/JSONL/YAML are the system of record; generated analytics/storefront views are reproducible projections.
- Campaign ID is the canonical cross-channel attribution key; offer code is a separately allocated human-facing identifier.
- LLM judgments are advisory. Deterministic validators are authoritative and cannot be overridden by score.
- Initial publishing mode is `calibration`; thresholds are disabled in configuration. `human_approved` enables Day-1 posts without inventing a cutoff.
- No production publish occurs unless both policy eligibility and `PUBLISH_ENABLED=true` hold.
- All uncertain or unavailable official capabilities remain optional adapter methods and are never simulated as production success.

## Verification gates

Fresh-clone offline gates: frozen install, format, lint, typecheck, unit tests, integration tests, fixture E2E, full dry-run pipeline, and Astro production build. Secret-backed contract checks are manual and read-only; absence of secrets is reported as unverified, not failed offline functionality.

## Stop condition

Delivery is complete only after the offline gates pass, the dry run emits every required artifact through analytics, the storefront builds, workflows and documentation match executable commands, a security/architecture review is resolved, and external integrations are classified as implemented/offline-tested/live-verified.
