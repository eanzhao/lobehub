/**
 * Status of a single workflow step as observed from the AGUI stream.
 *
 * - `pending` — known from a `stateSnapshot` but not yet started
 * - `running` — `stepStarted` has fired
 * - `success` — `stepFinished` has fired without an error
 * - `failed`  — the step finished with an error in its payload
 */
export type WorkflowStepStatus = 'pending' | 'running' | 'success' | 'failed';

/** Single node on the DAG. */
export interface WorkflowStepNode {
  /** Free-form label rendered in the node body. */
  label: string;
  /** Optional payload to surface in tooltips / message detail. */
  metadata?: Record<string, unknown>;
  status: WorkflowStepStatus;
  /** Stable identifier for the step (matches `stepName` in AGUI events). */
  stepId: string;
}

/** Single directed edge between two steps. */
export interface WorkflowStepEdge {
  /** Source `stepId`. */
  from: string;
  id: string;
  /** Target `stepId`. */
  to: string;
}

/** A snapshot of the workflow definition + live status, keyed by topic. */
export interface WorkflowSnapshot {
  edges: WorkflowStepEdge[];
  /** When this snapshot was last touched. */
  lastUpdated: number;
  /**
   * Optional: messageId currently being produced when a given step is running.
   * Lets the inspector jump to the assistant message for a step.
   */
  messageByStep: Record<string, string | undefined>;
  nodes: WorkflowStepNode[];
}

/**
 * Payload shape for events the codec emits as
 * `event: workflow_state` (see `packages/model-runtime/src/providers/aevatar/stream.ts`).
 *
 * The codec uses three known shapes:
 *  1. `{ type: 'step_started', stepName }` — from `agui.stepStarted`
 *  2. `{ type: 'step_finished', stepName }` — from `agui.stepFinished`
 *  3. `{ type: 'tool_call_result', toolCallId, toolName, result }` — from `agui.toolCallEnd`
 *  4. `{ type: 'custom', name, payload }` — from `agui.custom`
 *  5. arbitrary `stateSnapshot` payload (e.g. the workflow definition)
 *
 * Anything else is forwarded as opaque metadata so downstream code can be
 * extended without touching the codec.
 */
export type WorkflowStateEvent =
  | { stepName: string; type: 'step_started' }
  | { error?: string; stepName: string; type: 'step_finished' }
  | { result: unknown; toolCallId: string; toolName: string; type: 'tool_call_result' }
  | { name: string; payload: unknown; type: 'custom' }
  | { edges?: WorkflowStepEdge[]; nodes?: WorkflowStepNode[]; type?: never }
  | Record<PropertyKey, unknown>;
