import { beforeEach, describe, expect, it } from 'vitest';

import {
  resetWorkflowInspectorStore,
  selectWorkflowSnapshot,
  useWorkflowInspectorStore,
} from './store';

const topic = 'topic-1';

describe('useWorkflowInspectorStore', () => {
  beforeEach(() => {
    resetWorkflowInspectorStore();
  });

  it('applySnapshot creates a snapshot with the given nodes + edges', () => {
    useWorkflowInspectorStore.getState().applySnapshot(topic, {
      edges: [{ from: 'a', id: 'a-b', to: 'b' }],
      nodes: [
        { label: 'A', status: 'pending', stepId: 'a' },
        { label: 'B', status: 'pending', stepId: 'b' },
      ],
    });

    const snap = selectWorkflowSnapshot(useWorkflowInspectorStore.getState(), topic);
    expect(snap.nodes).toHaveLength(2);
    expect(snap.edges).toEqual([{ from: 'a', id: 'a-b', to: 'b' }]);
  });

  it('handleWorkflowEvent step_started promotes a node to running and tags message', () => {
    useWorkflowInspectorStore.getState().applySnapshot(topic, {
      edges: [],
      nodes: [{ label: 'A', status: 'pending', stepId: 'a' }],
    });

    useWorkflowInspectorStore
      .getState()
      .handleWorkflowEvent(topic, { stepName: 'a', type: 'step_started' }, 'msg-42');

    const snap = selectWorkflowSnapshot(useWorkflowInspectorStore.getState(), topic);
    expect(snap.nodes[0].status).toBe('running');
    expect(snap.messageByStep['a']).toBe('msg-42');
  });

  it('handleWorkflowEvent step_finished without error sets success', () => {
    useWorkflowInspectorStore.getState().applySnapshot(topic, {
      edges: [],
      nodes: [{ label: 'A', status: 'running', stepId: 'a' }],
    });

    useWorkflowInspectorStore
      .getState()
      .handleWorkflowEvent(topic, { stepName: 'a', type: 'step_finished' });

    const snap = selectWorkflowSnapshot(useWorkflowInspectorStore.getState(), topic);
    expect(snap.nodes[0].status).toBe('success');
  });

  it('handleWorkflowEvent step_finished with error sets failed', () => {
    useWorkflowInspectorStore.getState().applySnapshot(topic, {
      edges: [],
      nodes: [{ label: 'A', status: 'running', stepId: 'a' }],
    });

    useWorkflowInspectorStore.getState().handleWorkflowEvent(topic, {
      error: 'boom',
      stepName: 'a',
      type: 'step_finished',
    });

    const snap = selectWorkflowSnapshot(useWorkflowInspectorStore.getState(), topic);
    expect(snap.nodes[0].status).toBe('failed');
  });

  it('handleWorkflowEvent progressively adds unknown nodes (progressive reveal)', () => {
    // No prior snapshot — stepStarted should still create the node
    useWorkflowInspectorStore
      .getState()
      .handleWorkflowEvent(topic, { stepName: 'fresh', type: 'step_started' });

    const snap = selectWorkflowSnapshot(useWorkflowInspectorStore.getState(), topic);
    expect(snap.nodes).toHaveLength(1);
    expect(snap.nodes[0].stepId).toBe('fresh');
    expect(snap.nodes[0].status).toBe('running');
  });

  it('selectWorkflowSnapshot returns a stable empty snapshot for unknown topics', () => {
    const snap = selectWorkflowSnapshot(useWorkflowInspectorStore.getState(), 'never-seen');
    expect(snap.nodes).toEqual([]);
    expect(snap.edges).toEqual([]);
  });

  it('handleWorkflowEvent skips when topicId is missing', () => {
    useWorkflowInspectorStore
      .getState()
      .handleWorkflowEvent(undefined, { stepName: 'a', type: 'step_started' });
    expect(useWorkflowInspectorStore.getState().snapshots).toEqual({});
  });

  it('handleWorkflowEvent ignores tool_call_result / custom (no DAG mutation)', () => {
    useWorkflowInspectorStore.getState().applySnapshot(topic, {
      edges: [],
      nodes: [{ label: 'A', status: 'running', stepId: 'a' }],
    });

    useWorkflowInspectorStore.getState().handleWorkflowEvent(topic, {
      result: { ok: true },
      toolCallId: 'tc-1',
      toolName: 't',
      type: 'tool_call_result',
    });
    useWorkflowInspectorStore
      .getState()
      .handleWorkflowEvent(topic, { name: 'anything', payload: { x: 1 }, type: 'custom' });

    const snap = selectWorkflowSnapshot(useWorkflowInspectorStore.getState(), topic);
    expect(snap.nodes[0].status).toBe('running');
  });

  it('applySnapshot preserves the status of an already-known node', () => {
    useWorkflowInspectorStore.getState().applySnapshot(topic, {
      edges: [],
      nodes: [{ label: 'A', status: 'success', stepId: 'a' }],
    });
    // Subsequent snapshot (e.g. a re-load) doesn't include status
    useWorkflowInspectorStore.getState().applySnapshot(topic, {
      edges: [],
      nodes: [{ label: 'A', status: 'pending', stepId: 'a' }],
    });
    const snap = selectWorkflowSnapshot(useWorkflowInspectorStore.getState(), topic);
    expect(snap.nodes[0].status).toBe('success');
  });

  it('clearTopic drops the snapshot for a single topic', () => {
    useWorkflowInspectorStore.getState().applySnapshot('keep', {
      edges: [],
      nodes: [{ label: 'A', status: 'pending', stepId: 'a' }],
    });
    useWorkflowInspectorStore.getState().applySnapshot('drop', {
      edges: [],
      nodes: [{ label: 'B', status: 'pending', stepId: 'b' }],
    });

    useWorkflowInspectorStore.getState().clearTopic('drop');

    expect(useWorkflowInspectorStore.getState().snapshots).toHaveProperty('keep');
    expect(useWorkflowInspectorStore.getState().snapshots).not.toHaveProperty('drop');
  });
});
