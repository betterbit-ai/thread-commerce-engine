import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { ConfigurationError } from './shared/errors.js';

const nullableThreshold = z.object({
  enabled: z.boolean(),
  value: z.number().min(0).max(100).nullable(),
});
const configSchema = z
  .object({
    schema_version: z.literal(1),
    timezone: z.string(),
    ingest: z.object({
      products_per_query: z.number().int().positive(),
      live_sample_size: z.number().int().positive(),
      queries: z.array(z.string()),
    }),
    content: z.object({
      posts_per_day: z.number().int().positive(),
      candidate_products: z.number().int().positive(),
      generation_count: z.number().int().positive(),
      angles_per_product: z.number().int().positive(),
      duplicate_threshold: z.number().min(0).max(1),
      exploration_ratio: z.number().min(0).max(1),
      category_mix: z.record(z.string(), z.number().nonnegative()),
    }),
    publishing: z.object({
      mode: z.enum(['calibration', 'human_approved', 'auto']),
      require_storefront_deployment_receipt: z.boolean(),
      slots_kst: z.array(z.string().regex(/^\d{2}:\d{2}$/)),
      absolute_threshold: nullableThreshold,
      percentile_threshold: nullableThreshold,
      judge_weights: z.record(z.string(), z.number().nonnegative()),
    }),
    llm: z.object({
      primary_model: z.string(),
      judge_model: z.string(),
      max_output_tokens: z.number().int().positive(),
      timeout_ms: z.number().positive(),
      max_attempts: z.number().int().positive(),
      generation_temperature: z.number(),
      judge_temperature: z.number(),
    }),
    external: z.object({
      request_timeout_ms: z.number().positive(),
      max_attempts: z.number().int().positive(),
      coupang: z.object({
        base_url: z.string().url(),
        subid_enabled: z.boolean(),
        search_hourly_budget: z.number(),
        report_hourly_budget: z.number(),
        other_hourly_budget: z.number(),
      }),
      threads: z.object({ base_url: z.string().url(), token_warning_days: z.number() }),
    }),
    metrics: z.object({
      threads_windows_hours: z.array(z.number().positive()),
      coupang_collection_hour_kst: z.number().int().min(0).max(23),
    }),
    disclosure: z.object({ text: z.string().min(10) }),
    features: z.object({
      threads_keyword_search: z.boolean(),
      apple_event_engine: z.boolean(),
      auto_optimization: z.boolean(),
    }),
  })
  .superRefine((value, ctx) => {
    const sum = Object.values(value.content.category_mix).reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1) > 0.001)
      ctx.addIssue({ code: 'custom', message: 'content.category_mix must sum to 1' });
    for (const threshold of [
      value.publishing.absolute_threshold,
      value.publishing.percentile_threshold,
    ]) {
      if (threshold.enabled && threshold.value === null)
        ctx.addIssue({ code: 'custom', message: 'enabled threshold requires value' });
    }
  });
export type AppConfig = z.infer<typeof configSchema>;

function interpolate(input: string, env: NodeJS.ProcessEnv): string {
  return input.replace(
    /\$\{([A-Z0-9_]+)(:-([^}]*))?\}/g,
    (_all, key: string, _fallback, fallback: string | undefined) =>
      env[key] ?? fallback ?? `UNSET_${key}`,
  );
}
export async function loadConfig(
  path = resolve('config/default.yml'),
  env = process.env,
): Promise<AppConfig> {
  const parsed = configSchema.safeParse(parse(interpolate(await readFile(path, 'utf8'), env)));
  if (!parsed.success)
    throw new ConfigurationError('Invalid configuration', { issues: parsed.error.issues });
  return parsed.data;
}
