'use client';

import { memo, useCallback } from 'react';

import { useChatStore } from '@/store/chat';

import { selectWorkflowSnapshot, useWorkflowInspectorStore } from './store';
import WorkflowGraph from './WorkflowGraph';

interface WorkflowInspectorProps {
  /**
   * Optional override for the topic to render. Defaults to the current
   * chat topic (which is what the Portal mounts).
   */
  topicId?: string | null;
}

const WorkflowInspector = memo<WorkflowInspectorProps>(({ topicId }) => {
  const activeTopicId = useChatStore((s) => s.activeTopicId);
  const resolvedTopicId = topicId ?? activeTopicId ?? null;

  const snapshot = useWorkflowInspectorStore((s) => selectWorkflowSnapshot(s, resolvedTopicId));

  const handleStepClick = useCallback(
    (stepId: string) => {
      // Click-jump: when a node is clicked, scroll to the first chat message
      // that we tagged with this stepId. We pick a low-fi DOM-based scroll
      // because messages don't share a ref registry. If the message isn't
      // mounted yet (e.g. virtual list culled it), this is a no-op.
      if (!resolvedTopicId) return;
      const snap = useWorkflowInspectorStore.getState().snapshots[resolvedTopicId];
      const messageId = snap?.messageByStep[stepId];
      if (!messageId) return;
      const el =
        typeof document !== 'undefined'
          ? document.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`)
          : null;
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },
    [resolvedTopicId],
  );

  return <WorkflowGraph snapshot={snapshot} onStepClick={handleStepClick} />;
});

WorkflowInspector.displayName = 'WorkflowInspector';

export default WorkflowInspector;
