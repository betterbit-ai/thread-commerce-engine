import { describe, expect, it } from 'vitest';
import { CoupangClient } from '../../src/infrastructure/coupang.js';
import { GroqClient } from '../../src/infrastructure/groq.js';
import { ThreadsClient } from '../../src/infrastructure/threads.js';

const live = process.env.RUN_LIVE_CONTRACTS === 'true';
describe.skipIf(!live)('secret-backed read-only contracts', () => {
  it('authenticates and searches Coupang without publishing', async () => {
    const client = new CoupangClient({
      accessKey: process.env.COUPANG_ACCESS_KEY!,
      secretKey: process.env.COUPANG_SECRET_KEY!,
      baseUrl: process.env.COUPANG_BASE_URL ?? 'https://api-gateway.coupang.com',
      timeoutMs: 15000,
      attempts: 2,
      attributionEnabled: process.env.COUPANG_SUBID_ENABLED === 'true',
    });
    const products = await client.searchProducts('버티컬 마우스', { limit: 1 });
    expect(products.length).toBeGreaterThan(0);
    if (process.env.COUPANG_SUBID_ENABLED === 'true' && products[0]?.product_url)
      await expect(
        client.createAffiliateLink(products[0].product_url, 'contract_campaign'),
      ).resolves.toMatch(/^https:\/\//u);
  });
  it('executes one Groq structured request using configured current model', async () => {
    const client = new GroqClient({
      apiKey: process.env.GROQ_API_KEY!,
      timeoutMs: 30000,
      attempts: 2,
      cacheDir: '/tmp/tce-live-groq',
    });
    const result = await client.generateStructured({
      task: 'live-contract',
      prompt: 'Return JSON with ok true.',
      input: { ping: true },
      schemaName: 'connectivity',
      jsonSchema: {
        type: 'object',
        properties: { ok: { type: 'boolean' } },
        required: ['ok'],
        additionalProperties: false,
      },
      parse: (value) => value as { ok: boolean },
      model: process.env.GROQ_MODEL!,
      temperature: 0,
      maxTokens: 32,
    });
    expect(result.ok).toBe(true);
  });
  it('reads Threads identity without publishing', async () => {
    const client = new ThreadsClient({
      accessToken: process.env.THREADS_ACCESS_TOKEN!,
      baseUrl: 'https://graph.threads.net',
      timeoutMs: 15000,
      attempts: 2,
      publishEnabled: false,
      keywordSearchEnabled: false,
    });
    expect((await client.checkConnectivity()).ok).toBe(true);
  });
});
