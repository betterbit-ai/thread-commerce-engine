import type {
  CoupangPort,
  LlmPort,
  ProductSearchOptions,
  StructuredRequest,
  ThreadsPort,
} from '../application/ports.js';
import type { CoupangEvent, Product, ThreadsEvent } from '../domain/schemas.js';
import { createCampaignId, createEntityId } from '../domain/ids.js';

export class FixtureCoupang implements CoupangPort {
  constructor(
    private readonly products: Product[],
    private readonly now = () => new Date('2026-08-21T00:00:00.000Z'),
  ) {}
  async checkConnectivity() {
    return { ok: true, detail: 'fixture' };
  }
  async searchProducts(query: string, options: ProductSearchOptions) {
    const tokens = query.toLowerCase().split(/\s+/u);
    return this.products
      .filter(
        (item) => tokens.some((token) => item.name.toLowerCase().includes(token)) || query === '*',
      )
      .slice(0, options.limit);
  }
  async createAffiliateLink(productUrl: string, campaignId: string) {
    return `${productUrl}${productUrl.includes('?') ? '&' : '?'}subId=${encodeURIComponent(campaignId)}`;
  }
  async collectPerformance(): Promise<CoupangEvent[]> {
    return [
      {
        schema_version: 1,
        event_id: 'cpe_fixture',
        campaign_id: createCampaignId(this.now(), this.products[0]?.product_key ?? 'fixture'),
        sampled_at: this.now().toISOString(),
        clicks: 24,
        orders: 3,
        commission_krw: 8400,
        source_period: 'fixture',
      },
    ];
  }
}

export class FixtureLlm implements LlmPort {
  constructor(private readonly handlers: Record<string, (input: unknown) => unknown>) {}
  async checkConnectivity() {
    return { ok: true, detail: 'fixture' };
  }
  async generateStructured<T>(request: StructuredRequest<T>): Promise<T> {
    const handler = this.handlers[request.task];
    if (!handler) throw new Error(`No fixture handler for ${request.task}`);
    return request.parse(handler(request.input));
  }
}

export class FixtureThreads implements ThreadsPort {
  private readonly posts = new Map<string, { postId: string; permalink: string | null }>();
  private readonly containers = new Map<string, string>();
  constructor(private readonly now = () => new Date('2026-08-21T03:00:00.000Z')) {}
  async checkConnectivity() {
    return { ok: true, detail: 'fixture', expiresAt: null };
  }
  async publishText(_text: string, key: string) {
    const existing = this.posts.get(key);
    if (existing) return existing;
    const result = {
      postId: createEntityId('thread', key),
      permalink: `https://www.threads.net/@fixture/post/${createEntityId('p', key)}`,
    };
    this.posts.set(key, result);
    return result;
  }
  async createTextContainer(text: string, options: { linkAttachment?: string } = {}) {
    const id = createEntityId('container', `${text}:${options.linkAttachment ?? ''}`);
    this.containers.set(id, text);
    return id;
  }
  async publishContainer(containerId: string) {
    const existing = this.posts.get(containerId);
    if (existing) return existing;
    if (!this.containers.has(containerId)) throw new Error('Unknown fixture container');
    const result = {
      postId: createEntityId('thread', containerId),
      permalink: `https://www.threads.net/@fixture/post/${createEntityId('p', containerId)}`,
    };
    this.posts.set(containerId, result);
    return result;
  }
  async getPost(postId: string) {
    return { postId, permalink: `https://www.threads.net/@fixture/post/${postId}` };
  }
  async getInsights(postId: string, campaignId: string): Promise<ThreadsEvent> {
    const sampledAt = this.now().toISOString();
    return {
      schema_version: 1,
      event_id: createEntityId('the', `${postId}:${sampledAt}`),
      campaign_id: campaignId,
      sampled_at: sampledAt,
      post_id: postId,
      views: 1200,
      likes: 47,
      replies: 5,
      reposts: 3,
      quotes: 1,
      shares: 6,
    };
  }
  async searchKeyword() {
    return [];
  }
}
