import { describe, expect, it } from 'vitest';
import { CoupangClient } from '../../src/infrastructure/coupang.js';
import { GroqClient } from '../../src/infrastructure/groq.js';
import { ThreadsClient } from '../../src/infrastructure/threads.js';
import { PublishSafetyError } from '../../src/shared/errors.js';

function response(value: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(value), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

describe('HTTP adapters with fixtures', () => {
  it('normalizes Coupang product search and signs without leaking keys', async () => {
    let auth = '';
    const fetchFn: typeof fetch = (input, init) => {
      auth = new Headers(init?.headers).get('Authorization') ?? '';
      expect(String(input)).toContain('keyword=%EB%B2%84%ED%8B%B0%EC%BB%AC');
      return response({
        rCode: '0',
        data: {
          productData: [
            {
              productId: 42,
              productName: '버티컬 마우스',
              productPrice: 55000,
              productUrl: 'https://www.coupang.com/vp/products/42',
              productImage: 'https://img.test/42.jpg',
              isRocket: true,
            },
          ],
        },
      });
    };
    const client = new CoupangClient({
      accessKey: 'access',
      secretKey: 'secret',
      baseUrl: 'https://api.test',
      timeoutMs: 100,
      attempts: 1,
      fetchFn,
      now: () => new Date('2026-08-21T00:00:00Z'),
    });
    const products = await client.searchProducts('버티컬', { limit: 1 });
    expect(products[0]).toMatchObject({ product_key: 'coupang:42', price_krw: 55000 });
    expect(auth).toContain('signature=');
    expect(auth).not.toContain('secret');
  });
  it('parses and runtime-validates Groq structured output', async () => {
    const fetchFn: typeof fetch = (_input, init) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer key');
      return response({ choices: [{ message: { content: '{"answer":42}' } }] });
    };
    const client = new GroqClient({
      apiKey: 'key',
      timeoutMs: 100,
      attempts: 1,
      cacheDir: '/tmp/thread-commerce-groq-test',
      fetchFn,
    });
    const result = await client.generateStructured({
      task: 'integration-unique',
      prompt: 'return json',
      input: { x: 1 },
      schemaName: 'answer',
      jsonSchema: { type: 'object' },
      parse: (value) => value as { answer: number },
      model: 'configured-model',
      temperature: 0,
      maxTokens: 10,
    });
    expect(result.answer).toBe(42);
  });
  it('retries a Groq response that is not valid structured JSON', async () => {
    let calls = 0;
    const fetchFn: typeof fetch = () => {
      calls += 1;
      return response({
        choices: [{ message: { content: calls === 1 ? 'not-json' : '{"ok":true}' } }],
      });
    };
    const client = new GroqClient({
      apiKey: 'key',
      timeoutMs: 100,
      attempts: 2,
      cacheDir: `/tmp/thread-commerce-groq-retry-${Date.now()}`,
      fetchFn,
    });
    const result = await client.generateStructured({
      task: 'retry-invalid-json',
      prompt: 'json',
      input: {},
      schemaName: 'ok',
      jsonSchema: { type: 'object' },
      parse: (value) => value as { ok: boolean },
      model: 'configured-model',
      temperature: 0,
      maxTokens: 10,
    });
    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
  });
  it('normalizes Threads publication and insights, and blocks disabled publishing', async () => {
    const disabled = new ThreadsClient({
      accessToken: 'token',
      baseUrl: 'https://graph.test',
      timeoutMs: 100,
      attempts: 1,
      publishEnabled: false,
      keywordSearchEnabled: false,
      fetchFn: () => response({}),
    });
    await expect(disabled.publishText('x', 'key')).rejects.toBeInstanceOf(PublishSafetyError);
    let call = 0;
    const fetchFn: typeof fetch = (input) => {
      call += 1;
      const url = String(input);
      if (url.includes('/me/threads?')) return response({ id: 'container' });
      if (url.includes('/me/threads_publish?')) return response({ id: 'post' });
      if (url.includes('/post/insights?'))
        return response({
          data: [
            { name: 'views', values: [{ value: 99 }] },
            { name: 'likes', values: [{ value: 5 }] },
          ],
        });
      return response({ id: 'post', permalink: 'https://www.threads.net/@x/post/abc' });
    };
    const client = new ThreadsClient({
      accessToken: 'token',
      baseUrl: 'https://graph.test',
      timeoutMs: 100,
      attempts: 1,
      publishEnabled: true,
      keywordSearchEnabled: false,
      fetchFn,
      now: () => new Date('2026-08-21T00:00:00Z'),
    });
    const published = await client.publishText('hello', 'cmp');
    expect(published.postId).toBe('post');
    const insight = await client.getInsights('post', 'cmp');
    expect(insight).toMatchObject({ views: 99, likes: 5, replies: null });
    expect(call).toBeGreaterThanOrEqual(4);
  });
});
