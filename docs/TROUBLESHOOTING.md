# Troubleshooting

## `Specified signature is expired` / authentication failure

Ensure runner time is synchronized; signatures use UTC `YYMMDDTHHMMSSZ`. Confirm access/secret keys have no whitespace and the signed path/query exactly match the request. Logs intentionally omit authorization.

## Coupang capability unavailable

The current detailed Partners routes are portal-bound. Verify the operator’s official portal reference and configure the report path variables. Do not use seller Open API routes or guess fields. Run the read-only contract workflow.

## Groq 400 / schema errors

Confirm the configured model currently supports the selected structured-output mode. The client validates JSON regardless. Pick a current non-preview model intentionally, check project/account limits, and preserve the failed input hash for reproducibility.

## Groq/Meta 429 or timeout

Respect `Retry-After`; reduce live calibration sample/generation counts. Do not raise retries until they multiply load. GitHub retries should reuse cache/idempotency records.

## Threads permission/token errors

Check `threads_basic`, `threads_content_publish`, and `threads_manage_insights`, App Review/Live status, token expiry, and user ownership. Keyword search additionally needs `threads_keyword_search` and the feature flag. General contracts never publish.

## Dispatcher published nothing

Expected causes: calibration mode, no approval, thresholds disabled in auto mode, hard fail, future due time, missing mapping/link, `PUBLISH_ENABLED` not exactly `true`, or production environment approval pending. Inspect campaign/draft records and structured logs.

## Pages links are wrong

Set `SITE_URL` to `https://OWNER.github.io` and `SITE_BASE` to `/REPOSITORY` (empty/root only for an `OWNER.github.io` repository/custom domain). Rebuild and use GitHub Actions as Pages source.

## Scheduled workflow did not fire exactly

GitHub documents delay/drop under load. The next dispatcher handles all overdue items. Do not create one cron per post.
