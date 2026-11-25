import { describe, expect, test } from 'vitest';
import { fakeLocalWorkflow, fakeWorkflowFile, fakeWorkflowLoader } from '#src/core/compile/workflow.fake';
import { ProjectConfig } from '#src/core/config/config.model';
import { FAKE_INSTANCE, fakeLockStore, fakeLockText } from '#src/core/lock/lock-file.fake';
import { FakeN8n, fakeConnectedTarget, fakeN8n, fakeN8nWorkflow } from '#src/core/n8n/n8n.fake';
import { applyResetTarget, isResetConfirmed, planResetTarget } from '#src/core/reset/reset-target';

const CRM = fakeLocalWorkflow('crm-import', { path: 'dev/crm-import.json' });
const SHARED = fakeLocalWorkflow('shared', { path: 'staging/shared.json' });

/** CRM and SHARED are deployed on the instance. */
function instance(): FakeN8n {
  return fakeN8n({ workflows: [fakeN8nWorkflow(CRM, { id: 'crm1' }), fakeN8nWorkflow(SHARED, { id: 'sh1' })] });
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

const FILES = fakeWorkflowLoader({ './dev': [fakeWorkflowFile(CRM)], './staging': [fakeWorkflowFile(SHARED)] });

describe('planResetTarget', () => {
  test('Should keep an entry when its file is in the folder of another target on the instance', async () => {
    const dev = fakeConnectedTarget('dev', instance().client, { workflows: './dev' });

    const run = await planResetTarget(
      { config: sharedInstance(), target: dev, mode: 'archive' },
      { loadWorkflowFiles: FILES, lock: fakeLockStore({ text: fakeLockText({ 'crm-import': 'crm1', shared: 'sh1' }) }).store },
    );

    expect(run.kind === 'needs-confirmation' ? [run.plan.workflows.map(({ stableName }) => stableName), run.plan.kept] : run.kind).toEqual([
      ['crm-import'],
      [{ target: 'staging', count: 1 }],
    ]);
  });

  test('Should say there is nothing to remove when every entry belongs to another target', async () => {
    const dev = fakeConnectedTarget('dev', instance().client, { workflows: './dev' });

    const run = await planResetTarget(
      { config: sharedInstance(), target: dev, mode: 'archive' },
      { loadWorkflowFiles: FILES, lock: fakeLockStore({ text: fakeLockText({ shared: 'sh1' }) }).store },
    );

    expect(run.kind).toBe('nothing-to-remove');
  });

  test('Should read nothing on the instance and give the lock file error when the lock file is invalid', async () => {
    const n8n = instance();

    const run = await planResetTarget(
      { config: sharedInstance(), target: fakeConnectedTarget('dev', n8n.client, { workflows: './dev' }), mode: 'archive' },
      { loadWorkflowFiles: FILES, lock: fakeLockStore({ text: '{ not json' }).store },
    );

    expect([run.kind, n8n.calls]).toEqual(['invalid-lock-file', []]);
  });
});

describe('applyResetTarget', () => {
  test('Should archive each workflow and drop its entry from the lock file when it applies the plan', async () => {
    const dev = fakeConnectedTarget('dev', instance().client, { workflows: './dev' });
    const lock = fakeLockStore({ text: fakeLockText({ 'crm-import': 'crm1', shared: 'sh1' }) });
    const run = await planResetTarget({ config: sharedInstance(), target: dev, mode: 'archive' }, { loadWorkflowFiles: FILES, lock: lock.store });

    const report = run.kind === 'needs-confirmation' ? await applyResetTarget(run, dev, lock.store) : undefined;

    expect([report?.results.map(({ action }) => action), lock.recorded()]).toEqual([['archived'], { shared: 'sh1' }]);
  });
});

describe('isResetConfirmed', () => {
  test('Should go on when the answer is the exact target name, spaces around it aside', () => {
    const answers = ['dev', ' dev '];

    const confirmed = answers.map((answer) => isResetConfirmed(answer, 'dev'));

    expect(confirmed).toEqual([true, true]);
  });

  test('Should remove nothing when the answer is yes, Enter, the name in another case or stdin closed', () => {
    const answers = ['yes', '', 'Dev', undefined];

    const confirmed = answers.map((answer) => isResetConfirmed(answer, 'dev'));

    expect(confirmed).toEqual([false, false, false, false]);
  });
});
