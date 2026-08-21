import type { Product, ProductAnalysis } from '../domain/schemas.js';
import { hasExperienceEvidence } from '../domain/experience.js';
import type { ExperienceDatabase } from '../domain/schemas.js';

const categoryMatchers: Array<[Product['category'], RegExp]> = [
  ['apple_device', /맥북|macbook|아이맥|imac/iu],
  ['apple_accessory', /애플|apple|맥세이프|에어팟/iu],
  ['keyboard', /키보드|팜레스트|손목 받침|split keyboard/iu],
  ['mouse', /마우스|트랙볼/iu],
  ['desk', /모니터암|노트북 거치대|책상|스탠드/iu],
  ['productivity', /허브|dock|도크|충전기|케이블|모니터/iu],
];
export function classifyProduct(name: string): Product['category'] {
  return categoryMatchers.find(([, pattern]) => pattern.test(name))?.[0] ?? 'irrelevant';
}
export function normalizeProduct(product: Product): Product {
  return {
    ...product,
    name: product.name.trim().replace(/\s+/gu, ' '),
    category: classifyProduct(product.name),
  };
}
export function deterministicAnalysis(
  product: Product,
  experience: ExperienceDatabase,
): ProductAnalysis {
  const relevant = product.category !== 'irrelevant';
  const evidenceFields = new Set(product.evidence.map((item) => item.field));
  const priceChange = product.evidence.find((item) => item.field === 'price_change')?.value as
    { previous_krw?: number; current_krw?: number } | undefined;
  const dealSignal =
    priceChange?.previous_krw &&
    priceChange.current_krw !== undefined &&
    priceChange.current_krw < priceChange.previous_krw
      ? Math.min(
          100,
          ((priceChange.previous_krw - priceChange.current_krw) / priceChange.previous_krw) * 500,
        )
      : null;
  const priceBand: ProductAnalysis['price_band'] =
    product.price_krw === null
      ? 'unknown'
      : product.price_krw >= 1_000_000
        ? 'high_ticket'
        : product.price_krw >= 150_000
          ? 'premium'
          : product.price_krw >= 40_000
            ? 'mid'
            : 'budget';
  return {
    schema_version: 1,
    product_key: product.product_key,
    persona_relevance: relevant ? (product.category.startsWith('apple') ? 70 : 88) : 10,
    problem_solved: relevant ? '개발자 작업 환경의 편의와 구성 개선' : null,
    likely_target: relevant ? '장시간 PC를 사용하는 한국 IT 작업자' : null,
    price_band: priceBand,
    category: product.category,
    developer_relevance: relevant ? 85 : 5,
    mac_compatibility: evidenceFields.has('mac_compatibility') ? 'verified' : 'unknown',
    deal_signal: dealSignal,
    review_signal:
      product.review_count === null
        ? null
        : Math.min(100, Math.log10(product.review_count + 1) * 25),
    commission_economics: null,
    content_angle_potential: relevant ? 80 : 15,
    founder_experience_supported: hasExperienceEvidence(experience, product.product_key),
    evidence_quality: Math.min(100, 20 + product.evidence.length * 15),
  };
}

export function selectProductsByMix(
  products: Product[],
  mix: Record<string, number>,
  count: number,
): Product[] {
  const pools = new Map<string, Product[]>();
  for (const product of products) {
    const pool = pools.get(product.category) ?? [];
    pool.push(product);
    pools.set(product.category, pool);
  }
  const categories = Object.entries(mix).filter(
    ([category, weight]) => weight > 0 && (pools.get(category)?.length ?? 0) > 0,
  );
  const allocations = new Map(categories.map(([category]) => [category, 1]));
  let remaining = Math.max(0, count - allocations.size);
  while (remaining > 0) {
    const next = categories
      .filter(([category]) => (allocations.get(category) ?? 0) < (pools.get(category)?.length ?? 0))
      .sort(
        ([leftCategory, leftWeight], [rightCategory, rightWeight]) =>
          rightWeight * count -
          (allocations.get(rightCategory) ?? 0) -
          (leftWeight * count - (allocations.get(leftCategory) ?? 0)),
      )[0];
    if (!next) break;
    allocations.set(next[0], (allocations.get(next[0]) ?? 0) + 1);
    remaining -= 1;
  }
  const selected = categories.flatMap(([category]) =>
    (pools.get(category) ?? []).slice(0, allocations.get(category) ?? 0),
  );
  const selectedKeys = new Set(selected.map((product) => product.product_key));
  return [
    ...selected,
    ...products.filter(
      (product) => product.category !== 'irrelevant' && !selectedKeys.has(product.product_key),
    ),
  ].slice(0, count);
}
