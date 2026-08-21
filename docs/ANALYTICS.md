# Analytics

## Commerce outcomes

- `commerce_ctr = coupang_clicks / threads_views`
- `purchase_cvr = orders / coupang_clicks`
- `rpmv = commission_krw / threads_views * 1000`

Zero denominators return `null`, never an invented 0% conversion. Coupang metrics are used only if the current reporting contract supplies them and campaign attribution is mapped.

## Segments

Projections retain vertical, family/category/product, price band (when known), angle, hook, CTA, slot, founder-experience support, Apple/core, and evergreen/opportunity engine. Likes/views are diagnostic; business optimization prioritizes CTR, purchase CVR, and RPMV where available.

## Calibration over time

Compare judge score with Threads views, commerce CTR, purchase CVR, and RPMV. Small samples generate recommendations only. `features.auto_optimization` defaults false; enabling it still requires minimum-sample policy and review before strategy changes.

Attribution is observational: Git-backed campaign/subId linkage reduces ambiguity but cross-device, reporting delays, cancellations, and the official Partners attribution window may affect results. Do not claim causality beyond the data.
