import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const offerSchema = z.object({
  offer_code: z.number().int().positive(),
  campaign_id: z.string(),
  product: z.string(),
  category: z.string(),
  price_krw: z.number().int().nonnegative().nullable(),
  captured_at: z.string().datetime().nullable(),
  image_url: z.string().url().nullable(),
  affiliate_url: z.string().url(),
  recommended: z.boolean(),
  detail: z.string(),
});

const storefrontSchema = z.object({
  schema_version: z.literal(1),
  generated_at: z.string().datetime().nullable(),
  disclosure: z.string().min(10),
  offers: z.array(offerSchema),
});

const customDataPath = process.env.STOREFRONT_DATA_PATH;
const dataPath = resolve(customDataPath ?? 'data/storefront/offers.json');
const generated = storefrontSchema.parse(JSON.parse(readFileSync(dataPath, 'utf8')));
const manual = customDataPath
  ? { offers: [] }
  : storefrontSchema.parse(
      JSON.parse(readFileSync(resolve('data/storefront/manual-offers.json'), 'utf8')),
    );
const mergedOffers = new Map(
  [...generated.offers, ...manual.offers].map((offer) => [offer.offer_code, offer]),
);
export const storefrontData = {
  ...generated,
  offers: [...mergedOffers.values()],
};
