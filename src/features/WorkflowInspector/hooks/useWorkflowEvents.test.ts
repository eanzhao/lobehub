/**
 * End-to-end test for the workflow_state event flow:
 * AGUI SSE frame  →  fetchSSE `onMessageHandle({ type: 'workflow_state' })`
 *                →  createAgentExecutors dispatches to the store
 *                →  WorkflowInspectorStore mutation
 *
 * We can't run the full chat pipeline in isolation, so this test simulates
 * the chunk shape that `createAgentExecutors` receives and asserts the
 * store ends up in the expected state.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  resetWorkflowInspectorStore,
  selectWorkflowSnapshot,
  useWorkflowInspectorStore,
} from '../store';
import type { WorkflowStateEvent } from '../types';

// This mirrors the dispatch in `createAgentExecutors.onMessageHandle` for
// `workflow_state` chunks. Keeping it co-located in the test guards the
// integration against silent regressions.
const dispatchChunk = (
  topicId: string | undefined,
  chunk: { id?: string; payload: unknown; type: 'workflow_state' },
  messageId?: string,
) => {
  useWorkflowInspectorStore
    .getState()
    .handleWorkflowEvent(topicId, chunk.payload as WorkflowStateEvent, messageId);
};

describe('workflow_state → WorkflowInspector store integration', () => {
  beforeEach(() => {
    resetWorkflowInspectorStore();
  });

  it('builds a workflow snapshot progressively from a stream of AGUI events', () => {
    const topic = 'topic-stream';

    // Frame 1: initial state snapshot with the DAG definition
    dispatchChunk(topic, {
      payload: {
        edges: [
          { from: 'plan', id: 'plan-search', to: 'search' },
          { from: 'search', id: 'search-summarize', to: 'summarize' },
        ],
        nodes: [
          { label: 'Plan', status: 'pending', stepId: 'plan' },
          { label: 'Search', status: 'pending', stepId: 'search' },
          { label: 'Summarize', status: 'pending', stepId: 'summarize' },
        ],
      },
      type: 'workflow_state',
    });

    // Frame 2: plan starts
    dispatchChunk(
      topic,
      {
        id: 'plan',
        payload: { stepName: 'plan', type: 'step_started' },
        type: 'workflow_state',
      },
      'asst-msg-1',
    );

    // Frame 3: plan finishes successfully
    dispatchChunk(topic, {
      id: 'plan',
      payload: { stepName: 'plan', type: 'step_finished' },
      type: 'workflow_state',
    });

    // Frame 4: search starts
    dispatchChunk(
      topic,
      {
        id: 'search',
        payload: { stepName: 'search', type: 'step_started' },
        type: 'workflow_state',
      },
      'asst-msg-1',
    );

    const snap = selectWorkflowSnapshot(useWorkflowInspectorStore.getState(), topic);

    expect(snap.nodes).toHaveLength(3);
    expect(snap.edges).toHaveLength(2);
    expect(snap.nodes.find((n) => n.stepId === 'plan')?.status).toBe('success');
    expect(snap.nodes.find((n) => n.stepId === 'search')?.status).toBe('running');
    expect(snap.nodes.find((n) => n.stepId === 'summarize')?.status).toBe('pending');
    expect(snap.messageByStep['plan']).toBe('asst-msg-1');
    expect(snap.messageByStep['search']).toBe('asst-msg-1');
  });

  it('progressively reveals nodes when no initial snapshot was sent', () => {
    const topic = 'topic-reveal';

    // No initial snapshot — just stream of step_started events
    dispatchChunk(topic, {
      payload: { stepName: 'fetch', type: 'step_started' },
      type: 'workflow_state',
    });
    dispatchChunk(topic, {
      payload: { stepName: 'fetch', type: 'step_finished' },
      type: 'workflow_state',
    });
    dispatchChunk(topic, {
      payload: { stepName: 'transform', type: 'step_started' },
      type: 'workflow_state',
    });

    const snap = selectWorkflowSnapshot(useWorkflowInspectorStore.getState(), topic);
    expect(snap.nodes.map((n) => n.stepId).sort()).toEqual(['fetch', 'transform']);
    expect(snap.nodes.find((n) => n.stepId === 'fetch')?.status).toBe('success');
    expect(snap.nodes.find((n) => n.stepId === 'transform')?.status).toBe('running');
  });

  it('keeps per-topic snapshots isolated', () => {
    dispatchChunk('alpha', {
      payload: { stepName: 'one', type: 'step_started' },
      type: 'workflow_state',
    });
    dispatchChunk('beta', {
      payload: { stepName: 'two', type: 'step_started' },
      type: 'workflow_state',
    });

    const alphaSnap = selectWorkflowSnapshot(useWorkflowInspectorStore.getState(), 'alpha');
    const betaSnap = selectWorkflowSnapshot(useWorkflowInspectorStore.getState(), 'beta');

    expect(alphaSnap.nodes.map((n) => n.stepId)).toEqual(['one']);
    expect(betaSnap.nodes.map((n) => n.stepId)).toEqual(['two']);
  });
});
