/**
 * Issue #6: hook surface for consuming AGUI workflow_state events.
 *
 * **Design note** — the actual subscription lives one level up, in
 * `src/store/chat/agents/createAgentExecutors.ts`. That executor receives
 * every SSE chunk emitted by `fetchSSE` (incl. the new `workflow_state`
 * chunk added in this issue) and forwards `workflow_state` payloads to
 * `useWorkflowInspectorStore.handleWorkflowEvent`. We dispatch from the
 * chat pipeline rather than mounting a "listener component" because:
 *
 *  1. The store needs the `topicId` and `assistantMessageId` that only
 *     the executor knows about; surfacing those through a separate event
 *     bus would duplicate state.
 *  2. There is no native "stream event" hook in lobehub's chat pipeline —
 *     `onMessageHandle` is the canonical extension point.
 *
 * This module re-exports the store hook as `useWorkflowEvents` so callers
 * who think in "I want to read live workflow events for a topic" have an
 * obvious entry point. Subscribing to the store is a side-effect-free
 * read of whatever state the executor has already written.
 */

import { useChatStore } from '@/store/chat';

import {
  selectWorkflowSnapshot,
  useWorkflowInspectorStore,
  type WorkflowInspectorStore,
} from '../store';
import type { WorkflowSnapshot } from '../types';

const pickSnapshot =
  (topicId: string | null) =>
  (state: WorkflowInspectorStore): WorkflowSnapshot =>
    selectWorkflowSnapshot(state, topicId);

/**
 * Subscribe to the workflow snapshot for a given topic. Defaults to the
 * currently active chat topic when no explicit `topicId` is provided.
 */
export const useWorkflowEvents = (topicId?: string | null): WorkflowSnapshot => {
  const activeTopicId = useChatStore((s) => s.activeTopicId);
  const resolvedTopicId = topicId ?? activeTopicId ?? null;
  return useWorkflowInspectorStore(pickSnapshot(resolvedTopicId));
};
