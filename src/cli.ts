import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { productSchema, campaignSchema, draftSchema, humanLabelSchema } from './domain/schemas.js';
import { FixtureCoupang, FixtureLlm, FixtureThreads } from './infrastructure/fixtures.js';
import { CoupangClient } from './infrastructure/coupang.js';
import { GroqClient } from './infrastructure/groq.js';
import { ThreadsClient } from './infrastructure/threads.js';
import { RepositoryStore } from './infrastructure/repository.js';
import {
  buildCalibrationReport,
  buildAnalyticsProjection,
  buildStorefront,
  collectAndAnalyze,
  applyHumanLabels,
  hydrateDraftLabels,
  ingestProducts,
  loadExperience,
  planContent,
  prepareDuePublications,
  publishDue,
  runDryRun,
} from './application/pipeline.js';
import { log } from './shared/logger.js';
import { kstDate } from './domain/scheduling.js';

const command = process.argv[2];
const config = await loadConfig();
const now = () => new Date();
const fixtureProducts = productSchema
  .array()
  .parse(JSON.parse(await readFile(resolve('tests/fixtures/products.json'), 'utf8')));
const fixtureLlm = new FixtureLlm({});

function realDependencies(
  required: { coupang?: boolean; groq?: boolean; threads?: boolean },
  store = new RepositoryStore(),
) {
  const missing = (name: string): string => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is required for this live command`);
    return value;
  };
  const reportPaths = [
    process.env.COUPANG_REPORT_CLICKS_PATH,
    process.env.COUPANG_REPORT_ORDERS_PATH,
    process.env.COUPANG_REPORT_COMMISSION_PATH,
  ];
  const reportFields = [
    process.env.COUPANG_REPORT_CAMPAIGN_FIELD,
    process.env.COUPANG_REPORT_CLICKS_FIELD,
    process.env.COUPANG_REPORT_ORDERS_FIELD,
    process.env.COUPANG_REPORT_COMMISSION_FIELD,
  ];
  const routes =
    reportPaths.every(Boolean) && reportFields.every(Boolean)
      ? {
          search: '/v2/providers/affiliate_open_api/apis/openapi/products/search',
          deeplink: '/v2/providers/affiliate_open_api/apis/openapi/v1/deeplink',
          clicks: reportPaths[0] as string,
          orders: reportPaths[1] as string,
          commission: reportPaths[2] as string,
        }
      : undefined;
  const reportContract = routes
    ? {
        campaignField: reportFields[0] as string,
        clicksField: reportFields[1] as string,
        ordersField: reportFields[2] as string,
        commissionField: reportFields[3] as string,
        ...(process.env.COUPANG_REPORT_PERIOD_FIELD
          ? { periodField: process.env.COUPANG_REPORT_PERIOD_FIELD }
          : {}),
      }
    : undefined;
  const coupang = required.coupang
    ? new CoupangClient({
        accessKey: missing('COUPANG_ACCESS_KEY'),
        secretKey: missing('COUPANG_SECRET_KEY'),
        baseUrl: config.external.coupang.base_url,
        timeoutMs: config.external.request_timeout_ms,
        attempts: config.external.max_attempts,
        attributionEnabled: config.external.coupang.subid_enabled,
        ...(routes ? { routes } : {}),
        ...(reportContract ? { reportContract } : {}),
      })
    : new FixtureCoupang([]);
  const llm = required.groq
    ? new GroqClient({
        apiKey: missing('GROQ_API_KEY'),
        timeoutMs: config.llm.timeout_ms,
        attempts: config.llm.max_attempts,
      })
    : fixtureLlm;
  const threads = required.threads
    ? new ThreadsClient({
        accessToken: missing('THREADS_ACCESS_TOKEN'),
        baseUrl: config.external.threads.base_url,
        timeoutMs: config.external.request_timeout_ms,
        attempts: config.external.max_attempts,
        publishEnabled: process.env.PUBLISH_ENABLED === 'true',
        keywordSearchEnabled: config.features.threads_keyword_search,
      })
    : new FixtureThreads();
  return { coupang, llm, threads, store, config, now };
}

async function execute(): Promise<void> {
  if (command === 'pipeline:dry-run' || command === 'calibration:run') {
    const root =
      command === 'pipeline:dry-run'
        ? resolve('.artifacts/dry-run')
        : resolve('.artifacts/calibration');
    const store = new RepositoryStore(root);
    const deps = {
      coupang: new FixtureCoupang(fixtureProducts),
      llm: fixtureLlm,
      threads: new FixtureThreads(() => new Date('2026-08-23T14:00:00.000Z')),
      store,
      config,
      now: () => new Date('2026-08-23T14:00:00.000Z'),
    };
    await runDryRun(deps, fixtureProducts, { schema_version: 1, experiences: [] });
    return;
  }
  if (command === 'products:ingest') {
    await ingestProducts(realDependencies({ coupang: true }));
    return;
  }
  if (command === 'content:plan') {
    const deps = realDependencies({ coupang: true, groq: true });
    const products = await deps.store.readJsonl('data/catalog/products.jsonl', productSchema);
    await planContent(products, deps, await loadExperience());
    return;
  }
  if (command === 'warmup:prepare' || command === 'warmup:publish') {
    const warmupId = z.string().min(1).parse(process.env.WARMUP_ID);
    const text = z.string().min(1).max(500).parse(process.env.WARMUP_TEXT);
    const deps = realDependencies({ threads: true });
    const receiptPath = `data/state/warmup-publications/${warmupId}.json`;
    const receiptSchema = z.object({
      schema_version: z.literal(1),
      warmup_id: z.string(),
      text: z.string(),
      container_id: z.string(),
      status: z.enum(['container_created', 'published']),
      post_id: z.string().nullable(),
      permalink: z.string().url().nullable(),
      updated_at: z.string().datetime(),
    });
    const existing = await deps.store.readJson(receiptPath, receiptSchema).catch(() => null);
    if (command === 'warmup:prepare') {
      if (existing) return;
      const containerId = await deps.threads.createTextContainer(text);
      await deps.store.writeJson(receiptPath, {
        schema_version: 1,
        warmup_id: warmupId,
        text,
        container_id: containerId,
        status: 'container_created',
        post_id: null,
        permalink: null,
        updated_at: now().toISOString(),
      });
      return;
    }
    if (!existing) throw new Error(`Warmup publication ${warmupId} is not prepared`);
    if (existing.status === 'published') return;
    const result = await deps.threads.publishContainer(existing.container_id);
    await deps.store.writeJson(receiptPath, {
      ...existing,
      status: 'published',
      post_id: result.postId,
      permalink: result.permalink,
      updated_at: now().toISOString(),
    });
    return;
  }
  if (command === 'publish:due') {
    const deps = realDependencies({ threads: true });
    const campaigns = await deps.store.readJsonl('data/runtime/campaigns.jsonl', campaignSchema);
    const drafts = await hydrateDraftLabels(
      await deps.store.readJsonl('data/runtime/drafts.jsonl', draftSchema),
      deps.store,
    );
    await publishDue(campaigns, drafts, deps);
    return;
  }
  if (command === 'publish:prepare') {
    const deps = realDependencies({ threads: true });
    const campaigns = await deps.store.readJsonl('data/runtime/campaigns.jsonl', campaignSchema);
    const drafts = await hydrateDraftLabels(
      await deps.store.readJsonl('data/runtime/drafts.jsonl', draftSchema),
      deps.store,
    );
    await prepareDuePublications(campaigns, drafts, deps);
    return;
  }
  if (command === 'metrics:threads' || command === 'metrics:coupang') {
    const deps = realDependencies({
      threads: command === 'metrics:threads',
      coupang: command === 'metrics:coupang',
    });
    const campaigns = await deps.store.readJsonl('data/runtime/campaigns.jsonl', campaignSchema);
    await collectAndAnalyze(campaigns, deps, {
      threads: command === 'metrics:threads',
      coupang: command === 'metrics:coupang',
    });
    if (command === 'metrics:threads') {
      const warmupReceipts = await deps.store.readJsonTree(
        'data/state/warmup-publications',
        z.object({
          warmup_id: z.string(),
          status: z.enum(['container_created', 'published']),
          post_id: z.string().nullable(),
        }),
      );
      const date = kstDate(now());
      for (const receipt of warmupReceipts) {
        if (receipt.status !== 'published' || receipt.post_id === null) continue;
        const event = await deps.threads.getInsights(
          receipt.post_id,
          `warmup:${receipt.warmup_id}`,
        );
        await deps.store.appendJsonl(
          `data/events/threads/${date.slice(0, 4)}/${date.slice(5, 7)}/${date}.jsonl`,
          event,
        );
      }
      await buildAnalyticsProjection(campaigns, deps.store, now);
    }
    return;
  }
  if (command === 'calibration:report') {
    const store = new RepositoryStore();
    await buildCalibrationReport(
      await hydrateDraftLabels(
        await store.readJsonl('data/runtime/drafts.jsonl', draftSchema),
        store,
      ),
      await store.readJsonl('data/catalog/products.jsonl', productSchema),
      store,
      now,
    );
    return;
  }
  if (command === 'labels:apply') {
    const store = new RepositoryStore();
    const draftIds = (process.env.DRAFT_IDS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const label = z.enum(['approve', 'reject', 'uncertain']).parse(process.env.HUMAN_LABEL);
    const known = new Set(
      (await store.readJsonl('data/runtime/drafts.jsonl', draftSchema)).map(
        (draft) => draft.draft_id,
      ),
    );
    if (draftIds.length === 0 || draftIds.some((draftId) => !known.has(draftId)))
      throw new Error('Every DRAFT_IDS entry must reference an existing runtime draft');
    for (const draftId of draftIds)
      await store.appendJsonl(
        'data/labels/human_labels.jsonl',
        humanLabelSchema.parse({
          schema_version: 1,
          draft_id: draftId,
          label,
          labeled_at: now().toISOString(),
          notes: process.env.LABEL_NOTES || null,
        }),
      );
    const deps = realDependencies({});
    const projected = await applyHumanLabels(
      await deps.store.readJsonl('data/runtime/drafts.jsonl', draftSchema),
      await deps.store.readJsonl('data/runtime/campaigns.jsonl', campaignSchema),
      deps,
    );
    const products = await deps.store.readJsonl('data/catalog/products.jsonl', productSchema);
    await buildStorefront(products, projected.campaigns, deps.store, now, config.disclosure.text);
    await buildCalibrationReport(projected.drafts, products, deps.store, now);
    log('info', 'labels.applied', { count: draftIds.length, label });
    return;
  }
  if (command === 'storefront:data') {
    const store = new RepositoryStore();
    const products = await store.readJsonl('data/catalog/products.jsonl', productSchema);
    const campaigns = await store.readJsonl('data/runtime/campaigns.jsonl', campaignSchema);
    if (campaigns.length)
      await buildStorefront(products, campaigns, store, now, config.disclosure.text);
    return;
  }
  if (command === 'analytics:build') {
    const store = new RepositoryStore();
    const campaigns = await store.readJsonl('data/runtime/campaigns.jsonl', campaignSchema);
    await buildAnalyticsProjection(campaigns, store, now);
    log('info', 'analytics.rebuilt', { campaigns: campaigns.length });
    return;
  }
  if (command === 'optimize') {
    const store = new RepositoryStore();
    const analytics = await store.readJson(
      'data/analytics/latest.json',
      z
        .object({
          campaigns: z.number().int().nonnegative(),
          segments: z.array(
            z.object({ angle: z.string(), rpmv: z.number().nullable() }).passthrough(),
          ),
        })
        .passthrough(),
    );
    const measured = analytics.segments.filter((segment) => segment.rpmv !== null);
    const byAngle = new Map<string, typeof measured>();
    for (const segment of measured)
      byAngle.set(segment.angle, [...(byAngle.get(segment.angle) ?? []), segment]);
    const recommendations =
      analytics.campaigns < 20
        ? [
            {
              action: 'collect_more_data',
              reason: 'At least 20 campaigns are required before strategy recommendations.',
            },
          ]
        : [...byAngle.entries()].map(([angle, rows]) => ({
            action: 'review_angle',
            angle,
            samples: rows.length,
            average_rpmv: rows.length
              ? rows.reduce((sum, row) => sum + (row.rpmv ?? 0), 0) / rows.length
              : null,
          }));
    await store.writeJson('reports/analytics/recommendations.json', {
      schema_version: 1,
      generated_at: now().toISOString(),
      auto_applied: false,
      auto_optimization_enabled: config.features.auto_optimization,
      recommendations,
    });
    log('info', 'optimize.recommendations_built', { recommendations: recommendations.length });
    return;
  }
  if (command === 'connections:check') {
    const statuses: Record<string, unknown> = {};
    for (const [name, variables] of Object.entries({
      coupang: ['COUPANG_ACCESS_KEY', 'COUPANG_SECRET_KEY'],
      groq: ['GROQ_API_KEY', 'GROQ_MODEL', 'GROQ_JUDGE_MODEL'],
      threads: ['THREADS_ACCESS_TOKEN'],
    }))
      statuses[name] = {
        configured: variables.every((key) => Boolean(process.env[key])),
        required: variables,
      };
    log('info', 'connections.configuration', statuses);
    if (process.env.RUN_LIVE_CONTRACTS === 'true') {
      const deps = realDependencies({ coupang: true, groq: true, threads: true });
      statuses.live = {
        coupang: await deps.coupang.checkConnectivity(),
        groq: await deps.llm.checkConnectivity(),
        threads: await deps.threads.checkConnectivity(),
      };
      log('info', 'connections.live', statuses.live as Record<string, unknown>);
    }
    return;
  }
  throw new Error(`Unknown command: ${command ?? '(missing)'}`);
}

await execute().catch((error: unknown) => {
  log('error', 'command.failed', {
    command,
    message: error instanceof Error ? error.message : 'unknown',
  });
  process.exitCode = 1;
});
