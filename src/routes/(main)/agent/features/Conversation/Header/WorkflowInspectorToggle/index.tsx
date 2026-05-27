'use client';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@lobechat/const';
import { ActionIcon } from '@lobehub/ui';
import { Workflow } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';

/**
 * Issue #6: Toggle for the Workflow Inspector portal view.
 *
 * Renders only when the active agent is bound to a remote aevatar GAgent
 * (`remoteKind === 'aevatar'`). For local agents the workflow concept does
 * not apply, so the button is hidden — keeps the header clean for the
 * majority of users.
 */
const WorkflowInspectorToggle = memo(() => {
  const { t } = useTranslation('portal');

  const isAevatarAgent = useAgentStore((s) => {
    const config = agentSelectors.currentAgentConfig(s) as
      | { remoteKind?: 'aevatar' | null }
      | undefined;
    return config?.remoteKind === 'aevatar';
  });

  const toggleWorkflowInspector = useChatStore((s) => s.toggleWorkflowInspector);

  const handleClick = useCallback(() => {
    toggleWorkflowInspector();
  }, [toggleWorkflowInspector]);

  if (!isAevatarAgent) return null;

  return (
    <ActionIcon
      icon={Workflow}
      size={DESKTOP_HEADER_ICON_SMALL_SIZE}
      title={t('workflowInspector.toggle')}
      onClick={handleClick}
    />
  );
});

WorkflowInspectorToggle.displayName = 'WorkflowInspectorToggle';

export default WorkflowInspectorToggle;
