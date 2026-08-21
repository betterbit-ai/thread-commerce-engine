import { z } from 'zod';
import type { PublishResult, ThreadsPort } from '../application/ports.js';
import type { ThreadsEvent } from '../domain/schemas.js';
import { createEntityId } from '../domain/ids.js';
import {
  CapabilityUnavailableError,
  ConfigurationError,
  PublishSafetyError,
} from '../shared/errors.js';
import { requestJson } from './http.js';

const idSchema = z.object({ id: z.union([z.string(), z.number()]) }).passthrough();
const postSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    permalink: z.string().url().nullable().optional(),
  })
  .passthrough();
const insightsSchema = z
  .object({
    data: z.array(
      z
        .object({
          name: z.string(),
          values: z.array(z.object({ value: z.number() })).optional(),
          total_value: z.object({ value: z.number() }).optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export interface ThreadsOptions {
  accessToken: string;
  baseUrl: string;
  timeoutMs: number;
  attempts: number;
  publishEnabled: boolean;
  keywordSearchEnabled: boolean;
  fetchFn?: typeof fetch;
  now?: () => Date;
}
export class ThreadsClient implements ThreadsPort {
  private readonly now: () => Date;
  private readonly published = new Map<string, PublishResult>();
  constructor(private readonly options: ThreadsOptions) {
    if (!options.accessToken) throw new ConfigurationError('THREADS_ACCESS_TOKEN is required');
    this.now = options.now ?? (() => new Date());
  }
  private async call(method: string, path: string, params: URLSearchParams): Promise<unknown> {
    params.set('access_token', this.options.accessToken);
    const result = await requestJson(
      `${this.options.baseUrl}${path}?${params.toString()}`,
      { method },
      {
        timeoutMs: this.options.timeoutMs,
        attempts: method === 'GET' ? this.options.attempts : 1,
        ...(this.options.fetchFn ? { fetchFn: this.options.fetchFn } : {}),
      },
    );
    return result.data;
  }
  async checkConnectivity(): Promise<{ ok: boolean; detail: string; expiresAt: string | null }> {
    await this.call('GET', '/me', new URLSearchParams({ fields: 'id,username' }));
    return {
      ok: true,
      detail: 'Threads profile read succeeded',
      expiresAt: process.env.THREADS_TOKEN_EXPIRES_AT ?? null,
    };
  }
  async publishText(text: string, idempotencyKey: string): Promise<PublishResult> {
    if (!this.options.publishEnabled)
      throw new PublishSafetyError('Live Threads publication requires PUBLISH_ENABLED=true');
    const existing = this.published.get(idempotencyKey);
    if (existing) return existing;
    const containerId = await this.createTextContainer(text);
    const result = await this.publishContainer(containerId);
    this.published.set(idempotencyKey, result);
    return result;
  }
  async createTextContainer(text: string): Promise<string> {
    if (!this.options.publishEnabled)
      throw new PublishSafetyError('Live Threads publication requires PUBLISH_ENABLED=true');
    const container = idSchema.parse(
      await this.call('POST', '/me/threads', new URLSearchParams({ media_type: 'TEXT', text })),
    );
    return String(container.id);
  }
  async publishContainer(containerId: string): Promise<PublishResult> {
    if (!this.options.publishEnabled)
      throw new PublishSafetyError('Live Threads publication requires PUBLISH_ENABLED=true');
    const published = idSchema.parse(
      await this.call(
        'POST',
        '/me/threads_publish',
        new URLSearchParams({ creation_id: containerId }),
      ),
    );
    return this.getPost(String(published.id));
  }
  async getPost(postId: string): Promise<PublishResult> {
    const post = postSchema.parse(
      await this.call(
        'GET',
        `/${encodeURIComponent(postId)}`,
        new URLSearchParams({ fields: 'id,permalink' }),
      ),
    );
    return { postId: String(post.id), permalink: post.permalink ?? null };
  }
  async getInsights(postId: string, campaignId: string): Promise<ThreadsEvent> {
    const response = insightsSchema.parse(
      await this.call(
        'GET',
        `/${encodeURIComponent(postId)}/insights`,
        new URLSearchParams({ metric: 'views,likes,replies,reposts,quotes,shares' }),
      ),
    );
    const values = new Map(
      response.data.map((entry) => [
        entry.name,
        entry.values?.[0]?.value ?? entry.total_value?.value ?? null,
      ]),
    );
    const sampledAt = this.now().toISOString();
    return {
      schema_version: 1,
      event_id: createEntityId('the', `${campaignId}:${postId}:${sampledAt}`),
      campaign_id: campaignId,
      sampled_at: sampledAt,
      post_id: postId,
      views: values.get('views') ?? null,
      likes: values.get('likes') ?? null,
      replies: values.get('replies') ?? null,
      reposts: values.get('reposts') ?? null,
      quotes: values.get('quotes') ?? null,
      shares: values.get('shares') ?? null,
    };
  }
  async searchKeyword(
    query: string,
  ): Promise<Array<{ id: string; text: string | null; permalink: string | null }>> {
    if (!this.options.keywordSearchEnabled)
      throw new CapabilityUnavailableError('Threads keyword search feature flag');
    const result = z
      .object({
        data: z.array(
          z.object({
            id: z.union([z.string(), z.number()]),
            text: z.string().nullable().optional(),
            permalink: z.string().url().nullable().optional(),
          }),
        ),
      })
      .parse(
        await this.call(
          'GET',
          '/keyword_search',
          new URLSearchParams({
            q: query,
            search_type: 'RECENT',
            fields: 'id,text,permalink,timestamp',
          }),
        ),
      );
    return result.data.map((item) => ({
      id: String(item.id),
      text: item.text ?? null,
      permalink: item.permalink ?? null,
    }));
  }
}
