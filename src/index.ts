// Package entry point: what a `.workflow.ts` file imports from 'boilerlift'. The CLI is not a public API.
export { defineWorkflow } from '#src/core/compile/define-workflow';
export type { Workflow, WorkflowConnection, WorkflowConnections, WorkflowNode } from '#src/core/compile/workflow.model';
