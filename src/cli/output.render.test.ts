import { describe, expect, test } from 'vitest';
import { NAME_WIDTH_MAX, paint, rows, sections, stopped } from '#src/cli/output.render';

const LONG = 'a-workflow-name-longer-than-the-column';

describe('rows', () => {
  test('Should pad every name to the longest one, two spaces before the state, when the names fit the column', () => {
    const lines = rows([
      { symbol: '+', name: 'crm-import', state: 'created' },
      { symbol: '~', name: 'daily-report', state: 'updated' },
    ]);

    expect(lines).toEqual(['+ crm-import    created', '~ daily-report  updated']);
  });

  test('Should cap the name column and push only the long name state two spaces after it when a name is longer than the cap', () => {
    const lines = rows([
      { symbol: '+', name: LONG, state: 'created' },
      { symbol: '~', name: 'short', state: 'updated' },
    ]);

    expect(lines).toEqual([`+ ${LONG}  created`, `~ ${'short'.padEnd(NAME_WIDTH_MAX)}  updated`]);
  });

  test('Should put every follow-up at the name column, whatever the length of the name, when a row has follow-ups', () => {
    const lines = rows([{ symbol: '✗', name: LONG, state: 'failed', followUps: ['PUT /x : boom', '→ lift deploy'] }]);

    expect(lines).toEqual([`✗ ${LONG}  failed`, '  PUT /x : boom', '  → lift deploy']);
  });
});

describe('sections', () => {
  test('Should put one blank line between two non-empty sections and none for an empty one when a section is empty', () => {
    const text = sections(['lift status · dev'], [], ['1 missing.'], ['→ lift deploy']);

    expect(text).toBe('lift status · dev\n\n1 missing.\n\n→ lift deploy\n');
  });

  test('Should return no text when every section is empty', () => {
    const text = sections([], []);

    expect(text).toBe('');
  });
});

describe('stopped', () => {
  test('Should indent every line of a detail of several lines under the stop when the detail has several lines', () => {
    const lines = stopped('POST /x', 'Cannot publish:\n\nNode "Webhook":\n  - Missing credential', ['→ lift ping']);

    expect(lines).toEqual(['✗ POST /x : Cannot publish:', '  Node "Webhook":', '    - Missing credential', '  → lift ping']);
  });
});

describe('paint', () => {
  const result = { exitCode: 0 as const, stdout: '! tag missing\n= weekly  up to date\n· Hand made\n✓ Node  24.1.0\n', stderr: '' };

  test('Should colour the warning yellow, dim the unchanged and unmanaged rows and colour the check green when colour is on', () => {
    const painted = paint(result, { color: true, json: false });

    expect(painted.stdout).toBe(
      '\u001b[33m!\u001b[39m tag missing\n\u001b[2m= weekly  up to date\u001b[22m\n\u001b[2m· Hand made\u001b[22m\n\u001b[32m✓\u001b[39m Node  24.1.0\n',
    );
  });

  test('Should leave the text as it is when colour is off', () => {
    const painted = paint(result, { color: false, json: false });

    expect(painted).toBe(result);
  });

  test('Should leave a --json stdout as it is and colour its stderr when colour is on', () => {
    const painted = paint({ exitCode: 1, stdout: '{\n  "error": "✗ x"\n}\n', stderr: '✗ x\n' }, { color: true, json: true });

    expect(painted).toEqual({ exitCode: 1, stdout: '{\n  "error": "✗ x"\n}\n', stderr: '\u001b[31m✗\u001b[39m x\n' });
  });
});
