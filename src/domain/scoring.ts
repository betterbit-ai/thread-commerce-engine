import type { JudgeResult } from './schemas.js';

export function weightedScore(
  scores: JudgeResult['scores'],
  weights: Record<string, number>,
): number {
  let total = 0;
  let denominator = 0;
  for (const [key, value] of Object.entries(scores)) {
    const weight = weights[key] ?? 0;
    total += value * weight;
    denominator += weight;
  }
  return denominator === 0 ? 0 : Math.round((total / denominator) * 100) / 100;
}

export function percentileCutoff(values: number[], percentile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1)] ?? null;
}
