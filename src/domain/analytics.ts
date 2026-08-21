export interface BusinessMetrics {
  commerce_ctr: number | null;
  purchase_cvr: number | null;
  rpmv: number | null;
  engagement_rate: number | null;
  reply_rate: number | null;
}

export function calculateBusinessMetrics(
  views: number | null,
  clicks: number | null,
  orders: number | null,
  commission: number | null,
  engagement = 0,
  replies = 0,
): BusinessMetrics {
  return {
    commerce_ctr: views && clicks !== null ? clicks / views : null,
    purchase_cvr: clicks && orders !== null ? orders / clicks : null,
    rpmv: views && commission !== null ? (commission / views) * 1000 : null,
    engagement_rate: views ? engagement / views : null,
    reply_rate: views ? replies / views : null,
  };
}

export function pearsonCorrelation(pairs: Array<[number, number]>): number | null {
  if (pairs.length < 2) return null;
  const meanX = pairs.reduce((sum, [x]) => sum + x, 0) / pairs.length;
  const meanY = pairs.reduce((sum, [, y]) => sum + y, 0) / pairs.length;
  const numerator = pairs.reduce((sum, [x, y]) => sum + (x - meanX) * (y - meanY), 0);
  const dx = Math.sqrt(pairs.reduce((sum, [x]) => sum + (x - meanX) ** 2, 0));
  const dy = Math.sqrt(pairs.reduce((sum, [, y]) => sum + (y - meanY) ** 2, 0));
  return dx === 0 || dy === 0 ? null : numerator / (dx * dy);
}
