import debug from 'debug';
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

import type {
  WorkflowSnapshot,
  WorkflowStateEvent,
  WorkflowStepEdge,
  WorkflowStepNode,
  WorkflowStepStatus,
} from './types';

const log = debug('lobe-feature:workflow-inspector');

const EMPTY_SNAPSHOT: WorkflowSnapshot = {
  edges: [],
  lastUpdated: 0,
  messageByStep: {},
  nodes: [],
};

interface WorkflowInspectorState {
  /**
   * Topic the inspector is currently displaying.
   * `null` means "no active workflow" → render the empty state.
   */
  activeTopicId: string | null;
  /** Per-topic workflow snapshots. */
  snapshots: Record<string, WorkflowSnapshot>;
}

interface WorkflowInspectorActions {
  /** Replace the whole snapshot for a topic. */
  applySnapshot: (topicId: string, snapshot: Pick<WorkflowSnapshot, 'edges' | 'nodes'>) => void;
  /** Drop a topic's snapshot. */
  clearTopic: (topicId: string) => void;
  /** Dispatch an AGUI `workflow_state` event into the store. */
  handleWorkflowEvent: (
    topicId: string | undefined,
    event: WorkflowStateEvent,
    messageId?: string,
  ) => void;
  setActiveTopicId: (topicId: string | null) => void;
}

export type WorkflowInspectorStore = WorkflowInspectorState & WorkflowInspectorActions;

const cloneSnapshot = (s: WorkflowSnapshot | undefined): WorkflowSnapshot => ({
  edges: s ? [...s.edges] : [],
  lastUpdated: s?.lastUpdated ?? 0,
  messageByStep: { ...s?.messageByStep },
  nodes: s ? [...s.nodes] : [],
});

const upsertNode = (
  nodes: WorkflowStepNode[],
  stepId: string,
  patch: Partial<WorkflowStepNode>,
): WorkflowStepNode[] => {
  const next = [...nodes];
  const idx = next.findIndex((n) => n.stepId === stepId);
  if (idx === -1) {
    next.push({
      label: patch.label ?? stepId,
      status: patch.status ?? 'pending',
      stepId,
      ...patch,
    });
  } else {
    next[idx] = { ...next[idx], ...patch, stepId };
  }
  return next;
};

const setNodeStatus = (
  nodes: WorkflowStepNode[],
  stepId: string,
  status: WorkflowStepStatus,
): WorkflowStepNode[] => upsertNode(nodes, stepId, { status });

const looksLikeSnapshotDefinition = (
  payload: WorkflowStateEvent,
): payload is { edges?: WorkflowStepEdge[]; nodes?: WorkflowStepNode[] } => {
  if (typeof payload !== 'object' || payload === null) return false;
  if ('type' in payload) return false;
  const candidate = payload as { edges?: unknown; nodes?: unknown };
  return Array.isArray(candidate.nodes) || Array.isArray(candidate.edges);
};

export const useWorkflowInspectorStore = create<WorkflowInspectorStore>()(
  devtools(
    (set, get) => ({
      activeTopicId: null,
      snapshots: {},

      applySnapshot: (topicId, snapshot) => {
        set((state) => {
          const prior = state.snapshots[topicId];
          // Merge nodes by stepId, preserving status if a node was already known
          // (a fresh snapshot may not include status fields).
          const mergedNodes: WorkflowStepNode[] = [];
          for (const n of snapshot.nodes) {
            const existing = prior?.nodes.find((p) => p.stepId === n.stepId);
            mergedNodes.push({
              ...n,
              status: existing?.status ?? n.status ?? 'pending',
            });
          }
          // Keep edges as-is (definition is server-driven).
          return {
            snapshots: {
              ...state.snapshots,
              [topicId]: {
                edges: [...snapshot.edges],
                lastUpdated: Date.now(),
                messageByStep: prior?.messageByStep ?? {},
                nodes: mergedNodes,
              },
            },
          };
        });
      },

      clearTopic: (topicId) => {
        set((state) => {
          if (!(topicId in state.snapshots)) return state;
          const { [topicId]: _omit, ...rest } = state.snapshots;
          return { snapshots: rest };
        });
      },

      handleWorkflowEvent: (topicId, event, messageId) => {
        if (!topicId) return;
        if (typeof event !== 'object' || event === null) return;

        // Case 1: state snapshot with nodes/edges
        if (looksLikeSnapshotDefinition(event)) {
          get().applySnapshot(topicId, {
            edges: event.edges ?? [],
            nodes: event.nodes ?? [],
          });
          return;
        }

        const typed = event as Extract<WorkflowStateEvent, { type: string }>;

        if (typed.type === 'step_started') {
          const stepName = typed.stepName as string | undefined;
          if (!stepName) return;
          set((state) => {
            const snap = cloneSnapshot(state.snapshots[topicId]);
            snap.nodes = setNodeStatus(snap.nodes, stepName, 'running');
            if (messageId) snap.messageByStep[stepName] = messageId;
            snap.lastUpdated = Date.now();
            return { snapshots: { ...state.snapshots, [topicId]: snap } };
          });
          return;
        }

        if (typed.type === 'step_finished') {
          const stepName = typed.stepName as string | undefined;
          if (!stepName) return;
          const failed = Boolean((typed as { error?: unknown }).error);
          set((state) => {
            const snap = cloneSnapshot(state.snapshots[topicId]);
            snap.nodes = setNodeStatus(snap.nodes, stepName, failed ? 'failed' : 'success');
            snap.lastUpdated = Date.now();
            return { snapshots: { ...state.snapshots, [topicId]: snap } };
          });
          return;
        }

        // tool_call_result and custom currently don't mutate the DAG itself —
        // we log them for now so downstream code can extend.
        log('workflow_state event ignored by store (no DAG mutation): %o', event);
      },

      setActiveTopicId: (topicId) => {
        set({ activeTopicId: topicId });
      },
    }),
    { name: 'WorkflowInspectorStore' },
  ),
);

/** Test helpers — reset the store between tests. */
export const resetWorkflowInspectorStore = () => {
  useWorkflowInspectorStore.setState({ activeTopicId: null, snapshots: {} });
};

/**
 * Selector helper — returns a stable empty snapshot if the topic is unknown.
 */
export const selectWorkflowSnapshot = (
  state: WorkflowInspectorState,
  topicId: string | null | undefined,
): WorkflowSnapshot => {
  if (!topicId) return EMPTY_SNAPSHOT;
  return state.snapshots[topicId] ?? EMPTY_SNAPSHOT;
};
