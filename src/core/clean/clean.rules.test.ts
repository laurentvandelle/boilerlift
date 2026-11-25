import { describe, expect, test } from 'vitest';
import { decideCleanGroups } from '#src/core/clean/clean.rules';
import { fakeLocalWorkflow, fakeStableName } from '#src/core/compile/workflow.fake';
import { fakeManaged } from '#src/core/lock/lock-file.fake';
import { fakeN8nWorkflow, fakeWorkflowId } from '#src/core/n8n/n8n.fake';
import { WorkflowToRemove } from '#src/core/removal/removal.model';

const CRM = fakeLocalWorkflow('crm-import', { path: 'workflows/crm-import.json' });
const HAND_MADE = fakeLocalWorkflow('hand-made', { name: 'Hand made' });
const MANAGED = fakeManaged({ 'crm-import': 'crm1', 'old-report': 'old1' });

describe('decideCleanGroups', () => {
  test('Should keep the removed workflows as read when it sorts the groups', () => {
    const removed: WorkflowToRemove[] = [{ stableName: fakeStableName('old-report'), id: fakeWorkflowId('old1'), state: 'not-found' }];

    const groups = decideCleanGroups({ managed: MANAGED, files: [] }, removed, []);

    expect(groups.removed).toEqual(removed);
  });

  test('Should list the local files with no lock entry as not deployed, by stable name, when they were never deployed', () => {
    const files = ['workflows/zeta.json', CRM.path, 'workflows/alpha.json'];

    const groups = decideCleanGroups({ managed: MANAGED, files }, [], []);

    expect(groups.notDeployed).toEqual([
      { stableName: 'alpha', path: 'workflows/alpha.json' },
      { stableName: 'zeta', path: 'workflows/zeta.json' },
    ]);
  });

  test('Should leave out a file whose name is not a stable name when it lists the files not deployed', () => {
    const groups = decideCleanGroups({ managed: MANAGED, files: ['workflows/Not A Name.json'] }, [], []);

    expect(groups.notDeployed).toEqual([]);
  });

  test('Should list the workflows the lock file does not record, archived ones left out, when it reads the instance', () => {
    const listed = [
      fakeN8nWorkflow(CRM, { id: 'crm1' }),
      fakeN8nWorkflow(HAND_MADE, { id: 'h1' }),
      fakeN8nWorkflow(HAND_MADE, { id: 'h2', name: 'Old hand made', isArchived: true }),
    ];

    const groups = decideCleanGroups({ managed: MANAGED, files: [] }, [], listed);

    expect(groups.unmanaged).toEqual([{ id: 'h1', name: 'Hand made' }]);
  });
});
