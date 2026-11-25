import { describe, expect, test } from 'vitest';
import { fakeManaged } from '#src/core/lock/lock-file.fake';
import { decideResetScope } from '#src/core/reset/reset.rules';

const MANAGED = fakeManaged({ 'crm-import': 'crm1', 'daily-report': 'rep1', 'old-report': 'old1' });
const STAGING = { name: 'staging', stableNames: new Set(['daily-report']) };

describe('decideResetScope', () => {
  test('Should remove every entry of the instance when no other target is on it', () => {
    const scope = decideResetScope(MANAGED, []);

    expect(scope).toEqual({ removed: MANAGED, kept: [] });
  });

  test('Should keep and count the entries of another target on the same instance when its folder has their files', () => {
    const scope = decideResetScope(MANAGED, [STAGING]);

    expect(scope).toEqual({ removed: fakeManaged({ 'crm-import': 'crm1', 'old-report': 'old1' }), kept: [{ target: 'staging', count: 1 }] });
  });

  test('Should keep an entry when another target on the instance has its file, even if the target has it too', () => {
    const others = [{ name: 'staging', stableNames: new Set(['crm-import', 'daily-report']) }];

    const scope = decideResetScope(MANAGED, others);

    expect(scope).toEqual({ removed: fakeManaged({ 'old-report': 'old1' }), kept: [{ target: 'staging', count: 2 }] });
  });

  test('Should count the kept entries per other target in their order when several share the instance', () => {
    const others = [STAGING, { name: 'prod', stableNames: new Set(['crm-import', 'not-recorded']) }];

    const scope = decideResetScope(MANAGED, others);

    expect(scope.kept).toEqual([
      { target: 'staging', count: 1 },
      { target: 'prod', count: 1 },
    ]);
  });

  test('Should remove nothing and keep a zero count when the lock file records nothing for the instance', () => {
    const scope = decideResetScope(fakeManaged(), [STAGING]);

    expect(scope).toEqual({ removed: new Map(), kept: [{ target: 'staging', count: 0 }] });
  });
});
