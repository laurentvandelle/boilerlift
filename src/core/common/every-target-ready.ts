import { Result, err, ok } from '#src/core/common/result';

/**
 * The rule of every command that writes on several targets (publish, clean): every selected target is read first, and
 * if one of them is not `ready`, nothing is written on any of them. `ok` holds the ready plans, in order, when every
 * plan is ready; `err` holds every plan, so the caller can report each problem and hold back the ready ones.
 */
export function everyTargetReady<Plan extends { kind: string }>(plans: readonly Plan[]): Result<Extract<Plan, { kind: 'ready' }>[], Plan[]> {
  const ready = plans.filter((plan): plan is Extract<Plan, { kind: 'ready' }> => plan.kind === 'ready');
  return ready.length === plans.length ? ok(ready) : err([...plans]);
}
