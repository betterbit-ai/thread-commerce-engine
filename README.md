# Thread Commerce Engine

GitHub-native affiliate commerce experimentation for the Korean account **오래 일하는 개발자의 장비**. It connects evidence-grounded Coupang product opportunities, Korean Threads content, human/score calibration, offer-code storefront attribution, Threads insights, and Coupang revenue signals without an external server or database.

> This is an experimentation engine, not a bulk-posting bot. LLM scores never override deterministic safety failures, and live publishing is disabled by default.

## What it does

```text
Coupang Partners → Git-backed product evidence → analysis → angles → drafts
→ Groq judge → deterministic policy → calibration/human approval → campaign + offer code
→ Threads API → GitHub Pages storefront → Coupang → normalized events → commerce analytics
```

- Strict TypeScript domain and versioned Zod schemas
- Configurable 80/20 ergonomic-core/Apple bootstrap portfolio
- Multi-stage, versioned prompt pipeline with Groq structured output and cache
- Hard fails for fabricated experience, medical claims, disclosure, scarcity/superlatives, duplicates, URLs, mapping, and policy
- `calibration`, `human_approved`, and `auto` modes; thresholds start disabled
- HMAC-signed Coupang adapter; typed Groq and Threads adapters; complete offline fixtures
- Idempotent dispatcher and serialized Git writer workflows
- Mobile-first Korean Astro storefront with instant offer-code search
- Offline E2E from fixture products through mock commissions and analytics

## Quick start (offline)

Requirements: Node.js 24+, Corepack/pnpm 10.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm pipeline:dry-run
pnpm build
```

Dry-run output is under `.artifacts/dry-run/`; it never uses credentials or publishes.

## Operator commands

| Command                   | Purpose                                                   |
| ------------------------- | --------------------------------------------------------- |
| `pnpm products:ingest`    | Live Coupang product ingestion                            |
| `pnpm content:plan`       | Analyze, generate, judge, validate, and plan              |
| `pnpm calibration:run`    | Complete offline fixture calibration                      |
| `pnpm calibration:report` | Rebuild report from repository labels/drafts              |
| `pnpm publish:prepare`    | Create and persist one-time Threads containers            |
| `pnpm publish:due`        | Publish all eligible due items (requires production gate) |
| `pnpm metrics:threads`    | Sample Threads post insights                              |
| `pnpm metrics:coupang`    | Collect configured Partners reporting contracts           |
| `pnpm analytics:build`    | Rebuild/report analytics projection                       |
| `pnpm storefront:build`   | Regenerate data projection and build Astro                |
| `pnpm connections:check`  | Show credential configuration; optional live checks       |

## Documentation

- [Architecture](docs/ARCHITECTURE.md) · [Data model](docs/DATA_MODEL.md)
- [Setup and Day-1](docs/SETUP.md) · [Operations](docs/OPERATIONS.md)
- [Content policy](docs/CONTENT_POLICY.md) · [Calibration](docs/CALIBRATION.md)
- [Analytics](docs/ANALYTICS.md) · [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Current API research](docs/research/API_RESEARCH.md) · [ADRs](docs/adr/)

## Live-verification rule

Mock tests prove adapter behavior, not production access. Run the manual `Connectivity and token health` workflow with secrets. A component is **live verified** only after that secret-backed workflow passes; see the capability matrix in `docs/OPERATIONS.md`.

## Disclosure

Every commercial post/page is required to display:

> 이 게시물은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.
