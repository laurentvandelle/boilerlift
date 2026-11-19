// Package entry point: what a `.workflow.ts` file, `boilerlift.config.ts` and the generated `credentials/<target>.ts`
// files import from 'boilerlift'. The CLI is not a public API.
export { credential, defineCredentials } from '#src/core/compile/credential';
export type {
  CredentialEntry,
  CredentialKey,
  CredentialLists,
  CredentialMarker,
  CredentialSlot,
} from '#src/core/compile/credential.model';
export { defineWorkflow } from '#src/core/compile/define-workflow';
export type { Workflow, WorkflowConnection, WorkflowConnections, WorkflowNode } from '#src/core/compile/workflow.model';
export { defineConfig } from '#src/core/config/project-config';
export type { BoilerliftConfig, TargetConfig } from '#src/core/config/config.model';
