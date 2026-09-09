import { z } from 'zod';
import { coupangEventSchema, threadsEventSchema } from '../domain/schemas.js';
import type { RepositoryStore } from '../infrastructure/repository.js';

const storefrontSnapshotSchema = z.object({
  schema_version: z.literal(1),
  sampled_at: z.string().datetime(),
  page_views: z.number().nonnegative(),
  affiliate_clicks: z.number().nonnegative(),
});
const warmupReceiptSchema = z.object({
  warmup_id: z.string(),
  text: z.string(),
  permalink: z.string().url().nullable(),
});

function ratio(numerator: number | null, denominator: number): number | null {
  return numerator === null || denominator === 0 ? null : numerator / denominator;
}

export async function buildFunnelReport(store: RepositoryStore, now: () => Date) {
  const threadEvents = await store.readJsonlTree('data/events/threads', threadsEventSchema);
  const latestThreads = new Map<string, (typeof threadEvents)[number]>();
  for (const event of threadEvents) {
    const prior = latestThreads.get(event.campaign_id);
    if (!prior || prior.sampled_at < event.sampled_at) latestThreads.set(event.campaign_id, event);
  }
  const warmupEvents = [...latestThreads.values()].filter((event) =>
    event.campaign_id.startsWith('warmup:'),
  );
  const chainIds = new Set(
    warmupEvents
      .filter((event) => /:reply:1$/u.test(event.campaign_id))
      .map((event) => event.campaign_id.replace(/:reply:1$/u, '')),
  );
  const chainEvents = warmupEvents.filter((event) => {
    const baseId = event.campaign_id.replace(/:reply:[123]$/u, '');
    return chainIds.has(baseId);
  });
  const stageViews = (suffix: string | null): number =>
    chainEvents
      .filter((event) =>
        suffix === null
          ? !/:reply:[123]$/u.test(event.campaign_id)
          : event.campaign_id.endsWith(suffix),
      )
      .reduce((sum, event) => sum + (event.views ?? 0), 0);
  const roots = chainEvents.filter((event) => !/:reply:[123]$/u.test(event.campaign_id));
  const rootViews = stageViews(null);
  const reply1Views = stageViews(':reply:1');
  const reply2Views = stageViews(':reply:2');
  const reply3Views = stageViews(':reply:3');
  const storefront = await store
    .readJson('data/analytics/storefront/latest.json', storefrontSnapshotSchema)
    .catch(() => null);
  const coupangEvents = await store.readJsonlTree('data/events/coupang', coupangEventSchema);
  const latestCoupang = new Map<string, (typeof coupangEvents)[number]>();
  for (const event of coupangEvents) {
    const key = `${event.campaign_id}:${event.source_period}`;
    const prior = latestCoupang.get(key);
    if (!prior || prior.sampled_at < event.sampled_at) latestCoupang.set(key, event);
  }
  const commerce = [...latestCoupang.values()];
  const coupangClicks = commerce.length
    ? commerce.reduce((sum, event) => sum + (event.clicks ?? 0), 0)
    : null;
  const coupangOrders = commerce.length
    ? commerce.reduce((sum, event) => sum + (event.orders ?? 0), 0)
    : null;
  const commission = commerce.length
    ? commerce.reduce((sum, event) => sum + (event.commission_krw ?? 0), 0)
    : null;
  const blockers = [
    ...(storefront ? [] : ['landing_analytics_not_connected']),
    ...(commerce.length ? [] : ['coupang_reporting_not_connected']),
  ];
  const receipts = await store
    .readJsonTree('data/state/warmup-publications', warmupReceiptSchema)
    .catch(() => []);
  const receiptByCampaign = new Map(
    receipts.map((receipt) => [`warmup:${receipt.warmup_id}`, receipt]),
  );
  const threadPerformance = roots
    .map((root) => {
      const reply = (index: number) => latestThreads.get(`${root.campaign_id}:reply:${index}`);
      const organicReplies = Math.max((root.replies ?? 0) - 3, 0);
      return {
        campaign_id: root.campaign_id,
        hook: receiptByCampaign.get(root.campaign_id)?.text ?? null,
        permalink: receiptByCampaign.get(root.campaign_id)?.permalink ?? null,
        root_views: root.views ?? 0,
        likes: root.likes ?? 0,
        organic_replies: organicReplies,
        reply_1_views: reply(1)?.views ?? null,
        reply_2_views: reply(2)?.views ?? null,
        link_reply_views: reply(3)?.views ?? null,
        link_reach: ratio(reply(3)?.views ?? null, root.views ?? 0),
      };
    })
    .sort((left, right) => right.root_views - left.root_views);
  const report = {
    schema_version: 1,
    kind: 'daily_funnel',
    generated_at: now().toISOString(),
    published_threads_measured: roots.length,
    stages: {
      threads_root_views: rootViews,
      reply_1_views: reply1Views,
      reply_2_views: reply2Views,
      link_reply_views: reply3Views,
      landing_page_views: storefront?.page_views ?? null,
      affiliate_clicks: storefront?.affiliate_clicks ?? null,
      coupang_clicks: coupangClicks,
      coupang_orders: coupangOrders,
      commission_krw: commission,
    },
    rates: {
      reply_1_reach: ratio(reply1Views, rootViews),
      solution_reach: ratio(reply2Views, rootViews),
      link_reach: ratio(reply3Views, rootViews),
      landing_from_threads: ratio(storefront?.page_views ?? null, rootViews),
      affiliate_click_rate: ratio(
        storefront?.affiliate_clicks ?? null,
        storefront?.page_views ?? 0,
      ),
      purchase_rate: ratio(coupangOrders, coupangClicks ?? 0),
    },
    thread_performance: threadPerformance,
    blockers,
  };
  await store.writeJson('reports/funnel/latest.json', report);
  return report;
}
