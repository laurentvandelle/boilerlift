import { describe, expect, test } from 'vitest';
import { applyCleanTargets, isCleanConfirmed, planCleanTargets } from '#src/core/clean/clean-targets';
import { fakeLocalWorkflow, fakeWorkflowFile, fakeWorkflowLoader } from '#src/core/compile/workflow.fake';
import { ProjectConfig } from '#src/core/config/config.model';
import { FAKE_INSTANCE, fakeLockStore, fakeLockText } from '#src/core/lock/lock-file.fake';
import { FakeN8n, fakeConnectedTarget, fakeN8n, fakeN8nWorkflow, unreachable } from '#src/core/n8n/n8n.fake';

const OTHER_URL = 'https://other.example.com';
const CRM = fakeLocalWorkflow('crm-import', { path: 'dev/crm-import.json' });
const OLD = fakeLocalWorkflow('old-report', { path: 'staging/old-report.json' });

/** CRM and OLD are deployed on the instance. */
function instance(): FakeN8n {
  return fakeN8n({ workflows: [fakeN8nWorkflow(CRM, { id: 'crm1' }), fakeN8nWorkflow(OLD, { id: 'old1' })] });
}

/** dev and staging share FAKE_INSTANCE, with the folders ./dev and ./staging. */
function sharedInstance(): ProjectConfig {
  return {
    targets: [
      { name: 'dev', url: FAKE_INSTANCE, apiKey: 'secret', workflows: './dev', tag: true },
      { name: 'staging', url: FAKE_INSTANCE, apiKey: 'secret', workflows: './staging', tag: true },
    ],
  };
}

function lockText(): string {
  return fakeLockText({ 'crm-import': 'crm1', 'old-report': 'old1' });
}

describe('planCleanTargets', () => {
  test('Should not count a workflow as removed when another target on the same instance still has its file', async () => {
    const dev = fakeConnectedTarget('dev', instance().client, { workflows: './dev' });
    const loadWorkflowFiles = fakeWorkflowLoader({ './dev': [fakeWorkflowFile(CRM)], './staging': [fakeWorkflowFile(OLD)] });

    const run = await planCleanTargets({ config: sharedInstance(), targets: [dev], mode: 'archive' }, { loadWorkflowFiles, lock: fakeLockStore({ text: lockText() }).store });

    expect(run.kind).toBe('nothing-to-remove');
  });

  test('Should count a workflow as removed when no folder on its instance has its file any more', async () => {
    const dev = fakeConnectedTarget('dev', instance().client, { workflows: './dev' });
    const loadWorkflowFiles = fakeWorkflowLoader({ './dev': [fakeWorkflowFile(CRM)] });

    const run = await planCleanTargets({ config: sharedInstance(), targets: [dev], mode: 'archive' }, { loadWorkflowFiles, lock: fakeLockStore({ text: lockText() }).store });

    expect(run.kind === 'needs-confirmation' ? run.ready.flatMap(({ groups }) => groups.removed.map(({ stableName }) => stableName)) : run.kind).toEqual(['old-report']);
  });

  test('Should read no target and give the lock file error when the lock file is invalid', async () => {
    const n8n = instance();

    const run = await planCleanTargets(
      { config: sharedInstance(), targets: [fakeConnectedTarget('dev', n8n.client, { workflows: './dev' })], mode: 'archive' },
      { loadWorkflowFiles: fakeWorkflowLoader({}), lock: fakeLockStore({ text: '{ not json' }).store },
    );

    expect([run.kind, n8n.calls]).toEqual(['invalid-lock-file', []]);
  });

  test('Should hold back every target when a read stops on one of them', async () => {
    const dev = fakeConnectedTarget('dev', instance().client, { workflows: './dev' });
    const other = fakeConnectedTarget('other', fakeN8n({ failures: [unreachable('GET /api/v1/workflows', 'connection refused')] }).client, { url: OTHER_URL, workflows: './other' });
    const config: ProjectConfig = { targets: [...sharedInstance().targets, { name: 'other', url: OTHER_URL, apiKey: 'secret', workflows: './other', tag: true }] };

    const run = await planCleanTargets(
      { config, targets: [dev, other], mode: 'archive' },
      { loadWorkflowFiles: fakeWorkflowLoader({ './dev': [fakeWorkflowFile(CRM)] }), lock: fakeLockStore({ text: lockText() }).store },
    );

    expect(run.kind === 'held-back' ? run.plans.map(({ kind }) => kind) : run.kind).toEqual(['ready', 'stopped']);
  });
});

describe('applyCleanTargets', () => {
  test('Should archive each removed workflow and drop its entry from the lock file when it applies the plan', async () => {
    const n8n = instance();
    const lock = fakeLockStore({ text: lockText() });
    const run = await planCleanTargets(
      { config: sharedInstance(), targets: [fakeConnectedTarget('dev', n8n.client, { workflows: './dev' })], mode: 'archive' },
      { loadWorkflowFiles: fakeWorkflowLoader({ './dev': [fakeWorkflowFile(CRM)] }), lock: lock.store },
    );

    const cleaned = run.kind === 'needs-confirmation' ? await applyCleanTargets(run, lock.store) : [];

    expect([cleaned.flatMap(({ report }) => report.results.map(({ action }) => action)), lock.recorded()]).toEqual([['archived'], { 'crm-import': 'crm1' }]);
  });
});

describe('isCleanConfirmed', () => {
  test('Should clean when the answer is y or yes in any case', () => {
    const answers = ['y', 'Y', 'yes', ' YES '];

    const confirmed = answers.map(isCleanConfirmed);

    expect(confirmed).toEqual([true, true, true, true]);
  });

  test('Should clean nothing when the answer is empty (Enter), another word or stdin closed', () => {
    const answers = ['', 'n', 'sure', undefined];

    const confirmed = answers.map(isCleanConfirmed);

    expect(confirmed).toEqual([false, false, false, false]);
  });
});
