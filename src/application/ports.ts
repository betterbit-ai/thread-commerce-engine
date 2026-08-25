import type { Product, ThreadsEvent, CoupangEvent } from '../domain/schemas.js';

export interface ProductSearchOptions {
  limit: number;
  campaignId?: string;
}
export interface CoupangPort {
  checkConnectivity(): Promise<{ ok: boolean; detail: string }>;
  searchProducts(query: string, options: ProductSearchOptions): Promise<Product[]>;
  createAffiliateLink(productUrl: string, campaignId: string): Promise<string>;
  collectPerformance(startDate: string, endDate: string): Promise<CoupangEvent[]>;
}

export interface StructuredRequest<T> {
  task: string;
  prompt: string;
  input: unknown;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  strict?: boolean;
  parse: (value: unknown) => T;
  model: string;
  temperature: number;
  maxTokens: number;
}
export interface LlmPort {
  generateStructured<T>(request: StructuredRequest<T>): Promise<T>;
  checkConnectivity(): Promise<{ ok: boolean; detail: string }>;
}

export interface PublishResult {
  postId: string;
  permalink: string | null;
}
export interface ThreadsPort {
  checkConnectivity(): Promise<{ ok: boolean; detail: string; expiresAt: string | null }>;
  createTextContainer(text: string, options?: { linkAttachment?: string }): Promise<string>;
  publishContainer(containerId: string): Promise<PublishResult>;
  publishText(text: string, idempotencyKey: string): Promise<PublishResult>;
  getPost(postId: string): Promise<PublishResult>;
  getInsights(postId: string, campaignId: string): Promise<ThreadsEvent>;
  searchKeyword?(
    query: string,
  ): Promise<Array<{ id: string; text: string | null; permalink: string | null }>>;
}
