import { CredentialsFile } from '#src/core/compile/credential.model';
import { LoadProblem, WorkflowFile, WorkflowFileLoader } from '#src/core/compile/workflow.model';
import { DeployReport } from '#src/core/deliver/deploy.model';
import { LockFileError, LockStore } from '#src/core/lock/lock-file.model';
import { ConnectedTarget } from '#src/core/n8n/n8n.model';

/** What deploy reads before any target runs: the workflow files of every declared target, by folder, and the credential lists. */
export interface DeliverySources {
  files: Map<string, WorkflowFile[]>;
  credentials: CredentialsFile[];
}

/** The ports `loadDeliverySources` reads the project through. */
export interface DeliverySourcePorts {
  /** Imports the credential lists of a folder. Called before `loadWorkflowFiles`: the lists give `credential()` its types. */
  loadCredentialsFiles: (dir: string) => Promise<CredentialsFile[]>;
  loadWorkflowFiles: WorkflowFileLoader;
}

/** `deploy` writes; `dry-run` (`--dry-run`) stops after the plan and writes nothing. */
export type DeliveryMode = 'deploy' | 'dry-run';

export interface DeliverInput {
  sources: DeliverySources;
  /** The selected targets, in the order deploy runs them. */
  targets: readonly ConnectedTarget[];
  mode: DeliveryMode;
}

/**
 * What deploy did, or would do, on one target, tagged by `kind`. Nothing is sent to a target that is not `report`:
 * - `invalid-files`: a workflow file of its folder does not load.
 * - `nothing-to-deploy`: its folder holds no workflow file.
 * - `invalid-lock-file`: the lock file cannot be read.
 * - `report`: the deploy, or the dry run, went through to its report.
 */
export type TargetDelivery =
  | { kind: 'invalid-files'; target: ConnectedTarget; problems: LoadProblem[] }
  | { kind: 'nothing-to-deploy'; target: ConnectedTarget }
  | { kind: 'invalid-lock-file'; target: ConnectedTarget; error: LockFileError }
  | { kind: 'report'; target: ConnectedTarget; report: DeployReport };

/** The ports `deliverTargets` reads and writes the lock file through. */
export interface DeliverPorts {
  lock: LockStore;
}
