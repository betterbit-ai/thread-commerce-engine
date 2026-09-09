import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFunnelReport } from '../../src/application/funnel.js';
import { RepositoryStore } from '../../src/infrastructure/repository.js';

describe('daily funnel report', () => {
  it('measures reply-chain reach without inventing unconnected landing data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tce-funnel-'));
    const store = new RepositoryStore(root);
    for (const [campaignId, views] of [
      ['warmup:test', 100],
      ['warmup:test:reply:1', 70],
      ['warmup:test:reply:2', 50],
      ['warmup:test:reply:3', 30],
    ] as const) {
      await store.appendJsonl('data/events/threads/2026/09/2026-09-09.jsonl', {
        schema_version: 1,
        event_id: `the_${views}`,
        campaign_id: campaignId,
        sampled_at: '2026-09-09T12:00:00.000Z',
        post_id: campaignId,
        views,
        likes: 1,
        replies: 0,
        reposts: 0,
        quotes: 0,
        shares: null,
      });
    }

    const report = await buildFunnelReport(store, () => new Date('2026-09-09T14:30:00.000Z'));

    expect(report.stages).toMatchObject({
      threads_root_views: 100,
      reply_1_views: 70,
      reply_2_views: 50,
      link_reply_views: 30,
      landing_page_views: null,
      affiliate_clicks: null,
      coupang_orders: null,
    });
    expect(report.rates).toMatchObject({
      reply_1_reach: 0.7,
      solution_reach: 0.5,
      link_reach: 0.3,
      landing_from_threads: null,
    });
    expect(report.thread_performance[0]).toMatchObject({
      campaign_id: 'warmup:test',
      root_views: 100,
      organic_replies: 0,
      link_reach: 0.3,
    });
    expect(report.blockers).toContain('landing_analytics_not_connected');
  });
});
