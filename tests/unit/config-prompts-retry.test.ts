import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { loadPrompt } from '../../src/application/prompts.js';
import { withRetry } from '../../src/shared/retry.js';
import { ExternalApiError } from '../../src/shared/errors.js';
import { redact } from '../../src/shared/logger.js';
import { draftSchema, productSchema } from '../../src/domain/schemas.js';
import { eligibleDrafts } from '../../src/domain/scheduling.js';
import { selectProductsByMix } from '../../src/application/product.js';

describe('configuration and prompts', () => {
  it('keeps all initial publishing thresholds disabled', async () => {
    const config = await loadConfig();
    expect(config.publishing.mode).toBe('calibration');
    expect(config.publishing.absolute_threshold).toEqual({ enabled: false, value: null });
    expect(config.publishing.percentile_threshold).toEqual({ enabled: false, value: null });
  });
  it('interpolates configured models without hard-coding', async () => {
    const config = await loadConfig(undefined, {
      GROQ_MODEL: 'current-primary',
      GROQ_JUDGE_MODEL: 'current-judge',
    });
    expect(config.llm.primary_model).toBe('current-primary');
    expect(config.llm.judge_model).toBe('current-judge');
  });
  it('loads and hashes repository prompt versions', async () => {
    const prompt = await loadPrompt('writer', 'v1');
    expect(prompt.text).toContain('Korean Threads writer');
    expect(prompt.hash).toMatch(/^[a-f0-9]{64}$/u);
  });
  it('never selects a draft while initial calibration mode is active', async () => {
    const config = await loadConfig();
    const scores = {
      hook: 100,
      persona_fit: 100,
      purchase_intent: 100,
      specificity: 100,
      authenticity: 100,
      trust: 100,
      cta_quality: 100,
      policy_safety: 100,
      redundancy: 100,
    };
    const draft = draftSchema.parse({
      schema_version: 1,
      draft_id: 'd',
      campaign_id: 'c',
      product_key: 'p',
      angle: 'pain_solution',
      text: 'safe',
      text_hash: 'a'.repeat(64),
      offer_code: 142,
      created_at: '2026-08-21T00:00:00.000Z',
      prompt_version: 'v1',
      model: 'configured',
      input_hash: 'hash',
      judge: {
        schema_version: 1,
        scores,
        reasons: {},
        detected_risks: [],
        hard_fail_suggestions: [],
        overall_score: 100,
        confidence: 1,
        improvement: 'none',
        model: 'judge',
        prompt_version: 'v1',
      },
      policy: { hard_fail: false, failures: [] },
      human_label: 'approve',
    });
    expect(eligibleDrafts([draft], config)).toEqual([]);
  });
  it('selects configurable bootstrap categories without application-code changes', async () => {
    const config = await loadConfig();
    const products = productSchema
      .array()
      .parse(JSON.parse(await readFile(resolve('tests/fixtures/products.json'), 'utf8')));
    const selected = selectProductsByMix(
      products,
      config.content.category_mix,
      config.content.candidate_products,
    );
    expect(selected).toHaveLength(10);
    expect(new Set(selected.map((product) => product.category))).toEqual(
      new Set(['mouse', 'keyboard', 'desk', 'productivity', 'apple_accessory', 'apple_device']),
    );
  });
});

describe('retry and safe logs', () => {
  it('retries only retryable typed errors with exponential waits', async () => {
    let calls = 0;
    const sleep = vi.fn(async () => undefined);
    await expect(
      withRetry(
        async () => {
          calls += 1;
          if (calls < 3) throw new ExternalApiError('temporary', 503, true);
          return 'ok';
        },
        { attempts: 3, baseDelayMs: 10, maxDelayMs: 100, sleep },
      ),
    ).resolves.toBe('ok');
    expect(sleep).toHaveBeenCalledTimes(2);
  });
  it('redacts nested credentials', () =>
    expect(
      redact({ headers: { Authorization: 'Bearer value' }, apiKey: 'secret', safe: 'ok' }),
    ).toEqual({ headers: { Authorization: '[REDACTED]' }, apiKey: '[REDACTED]', safe: 'ok' }));
});
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
