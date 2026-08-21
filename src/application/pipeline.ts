import { createHash } from 'node:crypto';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { CoupangPort, LlmPort, ThreadsPort } from './ports.js';
import { loadPrompt } from './prompts.js';
import { deterministicAnalysis, normalizeProduct, selectProductsByMix } from './product.js';
import {
  createCampaignId,
  createEntityId,
  OfferCodeAllocator,
  sanitizeAttributionKey,
} from '../domain/ids.js';
import { enforceDisclosure, validatePolicy } from '../domain/policy.js';
import { weightedScore } from '../domain/scoring.js';
import { eligibleDrafts, kstDate, kstSlotToInstant } from '../domain/scheduling.js';
import { calculateBusinessMetrics, pearsonCorrelation } from '../domain/analytics.js';
import {
  angleSchema,
  angleKindSchema,
  analysisSchema,
  campaignSchema,
  componentScoresSchema,
  coupangEventSchema,
  draftSchema,
  experienceSchema,
  humanLabelSchema,
  judgeSchema,
  productSchema,
  queueSchema,
  threadsEventSchema,
  type Angle,
  type Campaign,
  type CoupangEvent,
  type Draft,
  type ExperienceDatabase,
  type JudgeResult,
  type Product,
  type ThreadsEvent,
} from '../domain/schemas.js';
import type { RepositoryStore } from '../infrastructure/repository.js';
import { log } from '../shared/logger.js';
import { PublishSafetyError, ValidationError } from '../shared/errors.js';

const genericObjectSchema: Record<string, unknown> = { type: 'object', additionalProperties: true };
const publicationReceiptSchema = z.object({
  schema_version: z.literal(1),
  campaign_id: z.string(),
  draft_id: z.string(),
  text_hash: z.string(),
  container_id: z.string(),
  status: z.enum(['container_created', 'publication_unknown', 'published']),
  post_id: z.string().nullable(),
  permalink: z.string().url().nullable(),
  updated_at: z.string().datetime(),
});
const generatedAnglesSchema = z.object({
  angles: z
    .array(
      z.object({
        kind: angleKindSchema,
        premise: z.string().min(1),
        evidence_refs: z.array(z.string()).min(1),
      }),
    )
    .min(1),
});
const judgeSubjectiveSchema = z.object({
  scores: componentScoresSchema,
  reasons: z.record(z.string(), z.string()),
  detected_risks: z.array(z.string()),
  hard_fail_suggestions: z.array(z.string()),
  overall_score: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1),
  improvement: z.string(),
});

export interface PipelineDependencies {
  coupang: CoupangPort;
  llm: LlmPort;
  threads: ThreadsPort;
  store: RepositoryStore;
  config: AppConfig;
  now: () => Date;
}

function dispatchEligible(draft: Draft, drafts: Draft[], config: AppConfig): boolean {
  return eligibleDrafts(drafts, config).some((candidate) => candidate.draft_id === draft.draft_id);
}

export async function hydrateDraftLabels(
  drafts: Draft[],
  store: RepositoryStore,
): Promise<Draft[]> {
  const labels = await store.readJsonl('data/labels/human_labels.jsonl', humanLabelSchema);
  const latest = new Map<string, (typeof labels)[number]>();
  for (const label of labels) {
    const prior = latest.get(label.draft_id);
    if (!prior || label.labeled_at >= prior.labeled_at) latest.set(label.draft_id, label);
  }
  return drafts.map((draft) =>
    draftSchema.parse({
      ...draft,
      human_label: latest.get(draft.draft_id)?.label ?? draft.human_label,
    }),
  );
}

type CoupangBudgetFamily = 'search' | 'report' | 'other';
const budgetStateSchema = z.object({
  schema_version: z.literal(1),
  hours: z.record(z.string(), z.record(z.string(), z.number().int().nonnegative())),
});

async function reserveCoupangCalls(
  deps: PipelineDependencies,
  family: CoupangBudgetFamily,
  count: number,
): Promise<void> {
  const limit = deps.config.external.coupang[`${family}_hourly_budget`];
  const hour = deps.now().toISOString().slice(0, 13);
  const state: z.infer<typeof budgetStateSchema> = await deps.store
    .readJson('data/state/coupang-api-budgets.json', budgetStateSchema)
    .catch(() => budgetStateSchema.parse({ schema_version: 1, hours: {} }));
  const usage = state.hours[hour] ?? {};
  const used = usage[family] ?? 0;
  if (used + count > limit)
    throw new ValidationError('Configured Coupang hourly API budget would be exceeded', {
      family,
      limit,
      requested: count,
      used,
      hour,
    });
  state.hours = { [hour]: { ...usage, [family]: used + count } };
  await deps.store.writeJson('data/state/coupang-api-budgets.json', state);
}

export async function loadExperience(
  path = resolve('data/experience/founder.yml'),
): Promise<ExperienceDatabase> {
  return experienceSchema.parse(parseYaml(await readFile(path, 'utf8')));
}

export async function ingestProducts(
  deps: PipelineDependencies,
  queries = deps.config.ingest.queries,
): Promise<Product[]> {
  await reserveCoupangCalls(deps, 'search', queries.length);
  const products: Product[] = [];
  for (const query of queries)
    products.push(
      ...(await deps.coupang.searchProducts(query, {
        limit: deps.config.ingest.products_per_query,
      })),
    );
  const normalized = [
    ...new Map(
      products.map((item) => [item.product_key, normalizeProduct(productSchema.parse(item))]),
    ).values(),
  ];
  const existing = await deps.store.readJsonl('data/catalog/products.jsonl', productSchema);
  const priorByKey = new Map(existing.map((product) => [product.product_key, product]));
  const deduped = normalized.map((product) => {
    const prior = priorByKey.get(product.product_key);
    if (
      prior &&
      prior.price_krw !== null &&
      product.price_krw !== null &&
      prior.price_krw !== product.price_krw
    )
      return {
        ...product,
        evidence: [
          ...product.evidence,
          {
            field: 'price_change',
            source: 'repository catalog comparison',
            value: { previous_krw: prior.price_krw, current_krw: product.price_krw },
          },
        ],
      } satisfies Product;
    return product;
  });
  const date = kstDate(deps.now());
  for (const product of deduped) {
    await deps.store.appendJsonl(
      `data/products/snapshots/${date.slice(0, 4)}/${date.slice(5, 7)}/${date}.jsonl`,
      product,
    );
    const priceChange = product.evidence.find((item) => item.field === 'price_change');
    if (priceChange)
      await deps.store.appendJsonl(
        `data/events/opportunities/${date.slice(0, 4)}/${date.slice(5, 7)}/${date}.jsonl`,
        {
          schema_version: 1,
          event_id: createEntityId('opp', `${product.product_key}:${date}`),
          product_key: product.product_key,
          detected_at: deps.now().toISOString(),
          kind: 'price_change',
          evidence: priceChange.value,
        },
      );
  }
  await deps.store.writeJsonl('data/catalog/products.jsonl', [
    ...new Map([...existing, ...deduped].map((item) => [item.product_key, item])).values(),
  ]);
  log('info', 'products.ingested', { count: deduped.length, queries: queries.length });
  return deduped;
}

function fallbackAngles(product: Product, count: number): Angle[] {
  const kinds: Angle['kind'][] =
    product.category === 'irrelevant'
      ? ['who_it_is_not_for']
      : ['pain_solution', 'who_it_is_for', 'developer_workflow', 'who_it_is_not_for', 'comparison'];
  return kinds.slice(0, count).map((kind, index) =>
    angleSchema.parse({
      schema_version: 1,
      angle_id: createEntityId('ang', `${product.product_key}:${kind}:${index}`),
      product_key: product.product_key,
      kind,
      premise: `${product.name}을(를) 장시간 개발 작업 관점에서 검토`,
      evidence_refs: product.evidence.length
        ? product.evidence.map((item) => item.field)
        : ['product_name'],
    }),
  );
}

function fixtureDraftText(product: Product, angle: Angle['kind'], offerCode: number): string {
  if (product.product_key === 'fx:risky-health')
    return `이 팜레스트면 손목 통증을 치료하고 터널증후군을 예방합니다.\n제품은 프로필 ${offerCode}번`;
  if (angle === 'who_it_is_not_for')
    return `${product.name}, 이름만 보고 모두에게 맞는 장비라고 생각하면 안 됩니다.\n확인된 사양과 내 작업 방식이 맞는지 먼저 보세요.\n제품 정보는 프로필 ${offerCode}번`;
  const categoryLead: Record<string, string> = {
    mouse: '포인터 장비는 그립과 버튼 배치가 작업 리듬을 크게 바꿉니다.',
    keyboard: '키보드는 배열과 적응 비용을 먼저 따져야 오래 쓰기 쉽습니다.',
    desk: '책상 장비는 화면 높이와 실제 하중 범위를 숫자로 확인해야 합니다.',
    productivity: '허브와 충전기는 포트 구성과 출력 조건이 내 장비 조합에 맞아야 합니다.',
    apple_accessory: 'Apple 액세서리도 생태계 이름보다 실제 호환 범위를 먼저 봐야 합니다.',
    apple_device: '고가 기기는 할인 문구보다 메모리·저장공간 구성이 작업에 맞는지가 먼저입니다.',
  };
  const angleLead: Partial<Record<Angle['kind'], string>> = {
    pain_solution: '불편을 장비 하나가 해결한다고 단정하기보다 작업 조건부터 확인했습니다.',
    who_it_is_for:
      '이 선택은 기능을 자주 쓰는 사람과 단순한 구성을 원하는 사람에게 다르게 맞습니다.',
    developer_workflow: '코딩·회의·이동 사이에 연결을 반복하는 흐름을 기준으로 살폈습니다.',
    comparison: '비교할 때는 이름보다 배열, 포트, 크기처럼 확인 가능한 차이를 봐야 합니다.',
  };
  return `${categoryLead[product.category] ?? '장비는 확인 가능한 정보부터 봐야 합니다.'}\n${angleLead[angle] ?? '구매 전에 내 작업 조건과 맞는지 확인해야 합니다.'}\n${product.name}은(는) 모르는 호환성을 모른다고 두고 비교했습니다.\n제품 정보는 프로필 ${offerCode}번`;
}

function fixtureJudge(product: Product): JudgeResult {
  const base = product.category === 'irrelevant' ? 35 : 78;
  const safety = product.product_key === 'fx:risky-health' ? 10 : 92;
  const scores = {
    hook: base,
    persona_fit: product.category === 'irrelevant' ? 10 : 88,
    purchase_intent: base - 5,
    specificity: 70,
    authenticity: 90,
    trust: safety,
    cta_quality: 80,
    policy_safety: safety,
    redundancy: 82,
  };
  return judgeSchema.parse({
    schema_version: 1,
    scores,
    reasons: Object.fromEntries(
      Object.keys(scores).map((key) => [key, 'fixture-calibrated reason']),
    ),
    detected_risks: safety < 50 ? ['health claim'] : [],
    hard_fail_suggestions: safety < 50 ? ['unsupported_health_claim'] : [],
    overall_score: Math.round(
      Object.values(scores).reduce((a, b) => a + b, 0) / Object.values(scores).length,
    ),
    confidence: 0.86,
    improvement: '근거가 있는 한 가지 구체 정보에 집중하세요.',
    model: 'fixture-judge',
    prompt_version: 'v1',
  });
}

export async function planContent(
  products: Product[],
  deps: PipelineDependencies,
  experience: ExperienceDatabase,
  options: { fixture?: boolean; approveCount?: number } = {},
): Promise<{ drafts: Draft[]; campaigns: Campaign[] }> {
  const writerPrompt = await loadPrompt('writer');
  const judgePrompt = await loadPrompt('judge');
  const anglePrompt = await loadPrompt('angle-generator');
  const analystPrompt = await loadPrompt('product-analyst');
  const promptChainVersion = `product-analyst:${analystPrompt.version}|angle-generator:${anglePrompt.version}|writer:${writerPrompt.version}|judge:${judgePrompt.version}`;
  const date = kstDate(deps.now());
  const counters = await deps.store
    .readJson(
      'data/state/counters.json',
      z.object({
        schema_version: z.literal(1),
        next_offer_code: z.number().int().positive(),
      }),
    )
    .catch(() => ({ schema_version: 1 as const, next_offer_code: 100 }));
  const labels = await deps.store.readJsonl('data/labels/human_labels.jsonl', humanLabelSchema);
  const latestLabels = new Map(labels.map((label) => [label.draft_id, label.label]));
  const existingCampaigns = await deps.store.readJsonl(
    'data/runtime/campaigns.jsonl',
    campaignSchema,
  );
  const existingCampaignById = new Map(
    existingCampaigns.map((campaign) => [campaign.campaign_id, campaign]),
  );
  const allocator = new OfferCodeAllocator(counters.next_offer_code);
  const drafts: Draft[] = [];
  const campaigns: Campaign[] = [];
  const priorTexts: string[] = [];
  const relevant = products.filter((product) => product.category !== 'irrelevant');
  const selected = options.fixture
    ? products
    : selectProductsByMix(
        relevant,
        deps.config.content.category_mix,
        deps.config.content.candidate_products,
      );
  for (const [productIndex, product] of selected.entries()) {
    const deterministic = deterministicAnalysis(product, experience);
    const analysis = options.fixture
      ? deterministic
      : await deps.llm.generateStructured({
          task: 'product-analyst',
          prompt: analystPrompt.text,
          input: { product, deterministic_constraints: deterministic },
          schemaName: 'product_analysis',
          jsonSchema: genericObjectSchema,
          parse: (value) => {
            const parsed = analysisSchema.parse(value);
            return analysisSchema.parse({
              ...parsed,
              product_key: product.product_key,
              category: deterministic.category,
              founder_experience_supported: deterministic.founder_experience_supported,
              deal_signal: deterministic.deal_signal,
              review_signal: deterministic.review_signal,
              commission_economics: deterministic.commission_economics,
              mac_compatibility:
                deterministic.mac_compatibility === 'unknown'
                  ? 'unknown'
                  : parsed.mac_compatibility,
            });
          },
          model: deps.config.llm.primary_model,
          temperature: 0,
          maxTokens: deps.config.llm.max_output_tokens,
        });
    const campaignId = createCampaignId(deps.now(), product.product_key);
    const offerCode = existingCampaignById.get(campaignId)?.offer_code ?? allocator.allocate();
    const affiliateUrl =
      product.affiliate_url ??
      (product.product_url
        ? (await reserveCoupangCalls(deps, 'other', 1),
          await deps.coupang.createAffiliateLink(product.product_url, campaignId))
        : null);
    if (!affiliateUrl) continue;
    const angles = options.fixture
      ? fallbackAngles(product, deps.config.content.angles_per_product)
      : (
          await deps.llm.generateStructured({
            task: 'angle-generator',
            prompt: anglePrompt.text,
            input: { product, analysis },
            schemaName: 'content_angles',
            jsonSchema: {
              type: 'object',
              properties: {
                angles: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      kind: { type: 'string' },
                      premise: { type: 'string' },
                      evidence_refs: { type: 'array', items: { type: 'string' } },
                    },
                    required: ['kind', 'premise', 'evidence_refs'],
                    additionalProperties: false,
                  },
                },
              },
              required: ['angles'],
              additionalProperties: false,
            },
            parse: (value) => generatedAnglesSchema.parse(value),
            model: deps.config.llm.primary_model,
            temperature: deps.config.llm.generation_temperature,
            maxTokens: deps.config.llm.max_output_tokens,
          })
        ).angles
          .slice(0, deps.config.content.angles_per_product)
          .map((angle, index) =>
            angleSchema.parse({
              schema_version: 1,
              angle_id: createEntityId(
                'ang',
                `${product.product_key}:${angle.kind}:${index}:${angle.premise}`,
              ),
              product_key: product.product_key,
              ...angle,
            }),
          );
    for (const [draftIndex, angle] of angles
      .slice(0, deps.config.content.generation_count)
      .entries()) {
      const rawText = options.fixture
        ? fixtureDraftText(product, angle.kind, offerCode)
        : await deps.llm
            .generateStructured({
              task: 'writer',
              prompt: writerPrompt.text,
              input: { product, analysis, angle, offer_code: offerCode },
              schemaName: 'thread_draft',
              jsonSchema: {
                type: 'object',
                properties: { text: { type: 'string' } },
                required: ['text'],
                additionalProperties: false,
              },
              parse: (value) => awaitImportText(value),
              model: deps.config.llm.primary_model,
              temperature: deps.config.llm.generation_temperature,
              maxTokens: deps.config.llm.max_output_tokens,
            })
            .then((value) => value.text);
      const text = enforceDisclosure(rawText, deps.config.disclosure.text);
      const judge = options.fixture
        ? fixtureJudge(product)
        : await deps.llm.generateStructured({
            task: 'judge',
            prompt: judgePrompt.text,
            input: { product, analysis, angle, text },
            schemaName: 'draft_judge',
            jsonSchema: {
              type: 'object',
              properties: {
                scores: {
                  type: 'object',
                  properties: Object.fromEntries(
                    [
                      'hook',
                      'persona_fit',
                      'purchase_intent',
                      'specificity',
                      'authenticity',
                      'trust',
                      'cta_quality',
                      'policy_safety',
                      'redundancy',
                    ].map((key) => [key, { type: 'number' }]),
                  ),
                  required: [
                    'hook',
                    'persona_fit',
                    'purchase_intent',
                    'specificity',
                    'authenticity',
                    'trust',
                    'cta_quality',
                    'policy_safety',
                    'redundancy',
                  ],
                  additionalProperties: false,
                },
                reasons: { type: 'object', additionalProperties: { type: 'string' } },
                detected_risks: { type: 'array', items: { type: 'string' } },
                hard_fail_suggestions: { type: 'array', items: { type: 'string' } },
                overall_score: { type: 'number' },
                confidence: { type: 'number' },
                improvement: { type: 'string' },
              },
              required: [
                'scores',
                'reasons',
                'detected_risks',
                'hard_fail_suggestions',
                'overall_score',
                'confidence',
                'improvement',
              ],
              additionalProperties: false,
            },
            parse: (value) => {
              const subjective = judgeSubjectiveSchema.parse(value);
              return judgeSchema.parse({
                schema_version: 1,
                ...subjective,
                model: deps.config.llm.judge_model,
                prompt_version: judgePrompt.version,
              });
            },
            model: deps.config.llm.judge_model,
            temperature: deps.config.llm.judge_temperature,
            maxTokens: deps.config.llm.max_output_tokens,
          });
      judge.overall_score = weightedScore(judge.scores, deps.config.publishing.judge_weights);
      const textHash = createHash('sha256').update(text).digest('hex');
      const draftId = createEntityId(
        'drf',
        `${campaignId}:${angle.angle_id}:${draftIndex}:${textHash}`,
      );
      const policy = validatePolicy({
        text,
        productKey: product.product_key,
        affiliateUrl,
        campaignKnown: true,
        disclosure: deps.config.disclosure.text,
        experience,
        priorTexts,
        duplicateThreshold: deps.config.content.duplicate_threshold,
        supportedClaims: product.evidence.map(
          (item) => `${item.field}:${JSON.stringify(item.value)}`,
        ),
        personaRelevant: product.category !== 'irrelevant',
      });
      const fixtureApproval =
        productIndex < (options.approveCount ?? 0) && draftIndex === 0 && !policy.hard_fail;
      const humanLabel = fixtureApproval ? 'approve' : (latestLabels.get(draftId) ?? null);
      const draft = draftSchema.parse({
        schema_version: 1,
        draft_id: draftId,
        campaign_id: campaignId,
        product_key: product.product_key,
        angle: angle.kind,
        text,
        text_hash: textHash,
        offer_code: offerCode,
        created_at: deps.now().toISOString(),
        prompt_version: promptChainVersion,
        model: options.fixture ? 'fixture-writer' : deps.config.llm.primary_model,
        input_hash: createHash('sha256')
          .update(
            JSON.stringify({
              product,
              analysis,
              angle,
              prompts: {
                analyst: analystPrompt.hash,
                angle: anglePrompt.hash,
                writer: writerPrompt.hash,
                judge: judgePrompt.hash,
              },
            }),
          )
          .digest('hex'),
        judge,
        policy,
        human_label: humanLabel,
      });
      drafts.push(draft);
      priorTexts.push(text);
      await deps.store.writeJson(
        `data/drafts/${date.slice(0, 4)}/${date.slice(5, 7)}/${draftId}.json`,
        draft,
      );
      if (draftIndex === 0) {
        const slot =
          deps.config.publishing.slots_kst[
            productIndex % deps.config.publishing.slots_kst.length
          ] ?? '08:10';
        const campaign = campaignSchema.parse({
          schema_version: 1,
          campaign_id: campaignId,
          offer_code: offerCode,
          product_key: product.product_key,
          affiliate_url: affiliateUrl,
          attribution_key: sanitizeAttributionKey(campaignId),
          draft_id: draftId,
          engine:
            analysis.deal_signal !== null && analysis.deal_signal > 0 ? 'opportunity' : 'evergreen',
          category: product.category,
          angle: angle.kind,
          hook_style: 'problem-first',
          cta_variant: 'profile-offer-code',
          scheduled_at: kstSlotToInstant(date, slot),
          prompt_version: promptChainVersion,
          groq_model: draft.model,
          judge_overall: judge.overall_score,
          founder_experience_supported: analysis.founder_experience_supported,
          status: 'calibration',
          threads_post_id: null,
          permalink: null,
          published_at: null,
        });
        campaigns.push(campaign);
        await deps.store.writeJson(
          `data/campaigns/${date.slice(0, 4)}/${date.slice(5, 7)}/${campaignId}.json`,
          campaign,
        );
      }
    }
  }
  const eligible = options.fixture
    ? drafts.filter((draft) => draft.human_label === 'approve' && !draft.policy.hard_fail)
    : eligibleDrafts(drafts, deps.config);
  const eligibleIds = new Set(eligible.map((draft) => draft.draft_id));
  const eligibleCampaigns: Campaign[] = [];
  for (const campaign of campaigns) {
    const candidates = drafts
      .filter((draft) => draft.campaign_id === campaign.campaign_id)
      .sort((left, right) => right.judge.overall_score - left.judge.overall_score);
    const chosen =
      candidates.find((draft) => eligibleIds.has(draft.draft_id)) ??
      candidates.find((draft) => !draft.policy.hard_fail) ??
      candidates[0];
    if (chosen) {
      campaign.draft_id = chosen.draft_id;
      campaign.angle = chosen.angle;
      campaign.judge_overall = chosen.judge.overall_score;
      campaign.groq_model = chosen.model;
      if (eligibleIds.has(chosen.draft_id)) eligibleCampaigns.push(campaign);
    }
  }
  const queuedCampaignIds = new Set(
    eligibleCampaigns
      .sort((left, right) => right.judge_overall - left.judge_overall)
      .slice(0, deps.config.content.posts_per_day)
      .map((campaign) => campaign.campaign_id),
  );
  for (const campaign of campaigns) {
    if (queuedCampaignIds.has(campaign.campaign_id)) campaign.status = 'queued';
    await deps.store.writeJson(
      `data/campaigns/${date.slice(0, 4)}/${date.slice(5, 7)}/${campaign.campaign_id}.json`,
      campaign,
    );
  }
  await deps.store.writeJson('data/state/counters.json', {
    schema_version: 1,
    next_offer_code: allocator.current(),
  });
  const existingDrafts = await deps.store.readJsonl('data/runtime/drafts.jsonl', draftSchema);
  await deps.store.writeJsonl('data/runtime/drafts.jsonl', [
    ...new Map([...existingDrafts, ...drafts].map((draft) => [draft.draft_id, draft])).values(),
  ]);
  const mergedCampaigns = new Map(
    existingCampaigns.map((campaign) => [campaign.campaign_id, campaign]),
  );
  for (const campaign of campaigns) {
    const existing = mergedCampaigns.get(campaign.campaign_id);
    mergedCampaigns.set(
      campaign.campaign_id,
      existing?.status === 'published' ? existing : campaign,
    );
  }
  await deps.store.writeJsonl('data/runtime/campaigns.jsonl', [...mergedCampaigns.values()]);
  await buildStorefront(
    products,
    [...mergedCampaigns.values()],
    deps.store,
    deps.now,
    deps.config.disclosure.text,
  );
  await buildCalibrationReport(
    await hydrateDraftLabels(drafts, deps.store),
    products,
    deps.store,
    deps.now,
  );
  log('info', 'content.planned', {
    drafts: drafts.length,
    campaigns: campaigns.length,
    hard_failures: drafts.filter((draft) => draft.policy.hard_fail).length,
  });
  return { drafts, campaigns };
}

export async function applyHumanLabels(
  drafts: Draft[],
  campaigns: Campaign[],
  deps: PipelineDependencies,
): Promise<{ drafts: Draft[]; campaigns: Campaign[] }> {
  const labeledDrafts = await hydrateDraftLabels(drafts, deps.store);
  const eligibleIds = new Set(
    eligibleDrafts(labeledDrafts, deps.config).map((draft) => draft.draft_id),
  );
  const updatedCampaigns = campaigns.map((campaign) => {
    if (campaign.status === 'published' || campaign.status === 'publishing') return campaign;
    const selected = labeledDrafts
      .filter(
        (draft) => draft.campaign_id === campaign.campaign_id && eligibleIds.has(draft.draft_id),
      )
      .sort((left, right) => right.judge.overall_score - left.judge.overall_score)[0];
    if (!selected)
      return campaign.status === 'queued'
        ? campaignSchema.parse({ ...campaign, status: 'calibration' })
        : campaign;
    return campaignSchema.parse({
      ...campaign,
      draft_id: selected.draft_id,
      angle: selected.angle,
      judge_overall: selected.judge.overall_score,
      groq_model: selected.model,
      status: 'queued',
    });
  });
  await deps.store.writeJsonl('data/runtime/drafts.jsonl', labeledDrafts);
  await deps.store.writeJsonl('data/runtime/campaigns.jsonl', updatedCampaigns);
  return { drafts: labeledDrafts, campaigns: updatedCampaigns };
}

function awaitImportText(value: unknown): { text: string } {
  if (!value || typeof value !== 'object' || typeof (value as { text?: unknown }).text !== 'string')
    throw new Error('writer response missing text');
  return { text: (value as { text: string }).text };
}

export async function buildCalibrationReport(
  drafts: Draft[],
  products: Product[],
  store: RepositoryStore,
  now: () => Date,
): Promise<Record<string, unknown>> {
  const productMap = new Map(products.map((product) => [product.product_key, product]));
  const labels = drafts.filter((item) => item.human_label !== null);
  const dimensionDistribution = Object.fromEntries(
    Object.keys(drafts[0]?.judge.scores ?? {}).map((dimension) => [
      dimension,
      drafts.map((draft) => draft.judge.scores[dimension as keyof JudgeResult['scores']]),
    ]),
  );
  const groupScores = (key: (draft: Draft) => string): Record<string, number[]> => {
    const groups: Record<string, number[]> = {};
    for (const draft of drafts) (groups[key(draft)] ??= []).push(draft.judge.overall_score);
    return groups;
  };
  const approved = labels.filter((item) => item.human_label === 'approve');
  const rejected = labels.filter((item) => item.human_label === 'reject');
  const midpoint = drafts.length
    ? ([...drafts].sort((a, b) => a.judge.overall_score - b.judge.overall_score)[
        Math.floor(drafts.length / 2)
      ]?.judge.overall_score ?? 0)
    : 0;
  const report = {
    schema_version: 1,
    generated_at: now().toISOString(),
    threshold_status: 'disabled_initially',
    score_distribution: drafts.map((item) => item.judge.overall_score),
    score_distribution_by_dimension: dimensionDistribution,
    score_distribution_by_angle: groupScores((draft) => draft.angle),
    score_distribution_by_category: groupScores(
      (draft) => productMap.get(draft.product_key)?.category ?? 'unknown',
    ),
    approved_rejected_overlap: {
      approved_range: approved.length
        ? [
            Math.min(...approved.map((item) => item.judge.overall_score)),
            Math.max(...approved.map((item) => item.judge.overall_score)),
          ]
        : null,
      rejected_range: rejected.length
        ? [
            Math.min(...rejected.map((item) => item.judge.overall_score)),
            Math.max(...rejected.map((item) => item.judge.overall_score)),
          ]
        : null,
    },
    false_positive_examples: rejected
      .filter((item) => item.judge.overall_score >= midpoint)
      .map((item) => item.draft_id),
    false_negative_examples: approved
      .filter((item) => item.judge.overall_score < midpoint)
      .map((item) => item.draft_id),
    score_correlation_with_human_labels: pearsonCorrelation(
      labels.map((item) => [item.judge.overall_score, item.human_label === 'approve' ? 1 : 0]),
    ),
    drafts: drafts.map((draft) => ({
      draft_id: draft.draft_id,
      product: productMap.get(draft.product_key)?.name ?? draft.product_key,
      category: productMap.get(draft.product_key)?.category ?? 'unknown',
      angle: draft.angle,
      text: draft.text,
      scores: draft.judge.scores,
      overall_score: draft.judge.overall_score,
      hard_fails: draft.policy.failures,
      judge_explanation: draft.judge.reasons,
      model: draft.judge.model,
      prompt_version: draft.judge.prompt_version,
      human_label: draft.human_label,
    })),
  };
  await store.writeJson('reports/calibration/latest.json', report);
  return report;
}

export async function publishDue(
  campaigns: Campaign[],
  drafts: Draft[],
  deps: PipelineDependencies,
): Promise<Campaign[]> {
  const draftMap = new Map(drafts.map((item) => [item.draft_id, item]));
  const published: Campaign[] = [];
  for (const campaign of campaigns.filter((item) => item.status === 'publishing')) {
    const draft = draftMap.get(campaign.draft_id);
    if (!draft || !dispatchEligible(draft, drafts, deps.config)) continue;
    const receipt = await deps.store
      .readJson(`data/state/publications/${campaign.campaign_id}.json`, publicationReceiptSchema)
      .catch(() => null);
    if (!receipt || receipt.draft_id !== draft.draft_id) continue;
    if (receipt.text_hash !== draft.text_hash) continue;
    if (receipt.status === 'publication_unknown')
      throw new PublishSafetyError(
        `Publication outcome is unknown for ${campaign.campaign_id}; reconcile manually before retry.`,
      );
    let result: { postId: string; permalink: string | null };
    try {
      result =
        receipt.status === 'published' && receipt.post_id
          ? { postId: receipt.post_id, permalink: receipt.permalink }
          : await deps.threads.publishContainer(receipt.container_id);
    } catch (error) {
      await deps.store.writeJson(`data/state/publications/${campaign.campaign_id}.json`, {
        ...receipt,
        status: 'publication_unknown',
        updated_at: deps.now().toISOString(),
      });
      throw error;
    }
    await deps.store.writeJson(`data/state/publications/${campaign.campaign_id}.json`, {
      ...receipt,
      status: 'published',
      post_id: result.postId,
      permalink: result.permalink,
      updated_at: deps.now().toISOString(),
    });
    const updated = campaignSchema.parse({
      ...campaign,
      status: 'published',
      threads_post_id: result.postId,
      permalink: result.permalink,
      published_at: deps.now().toISOString(),
    });
    published.push(updated);
    const date = kstDate(new Date(campaign.scheduled_at));
    await deps.store.writeJson(
      `data/campaigns/${date.slice(0, 4)}/${date.slice(5, 7)}/${campaign.campaign_id}.json`,
      updated,
    );
  }
  const merged = campaigns.map(
    (campaign) => published.find((item) => item.campaign_id === campaign.campaign_id) ?? campaign,
  );
  await deps.store.writeJsonl('data/runtime/campaigns.jsonl', merged);
  log('info', 'publish.dispatched', { due: published.length });
  return published;
}

export async function prepareDuePublications(
  campaigns: Campaign[],
  drafts: Draft[],
  deps: PipelineDependencies,
): Promise<Campaign[]> {
  if (deps.config.publishing.mode === 'calibration') {
    log('info', 'publish.prepared', { prepared: 0, reason: 'calibration_mode' });
    return [];
  }
  const draftMap = new Map(drafts.map((draft) => [draft.draft_id, draft]));
  const storefront = await deps.store.readJson(
    'data/storefront/offers.json',
    z.object({ offers: z.array(z.object({ campaign_id: z.string(), offer_code: z.number() })) }),
  );
  if (deps.config.publishing.require_storefront_deployment_receipt) {
    const receipt = await deps.store
      .readJson(
        'data/state/storefront-deployment.json',
        z.object({ schema_version: z.literal(1), data_hash: z.string().length(64) }),
      )
      .catch(() => null);
    const currentHash = createHash('sha256')
      .update(await readFile(deps.store.path('data/storefront/offers.json')))
      .digest('hex');
    if (!receipt || receipt.data_hash !== currentHash)
      throw new PublishSafetyError('Current storefront data has not been successfully deployed.');
  }
  const readyOffers = new Set(storefront.offers.map((offer) => offer.campaign_id));
  const prepared: Campaign[] = [];
  for (const campaign of campaigns.filter(
    (item) => item.status === 'queued' && new Date(item.scheduled_at) <= deps.now(),
  )) {
    const draft = draftMap.get(campaign.draft_id);
    if (!draft || !dispatchEligible(draft, drafts, deps.config)) continue;
    if (!readyOffers.has(campaign.campaign_id))
      throw new PublishSafetyError(`Storefront offer is not ready for ${campaign.campaign_id}`);
    const textHash = draft.text_hash;
    const existing = await deps.store
      .readJson(`data/state/publications/${campaign.campaign_id}.json`, publicationReceiptSchema)
      .catch(() => null);
    if (existing && (existing.draft_id !== draft.draft_id || existing.text_hash !== textHash))
      continue;
    const containerId =
      existing?.container_id ?? (await deps.threads.createTextContainer(draft.text));
    await deps.store.writeJson(
      `data/state/publications/${campaign.campaign_id}.json`,
      existing ?? {
        schema_version: 1,
        campaign_id: campaign.campaign_id,
        draft_id: draft.draft_id,
        text_hash: textHash,
        container_id: containerId,
        status: 'container_created',
        post_id: null,
        permalink: null,
        updated_at: deps.now().toISOString(),
      },
    );
    const updated = campaignSchema.parse({ ...campaign, status: 'publishing' });
    prepared.push(updated);
    const date = kstDate(new Date(campaign.scheduled_at));
    await deps.store.writeJson(
      `data/campaigns/${date.slice(0, 4)}/${date.slice(5, 7)}/${campaign.campaign_id}.json`,
      updated,
    );
  }
  const merged = campaigns.map(
    (campaign) => prepared.find((item) => item.campaign_id === campaign.campaign_id) ?? campaign,
  );
  await deps.store.writeJsonl('data/runtime/campaigns.jsonl', merged);
  log('info', 'publish.prepared', { prepared: prepared.length });
  return prepared;
}

export async function collectAndAnalyze(
  campaigns: Campaign[],
  deps: PipelineDependencies,
  include: { threads: boolean; coupang: boolean } = { threads: true, coupang: true },
): Promise<{
  threads: ThreadsEvent[];
  coupang: CoupangEvent[];
  analytics: Record<string, unknown>;
}> {
  const date = kstDate(deps.now());
  const threads: ThreadsEvent[] = [];
  const priorThreadEvents = await deps.store.readJsonlTree(
    'data/events/threads',
    threadsEventSchema,
  );
  for (const campaign of include.threads ? campaigns.filter((item) => item.threads_post_id) : []) {
    if (!campaign.published_at) continue;
    const ageHours = (deps.now().getTime() - new Date(campaign.published_at).getTime()) / 3_600_000;
    const sampledWindows = priorThreadEvents
      .filter((event) => event.campaign_id === campaign.campaign_id)
      .map(
        (event) =>
          (new Date(event.sampled_at).getTime() -
            new Date(campaign.published_at as string).getTime()) /
          3_600_000,
      );
    const due = deps.config.metrics.threads_windows_hours.some(
      (window) => ageHours >= window && !sampledWindows.some((sampled) => sampled >= window),
    );
    if (!due) continue;
    const event = threadsEventSchema.parse(
      await deps.threads.getInsights(campaign.threads_post_id as string, campaign.campaign_id),
    );
    threads.push(event);
    await deps.store.appendJsonl(
      `data/events/threads/${date.slice(0, 4)}/${date.slice(5, 7)}/${date}.jsonl`,
      event,
    );
  }
  const hourKst = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: deps.config.timezone,
      hour: '2-digit',
      hour12: false,
    }).format(deps.now()),
  );
  const rawCoupang =
    include.coupang && hourKst === deps.config.metrics.coupang_collection_hour_kst
      ? (await reserveCoupangCalls(deps, 'report', 3),
        await deps.coupang.collectPerformance(date.replaceAll('-', ''), date.replaceAll('-', '')))
      : [];
  const coupang = rawCoupang.map((event, index) =>
    coupangEventSchema.parse({
      ...event,
      event_id: createEntityId('cpe', `${event.event_id}:${index}`),
    }),
  );
  for (const event of coupang)
    await deps.store.appendJsonl(
      `data/events/coupang/${date.slice(0, 4)}/${date.slice(5, 7)}/${date}.jsonl`,
      event,
    );
  const analytics = await buildAnalyticsProjection(campaigns, deps.store, deps.now);
  return { threads, coupang, analytics };
}

export async function buildAnalyticsProjection(
  campaigns: Campaign[],
  store: RepositoryStore,
  now: () => Date,
): Promise<Record<string, unknown>> {
  const storedThreads = await store.readJsonlTree('data/events/threads', threadsEventSchema);
  const latestThreads = new Map<string, ThreadsEvent>();
  for (const event of storedThreads) {
    const prior = latestThreads.get(event.campaign_id);
    if (!prior || event.sampled_at > prior.sampled_at) latestThreads.set(event.campaign_id, event);
  }
  const storedCoupang = await store.readJsonlTree('data/events/coupang', coupangEventSchema);
  const latestCoupangPeriods = new Map<string, CoupangEvent>();
  const knownCampaignIds = new Set(campaigns.map((campaign) => campaign.campaign_id));
  let unmappedEvents = 0;
  for (const event of storedCoupang) {
    if (!knownCampaignIds.has(event.campaign_id)) {
      unmappedEvents += 1;
      continue;
    }
    const key = `${event.campaign_id}:${event.source_period}`;
    const prior = latestCoupangPeriods.get(key);
    latestCoupangPeriods.set(key, {
      ...event,
      clicks: event.clicks ?? prior?.clicks ?? null,
      orders: event.orders ?? prior?.orders ?? null,
      commission_krw: event.commission_krw ?? prior?.commission_krw ?? null,
    });
  }
  const coupangByCampaign = new Map<
    string,
    { clicks: number; orders: number; commission_krw: number }
  >();
  for (const event of latestCoupangPeriods.values()) {
    const aggregate = coupangByCampaign.get(event.campaign_id) ?? {
      clicks: 0,
      orders: 0,
      commission_krw: 0,
    };
    aggregate.clicks += event.clicks ?? 0;
    aggregate.orders += event.orders ?? 0;
    aggregate.commission_krw += event.commission_krw ?? 0;
    coupangByCampaign.set(event.campaign_id, aggregate);
  }
  const totals = {
    threads_views: [...latestThreads.values()].reduce((sum, item) => sum + (item.views ?? 0), 0),
    coupang_clicks: [...coupangByCampaign.values()].reduce((sum, item) => sum + item.clicks, 0),
    orders: [...coupangByCampaign.values()].reduce((sum, item) => sum + item.orders, 0),
    commission_krw: [...coupangByCampaign.values()].reduce(
      (sum, item) => sum + item.commission_krw,
      0,
    ),
  };
  const analytics = {
    schema_version: 1,
    generated_at: now().toISOString(),
    campaigns: campaigns.length,
    unmapped_coupang_events: unmappedEvents,
    totals,
    metrics: calculateBusinessMetrics(
      totals.threads_views,
      totals.coupang_clicks,
      totals.orders,
      totals.commission_krw,
    ),
    segments: campaigns.map((campaign) => {
      const social = latestThreads.get(campaign.campaign_id);
      const commerce = coupangByCampaign.get(campaign.campaign_id);
      const metrics = calculateBusinessMetrics(
        social?.views ?? null,
        commerce?.clicks ?? null,
        commerce?.orders ?? null,
        commerce?.commission_krw ?? null,
      );
      return {
        campaign_id: campaign.campaign_id,
        vertical: campaign.category.startsWith('apple') ? 'apple' : 'ergonomic_core',
        category: campaign.category,
        product: campaign.product_key,
        angle: campaign.angle,
        hook_style: campaign.hook_style,
        cta_variant: campaign.cta_variant,
        publishing_slot: campaign.scheduled_at.slice(11, 16),
        founder_experience_supported: campaign.founder_experience_supported,
        engine: campaign.engine,
        judge_overall: campaign.judge_overall,
        threads_views: social?.views ?? null,
        coupang_clicks: commerce?.clicks ?? null,
        orders: commerce?.orders ?? null,
        commission_krw: commerce?.commission_krw ?? null,
        ...metrics,
      };
    }),
  };
  await store.writeJson('data/analytics/latest.json', analytics);
  await store.writeJson('reports/analytics/latest.json', analytics);
  return analytics;
}

export async function buildStorefront(
  products: Product[],
  campaigns: Campaign[],
  store: RepositoryStore,
  now: () => Date,
  disclosure: string,
): Promise<void> {
  const productMap = new Map(products.map((item) => [item.product_key, item]));
  const offers = campaigns
    .filter((campaign) => ['queued', 'publishing', 'published'].includes(campaign.status))
    .map((campaign) => ({
      offer_code: campaign.offer_code,
      campaign_id: campaign.campaign_id,
      product: productMap.get(campaign.product_key)?.name ?? campaign.product_key,
      category: campaign.category,
      price_krw: productMap.get(campaign.product_key)?.price_krw ?? null,
      captured_at: productMap.get(campaign.product_key)?.captured_at ?? null,
      image_url: productMap.get(campaign.product_key)?.image_url ?? null,
      affiliate_url: campaign.affiliate_url,
      recommended: campaign.status === 'published',
      detail: '확인된 상품 정보와 캠페인 기록을 바탕으로 표시합니다.',
    }));
  await store.writeJson('data/storefront/offers.json', {
    schema_version: 1,
    generated_at: now().toISOString(),
    disclosure,
    offers,
  });
}

export async function runDryRun(
  deps: PipelineDependencies,
  products: Product[],
  experience: ExperienceDatabase,
): Promise<Record<string, unknown>> {
  await rm(deps.store.root, { recursive: true, force: true });
  await mkdir(deps.store.root, { recursive: true });
  const ingested = products.map(normalizeProduct);
  const date = kstDate(deps.now());
  for (const product of ingested)
    await deps.store.appendJsonl(
      `data/products/snapshots/${date.slice(0, 4)}/${date.slice(5, 7)}/${date}.jsonl`,
      productSchema.parse(product),
    );
  await deps.store.writeJson('data/state/counters.json', {
    schema_version: 1,
    next_offer_code: 100,
  });
  const executionDeps: PipelineDependencies = {
    ...deps,
    config: {
      ...deps.config,
      publishing: {
        ...deps.config.publishing,
        mode: 'human_approved',
        require_storefront_deployment_receipt: false,
      },
      metrics: {
        ...deps.config.metrics,
        coupang_collection_hour_kst: Number(
          new Intl.DateTimeFormat('en-US', {
            timeZone: deps.config.timezone,
            hour: '2-digit',
            hour12: false,
          }).format(deps.now()),
        ),
      },
    },
  };
  const { drafts, campaigns } = await planContent(ingested, executionDeps, experience, {
    fixture: true,
    approveCount: 4,
  });
  const queue = queueSchema.parse({
    schema_version: 1,
    date_kst: date,
    items: campaigns
      .filter((item) => item.status === 'queued')
      .map((item) => ({
        campaign_id: item.campaign_id,
        draft_id: item.draft_id,
        due_at: item.scheduled_at,
        state: 'pending',
      })),
  });
  await deps.store.writeJson(`data/queues/${date}.json`, queue);
  const prepared = await prepareDuePublications(campaigns, drafts, executionDeps);
  const preparedCampaigns = campaigns.map(
    (campaign) => prepared.find((item) => item.campaign_id === campaign.campaign_id) ?? campaign,
  );
  const published = await publishDue(preparedCampaigns, drafts, executionDeps);
  const allCampaigns = campaigns.map(
    (campaign) => published.find((item) => item.campaign_id === campaign.campaign_id) ?? campaign,
  );
  await buildStorefront(ingested, allCampaigns, deps.store, deps.now, deps.config.disclosure.text);
  const metrics = await collectAndAnalyze(published, {
    ...executionDeps,
    now: () => new Date(deps.now().getTime() + 8 * 24 * 3_600_000),
  });
  const manifest = {
    schema_version: 1,
    generated_at: deps.now().toISOString(),
    products: ingested.length,
    analyzed_candidates: ingested.length,
    angles: drafts.length,
    drafts: drafts.length,
    judge_scores: drafts.length,
    hard_fail_results: drafts.filter((item) => item.policy.hard_fail).length,
    campaigns: campaigns.length,
    queued: queue.items.length,
    published: published.length,
    threads_events: metrics.threads.length,
    coupang_events: metrics.coupang.length,
    analytics_report: 'reports/analytics/latest.json',
    storefront_data: 'data/storefront/offers.json',
  };
  await deps.store.writeJson('reports/dry-run/manifest.json', manifest);
  log('info', 'pipeline.dry_run.complete', manifest);
  return manifest;
}
