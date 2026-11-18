// Package entry point: what a `.workflow.ts` file and `boilerlift.config.ts` import from 'boilerlift'. The CLI is not a
// public API.
export { defineWorkflow } from '#src/core/compile/define-workflow';
export type { Workflow, WorkflowConnection, WorkflowConnections, WorkflowNode } from '#src/core/compile/workflow.model';
export { defineConfig } from '#src/core/config/project-config';
export type { BoilerliftConfig, TargetConfig } from '#src/core/config/config.model';
