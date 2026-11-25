import { describe, expect, test } from 'vitest';
import { everyTargetReady } from '#src/core/common/every-target-ready';

type Plan = { kind: 'ready'; target: string } | { kind: 'problem'; target: string };

describe('everyTargetReady', () => {
  test('Should give the ready plans in order when every target is ready', () => {
    const plans: Plan[] = [{ kind: 'ready', target: 'dev' }, { kind: 'ready', target: 'prod' }];

    const ready = everyTargetReady(plans);

    expect(ready).toEqual({ ok: true, value: plans });
  });

  test('Should hold back every plan, the ready ones too, when one target is not ready', () => {
    const plans: Plan[] = [{ kind: 'ready', target: 'dev' }, { kind: 'problem', target: 'prod' }];

    const ready = everyTargetReady(plans);

    expect(ready).toEqual({ ok: false, error: plans });
  });
});
