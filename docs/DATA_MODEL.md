# Data Model

All records have `schema_version: 1` and are runtime-validated. ISO timestamps include offsets/UTC; business date partitioning uses Asia/Seoul.

| Record        | Purpose                                | Canonical identity                               |
| ------------- | -------------------------------------- | ------------------------------------------------ |
| Product       | Normalized evidence snapshot           | `product_key`                                    |
| Analysis      | Evidence-preserving product evaluation | `product_key` + prompt/input hash in draft chain |
| Angle         | Taxonomy/premise/evidence references   | `angle_id`                                       |
| Draft         | Korean content, judge, policy, label   | `draft_id`                                       |
| Campaign      | Cross-channel experiment               | `campaign_id`                                    |
| Offer         | Human storefront lookup                | `offer_code` (not Coupang product ID)            |
| Queue item    | Due dispatch state                     | `campaign_id`                                    |
| Threads event | Sampled post metrics                   | `event_id`                                       |
| Coupang event | Sampled click/order/commission metric  | `event_id`                                       |
| Human label   | Approve/reject/uncertain               | append event keyed by `draft_id`                 |

Campaign records retain product, link/attribution key, the selected (possibly non-first) draft, stable offer code, engine/category/angle, CTA/hook, schedule, full prompt-chain version/model/score, experience support, and publication receipt. This is sufficient to reconstruct the experiment from Git history.

## Repository layout

Snapshots and events are date-partitioned under `data/products/snapshots`, `data/events/threads`, and `data/events/coupang`. Entity records are under `data/campaigns` and `data/drafts`; `data/runtime/*.jsonl` are executable projections. `data/storefront/offers.json` and `data/analytics/latest.json` are generated projections. Human data lives in `data/experience` and `data/labels`.

Never put raw authorization responses, access tokens, request headers, or huge unredacted payloads in data records.
