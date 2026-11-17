import { TagId, WorkflowId } from '#src/core/n8n/n8n.model';

/** True when `value` can be a workflow id that n8n sends: a non-empty string. */
export function isWorkflowId(value: unknown): value is WorkflowId {
  return typeof value === 'string' && value !== '';
}

/** True when `value` can be a tag id that n8n sends: a non-empty string. */
export function isTagId(value: unknown): value is TagId {
  return typeof value === 'string' && value !== '';
}
