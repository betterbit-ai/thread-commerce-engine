# Setup and Day-1 Runbook

## 1. Repository and Pages

1. Push to GitHub with default branch `main`.
2. Settings → Pages → Source: **GitHub Actions**.
3. Create `production` environment and require reviewer approval.
4. Keep Actions workflow permissions least-privileged; writer workflows explicitly request `contents: write`.

## 2. Secrets and variables

Repository/environment **Secrets**: `COUPANG_ACCESS_KEY`, `COUPANG_SECRET_KEY`, `GROQ_API_KEY`, `THREADS_ACCESS_TOKEN` (and app secret only for manual token operations).

Repository **Variables**: `GROQ_MODEL`, `GROQ_JUDGE_MODEL`, `THREADS_TOKEN_EXPIRES_AT`, and—after checking the current Partners portal—three `COUPANG_REPORT_*_PATH` variables plus exact `COUPANG_REPORT_CAMPAIGN_FIELD`, `COUPANG_REPORT_CLICKS_FIELD`, `COUPANG_REPORT_ORDERS_FIELD`, `COUPANG_REPORT_COMMISSION_FIELD`, and optional period field. Do not copy uncertain example paths or field names blindly. Enable `external.coupang.subid_enabled` only after its live contract succeeds.

Production environment variable: `PUBLISH_ENABLED=false` initially. Models must be current Groq model IDs selected from the account Models page; none are hard-coded.

## 3. Meta configuration

Create/configure a Threads app, complete OAuth, and request `threads_basic`, `threads_content_publish`, and `threads_manage_insights`; request `threads_keyword_search` only if enabling that feature. Exchange for a long-lived token, record its expiry timestamp as a non-secret variable, and complete App Review/Live mode requirements.

## 4. Literal Day-1 sequence

1. Keep `config/default.yml` in `publishing.mode: calibration`; thresholds disabled.
2. Manually run **Connectivity and token health**. It is read-only and must pass before claiming integration verification.
3. Run **Ingest products**. Review the generated snapshot/catalog commit.
4. Run **Calibration** offline, then **Plan content** live. Review `reports/calibration/latest.json`.
5. Change mode to `human_approved`; keep both thresholds disabled.
6. Run **Review calibration drafts** to add `approve` labels for four safe, diverse drafts (mouse, keyboard/desk, Apple accessory, high-ticket opportunity). The workflow validates and commits labels and queues the exact reviewed draft revision; do not regenerate approved content before publishing.
7. Run/deploy Pages and test the literal `프로필 142번 → search → offer → Coupang` flow on mobile.
8. Set production environment variable `PUBLISH_ENABLED=true` only after review. Run **Publish dispatcher** manually; environment reviewer approves it.
9. Confirm stored Threads post IDs/permalinks. Then allow scheduled dispatcher/collectors.
10. After reporting cadence permits, validate configured Coupang report routes with the contract workflow before enabling the reporting schedule.

Rollback: immediately set `PUBLISH_ENABLED=false`; do not delete audit records. See Operations.
