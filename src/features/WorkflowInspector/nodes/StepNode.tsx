import { Handle, type NodeProps, Position } from '@xyflow/react';
import { createStyles } from 'antd-style';
import { memo } from 'react';

import type { WorkflowStepStatus } from '../types';

const useStyles = createStyles(({ css, token }, status: WorkflowStepStatus) => {
  const palette: Record<WorkflowStepStatus, { bg: string; border: string; dot: string }> = {
    failed: {
      bg: token.colorErrorBg,
      border: token.colorError,
      dot: token.colorError,
    },
    pending: {
      bg: token.colorBgContainer,
      border: token.colorBorder,
      dot: token.colorTextDisabled,
    },
    running: {
      bg: token.colorInfoBg,
      border: token.colorInfoBorder,
      dot: token.colorInfo,
    },
    success: {
      bg: token.colorSuccessBg,
      border: token.colorSuccess,
      dot: token.colorSuccess,
    },
  };

  const c = palette[status];

  return {
    container: css`
      display: flex;
      gap: 8px;
      align-items: center;

      width: 180px;
      min-height: 56px;
      padding-block: 8px;
      padding-inline: 12px;
      border: 1px solid ${c.border};
      border-radius: ${token.borderRadiusLG}px;

      font-size: 12px;
      color: ${token.colorText};

      background: ${c.bg};
    `,
    dot: css`
      flex-shrink: 0;

      width: 8px;
      height: 8px;
      border-radius: 50%;

      background: ${c.dot};
      box-shadow: 0 0 0 2px ${token.colorBgContainer};
    `,
    label: css`
      overflow: hidden;
      flex: 1;

      font-weight: 500;
      text-overflow: ellipsis;
      white-space: nowrap;
    `,
    status: css`
      font-size: 10px;
      color: ${token.colorTextSecondary};
      text-transform: uppercase;
    `,
  };
});

/**
 * Data attached to each @xyflow/react node — keep this in sync with
 * `WorkflowGraph.tsx`'s `RFNode` definition. The status drives the colour.
 */
export interface StepNodeData {
  [key: string]: unknown;
  label: string;
  status: WorkflowStepStatus;
  stepId: string;
}

const StepNode = memo<NodeProps>(({ data }) => {
  const nodeData = data as StepNodeData;
  const { styles } = useStyles(nodeData.status);

  return (
    <div className={styles.container} data-status={nodeData.status} data-step-id={nodeData.stepId}>
      <Handle
        position={Position.Left}
        style={{ background: 'transparent', border: 'none' }}
        type="target"
      />
      <span aria-hidden className={styles.dot} />
      <div className={styles.label} title={nodeData.label}>
        {nodeData.label}
      </div>
      <span className={styles.status}>{nodeData.status}</span>
      <Handle
        position={Position.Right}
        style={{ background: 'transparent', border: 'none' }}
        type="source"
      />
    </div>
  );
});

StepNode.displayName = 'StepNode';

export default StepNode;
