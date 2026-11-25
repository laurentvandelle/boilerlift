import { Result, err, ok } from '#src/core/common/result';

/**
 * The rule of every command that writes on several targets (publish, clean): every selected target is read first, and
 * if one of them is not `ready`, nothing is written on any of them. `ok` holds the ready plans, in order, when every
 * plan is ready; `err` holds every plan, so the caller can report each problem and hold back the ready ones.
 */
export function everyTargetReady<Ready extends { kind: 'ready' }, Problem extends { kind: string }>(
  plans: readonly (Ready | Problem)[],
): Result<Ready[], (Ready | Problem)[]> {
  const ready = plans.filter((plan): plan is Ready => plan.kind === 'ready');
  return ready.length === plans.length ? ok(ready) : err([...plans]);
}
