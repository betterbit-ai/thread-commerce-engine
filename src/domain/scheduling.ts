import type { Campaign, Draft } from './schemas.js';
import type { AppConfig } from '../config.js';
import { percentileCutoff } from './scoring.js';

export function kstDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function kstSlotToInstant(dateKst: string, time: string): string {
  const [hour = '00', minute = '00'] = time.split(':');
  return new Date(`${dateKst}T${hour}:${minute}:00+09:00`).toISOString();
}

export function isDue(iso: string, now = new Date()): boolean {
  return new Date(iso).getTime() <= now.getTime();
}

export function isWarmupComplete(config: AppConfig, now = new Date()): boolean {
  const start = new Date(`${config.publishing.warmup_started_at}T00:00:00+09:00`);
  const finish = start.getTime() + config.publishing.warmup_days * 86400000;
  return now.getTime() >= finish;
}

export function eligibleDrafts(drafts: Draft[], config: AppConfig): Draft[] {
  const safe = drafts.filter((draft) => !draft.policy.hard_fail);
  if (config.publishing.mode === 'calibration') return [];
  if (config.publishing.mode === 'human_approved')
    return safe.filter((draft) => draft.human_label === 'approve');
  if (
    !config.publishing.absolute_threshold.enabled &&
    !config.publishing.percentile_threshold.enabled
  )
    return safe;
  const percentile = config.publishing.percentile_threshold.value;
  const cutoff =
    config.publishing.percentile_threshold.enabled && percentile !== null
      ? percentileCutoff(
          safe.map((item) => item.judge.overall_score),
          percentile,
        )
      : null;
  return safe.filter((draft) => {
    const absoluteOk =
      !config.publishing.absolute_threshold.enabled ||
      (config.publishing.absolute_threshold.value !== null &&
        draft.judge.overall_score >= config.publishing.absolute_threshold.value);
    const percentileOk =
      !config.publishing.percentile_threshold.enabled ||
      (cutoff !== null && draft.judge.overall_score >= cutoff);
    return absoluteOk && percentileOk;
  });
}

export function dueCampaigns(campaigns: Campaign[], now: Date): Campaign[] {
  return campaigns.filter(
    (campaign) => campaign.status === 'queued' && isDue(campaign.scheduled_at, now),
  );
}
