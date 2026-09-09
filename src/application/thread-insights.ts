import type { ThreadsPort } from './ports.js';
import type { ThreadsEvent } from '../domain/schemas.js';
import { kstDate } from '../domain/scheduling.js';
import type { RepositoryStore } from '../infrastructure/repository.js';
import { log } from '../shared/logger.js';

export interface ThreadInsightTarget {
  campaignId: string;
  postId: string;
  stage: 'root' | 'reply_1' | 'reply_2' | 'reply_3';
}

export interface ThreadInsightFailure {
  campaign_id: string;
  post_id: string;
  stage: ThreadInsightTarget['stage'];
  message: string;
}

export async function collectThreadInsights(
  targets: ThreadInsightTarget[],
  dependencies: {
    threads: ThreadsPort;
    store: RepositoryStore;
    now: () => Date;
  },
): Promise<{ events: ThreadsEvent[]; failures: ThreadInsightFailure[] }> {
  const events: ThreadsEvent[] = [];
  const failures: ThreadInsightFailure[] = [];
  const date = kstDate(dependencies.now());
  for (const target of targets) {
    try {
      const event = await dependencies.threads.getInsights(target.postId, target.campaignId);
      events.push(event);
      await dependencies.store.appendJsonl(
        `data/events/threads/${date.slice(0, 4)}/${date.slice(5, 7)}/${date}.jsonl`,
        event,
      );
    } catch (error) {
      const failure = {
        campaign_id: target.campaignId,
        post_id: target.postId,
        stage: target.stage,
        message: error instanceof Error ? error.message : 'Unknown Threads insights error',
      };
      failures.push(failure);
      log('warn', 'threads.insights.skipped', failure);
    }
  }
  return { events, failures };
}
