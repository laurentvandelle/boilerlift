import { StableName } from '#src/core/compile/workflow.model';
import { Result } from '#src/core/common/result';
import { DeployError } from '#src/core/deliver/deploy.model';
import { WorkflowId } from '#src/core/n8n/n8n.model';

/** One workflow in the lock file: the id n8n gave it when deploy created it. */
export interface LockEntry {
  n8nId: WorkflowId;
}

/**
 * `boilerlift.lock.json`, committed with the project (ADR 0009): for each instance, by the cleaned-up url of its target,
 * the n8n id of each stable name deploy created there. Deploy recognises its workflows by these ids only.
 */
export interface LockFile {
  version: 1;
  instances: Map<string, Map<StableName, LockEntry>>;
}

/**
 * Why the lock file cannot be used, tagged by `kind`. Deploy refuses it before any call.
 * - `invalid-json`: the text is not JSON.
 * - `invalid-version`: `version` is not 1.
 * - `invalid-shape`: the file, `instances` or an instance is not an object, or an entry has no `n8nId` object shape.
 * - `invalid-stable-name`: a key under an instance breaks the stable-name rule.
 * - `invalid-id`: an `n8nId` is not a workflow id.
 */
export type LockFileError =
  | { kind: 'invalid-json'; detail: string }
  | { kind: 'invalid-version'; detail: string }
  | { kind: 'invalid-shape'; detail: string }
  | { kind: 'invalid-stable-name'; detail: string }
  | { kind: 'invalid-id'; detail: string };

/**
 * Records the id of a workflow deploy has just created, under the instance it deploys to. Each call saves the whole
 * file, so the record never lags behind the instance by more than the workflow that failed to be recorded.
 */
export interface LockWriter {
  record(stableName: StableName, id: WorkflowId): Promise<Result<void, DeployError>>;
}

/**
 * Drops the entry of a workflow that clean archived, or found already archived or gone, from the record of `instance`.
 * Each call saves the whole file. A disk error comes back with its `reason`; the entry then stays.
 */
export interface LockRemover {
  remove(instance: string, stableName: StableName): Promise<Result<void, { reason: string }>>;
}
