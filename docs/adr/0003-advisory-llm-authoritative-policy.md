# ADR-0003: LLM scores are advisory; deterministic policy is authoritative

Status: Accepted — 2026-08-21

## Decision

Store component judge scores and explanations, but calculate hard fails independently. No score can override fabricated experience, unsupported claims, health claims, disclosure, scarcity/superlative, similarity, URL, mapping, or policy failures. Initial thresholds are disabled and publishing mode is calibration.

## Rationale

This separates subjective content quality from compliance and supports empirical calibration without unsafe arbitrary cutoffs.
