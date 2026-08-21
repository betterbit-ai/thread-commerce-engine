import type { ExperienceDatabase } from './schemas.js';

export function hasExperienceEvidence(database: ExperienceDatabase, productKey: string): boolean {
  return database.experiences.some(
    (item) => item.product_key === productKey && item.used && item.observations.length > 0,
  );
}

export function experienceEvidenceText(database: ExperienceDatabase, productKey: string): string[] {
  const item = database.experiences.find((entry) => entry.product_key === productKey && entry.used);
  if (!item) return [];
  return [...item.observations, ...item.negatives, ...item.caveats];
}

export function supportsFirstPersonText(
  database: ExperienceDatabase,
  productKey: string,
  text: string,
): boolean {
  const item = database.experiences.find((entry) => entry.product_key === productKey && entry.used);
  if (!item || item.observations.length === 0) return false;
  if (/내돈내산|직접.{0,8}샀/iu.test(text)) return false;
  if (
    /몇\s*(?:달|개월|년)|\d+\s*(?:달|개월|년)/iu.test(text) &&
    (!item.duration || !text.includes(item.duration))
  )
    return false;
  if (
    /회사|사무실/iu.test(text) &&
    !item.environments.some((value) => /회사|사무실|office|work/iu.test(value))
  )
    return false;
  if (
    /우리\s*집|집에서/iu.test(text) &&
    !item.environments.some((value) => /집|home/iu.test(value))
  )
    return false;
  return [...item.observations, ...item.negatives, ...item.caveats].some((fact) =>
    text.includes(fact),
  );
}
