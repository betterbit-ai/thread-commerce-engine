import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { productSchema } from '../../src/domain/schemas.js';
import { FixtureCoupang, FixtureLlm, FixtureThreads } from '../../src/infrastructure/fixtures.js';
import { RepositoryStore } from '../../src/infrastructure/repository.js';
import {
  buildStorefront,
  applyHumanLabels,
  hydrateDraftLabels,
  planContent,
  prepareDuePublications,
  publishDue,
} from '../../src/application/pipeline.js';
import { PublishSafetyError } from '../../src/shared/errors.js';

const emptyExperience = { schema_version: 1 as const, experiences: [] };

describe('selection and dispatch invariants', () => {
  it('rebinds a campaign to an approved non-first draft', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tce-selection-'));
    const products = productSchema
      .array()
      .parse(JSON.parse(await readFile(resolve('tests/fixtures/products.json'), 'utf8')));
    const product = products[0]!;
    const base = await loadConfig();
    const config = {
      ...base,
      publishing: {
        ...base.publishing,
        mode: 'human_approved' as const,
        require_storefront_deployment_receipt: false,
      },
    };
    const time = () => new Date('2026-08-21T14:00:00.000Z');
    const store = new RepositoryStore(root);
    const deps = {
      coupang: new FixtureCoupang([product], time),
      llm: new FixtureLlm({}),
      threads: new FixtureThreads(time),
      store,
      config,
      now: time,
    };
    await store.writeJson('data/state/counters.json', { schema_version: 1, next_offer_code: 100 });
    const first = await planContent([product], deps, emptyExperience, { fixture: true });
    const approved = first.drafts[1]!;
    await store.appendJsonl('data/labels/human_labels.jsonl', {
      schema_version: 1,
      draft_id: approved.draft_id,
      label: 'approve',
      labeled_at: time().toISOString(),
      notes: 'select the second candidate',
    });
    const second = await planContent([product], deps, emptyExperience, { fixture: true });
    expect(second.campaigns[0]).toMatchObject({ draft_id: approved.draft_id, status: 'queued' });
    expect(second.campaigns[0]?.offer_code).toBe(first.campaigns[0]?.offer_code);
  });

  it('permits safe unlabeled auto drafts but calibration blocks an old queue', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tce-modes-'));
    const products = productSchema
      .array()
      .parse(JSON.parse(await readFile(resolve('tests/fixtures/products.json'), 'utf8')));
    const product = products[0]!;
    const base = await loadConfig();
    const time = () => new Date('2026-08-21T14:00:00.000Z');
    const store = new RepositoryStore(root);
    await store.writeJson('data/state/counters.json', { schema_version: 1, next_offer_code: 100 });
    const calibrationDeps = {
      coupang: new FixtureCoupang([product], time),
      llm: new FixtureLlm({}),
      threads: new FixtureThreads(time),
      store,
      config: base,
      now: time,
    };
    const planned = await planContent([product], calibrationDeps, emptyExperience, {
      fixture: true,
    });
    const campaign = { ...planned.campaigns[0]!, status: 'queued' as const };
    await expect(
      prepareDuePublications([campaign], planned.drafts, calibrationDeps),
    ).resolves.toEqual([]);
    const autoDeps = {
      ...calibrationDeps,
      config: {
        ...base,
        publishing: {
          ...base.publishing,
          mode: 'auto' as const,
          require_storefront_deployment_receipt: false,
          absolute_threshold: { enabled: true, value: 0 },
        },
      },
    };
    await buildStorefront([product], [campaign], store, time, base.disclosure.text);
    await expect(
      prepareDuePublications([campaign], planned.drafts, autoDeps),
    ).resolves.toHaveLength(1);
    const tightenedDeps = {
      ...autoDeps,
      config: {
        ...autoDeps.config,
        publishing: {
          ...autoDeps.config.publishing,
          absolute_threshold: { enabled: true, value: 100 },
        },
      },
    };
    await expect(
      prepareDuePublications([campaign], planned.drafts, tightenedDeps),
    ).resolves.toEqual([]);
  });
  it('binds a human approval to the immutable reviewed text revision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tce-label-revision-'));
    const product = productSchema
      .array()
      .parse(JSON.parse(await readFile(resolve('tests/fixtures/products.json'), 'utf8')))[0]!;
    const base = await loadConfig();
    const config = {
      ...base,
      publishing: {
        ...base.publishing,
        mode: 'human_approved' as const,
        require_storefront_deployment_receipt: false,
      },
    };
    const time = () => new Date('2026-08-21T14:00:00.000Z');
    const store = new RepositoryStore(root);
    const deps = {
      coupang: new FixtureCoupang([product], time),
      llm: new FixtureLlm({}),
      threads: new FixtureThreads(time),
      store,
      config,
      now: time,
    };
    await store.writeJson('data/state/counters.json', { schema_version: 1, next_offer_code: 100 });
    const planned = await planContent([product], deps, emptyExperience, { fixture: true });
    const reviewed = planned.drafts[1]!;
    await store.appendJsonl('data/labels/human_labels.jsonl', {
      schema_version: 1,
      draft_id: reviewed.draft_id,
      label: 'approve',
      labeled_at: time().toISOString(),
      notes: null,
    });
    const changedRevision = {
      ...reviewed,
      draft_id: `${reviewed.draft_id}-changed`,
      text: `${reviewed.text} changed`,
      text_hash: 'b'.repeat(64),
      human_label: null,
    };
    const hydrated = await hydrateDraftLabels([reviewed, changedRevision], store);
    expect(hydrated.map((draft) => draft.human_label)).toEqual(['approve', null]);
    const projected = await applyHumanLabels(planned.drafts, planned.campaigns, deps);
    expect(projected.campaigns[0]).toMatchObject({
      draft_id: reviewed.draft_id,
      status: 'queued',
    });
  });
  it('quarantines an ambiguous publish outcome instead of retrying blindly', async () => {
    class FailingThreads extends FixtureThreads {
      override async publishContainer(): Promise<never> {
        throw new Error('simulated timeout after request');
      }
    }
    const root = await mkdtemp(join(tmpdir(), 'tce-unknown-'));
    const product = productSchema
      .array()
      .parse(JSON.parse(await readFile(resolve('tests/fixtures/products.json'), 'utf8')))[0]!;
    const base = await loadConfig();
    const config = {
      ...base,
      publishing: {
        ...base.publishing,
        mode: 'human_approved' as const,
        require_storefront_deployment_receipt: false,
      },
    };
    const time = () => new Date('2026-08-21T14:00:00.000Z');
    const store = new RepositoryStore(root);
    const deps = {
      coupang: new FixtureCoupang([product], time),
      llm: new FixtureLlm({}),
      threads: new FailingThreads(time),
      store,
      config,
      now: time,
    };
    await store.writeJson('data/state/counters.json', {
      schema_version: 1,
      next_offer_code: 100,
    });
    const planned = await planContent([product], deps, emptyExperience, {
      fixture: true,
      approveCount: 1,
    });
    const prepared = await prepareDuePublications(planned.campaigns, planned.drafts, deps);
    await expect(publishDue(prepared, planned.drafts, deps)).rejects.toThrow('simulated timeout');
    const receiptText = await readFile(
      store.path(`data/state/publications/${prepared[0]!.campaign_id}.json`),
      'utf8',
    );
    expect(JSON.parse(receiptText)).toMatchObject({ status: 'publication_unknown' });
    await expect(publishDue(prepared, planned.drafts, deps)).rejects.toBeInstanceOf(
      PublishSafetyError,
    );
  });
});
