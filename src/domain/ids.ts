import { createHash, randomUUID } from 'node:crypto';

export function createCampaignId(now = new Date(), entropy: string = randomUUID()): string {
  const date = now.toISOString().slice(0, 10).replaceAll('-', '');
  const suffix = createHash('sha256').update(entropy).digest('hex').slice(0, 10);
  return `cmp_${date}_${suffix}`;
}

export function sanitizeAttributionKey(campaignId: string): string {
  return campaignId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
}

export function createEntityId(prefix: string, input: string): string {
  return `${prefix}_${createHash('sha256').update(input).digest('hex').slice(0, 12)}`;
}

export class OfferCodeAllocator {
  constructor(private nextCode: number) {}
  allocate(): number {
    const value = this.nextCode;
    this.nextCode += 1;
    return value;
  }
  current(): number {
    return this.nextCode;
  }
}
