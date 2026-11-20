import { describe, expect, test } from 'vitest';
import { knownCredentialTypes, targetCredentials } from '#src/core/compile/credential-lists';

describe('knownCredentialTypes', () => {
  test('Should map each key to its type, the first list winning, when lists hold entries', () => {
    const files = [
      { path: 'credentials/dev.ts', content: [{ key: 'slack', name: 'Slack', type: 'slackApi', id: '1' }] },
      { path: 'credentials/prod.ts', content: [{ key: 'slack', name: 'Slack', type: 'other', id: '2' }] },
      { path: 'credentials/broken.ts', error: 'SyntaxError' },
    ];

    const types = knownCredentialTypes(files);

    expect(types).toEqual(new Map([['slack', 'slackApi']]));
  });
});

describe('targetCredentials', () => {
  test('Should return the entries of credentials/<target>.ts when the project holds lists of several targets', () => {
    const files = [
      { path: 'credentials/dev.ts', content: [{ key: 'slack', name: 'Slack', type: 'slackApi', id: '1' }] },
      { path: 'credentials/prod.ts', content: [{ key: 'slack', name: 'Slack', type: 'slackApi', id: '2' }] },
    ];

    const list = targetCredentials(files, 'prod');

    expect(list).toEqual([{ key: 'slack', name: 'Slack', type: 'slackApi', id: '2' }]);
  });

  test('Should return an empty list when the file of the target cannot be imported', () => {
    const files = [{ path: 'credentials/prod.ts', error: 'SyntaxError' }];

    const list = targetCredentials(files, 'prod');

    expect(list).toEqual([]);
  });
});
