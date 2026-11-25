import { CredentialsFile } from '#src/core/compile/credential.model';
import { describe, expect, test } from 'vitest';
import { fakeLocalWorkflow, fakeWorkflowFile, fakeWorkflowLoader } from '#src/core/compile/workflow.fake';
import { ProjectConfig } from '#src/core/config/config.model';
import { FAKE_INSTANCE, fakeLockStore, fakeLockText } from '#src/core/lock/lock-file.fake';
import { fakeConnectedTarget, fakeN8n, fakeN8nWorkflow } from '#src/core/n8n/n8n.fake';
import { StatusFilter } from '#src/core/status/status.model';
import { readStatusTargets } from '#src/core/status/status-targets';

/** A project with no credential list. */
const NO_LISTS = (): Promise<CredentialsFile[]> => Promise.resolve([]);

const WEEKLY = fakeLocalWorkflow('weekly', { path: 'staging/weekly.json' });
const FILTER: StatusFilter = { managed: true, unmanaged: false, archived: false };

/** dev and staging share FAKE_INSTANCE, with the folders ./dev and ./staging. */
function sharedInstance(): ProjectConfig {
  return {
    targets: [
      { name: 'dev', url: FAKE_INSTANCE, apiKey: 'secret', workflows: './dev', tag: true },
      { name: 'staging', url: FAKE_INSTANCE, apiKey: 'secret', workflows: './staging', tag: true },
    ],
  };
}

function devTarget(): ReturnType<typeof fakeConnectedTarget> {
  return fakeConnectedTarget('dev', fakeN8n({ workflows: [fakeN8nWorkflow(WEEKLY, { id: 'wk1' })] }).client, { workflows: './dev' });
}

describe('readStatusTargets', () => {
  test('Should not show a workflow as removed when another target on the same instance still has its file', async () => {
    const loadWorkflowFiles = fakeWorkflowLoader({ './staging': [fakeWorkflowFile(WEEKLY)] });

    const [status] = await readStatusTargets(
      { config: sharedInstance(), targets: [devTarget()], filter: FILTER },
      { loadCredentialsFiles: NO_LISTS, loadWorkflowFiles, lock: fakeLockStore({ text: fakeLockText({ weekly: 'wk1' }) }).store },
    );

    expect(status?.kind === 'report' ? status.report.workflows.map(({ state }) => state) : status?.kind).toEqual([]);
  });

  test('Should show a workflow as removed when no folder on its instance has its file any more', async () => {
    const [status] = await readStatusTargets(
      { config: sharedInstance(), targets: [devTarget()], filter: FILTER },
      { loadCredentialsFiles: NO_LISTS, loadWorkflowFiles: fakeWorkflowLoader({}), lock: fakeLockStore({ text: fakeLockText({ weekly: 'wk1' }) }).store },
    );

    expect(status?.kind === 'report' ? [status.report.workflows.map(({ state }) => state), status.empty] : status?.kind).toEqual([['removed'], true]);
  });

  test('Should give the lock file error and read nothing on the instance when the lock file is invalid', async () => {
    const n8n = fakeN8n();

    const statuses = await readStatusTargets(
      { config: sharedInstance(), targets: [fakeConnectedTarget('dev', n8n.client, { workflows: './dev' })], filter: FILTER },
      { loadCredentialsFiles: NO_LISTS, loadWorkflowFiles: fakeWorkflowLoader({}), lock: fakeLockStore({ text: '{ not json' }).store },
    );

    expect([statuses.map(({ kind }) => kind), n8n.calls]).toEqual([['invalid-lock-file'], []]);
  });

  test('Should go on to the next target when a workflow file of one target does not load', async () => {
    const loadWorkflowFiles = fakeWorkflowLoader({ './dev': [{ path: 'dev/broken.json', error: 'unexpected token' }] });
    const staging = fakeConnectedTarget('staging', fakeN8n().client, { workflows: './staging' });

    const statuses = await readStatusTargets(
      { config: sharedInstance(), targets: [devTarget(), staging], filter: FILTER },
      { loadCredentialsFiles: NO_LISTS, loadWorkflowFiles, lock: fakeLockStore().store },
    );

    expect(statuses.map(({ kind }) => kind)).toEqual(['invalid-files', 'report']);
  });
});
