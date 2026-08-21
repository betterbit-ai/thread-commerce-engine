import { z } from 'zod';

export const schemaVersion = z.literal(1);
export const isoDateTime = z.string().datetime({ offset: true });

export const productCategorySchema = z.enum([
  'mouse',
  'keyboard',
  'desk',
  'productivity',
  'apple_accessory',
  'apple_device',
  'irrelevant',
]);

export const productSchema = z.object({
  schema_version: schemaVersion,
  product_key: z.string().min(1),
  source: z.enum(['coupang', 'fixture', 'manual']),
  source_product_id: z.string().nullable(),
  name: z.string().min(1),
  category: productCategorySchema,
  product_url: z.string().url().nullable(),
  affiliate_url: z.string().url().nullable(),
  image_url: z.string().url().nullable(),
  price_krw: z.number().int().nonnegative().nullable(),
  captured_at: isoDateTime,
  is_rocket: z.boolean().nullable(),
  is_free_shipping: z.boolean().nullable(),
  review_count: z.number().int().nonnegative().nullable(),
  rating: z.number().min(0).max(5).nullable(),
  evidence: z.array(z.object({ field: z.string(), source: z.string(), value: z.unknown() })),
});
export type Product = z.infer<typeof productSchema>;

export const experienceSchema = z.object({
  schema_version: schemaVersion,
  experiences: z.array(
    z.object({
      product_key: z.string(),
      exact_model: z.string(),
      used: z.boolean(),
      duration: z.string().nullable(),
      environments: z.array(z.string()),
      observations: z.array(z.string()),
      negatives: z.array(z.string()),
      caveats: z.array(z.string()),
      verified_at: z.string().date(),
    }),
  ),
});
export type ExperienceDatabase = z.infer<typeof experienceSchema>;

export const analysisSchema = z.object({
  schema_version: schemaVersion,
  product_key: z.string(),
  persona_relevance: z.number().min(0).max(100),
  problem_solved: z.string().nullable(),
  likely_target: z.string().nullable(),
  price_band: z.enum(['budget', 'mid', 'premium', 'high_ticket', 'unknown']),
  category: productCategorySchema,
  developer_relevance: z.number().min(0).max(100),
  mac_compatibility: z.enum(['verified', 'unsupported', 'unknown']),
  deal_signal: z.number().min(0).max(100).nullable(),
  review_signal: z.number().min(0).max(100).nullable(),
  commission_economics: z.number().nullable(),
  content_angle_potential: z.number().min(0).max(100),
  founder_experience_supported: z.boolean(),
  evidence_quality: z.number().min(0).max(100),
});
export type ProductAnalysis = z.infer<typeof analysisSchema>;

export const angleKindSchema = z.enum([
  'pain_solution',
  'curiosity',
  'comparison',
  'who_it_is_for',
  'who_it_is_not_for',
  'firsthand_tradeoff',
  'common_mistake',
  'surprising_use',
  'setup_improvement',
  'purchase_event',
  'deal',
  'developer_workflow',
]);
export const angleSchema = z.object({
  schema_version: schemaVersion,
  angle_id: z.string(),
  product_key: z.string(),
  kind: angleKindSchema,
  premise: z.string(),
  evidence_refs: z.array(z.string()).min(1),
});
export type Angle = z.infer<typeof angleSchema>;

export const componentScoresSchema = z.object({
  hook: z.number().min(0).max(100),
  persona_fit: z.number().min(0).max(100),
  purchase_intent: z.number().min(0).max(100),
  specificity: z.number().min(0).max(100),
  authenticity: z.number().min(0).max(100),
  trust: z.number().min(0).max(100),
  cta_quality: z.number().min(0).max(100),
  policy_safety: z.number().min(0).max(100),
  redundancy: z.number().min(0).max(100),
});

export const judgeSchema = z.object({
  schema_version: schemaVersion,
  scores: componentScoresSchema,
  reasons: z.record(z.string(), z.string()),
  detected_risks: z.array(z.string()),
  hard_fail_suggestions: z.array(z.string()),
  overall_score: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1),
  improvement: z.string(),
  model: z.string(),
  prompt_version: z.string(),
});
export type JudgeResult = z.infer<typeof judgeSchema>;

export const hardFailCodeSchema = z.enum([
  'fabricated_experience',
  'unsupported_factual_claim',
  'unsupported_health_claim',
  'missing_disclosure',
  'false_scarcity',
  'unsupported_price_superlative',
  'duplicate_content',
  'broken_affiliate_url',
  'unknown_campaign_mapping',
  'policy_violation',
]);
export const policyResultSchema = z.object({
  hard_fail: z.boolean(),
  failures: z.array(z.object({ code: hardFailCodeSchema, detail: z.string() })),
});
export type PolicyResult = z.infer<typeof policyResultSchema>;

export const draftSchema = z.object({
  schema_version: schemaVersion,
  draft_id: z.string(),
  campaign_id: z.string(),
  product_key: z.string(),
  angle: angleKindSchema,
  text: z.string().min(1),
  text_hash: z.string().regex(/^[a-f0-9]{64}$/),
  offer_code: z.number().int().positive(),
  created_at: isoDateTime,
  prompt_version: z.string(),
  model: z.string(),
  input_hash: z.string(),
  judge: judgeSchema,
  policy: policyResultSchema,
  human_label: z.enum(['approve', 'reject', 'uncertain']).nullable(),
});
export type Draft = z.infer<typeof draftSchema>;

export const campaignSchema = z.object({
  schema_version: schemaVersion,
  campaign_id: z.string(),
  offer_code: z.number().int().positive(),
  product_key: z.string(),
  affiliate_url: z.string().url(),
  attribution_key: z.string(),
  draft_id: z.string(),
  engine: z.enum(['evergreen', 'opportunity']),
  category: productCategorySchema,
  angle: angleKindSchema,
  hook_style: z.string(),
  cta_variant: z.string(),
  scheduled_at: isoDateTime,
  prompt_version: z.string(),
  groq_model: z.string(),
  judge_overall: z.number(),
  founder_experience_supported: z.boolean(),
  status: z.enum(['calibration', 'queued', 'publishing', 'published', 'failed']),
  threads_post_id: z.string().nullable(),
  permalink: z.string().url().nullable(),
  published_at: isoDateTime.nullable(),
});
export type Campaign = z.infer<typeof campaignSchema>;

export const queueSchema = z.object({
  schema_version: schemaVersion,
  date_kst: z.string().date(),
  items: z.array(
    z.object({
      campaign_id: z.string(),
      draft_id: z.string(),
      due_at: isoDateTime,
      state: z.enum(['pending', 'claimed', 'published', 'failed']),
    }),
  ),
});
export type PublishQueue = z.infer<typeof queueSchema>;

export const threadsEventSchema = z.object({
  schema_version: schemaVersion,
  event_id: z.string(),
  campaign_id: z.string(),
  sampled_at: isoDateTime,
  post_id: z.string(),
  views: z.number().nonnegative().nullable(),
  likes: z.number().nonnegative().nullable(),
  replies: z.number().nonnegative().nullable(),
  reposts: z.number().nonnegative().nullable(),
  quotes: z.number().nonnegative().nullable(),
  shares: z.number().nonnegative().nullable(),
});
export type ThreadsEvent = z.infer<typeof threadsEventSchema>;

export const coupangEventSchema = z.object({
  schema_version: schemaVersion,
  event_id: z.string(),
  campaign_id: z.string(),
  sampled_at: isoDateTime,
  clicks: z.number().nonnegative().nullable(),
  orders: z.number().nonnegative().nullable(),
  commission_krw: z.number().nonnegative().nullable(),
  source_period: z.string(),
});
export type CoupangEvent = z.infer<typeof coupangEventSchema>;

export const humanLabelSchema = z.object({
  schema_version: schemaVersion,
  draft_id: z.string(),
  label: z.enum(['approve', 'reject', 'uncertain']),
  labeled_at: isoDateTime,
  notes: z.string().nullable(),
});
