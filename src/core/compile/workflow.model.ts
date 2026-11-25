/** One file found under `./workflows`: its parsed content, or why it could not be read. */
export type WorkflowFile =
  | {
    /** Path relative to the current folder, with `/` separators (for example `workflows/crm/import.json`). */
    path: string;
    /** The parsed JSON, or the `default` export of a `.workflow.ts` module. */
    content: unknown;
  }
  | { path: string; error: string };

/**
 * Reads every workflow file under `folder`, sorted by path; `[]` when the folder does not exist. A port: the CLI fills it
 * with `CommandContext.loadWorkflowFiles`.
 */
export type WorkflowFileLoader = (folder: string) => Promise<WorkflowFile[]>;

/**
 * The file base name without `.workflow.ts` / `.json`: 1 to 64 of a-z, 0-9 and -. It names the workflow in the
 * project and in the lock file (ADR 0009). Only `isStableName` in load-workflows.ts produces one.
 */
export type StableName = string & { readonly __brand: 'StableName' };

/** A local workflow ready to deliver. */
export interface LocalWorkflow {
  stableName: StableName;
  path: string;
  name: string;
  /** Every node has the fields `WorkflowNode` requires: the loader checked them. */
  nodes: WorkflowNode[];
  connections: Record<string, unknown>;
  settings: Record<string, unknown>;
}

export type LoadProblemKind = 'invalid-name' | 'duplicate-name' | 'unreadable' | 'invalid-shape';

export interface LoadProblem {
  kind: LoadProblemKind;
  path: string;
  /** What is wrong, in one sentence. */
  detail: string;
}

/** One node of an n8n workflow export. Unknown keys (`credentials`, `disabled`, `webhookId`…) are kept. */
export interface WorkflowNode<Name extends string = string> {
  name: Name;
  type: string;
  typeVersion: number;
  position: readonly [number, number];
  parameters: Record<string, unknown>;
  id?: string;
  [key: string]: unknown;
}

/** One edge of `connections`: the node it goes to, and which of its inputs. */
export interface WorkflowConnection<Target extends string = string> {
  node: Target;
  type: string;
  index: number;
  [key: string]: unknown;
}

/**
 * `connections` of an n8n export: source node name → output type (`main`, `ai_tool`…) → one list per output.
 * With literal `Names`, a source or a target that is not a node name is a type error.
 */
export type WorkflowConnections<Names extends string = string> = {
  [Source in Names]?: Record<string, readonly (readonly WorkflowConnection<Names>[] | null)[]>;
};

/** An n8n workflow export. Unknown keys (`id`, `meta`, `pinData`, `versionId`, `active`, `tags`…) are kept. */
export interface Workflow<Names extends string = string> {
  name: string;
  nodes: readonly WorkflowNode<Names>[];
  connections: WorkflowConnections<Names>;
  settings?: Record<string, unknown>;
  [key: string]: unknown;
}

/** The names of every node of `Nodes` except the one at index `Index`. */
type OtherNodeNames<Nodes extends readonly WorkflowNode[], Index> = {
  [Other in keyof Nodes]: Other extends Index ? never : Nodes[Other] extends { name: infer Name } ? Name : never;
}[number];

/**
 * Maps `Nodes` element by element: a node whose name is used by another node requires a property named
 * `duplicate node name: …` that no node can have, every other node maps to `unknown`. Intersected with `Nodes`,
 * a duplicated name becomes a type error that names it. Names typed as plain `string` are not checked.
 */
export type UniqueNodeNames<Nodes extends readonly WorkflowNode[]> = {
  [Index in keyof Nodes]: Nodes[Index] extends { name: infer Name extends string }
    ? string extends Name
      ? unknown
      : [Name] extends [OtherNodeNames<Nodes, Index>]
        ? { [Marker in `duplicate node name: ${Name}`]: never }
        : unknown
    : unknown;
};

/** What `defineWorkflow` accepts: an n8n export whose node names are inferred from `nodes` only. */
export interface WorkflowDefinition<Nodes extends readonly WorkflowNode[]> {
  name: string;
  nodes: Nodes & UniqueNodeNames<Nodes>;
  connections: WorkflowConnections<NoInfer<Nodes[number]['name']>>;
  settings?: Record<string, unknown>;
  [key: string]: unknown;
}
