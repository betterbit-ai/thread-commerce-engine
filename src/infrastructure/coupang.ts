import { createHmac } from 'node:crypto';
import { z } from 'zod';
import type { CoupangPort, ProductSearchOptions } from '../application/ports.js';
import type { CoupangEvent, Product } from '../domain/schemas.js';
import { createEntityId, sanitizeAttributionKey } from '../domain/ids.js';
import {
  CapabilityUnavailableError,
  ConfigurationError,
  ValidationError,
} from '../shared/errors.js';
import { requestJson } from './http.js';

export function coupangTimestamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
    .slice(2);
}

export function signCoupangRequest(input: {
  method: string;
  path: string;
  query: string;
  datetime: string;
  accessKey: string;
  secretKey: string;
}): string {
  const message = `${input.datetime}${input.method.toUpperCase()}${input.path}${input.query}`;
  const signature = createHmac('sha256', input.secretKey).update(message, 'utf8').digest('hex');
  return `CEA algorithm=HmacSHA256, access-key=${input.accessKey}, signed-date=${input.datetime}, signature=${signature}`;
}

const searchResponseSchema = z
  .object({
    rCode: z.string().optional(),
    code: z.string().optional(),
    data: z
      .union([z.object({ productData: z.array(z.unknown()) }), z.array(z.unknown())])
      .optional(),
  })
  .passthrough();
const rawProductSchema = z
  .object({
    productId: z.union([z.string(), z.number()]),
    productName: z.string(),
    productPrice: z.number().nullable().optional(),
    productUrl: z.string().url().optional(),
    productImage: z.string().url().optional(),
    isRocket: z.boolean().optional(),
    isFreeShipping: z.boolean().optional(),
  })
  .passthrough();
const deeplinkResponseSchema = z
  .object({
    data: z.array(
      z
        .object({
          shortenUrl: z.string().url().optional(),
          shortUrl: z.string().url().optional(),
          landingUrl: z.string().url().optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export interface CoupangClientOptions {
  accessKey: string;
  secretKey: string;
  baseUrl: string;
  timeoutMs: number;
  attempts: number;
  fetchFn?: typeof fetch;
  now?: () => Date;
  attributionEnabled?: boolean;
  routes?: {
    search: string;
    deeplink: string;
    clicks?: string;
    orders?: string;
    commission?: string;
  };
  reportContract?: {
    campaignField: string;
    clicksField: string;
    ordersField: string;
    commissionField: string;
    periodField?: string;
  };
}

export class CoupangClient implements CoupangPort {
  private readonly now: () => Date;
  private readonly routes: NonNullable<CoupangClientOptions['routes']>;
  constructor(private readonly options: CoupangClientOptions) {
    if (!options.accessKey || !options.secretKey)
      throw new ConfigurationError('Coupang credentials are required');
    this.now = options.now ?? (() => new Date());
    this.routes = options.routes ?? {
      search: '/v2/providers/affiliate_open_api/apis/openapi/products/search',
      deeplink: '/v2/providers/affiliate_open_api/apis/openapi/v1/deeplink',
    };
  }
  private async call(
    method: string,
    path: string,
    params: URLSearchParams,
    body?: unknown,
  ): Promise<unknown> {
    const query = params.toString();
    const datetime = coupangTimestamp(this.now());
    const authorization = signCoupangRequest({
      method,
      path,
      query,
      datetime,
      accessKey: this.options.accessKey,
      secretKey: this.options.secretKey,
    });
    const result = await requestJson(
      `${this.options.baseUrl}${path}${query ? `?${query}` : ''}`,
      {
        method,
        headers: { Authorization: authorization, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      {
        timeoutMs: this.options.timeoutMs,
        attempts: this.options.attempts,
        ...(this.options.fetchFn ? { fetchFn: this.options.fetchFn } : {}),
      },
    );
    return result.data;
  }
  async checkConnectivity(): Promise<{ ok: boolean; detail: string }> {
    await this.searchProducts('버티컬 마우스', { limit: 1 });
    return { ok: true, detail: 'authenticated product search succeeded' };
  }
  async searchProducts(query: string, options: ProductSearchOptions): Promise<Product[]> {
    const params = new URLSearchParams({ keyword: query, limit: String(options.limit) });
    if (options.campaignId && this.options.attributionEnabled)
      params.set('subId', sanitizeAttributionKey(options.campaignId));
    const envelope = searchResponseSchema.parse(await this.call('GET', this.routes.search, params));
    const raw =
      envelope.data && !Array.isArray(envelope.data)
        ? envelope.data.productData
        : (envelope.data ?? []);
    return raw.map((item) => {
      const value = rawProductSchema.parse(item);
      const productId = String(value.productId);
      return {
        schema_version: 1,
        product_key: `coupang:${productId}`,
        source: 'coupang',
        source_product_id: productId,
        name: value.productName,
        category: 'productivity',
        product_url: value.productUrl ?? null,
        affiliate_url: null,
        image_url: value.productImage ?? null,
        price_krw: value.productPrice ?? null,
        captured_at: this.now().toISOString(),
        is_rocket: value.isRocket ?? null,
        is_free_shipping: value.isFreeShipping ?? null,
        review_count: null,
        rating: null,
        evidence: [{ field: 'source', source: 'Coupang Partners search API', value: query }],
      } satisfies Product;
    });
  }
  async createAffiliateLink(productUrl: string, campaignId: string): Promise<string> {
    const response = deeplinkResponseSchema.parse(
      await this.call('POST', this.routes.deeplink, new URLSearchParams(), {
        coupangUrls: [productUrl],
        ...(this.options.attributionEnabled ? { subId: sanitizeAttributionKey(campaignId) } : {}),
      }),
    );
    const link = response.data[0]?.shortenUrl ?? response.data[0]?.shortUrl;
    if (!link)
      throw new ValidationError('Coupang deep-link response did not contain a supported URL field');
    return link;
  }
  async collectPerformance(startDate: string, endDate: string): Promise<CoupangEvent[]> {
    if (
      !this.routes.clicks ||
      !this.routes.orders ||
      !this.routes.commission ||
      !this.options.reportContract
    )
      throw new CapabilityUnavailableError('Coupang reporting routes and exact field contract');
    const sampledAt = this.now().toISOString();
    const records: CoupangEvent[] = [];
    for (const [kind, path] of Object.entries({
      clicks: this.routes.clicks,
      orders: this.routes.orders,
      commission: this.routes.commission,
    })) {
      const raw = await this.call('GET', path, new URLSearchParams({ startDate, endDate }));
      const parsed = z
        .object({ data: z.array(z.record(z.string(), z.unknown())) })
        .passthrough()
        .parse(raw);
      const valueField =
        kind === 'clicks'
          ? this.options.reportContract.clicksField
          : kind === 'orders'
            ? this.options.reportContract.ordersField
            : this.options.reportContract.commissionField;
      for (const [index, row] of parsed.data.entries()) {
        const campaignValue = row[this.options.reportContract.campaignField];
        const periodValue = this.options.reportContract.periodField
          ? row[this.options.reportContract.periodField]
          : undefined;
        records.push({
          schema_version: 1,
          event_id: createEntityId('cpe', `${kind}:${sampledAt}:${index}`),
          campaign_id: typeof campaignValue === 'string' ? campaignValue : 'unmapped',
          sampled_at: sampledAt,
          clicks:
            kind === 'clicks'
              ? z.number().nonnegative().nullable().catch(null).parse(row[valueField])
              : null,
          orders:
            kind === 'orders'
              ? z.number().nonnegative().nullable().catch(null).parse(row[valueField])
              : null,
          commission_krw:
            kind === 'commission'
              ? z.number().nonnegative().nullable().catch(null).parse(row[valueField])
              : null,
          source_period: typeof periodValue === 'string' ? periodValue : `${startDate}:${endDate}`,
        });
      }
    }
    return records;
  }
}
