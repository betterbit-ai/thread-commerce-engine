import type { ExperienceDatabase, PolicyResult } from './schemas.js';
import { supportsFirstPersonText } from './experience.js';
import { mostSimilar } from './similarity.js';

const firsthandPatterns = [
  /내가.{0,12}써봤/iu,
  /내돈내산/iu,
  /직접.{0,8}샀/iu,
  /회사에서.{0,12}쓰/iu,
  /내가 써보니까/iu,
  /우리 집에서는/iu,
  /몇 년째.{0,8}쓰/iu,
];
const medicalPatterns = [
  /손목.{0,8}(치료|완치|낫|예방)/iu,
  /손목.{0,12}(피로|부담|뭉침).{0,12}(줄|감소|완화|덜)/iu,
  /터널증후군.{0,8}(예방|치료)/iu,
  /(자세|통증).{0,8}(고쳐|교정|없애|보장)/iu,
  /의학적으로.{0,8}(증명|입증)/iu,
];
const scarcityPatterns = [/오늘만/iu, /곧 품절/iu, /마감 임박/iu, /지금 아니면/iu];
const superlativePatterns = [/역대 최저/iu, /최저가/iu, /가장 싸/iu];
const unsupportedDiscountPattern = /(할인코드|쿠폰|\d+\s*%\s*할인)/iu;
const directAffiliateLinkPattern = /https:\/\/link\.coupang\.com/iu;

export interface PolicyInput {
  text: string;
  productKey: string;
  affiliateUrl: string | null;
  campaignKnown: boolean;
  disclosure: string;
  experience: ExperienceDatabase;
  priorTexts: string[];
  duplicateThreshold: number;
  supportedClaims?: string[];
  personaRelevant?: boolean;
}

export function validatePolicy(input: PolicyInput): PolicyResult {
  const failures: PolicyResult['failures'] = [];
  const add = (code: PolicyResult['failures'][number]['code'], detail: string): void => {
    failures.push({ code, detail });
  };
  if (
    firsthandPatterns.some((pattern) => pattern.test(input.text)) &&
    !supportsFirstPersonText(input.experience, input.productKey, input.text)
  )
    add(
      'fabricated_experience',
      'First-person use claim has no exact curated experience evidence.',
    );
  if (medicalPatterns.some((pattern) => pattern.test(input.text)))
    add('unsupported_health_claim', 'Medical/health outcome claim is not supported.');
  if (!input.text.includes(input.disclosure))
    add('missing_disclosure', 'Required affiliate disclosure is absent or changed.');
  if (scarcityPatterns.some((pattern) => pattern.test(input.text)))
    add('false_scarcity', 'Scarcity claim lacks trustworthy current evidence.');
  if (superlativePatterns.some((pattern) => pattern.test(input.text)))
    add('unsupported_price_superlative', 'Price superlative lacks historical/current evidence.');
  if (unsupportedDiscountPattern.test(input.text))
    add('unsupported_factual_claim', 'Discount or coupon claim has no supplied evidence.');
  if (directAffiliateLinkPattern.test(input.text))
    add(
      'policy_violation',
      'Product posts must route through the approved offer page, not a direct affiliate link.',
    );
  const compatibilityClaim = /맥(?:북)?(?:과|에).*호환|Mac.*compatible/iu.test(input.text);
  const reviewClaim = /리뷰\s*\d+|평점\s*\d/iu.test(input.text);
  const claims = input.supportedClaims ?? [];
  if (
    (compatibilityClaim && !claims.some((claim) => /compatib|호환|mac_/iu.test(claim))) ||
    (reviewClaim && !claims.some((claim) => /review|rating|리뷰|평점/iu.test(claim)))
  )
    add('unsupported_factual_claim', 'A compatibility/review claim has no supplied evidence.');
  const affiliateUrlValid = (() => {
    try {
      const url = new URL(input.affiliateUrl ?? '');
      return (
        url.protocol === 'https:' &&
        (url.hostname === 'coupang.com' || url.hostname.endsWith('.coupang.com'))
      );
    } catch {
      return false;
    }
  })();
  if (!affiliateUrlValid)
    add('broken_affiliate_url', 'Affiliate URL is absent, not HTTPS, or outside Coupang domains.');
  if (!input.campaignKnown)
    add('unknown_campaign_mapping', 'Draft is not mapped to a known campaign.');
  if (input.personaRelevant === false)
    add('policy_violation', 'Product is outside the configured developer-workstation persona.');
  const withoutDisclosure = (text: string): string => text.replace(input.disclosure, '').trim();
  const duplicate = mostSimilar(
    withoutDisclosure(input.text),
    input.priorTexts.map(withoutDisclosure),
  );
  if (duplicate.index !== null && duplicate.similarity >= input.duplicateThreshold)
    add(
      'duplicate_content',
      `Similarity ${duplicate.similarity.toFixed(3)} exceeds configured threshold.`,
    );
  return { hard_fail: failures.length > 0, failures };
}

export function enforceDisclosure(text: string, disclosure: string): string {
  const trimmed = text.trim();
  return trimmed.includes(disclosure) ? trimmed : `${trimmed}\n\n${disclosure}`;
}
