# Calibration

Initial mode is `calibration`; absolute and percentile thresholds are disabled. This is intentional—not an incomplete configuration.

## Offline fixture calibration

```bash
pnpm calibration:run
cat .artifacts/calibration/reports/calibration/latest.json
```

Fixtures include vertical/normal mice, ergonomic/split keyboards, trackball, monitor arm, laptop stand, USB-C dock, charger, Apple accessory, high-ticket MacBook-like item, irrelevant item, risky health scenario, and missing data.

## Human labels

Use the manually triggered **Review calibration drafts** GitHub workflow with comma-separated draft IDs, a label, and optional notes. It validates IDs and commits versioned records to `data/labels/human_labels.jsonl`. The equivalent local record shape is:

```json
{
  "schema_version": 1,
  "draft_id": "drf_...",
  "label": "approve",
  "labeled_at": "2026-08-21T09:00:00+09:00",
  "notes": "specific and credible"
}
```

Allowed labels: `approve`, `reject`, `uncertain`. Never edit model scores to express a human label.

## Live calibration

Run ingestion, then planning in `calibration` mode with secrets. Groq input hashes/cache prevent paying/requesting twice for identical inputs. Inspect `reports/calibration/latest.json`, label examples, and rerun `pnpm calibration:report`.

The report exposes component/overall distributions, risks, explanations, labels, and score/label correlation. Operators should also examine approved/rejected overlap and false positive/negative examples. Only after enough representative labels should config enable an absolute or percentile threshold. No application code change is needed.

For Day-1, change `publishing.mode` to `human_approved`, label four safe drafts approved, and keep thresholds disabled.
