# ADR-0002: Do not guess portal-bound Coupang contracts

Status: Accepted — 2026-08-21

## Context

The current official public Coupang Partners guides confirm Product, Deep Link, and Reporting API families, HMAC authentication, disclosure obligations, and family rate limits. The detailed current endpoint/response reference is rendered inside the authenticated Partners portal and was not verifiable in this environment.

## Decision

Define typed Partners ports and full offline fixture behavior. Keep base URL and verified route templates in configuration, validate all returned data, and require manually triggered credential-backed contract tests before marking production search, deep-link attribution, or reporting as live verified. Any capability without a verified route fails with a typed `CapabilityUnavailableError`; it never returns fabricated data.

## Consequences

Offline E2E and business logic are complete. The operator must validate the current portal contract and secrets through the connectivity workflow. If the official contract differs, only the infrastructure adapter/config changes; the domain and historical records remain stable.
