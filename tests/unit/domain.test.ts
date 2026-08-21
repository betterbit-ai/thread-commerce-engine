import { describe, expect, it } from 'vitest';
import {
  createCampaignId,
  OfferCodeAllocator,
  sanitizeAttributionKey,
} from '../../src/domain/ids.js';
import { hasExperienceEvidence } from '../../src/domain/experience.js';
import { jaccardSimilarity } from '../../src/domain/similarity.js';
import { enforceDisclosure, validatePolicy } from '../../src/domain/policy.js';
import { weightedScore, percentileCutoff } from '../../src/domain/scoring.js';
import { calculateBusinessMetrics, pearsonCorrelation } from '../../src/domain/analytics.js';
import { isDue, kstDate, kstSlotToInstant } from '../../src/domain/scheduling.js';
import { productSchema } from '../../src/domain/schemas.js';

const disclosure =
  '이 게시물은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.';
const emptyExperience = { schema_version: 1 as const, experiences: [] };

describe('canonical identifiers', () => {
  it('creates stable-shaped campaign IDs without leaking product IDs', () =>
    expect(createCampaignId(new Date('2026-08-21T00:00:00Z'), 'seed')).toMatch(
      /^cmp_20260821_[a-f0-9]{10}$/u,
    ));
  it('allocates offer codes independently', () => {
    const allocator = new OfferCodeAllocator(142);
    expect([allocator.allocate(), allocator.allocate(), allocator.current()]).toEqual([
      142, 143, 144,
    ]);
  });
  it('sanitizes affiliate attribution keys', () =>
    expect(sanitizeAttributionKey('cmp:한글/42')).toBe('cmp____42'));
});

describe('schemas and scoring', () => {
  it('rejects unsupported rating ranges', () =>
    expect(() =>
      productSchema.parse({
        schema_version: 1,
        product_key: 'x',
        source: 'fixture',
        source_product_id: null,
        name: 'x',
        category: 'mouse',
        product_url: null,
        affiliate_url: null,
        image_url: null,
        price_krw: null,
        captured_at: '2026-08-21T00:00:00.000Z',
        is_rocket: null,
        is_free_shipping: null,
        review_count: null,
        rating: 6,
        evidence: [],
      }),
    ).toThrow());
  it('calculates configured weights only', () =>
    expect(
      weightedScore(
        {
          hook: 100,
          persona_fit: 0,
          purchase_intent: 0,
          specificity: 0,
          authenticity: 0,
          trust: 0,
          cta_quality: 0,
          policy_safety: 0,
          redundancy: 0,
        },
        { hook: 1 },
      ),
    ).toBe(100));
  it('calculates percentile cutoff', () => expect(percentileCutoff([10, 20, 30, 40], 75)).toBe(30));
});

describe('experience and hard-fail policy', () => {
  it('requires used, exact curated observations', () =>
    expect(
      hasExperienceEvidence(
        {
          schema_version: 1,
          experiences: [
            {
              product_key: 'p',
              exact_model: 'm',
              used: true,
              duration: null,
              environments: [],
              observations: ['verified'],
              negatives: [],
              caveats: [],
              verified_at: '2026-08-21',
            },
          ],
        },
        'p',
      ),
    ).toBe(true));
  it('hard-fails fabricated experience', () =>
    expect(
      validatePolicy({
        text: enforceDisclosure('내가 몇 달 써봤는데 좋다', disclosure),
        productKey: 'p',
        affiliateUrl: 'https://link.coupang.com/a/x',
        campaignKnown: true,
        disclosure,
        experience: emptyExperience,
        priorTexts: [],
        duplicateThreshold: 0.8,
      }).failures.map((item) => item.code),
    ).toContain('fabricated_experience'));
  it('hard-fails medical claims', () =>
    expect(
      validatePolicy({
        text: enforceDisclosure('손목 통증을 치료하고 터널증후군을 예방한다', disclosure),
        productKey: 'p',
        affiliateUrl: 'https://link.coupang.com/a/x',
        campaignKnown: true,
        disclosure,
        experience: emptyExperience,
        priorTexts: [],
        duplicateThreshold: 0.8,
      }).failures.map((item) => item.code),
    ).toContain('unsupported_health_claim'));
  it('hard-fails missing disclosure and false price/scarcity claims', () => {
    const codes = validatePolicy({
      text: '오늘만 역대 최저가',
      productKey: 'p',
      affiliateUrl: 'https://x.test/a',
      campaignKnown: true,
      disclosure,
      experience: emptyExperience,
      priorTexts: [],
      duplicateThreshold: 0.8,
    }).failures.map((item) => item.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'missing_disclosure',
        'false_scarcity',
        'unsupported_price_superlative',
      ]),
    );
  });
  it('allows only exact curated observation text and never infers purchase', () => {
    const experience = {
      schema_version: 1 as const,
      experiences: [
        {
          product_key: 'p',
          exact_model: 'm',
          used: true,
          duration: null,
          environments: ['home'],
          observations: ['버튼 위치는 적응이 필요했다'],
          negatives: [],
          caveats: [],
          verified_at: '2026-08-21',
        },
      ],
    };
    const exact = validatePolicy({
      text: enforceDisclosure('내가 써보니까 버튼 위치는 적응이 필요했다', disclosure),
      productKey: 'p',
      affiliateUrl: 'https://link.coupang.com/a/x',
      campaignKnown: true,
      disclosure,
      experience,
      priorTexts: [],
      duplicateThreshold: 0.8,
    });
    expect(exact.failures.map((failure) => failure.code)).not.toContain('fabricated_experience');
    const purchase = validatePolicy({
      text: enforceDisclosure('내돈내산으로 직접 샀는데 버튼 위치는 적응이 필요했다', disclosure),
      productKey: 'p',
      affiliateUrl: 'https://link.coupang.com/a/x',
      campaignKnown: true,
      disclosure,
      experience,
      priorTexts: [],
      duplicateThreshold: 0.8,
    });
    expect(purchase.failures.map((failure) => failure.code)).toContain('fabricated_experience');
  });
  it('hard-fails missing link/mapping and duplicates', () => {
    const text = enforceDisclosure('개발자 작업용 장비 정보입니다.', disclosure);
    const codes = validatePolicy({
      text,
      productKey: 'p',
      affiliateUrl: null,
      campaignKnown: false,
      disclosure,
      experience: emptyExperience,
      priorTexts: [text],
      duplicateThreshold: 0.8,
    }).failures.map((item) => item.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'broken_affiliate_url',
        'unknown_campaign_mapping',
        'duplicate_content',
      ]),
    );
  });
  it('does not duplicate disclosure', () =>
    expect(
      enforceDisclosure(enforceDisclosure('본문', disclosure), disclosure).match(
        new RegExp(disclosure, 'gu'),
      ),
    ).toHaveLength(1));
});

describe('similarity, time, and business metrics', () => {
  it('detects Korean near duplicates locally', () =>
    expect(jaccardSimilarity('개발자용 버티컬 마우스 추천', '개발자용 버티컬 마우스 추천!')).toBe(
      1,
    ));
  it('converts KST slots and dates deterministically', () => {
    expect(kstSlotToInstant('2026-08-21', '08:10')).toBe('2026-08-20T23:10:00.000Z');
    expect(kstDate(new Date('2026-08-20T16:00:00Z'))).toBe('2026-08-21');
    expect(isDue('2026-08-20T00:00:00Z', new Date('2026-08-21T00:00:00Z'))).toBe(true);
  });
  it('calculates commerce metrics without divide-by-zero fiction', () => {
    expect(calculateBusinessMetrics(1000, 25, 2, 8000, 80, 15)).toEqual({
      commerce_ctr: 0.025,
      purchase_cvr: 0.08,
      rpmv: 8000,
      engagement_rate: 0.08,
      reply_rate: 0.015,
    });
    expect(calculateBusinessMetrics(0, 0, 0, 0)).toEqual({
      commerce_ctr: null,
      purchase_cvr: null,
      rpmv: null,
      engagement_rate: null,
      reply_rate: null,
    });
  });
  it('calculates human-label correlation only with enough variance', () =>
    expect(
      pearsonCorrelation([
        [10, 0],
        [90, 1],
      ]),
    ).toBeCloseTo(1));
});
