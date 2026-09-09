import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ThreadsPort } from '../../src/application/ports.js';
import { collectThreadInsights } from '../../src/application/thread-insights.js';
import type { ThreadsEvent } from '../../src/domain/schemas.js';
import { RepositoryStore } from '../../src/infrastructure/repository.js';

describe('Threads insight collection', () => {
  it('keeps collecting when a deleted post returns an error', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tce-thread-insights-'));
    const store = new RepositoryStore(root);
    const now = () => new Date('2026-09-09T12:00:00.000Z');
    const threads: ThreadsPort = {
      checkConnectivity: async () => ({ ok: true, detail: 'ok', expiresAt: null }),
      publishText: async () => ({ postId: 'post', permalink: null }),
      createTextContainer: async () => 'container',
      publishContainer: async () => ({ postId: 'post', permalink: null }),
      getPost: async () => ({ postId: 'post', permalink: null }),
      getInsights: async (postId, campaignId): Promise<ThreadsEvent> => {
        if (postId === 'deleted') throw new Error('External API returned HTTP 400');
        return {
          schema_version: 1,
          event_id: `the_${postId}`,
          campaign_id: campaignId,
          sampled_at: now().toISOString(),
          post_id: postId,
          views: 120,
          likes: 7,
          replies: 2,
          reposts: 1,
          quotes: 0,
          shares: null,
        };
      },
      searchKeyword: async () => [],
    };

    const result = await collectThreadInsights(
      [
        { campaignId: 'warmup:deleted', postId: 'deleted', stage: 'root' },
        { campaignId: 'warmup:healthy', postId: 'healthy', stage: 'root' },
      ],
      { threads, store, now },
    );

    expect(result.events).toHaveLength(1);
    expect(result.failures).toEqual([
      {
        campaign_id: 'warmup:deleted',
        post_id: 'deleted',
        stage: 'root',
        message: 'External API returned HTTP 400',
      },
    ]);
    expect(
      (await readFile(store.path('data/events/threads/2026/09/2026-09-09.jsonl'), 'utf8'))
        .trim()
        .split('\n'),
    ).toHaveLength(1);
  });
});
