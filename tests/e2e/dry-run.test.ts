import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { campaignSchema, draftSchema, productSchema } from '../../src/domain/schemas.js';
import { FixtureCoupang, FixtureLlm, FixtureThreads } from '../../src/infrastructure/fixtures.js';
import { RepositoryStore } from '../../src/infrastructure/repository.js';
import { publishDue, runDryRun } from '../../src/application/pipeline.js';

describe('complete offline commerce loop', () => {
  it('produces audited artifacts through mock revenue analytics and builds Astro', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tce-e2e-'));
    const products = productSchema
      .array()
      .parse(JSON.parse(await readFile(resolve('tests/fixtures/products.json'), 'utf8')));
    const config = await loadConfig();
    const time = () => new Date('2026-08-23T14:00:00.000Z');
    const deps = {
      coupang: new FixtureCoupang(products, time),
      llm: new FixtureLlm({}),
      threads: new FixtureThreads(time),
      store: new RepositoryStore(root),
      config,
      now: time,
    };
    const manifest = await runDryRun(deps, products, { schema_version: 1, experiences: [] });
    expect(manifest).toMatchObject({
      products: 14,
      campaigns: 14,
      queued: 1,
      published: 1,
      threads_events: 1,
      coupang_events: 1,
    });
    const analytics = JSON.parse(
      await readFile(join(root, 'reports/analytics/latest.json'), 'utf8'),
    );
    expect(analytics.metrics).toMatchObject({
      commerce_ctr: 0.02,
      purchase_cvr: 0.125,
      rpmv: 7000,
    });
    const report = JSON.parse(
      await readFile(join(root, 'reports/calibration/latest.json'), 'utf8'),
    );
    expect(report.drafts.length).toBeGreaterThan(5);
    expect(report.threshold_status).toBe('disabled_initially');
    const storefront = JSON.parse(
      await readFile(join(root, 'data/storefront/offers.json'), 'utf8'),
    );
    expect(storefront.offers).toHaveLength(1);
    const persistedCampaigns = await deps.store.readJsonl(
      'data/runtime/campaigns.jsonl',
      campaignSchema,
    );
    const persistedDrafts = await deps.store.readJsonl('data/runtime/drafts.jsonl', draftSchema);
    expect(persistedCampaigns.filter((campaign) => campaign.status === 'published')).toHaveLength(
      1,
    );
    await expect(publishDue(persistedCampaigns, persistedDrafts, deps)).resolves.toEqual([]);
    if (Number(process.versions.node.split('.')[0]) >= 24) {
      execFileSync(resolve('node_modules/.bin/astro'), ['build'], {
        cwd: resolve('.'),
        env: {
          ...process.env,
          SITE_BASE: '/thread-commerce-engine',
          ASTRO_TELEMETRY_DISABLED: '1',
          STOREFRONT_DATA_PATH: join(root, 'data/storefront/offers.json'),
        },
        stdio: 'pipe',
      });
      expect(await readFile(resolve('dist/offer/100/index.html'), 'utf8')).toContain(
        '쿠팡에서 현재 정보 보기',
      );
    } else {
      expect(process.version).toMatch(/^v20\./u);
    }
  });
});
