import { describe, expect, test } from 'vitest';
import { UNKNOWN_CREDENTIAL_TYPE, credential, defineCredentials, findCredentialUses, isCredentialMarker } from '#src/core/compile/credential';
import { fakeWorkflowFileUsing } from '#src/core/compile/credential.fake';
import { fakeNode } from '#src/core/compile/workflow.fake';

describe('credential', () => {
  test('Should store the marker under the type of its list when a list registered the key', () => {
    defineCredentials([{ key: 'gmail-sales', name: 'Gmail sales', type: 'gmailOAuth2', id: '1' }]);

    const slot = credential('gmail-sales');

    expect(slot).toEqual({ gmailOAuth2: { boilerlift: 'credential', key: 'gmail-sales' } });
  });

  test('Should store the marker under the unknown type when no list registered the key', () => {
    // @ts-expect-error -- 'never-listed' is in no list: the editor flags it, and the marker still records it.
    const slot = credential('never-listed');

    expect(slot).toEqual({ [UNKNOWN_CREDENTIAL_TYPE]: { boilerlift: 'credential', key: 'never-listed' } });
  });
});

describe('defineCredentials', () => {
  test('Should return the list unchanged when it registers it', () => {
    const list = [{ key: 'slack', name: 'Slack', type: 'slackApi', id: '2' }] as const;

    const defined = defineCredentials(list);

    expect(defined).toBe(list);
  });
});

describe('isCredentialMarker', () => {
  test('Should reject an n8n credential reference when it has an id and a name', () => {
    const reference = { id: '1', name: 'Gmail sales' };

    const marker = isCredentialMarker(reference);

    expect(marker).toBe(false);
  });
});

describe('findCredentialUses', () => {
  test('Should list each marker with its file, workflow, node, key and type when nodes use credential()', () => {
    const files = [fakeWorkflowFileUsing('workflows/invoice-sync.workflow.ts', ['gmail-sales', 'slack'], 'gmailOAuth2')];

    const uses = findCredentialUses(files);

    expect(uses).toEqual([
      { path: 'workflows/invoice-sync.workflow.ts', workflow: 'invoice-sync', node: 'Node 1', key: 'gmail-sales', type: 'gmailOAuth2' },
      { path: 'workflows/invoice-sync.workflow.ts', workflow: 'invoice-sync', node: 'Node 2', key: 'slack', type: 'gmailOAuth2' },
    ]);
  });

  test('Should skip a node when its credentials are n8n references', () => {
    const node = fakeNode({ credentials: { gmailOAuth2: { id: '1', name: 'Gmail sales' } } });
    const files = [{ path: 'workflows/a.json', content: { name: 'A', nodes: [node], connections: {} } }];

    const uses = findCredentialUses(files);

    expect(uses).toEqual([]);
  });

  test('Should skip a file when it cannot be read', () => {
    const files = [{ path: 'workflows/broken.workflow.ts', error: 'SyntaxError' }];

    const uses = findCredentialUses(files);

    expect(uses).toEqual([]);
  });
});
