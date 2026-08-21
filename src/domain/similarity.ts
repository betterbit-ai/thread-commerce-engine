function ngrams(text: string, size = 3): Set<string> {
  const normalized = text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  const values = new Set<string>();
  for (let index = 0; index <= normalized.length - size; index += 1)
    values.add(normalized.slice(index, index + size));
  return values;
}

export function jaccardSimilarity(left: string, right: string): number {
  const a = ngrams(left);
  const b = ngrams(right);
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

export function mostSimilar(
  text: string,
  corpus: string[],
): { similarity: number; index: number | null } {
  return corpus.reduce(
    (best, candidate, index) => {
      const similarity = jaccardSimilarity(text, candidate);
      return similarity > best.similarity ? { similarity, index } : best;
    },
    { similarity: 0, index: null } as { similarity: number; index: number | null },
  );
}
