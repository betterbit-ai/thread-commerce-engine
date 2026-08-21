# Operations

## Schedules

Ingest and planning run daily; the dispatcher runs every ten minutes and publishes all due eligible records. Threads collection runs every three hours; Coupang reporting is lower-frequency after its documented daily availability. GitHub cron may be delayed/dropped, so no workflow assumes exact firing.

Human-approved/auto planning projects queued offers into `data/storefront` before dispatch. The Pages workflow must complete successfully before enabling the production dispatcher; `publish:prepare` also refuses any campaign missing from the storefront projection.

## Failure handling

- API calls have timeouts, bounded exponential retry, typed errors, and safe logs.
- 429/5xx may retry; policy/config/validation/authentication failures do not retry blindly.
- Writer concurrency prevents simultaneous Git writes; idempotency/receipts remain the real duplicate defense.
- The dispatcher first commits `data/state/publications/<campaign>.json` with a one-time container, then publishes it. A timeout/error after the publish request records `publication_unknown`; automatic retry stops. Inspect the account/container and reconcile the receipt manually—never clear the claim to “retry.”
- Disable publishing by setting `PUBLISH_ENABLED=false`; scheduled collectors can remain read-only.

## Token health

The weekly connectivity workflow reads `THREADS_TOKEN_EXPIRES_AT`, emits an Actions warning, and attempts a GitHub Issue before the warning window. It never prints the token. Secure manual renewal: obtain/exchange/refresh through Meta, replace the GitHub Secret, update only the expiry variable, rerun read-only contracts, then revoke/retire the old credential as appropriate.

## Data commits

Generated commits use `data(products)`, `data(content)`, `data(publish)`, and `data(metrics)`. If a push races despite concurrency, rerun the workflow against the latest default branch rather than force-pushing.

## Capability matrix at repository delivery

| Component                                 |                       Implemented |         Tested offline |                                                Live verified |
| ----------------------------------------- | --------------------------------: | ---------------------: | -----------------------------------------------------------: |
| Domain/content/policy/calibration         |                               Yes |                    Yes |                                               Not applicable |
| Git datastore/analytics/storefront        |                               Yes |                    Yes |                       Pages deployment requires operator run |
| Coupang signing/search/deep link          |                               Yes |      Yes with fixtures |                                          No credentials used |
| Coupang reporting                         | Port + configurable HTTP contract |    Normalized fixtures | No; exact portal routes/fields require operator verification |
| Groq structured generation/judge          |                               Yes |      Yes with fixtures |                                          No credentials used |
| Threads read/publish/insights/search flag |                               Yes |      Yes with fixtures |                   No credentials used; publish remains gated |
| Actions schedules/Pages                   |                               Yes | YAML/repository review |                                     No GitHub-hosted run yet |

Never change the final column without a secret-backed workflow receipt.
