import { CredentialsFile } from '#src/core/compile/credential.model';
import { describe, expect, test } from 'vitest';
import { fakeLocalWorkflow, fakeWorkflowFile, fakeWorkflowLoader } from '#src/core/compile/workflow.fake';
import { fakeLockStore, fakeLockText } from '#src/core/lock/lock-file.fake';
import { FakeN8n, fakeConnectedTarget, fakeN8n, fakeN8nWorkflow } from '#src/core/n8n/n8n.fake';
import { applyPublishTargets, isPublishConfirmed, planPublishTargets } from '#src/core/publish/publish-targets';

/** A project with no credential list. */
const NO_LISTS = (): Promise<CredentialsFile[]> => Promise.resolve([]);

const DEV_URL = 'https://dev.example.com';
const PROD_URL = 'https://prod.example.com';
const REPORT = fakeLocalWorkflow('daily-report', { path: 'workflows/daily-report.json' });
const FILES = fakeWorkflowLoader({ './workflows': [fakeWorkflowFile(REPORT)] });

/** An instance where REPORT, recorded as `id`, has a draft waiting to be published. */
function pending(id: string): FakeN8n {
  return fakeN8n({ workflows: [fakeN8nWorkflow(REPORT, { id, versionId: 'v2', activeVersionId: 'v1' })] });
}

/** A lock file that records REPORT as rep1 on dev and rep2 on prod. */
function twoInstanceLock(): string {
  return `${JSON.stringify({ version: 1, instances: { [DEV_URL]: { 'daily-report': { n8nId: 'rep1' } }, [PROD_URL]: { 'daily-report': { n8nId: 'rep2' } } } })}\n`;
}

describe('planPublishTargets', () => {
  test('Should ask for a confirmation when a draft is waiting on a target', async () => {
    const target = fakeConnectedTarget('dev', pending('rep1').client);

    const run = await planPublishTargets({ targets: [target], names: [] }, { loadCredentialsFiles: NO_LISTS, loadWorkflowFiles: FILES, lock: fakeLockStore({ text: fakeLockText({ 'daily-report': 'rep1' }) }).store });

    expect(run.kind).toBe('needs-confirmation');
  });

  test('Should not ask when no draft is waiting on any target', async () => {
    const target = fakeConnectedTarget('dev', fakeN8n({ workflows: [fakeN8nWorkflow(REPORT, { id: 'rep1' })] }).client);

    const run = await planPublishTargets({ targets: [target], names: [] }, { loadCredentialsFiles: NO_LISTS, loadWorkflowFiles: FILES, lock: fakeLockStore({ text: fakeLockText({ 'daily-report': 'rep1' }) }).store });

    expect(run.kind).toBe('ready');
  });

  test('Should hold back every target and publish nothing when a name is unknown on one of them', async () => {
    const dev = pending('rep1');
    const targets = [fakeConnectedTarget('dev', dev.client, { url: DEV_URL }), fakeConnectedTarget('prod', fakeN8n().client, { url: PROD_URL })];

    const run = await planPublishTargets({ targets, names: ['daily-report'] }, { loadCredentialsFiles: NO_LISTS, loadWorkflowFiles: FILES, lock: fakeLockStore({ text: twoInstanceLock() }).store });

    expect([run.kind === 'held-back' ? run.plans.map(({ kind }) => kind) : run.kind, dev.calls.filter((call) => call.endsWith('/activate'))]).toEqual([
      ['ready', 'not-ready'],
      [],
    ]);
  });

  test('Should hold the target back with the lock file error when the lock file is invalid', async () => {
    const target = fakeConnectedTarget('dev', pending('rep1').client);

    const run = await planPublishTargets({ targets: [target], names: [] }, { loadCredentialsFiles: NO_LISTS, loadWorkflowFiles: FILES, lock: fakeLockStore({ text: '{ not json' }).store });

    expect(run.kind === 'held-back' ? run.plans.map(({ kind }) => kind) : run.kind).toEqual(['invalid-lock-file']);
  });

  test('Should hold the target back with its problems when a workflow file does not load', async () => {
    const target = fakeConnectedTarget('dev', pending('rep1').client);
    const loadWorkflowFiles = fakeWorkflowLoader({ './workflows': [{ path: 'workflows/broken.json', error: 'unexpected token' }] });

    const run = await planPublishTargets({ targets: [target], names: [] }, { loadCredentialsFiles: NO_LISTS, loadWorkflowFiles, lock: fakeLockStore().store });

    expect(run.kind === 'held-back' ? run.plans.map(({ kind }) => kind) : run.kind).toEqual(['invalid-files']);
  });
});

describe('applyPublishTargets', () => {
  test('Should publish the waiting draft on each target, in order, when every target is ready', async () => {
    const dev = pending('rep1');
    const prod = pending('rep2');
    const targets = [fakeConnectedTarget('dev', dev.client, { url: DEV_URL }), fakeConnectedTarget('prod', prod.client, { url: PROD_URL })];
    const run = await planPublishTargets({ targets, names: [] }, { loadCredentialsFiles: NO_LISTS, loadWorkflowFiles: FILES, lock: fakeLockStore({ text: twoInstanceLock() }).store });

    const published = await applyPublishTargets(run.kind === 'held-back' ? [] : run.ready);

    expect(published.map(({ target, report }) => [target.name, report.results.map(({ action }) => action)])).toEqual([
      ['dev', ['published']],
      ['prod', ['published']],
    ]);
  });
});

describe('isPublishConfirmed', () => {
  test('Should publish when the answer is empty (Enter), y or yes in any case', () => {
    const answers = ['', '  ', 'y', 'Y', 'yes', 'YES '];

    const confirmed = answers.map(isPublishConfirmed);

    expect(confirmed).toEqual([true, true, true, true, true, true]);
  });

  test('Should publish nothing when the answer is another word or stdin closed', () => {
    const answers = ['n', 'no', 'sure', undefined];

    const confirmed = answers.map(isPublishConfirmed);

    expect(confirmed).toEqual([false, false, false, false]);
  });
});
