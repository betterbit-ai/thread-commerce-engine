# Official API Research

Checked: **2026-08-21 (KST)**. Current documentation wins over the original project brief. No secret-backed calls were made during this research.

## Meta Threads API

Sources:

- [Meta Threads API collection (official Meta workspace)](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api)
- [Publish request](https://www.postman.com/meta/threads/request/34203612-e19a804d-ed93-45cd-82f8-7b8110a60744)
- [Post insights request](https://www.postman.com/meta/threads/request/434u2bd/get-post-insights)
- [Keyword search request](https://www.postman.com/meta/threads/request/m9j4i2x/search-for-threads-posts)
- [Token debug request](https://www.postman.com/meta/threads/request/mm48yqc/debug-access-token)

Relevant API/version: Threads Graph API at `https://graph.threads.net`; the public collection does not expose a stable version number in the endpoint path, so the base URL is configurable.

Verified capabilities and fields:

- Create text container: `POST /me/threads` with `media_type=TEXT` and `text`.
- Publish: `POST /me/threads_publish` with `creation_id`; response contains the Threads media `id`.
- Read post/profile fields including `id`, `text`, `timestamp`, `permalink`, and `username` where requested and permitted.
- Post insights: `GET /{threads-media-id}/insights`; currently documented post metrics include `views`, `likes`, `replies`, `reposts`, `quotes`, and `shares`.
- Keyword search: `GET /keyword_search`, query `q`, `search_type=TOP|RECENT`, and requested fields. It requires `threads_keyword_search` and is therefore feature-flagged.
- Long-lived token exchange returns `expires_in: 5184000` (60 days). Token debugging/health is available; automated secret replacement is not assumed.
- Publishing quota endpoint is documented at `/me/threads_publishing_limit`; the example shows 250 API-published posts per 86,400 seconds and a separate reply quota. This is a quota returned by the API, not a constant used by the application.

Permissions/scopes:

- `threads_basic` for basic identity/read and token exchange/refresh.
- `threads_content_publish` for publishing.
- `threads_manage_insights` for insights.
- `threads_keyword_search` for optional keyword discovery.
- The official collection also lists reply/mention permissions, but they are outside initial scope.

Rate limits: no general request-per-hour limit was found in the accessible official Threads material. The client reads API error responses and publishing quota dynamically and does not invent a limit.

Important constraints/uncertainties:

- App Review and production-app configuration may be required for permissions used by people without an app role.
- Scheduled publication is implemented locally as a due-item dispatcher; it does not depend on a Threads scheduling endpoint.
- Token expiry warning is implemented, but GitHub Secrets cannot be safely rewritten without additional privileged credentials, so renewal remains a documented manual operation.

## Coupang Partners API

Sources:

- [Coupang Partners portal](https://partners.coupang.com/#help/open-api)
- [Official Coupang Partners usage guide, 2024-07](https://partners.coupangcdn.com/partners-guide/partners-guide-20240716100922.pdf)
- [Official Coupang Partners usage guide, 2024-12 edition](https://partners.coupangcdn.com/partners-guide/partners-guide-20250324160743.pdf)

Relevant API/version: Partners Open API. The accessible official guide describes product, deep-link, and reporting API families but the current detailed endpoint reference is rendered behind the Partners portal session. The adapter base URL/path set is configurable and contract tests are required before production use.

Verified capabilities:

- Product APIs provide Coupang product information and deal lists such as Gold Box.
- Deep Link API converts Coupang URLs to Partners URLs.
- Reporting API provides daily click and performance information.
- API access is available after final Partners approval and API-key issuance.
- Official guide limits: Search **10 calls/hour**, Report **50 calls/hour**, other APIs **100 calls/hour**. First excess can block calls for 24 hours; repeated excess can disable Partners features pending review. These values are configuration defaults and throttling budgets, not retry targets.

Authentication: the official Partners Open API requires issued access/secret keys and HMAC signing. The implementation uses the documented CEA `HmacSHA256` construction over UTC timestamp + HTTP method + path + query and includes deterministic signing vectors. Credentials are never logged.

Attribution/subId: the detailed current portal reference was not accessible without an operator session, so `subId` support is modeled explicitly at the adapter boundary and sent only by the endpoint method whose configured contract enables it. Campaign-to-link mapping is always stored locally. A live contract response must verify current subId acceptance before it is considered production-verified.

Reporting uncertainty: the guide verifies daily reporting as a capability, but the exact current response fields, grouping dimensions, availability delay, and endpoint paths could not be verified from the public guide. The reporting port therefore accepts normalized click/order/commission records, the fixture adapter exercises them offline, and the HTTP adapter validates configured raw responses without claiming live verification. No metric is fabricated.

Disclosure requirement:

> 이 게시물은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.

The guide requires the economic-interest disclosure on every linked post, close to the recommendation, clearly distinguishable, and in the same language. The exact required text is configuration-backed and deterministically appended/validated for Threads and displayed on storefront pages.

## Groq API

Sources:

- [Groq API reference](https://console.groq.com/docs/api-reference)
- [Structured Outputs](https://console.groq.com/docs/structured-outputs)
- [Rate limits](https://console.groq.com/docs/rate-limits)
- [Supported models](https://console.groq.com/docs/models)
- [Error responses](https://console.groq.com/docs/errors)

Relevant API/version: OpenAI-compatible `POST https://api.groq.com/openai/v1/chat/completions`.

Authentication: bearer API key. Models are environment/config values and are intentionally not hard-coded to a potentially deprecated identifier.

Verified constraints:

- `response_format.type=json_schema` is preferred on supported models; strict structured outputs support only a subset of models and require all properties required plus `additionalProperties: false`.
- Best-effort schema mode and JSON-object mode still require runtime validation/retry.
- Structured outputs do not currently support streaming or tool use.
- Rate limits are organization/model-specific and measured across RPM/RPD/TPM/TPD (and sometimes separate input/output token limits). Exact current limits must be read from the account Limits page and response headers.
- HTTP 429 is rate limiting; `retry-after` may be present. Transient/flex errors also require bounded backoff.

Implementation consequence: prompt files are versioned; requests have deterministic task temperatures, timeouts, token caps, input hashes, repository cache records, schema validation, invalid-output retries, and `Retry-After`-aware backoff.

## GitHub Actions and GitHub Pages

Sources:

- [Events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- [Workflow concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
- [Actions secrets](https://docs.github.com/en/actions/reference/security/secrets)
- [Custom Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

Relevant version: current GitHub-hosted Actions/Pages service documentation, checked date above.

Verified constraints:

- Scheduled runs may be delayed or dropped during high load, especially at the start of an hour; minimum schedule interval is five minutes. Business scheduling must therefore be a due-item dispatcher, not exact cron firing.
- Scheduled workflows use the latest default-branch commit and may be disabled after 60 days of inactivity in public repositories.
- Concurrency groups serialize writers; pending-run replacement semantics mean workflows must remain idempotent even with concurrency enabled.
- Secrets belong in GitHub Actions Secrets; log redaction is not a security boundary, so application logs redact by key/value and never print request authorization.
- Custom Pages deployment requires `pages: write` and `id-token: write`, a `github-pages` environment, an uploaded Pages artifact, and `actions/deploy-pages`.

## Astro

Source: [official Astro GitHub Pages deployment guide](https://docs.astro.build/en/guides/deploy/github/).

Relevant version: current Astro docs (the guide currently demonstrates `withastro/action@v6`).

Constraints:

- Static GitHub project Pages generally requires an Astro `base` matching the repository name; internal links must respect it.
- The lockfile must be committed so the official action detects pnpm.
- This project uses static output only and no server adapter.

## Research deviations and explicit unknowns

1. The brief suggests implementing every Coupang reporting field if available. Current public official material confirms reporting but does not expose its exact contract without portal access; detailed production reporting stays unverified and adapter-isolated rather than guessed. See ADR-0002.
2. Threads keyword search is currently documented, contrary to treating it as hypothetical, but it requires a dedicated permission. It is implemented behind a disabled-by-default flag.
3. GitHub schedule now documents optional IANA timezones, but dispatcher idempotency remains necessary because schedules can still be delayed/dropped.
