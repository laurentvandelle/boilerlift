import { describe, expect, test } from 'vitest';
import { err, ok } from '#src/core/common/result';
import { fakeStableName } from '#src/core/compile/workflow.fake';
import { emptyLockFile, lockRemover, managedIds, parseLockFile, removedEntries, serializeLockFile, withEntry } from '#src/core/lock/lock-file';
import { LockFile } from '#src/core/lock/lock-file.model';
import { FAKE_INSTANCE, fakeLockText, fakeManaged } from '#src/core/lock/lock-file.fake';
import { fakeWorkflowId } from '#src/core/n8n/n8n.fake';

/** A lock file that parses, or a failed test. */
function parsed(text: string | undefined): LockFile {
  const result = parseLockFile(text);
  if (!result.ok) {
    throw new Error(`the lock file does not parse: ${result.error.detail}`);
  }
  return result.value;
}

describe('parseLockFile', () => {
  test('Should read an empty record when there is no file', () => {
    const lock = parsed(undefined);

    expect(managedIds(lock, FAKE_INSTANCE)).toEqual(new Map());
  });

  test('Should read the ids of each instance when the file is valid', () => {
    const text = fakeLockText({ 'crm-import': 'abc', 'invoice-sync': 'def' });

    const lock = parsed(text);

    expect(managedIds(lock, FAKE_INSTANCE)).toEqual(fakeManaged({ 'crm-import': 'abc', 'invoice-sync': 'def' }));
  });

  test('Should give no ids for an instance when the file records only other instances', () => {
    const lock = parsed(fakeLockText({ 'crm-import': 'abc' }, 'https://other.example.com'));

    expect(managedIds(lock, FAKE_INSTANCE)).toEqual(new Map());
  });

  test.each([
    ['invalid-json', 'the text is not JSON', '{ "version": 1, '],
    ['invalid-shape', 'the file is an array', '[]'],
    ['invalid-version', 'the version is 2', '{ "version": 2, "instances": {} }'],
    ['invalid-version', 'the version is missing', '{ "instances": {} }'],
    ['invalid-shape', 'instances is not an object', '{ "version": 1, "instances": [] }'],
    ['invalid-shape', 'an instance is not an object', '{ "version": 1, "instances": { "https://n8n.example.com": "abc" } }'],
    ['invalid-stable-name', 'a key breaks the stable-name rule', '{ "version": 1, "instances": { "https://n8n.example.com": { "CRM": { "n8nId": "abc" } } } }'],
    ['invalid-shape', 'an entry is not an object', '{ "version": 1, "instances": { "https://n8n.example.com": { "crm": "abc" } } }'],
    ['invalid-id', 'an id is empty', '{ "version": 1, "instances": { "https://n8n.example.com": { "crm": { "n8nId": "" } } } }'],
    ['invalid-id', 'an id is a number', '{ "version": 1, "instances": { "https://n8n.example.com": { "crm": { "n8nId": 42 } } } }'],
  ])('Should refuse the file with %s when %s', (kind, _condition, text) => {
    const result = parseLockFile(text);

    expect(result).toMatchObject({ ok: false, error: { kind } });
  });
});

describe('serializeLockFile', () => {
  test('Should sort instances and stable names when it writes the file', () => {
    const entries: [string, string, string][] = [
      ['https://z.example.com', 'b', 'id1'],
      ['https://a.example.com', 'zeta', 'id2'],
      ['https://a.example.com', 'alpha', 'id3'],
    ];
    const lock = entries.reduce(
      (current, [instance, name, id]) => withEntry(current, instance, fakeStableName(name), fakeWorkflowId(id)),
      emptyLockFile(),
    );

    const text = serializeLockFile(lock);

    expect(text).toBe(`{
  "version": 1,
  "instances": {
    "https://a.example.com": {
      "alpha": {
        "n8nId": "id3"
      },
      "zeta": {
        "n8nId": "id2"
      }
    },
    "https://z.example.com": {
      "b": {
        "n8nId": "id1"
      }
    }
  }
}
`);
  });

  test('Should give back the same text when it rewrites a file it read', () => {
    const text = fakeLockText({ 'crm-import': 'abc', 'invoice-sync': 'def' });

    const rewritten = serializeLockFile(parsed(text));

    expect(rewritten).toBe(text);
  });
});

describe('withEntry', () => {
  test('Should add the entry and leave the given lock file unchanged when it records an id', () => {
    const lock = parsed(fakeLockText({ 'crm-import': 'abc' }));

    const next = withEntry(lock, FAKE_INSTANCE, fakeStableName('invoice-sync'), fakeWorkflowId('def'));

    expect({ before: managedIds(lock, FAKE_INSTANCE), after: managedIds(next, FAKE_INSTANCE) }).toEqual({
      before: fakeManaged({ 'crm-import': 'abc' }),
      after: fakeManaged({ 'crm-import': 'abc', 'invoice-sync': 'def' }),
    });
  });

  test('Should replace the id when the stable name is already recorded', () => {
    const lock = parsed(fakeLockText({ 'crm-import': 'gone' }));

    const next = withEntry(lock, FAKE_INSTANCE, fakeStableName('crm-import'), fakeWorkflowId('new'));

    expect(managedIds(next, FAKE_INSTANCE)).toEqual(fakeManaged({ 'crm-import': 'new' }));
  });
});

describe('removedEntries', () => {
  test('Should give the entries no workflow file points to when the files of the instance are given', () => {
    const lock = parsed(fakeLockText({ 'crm-import': 'abc', 'old-report': 'old' }));

    const removed = removedEntries(lock, FAKE_INSTANCE, new Set(['crm-import', 'invoice-sync']));

    expect(removed).toEqual(fakeManaged({ 'old-report': 'old' }));
  });

  test('Should give no entry when the lock file records nothing for the instance', () => {
    const lock = parsed(fakeLockText({ 'old-report': 'old' }, 'https://other.example.com'));

    const removed = removedEntries(lock, FAKE_INSTANCE, new Set());

    expect(removed).toEqual(new Map());
  });
});

describe('lockRemover', () => {
  test('Should save the file without the entry when it removes one', async () => {
    const saved: string[] = [];
    const remover = lockRemover(parsed(fakeLockText({ 'crm-import': 'abc', 'old-report': 'old' })), (text) => {
      saved.push(text);
      return Promise.resolve(ok(undefined));
    });

    await remover.remove(FAKE_INSTANCE, fakeStableName('old-report'));

    expect(saved).toEqual([fakeLockText({ 'crm-import': 'abc' })]);
  });

  test('Should drop the instance when its last entry is removed', async () => {
    const saved: string[] = [];
    const remover = lockRemover(parsed(fakeLockText({ 'old-report': 'old' })), (text) => {
      saved.push(text);
      return Promise.resolve(ok(undefined));
    });

    await remover.remove(FAKE_INSTANCE, fakeStableName('old-report'));

    expect(saved.map((text) => managedIds(parsed(text), FAKE_INSTANCE))).toEqual([new Map()]);
    expect(saved[0]).toBe('{\n  "version": 1,\n  "instances": {}\n}\n');
  });

  test('Should keep the entry in the next save when a save fails', async () => {
    const saved: string[] = [];
    let fail = true;
    const remover = lockRemover(parsed(fakeLockText({ a: '1', b: '2' })), (text) => {
      if (fail) {
        fail = false;
        return Promise.resolve(err({ reason: 'disk full' }));
      }
      saved.push(text);
      return Promise.resolve(ok(undefined));
    });

    const first = await remover.remove(FAKE_INSTANCE, fakeStableName('a'));
    await remover.remove(FAKE_INSTANCE, fakeStableName('b'));

    expect(first).toEqual({ ok: false, error: { reason: 'disk full' } });
    expect(saved).toEqual([fakeLockText({ a: '1' })]);
  });
});
