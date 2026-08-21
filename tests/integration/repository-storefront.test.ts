import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RepositoryStore } from '../../src/infrastructure/repository.js';
import { campaignSchema, productSchema } from '../../src/domain/schemas.js';
import { buildAnalyticsProjection, buildStorefront } from '../../src/application/pipeline.js';

describe('Git repository datastore', () => {
  it('atomically writes JSON and appends validated JSONL', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tce-store-'));
    const store = new RepositoryStore(root);
    const product = productSchema.parse({
      schema_version: 1,
      product_key: 'p',
      source: 'fixture',
      source_product_id: null,
      name: '마우스',
      category: 'mouse',
      product_url: null,
      affiliate_url: null,
      image_url: null,
      price_krw: null,
      captured_at: '2026-08-21T00:00:00.000Z',
      is_rocket: null,
      is_free_shipping: null,
      review_count: null,
      rating: null,
      evidence: [],
    });
    await store.appendJsonl('data/products.jsonl', product);
    await store.appendJsonl('data/products.jsonl', product);
    expect(await store.readJsonl('data/products.jsonl', productSchema)).toHaveLength(2);
  });
  it('generates safe storefront projection without invented fields', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tce-front-'));
    const store = new RepositoryStore(root);
    const product = productSchema.parse({
      schema_version: 1,
      product_key: 'p',
      source: 'fixture',
      source_product_id: '1',
      name: '버티컬 마우스',
      category: 'mouse',
      product_url: 'https://c.test/p',
      affiliate_url: 'https://link.coupang.com/a/x',
      image_url: null,
      price_krw: 50000,
      captured_at: '2026-08-21T00:00:00.000Z',
      is_rocket: null,
      is_free_shipping: null,
      review_count: null,
      rating: null,
      evidence: [],
    });
    const campaign = {
      schema_version: 1 as const,
      campaign_id: 'cmp',
      offer_code: 142,
      product_key: 'p',
      affiliate_url: 'https://link.coupang.com/a/x',
      attribution_key: 'cmp',
      draft_id: 'drf',
      engine: 'evergreen' as const,
      category: 'mouse' as const,
      angle: 'pain_solution' as const,
      hook_style: 'problem',
      cta_variant: 'profile',
      scheduled_at: '2026-08-21T00:00:00.000Z',
      prompt_version: 'v1',
      groq_model: 'fixture',
      judge_overall: 70,
      founder_experience_supported: false,
      status: 'published' as const,
      threads_post_id: 't',
      permalink: null,
      published_at: '2026-08-21T00:00:00.000Z',
    };
    await buildStorefront(
      [product],
      [campaign],
      store,
      () => new Date('2026-08-21T00:00:00Z'),
      '이 게시물은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.',
    );
    const generated = JSON.parse(await readFile(join(root, 'data/storefront/offers.json'), 'utf8'));
    expect(generated.offers[0]).toMatchObject({ offer_code: 142, price_krw: 50000 });
    expect(generated.offers[0]).not.toHaveProperty('rating');
  });
  it('projects cross-day campaign revenue without summing cumulative social samples', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tce-analytics-'));
    const store = new RepositoryStore(root);
    const campaign = campaignSchema.parse({
      schema_version: 1,
      campaign_id: 'cmp',
      offer_code: 142,
      product_key: 'p',
      affiliate_url: 'https://link.coupang.com/a/x',
      attribution_key: 'cmp',
      draft_id: 'drf',
      engine: 'evergreen',
      category: 'mouse',
      angle: 'pain_solution',
      hook_style: 'problem',
      cta_variant: 'profile',
      scheduled_at: '2026-08-20T00:00:00.000Z',
      prompt_version: 'v1',
      groq_model: 'fixture',
      judge_overall: 80,
      founder_experience_supported: false,
      status: 'published',
      threads_post_id: 'thread',
      permalink: null,
      published_at: '2026-08-20T00:00:00.000Z',
    });
    for (const [date, views] of [
      ['2026-08-20', 1000],
      ['2026-08-21', 2000],
    ] as const)
      await store.appendJsonl(`data/events/threads/2026/08/${date}.jsonl`, {
        schema_version: 1,
        event_id: `t-${date}`,
        campaign_id: 'cmp',
        sampled_at: `${date}T12:00:00.000Z`,
        post_id: 'thread',
        views,
        likes: null,
        replies: null,
        reposts: null,
        quotes: null,
        shares: null,
      });
    for (const [date, clicks, orders, commission] of [
      ['2026-08-20', 10, 1, 1000],
      ['2026-08-21', 20, 2, 2000],
    ] as const)
      await store.appendJsonl(`data/events/coupang/2026/08/${date}.jsonl`, {
        schema_version: 1,
        event_id: `c-${date}`,
        campaign_id: 'cmp',
        sampled_at: `${date}T16:00:00.000Z`,
        clicks,
        orders,
        commission_krw: commission,
        source_period: date,
      });
    const analytics = (await buildAnalyticsProjection(
      [campaign],
      store,
      () => new Date('2026-08-22T00:00:00Z'),
    )) as { totals: Record<string, number>; segments: Array<Record<string, unknown>> };
    expect(analytics.totals).toMatchObject({
      threads_views: 2000,
      coupang_clicks: 30,
      orders: 3,
      commission_krw: 3000,
    });
    expect(analytics.segments[0]).toMatchObject({
      commerce_ctr: 0.015,
      purchase_cvr: 0.1,
      rpmv: 1500,
    });
  });
});
