'use client';

import '@xyflow/react/dist/style.css';

import {
  Background,
  Controls,
  type Edge,
  type Node,
  ReactFlow,
  type ReactFlowProps,
} from '@xyflow/react';
import { createStyles } from 'antd-style';
import { memo, useCallback, useMemo } from 'react';

import { layoutWorkflow } from './layout';
import StepNode, { type StepNodeData } from './nodes/StepNode';
import type { WorkflowSnapshot } from './types';

const useStyles = createStyles(({ css, token }) => ({
  empty: css`
    display: flex;
    flex-direction: column;
    gap: 4px;
    align-items: center;
    justify-content: center;

    height: 100%;

    font-size: 12px;
    color: ${token.colorTextSecondary};
    text-align: center;
  `,
  emptyHint: css`
    max-width: 220px;
    color: ${token.colorTextTertiary};
  `,
  emptyTitle: css`
    font-weight: 500;
    color: ${token.colorText};
  `,
  wrapper: css`
    width: 100%;
    height: 100%;
    background: ${token.colorBgLayout};
  `,
}));

interface WorkflowGraphProps {
  /**
   * Fired when the user clicks a node. The host wires this to chat scroll-to
   * — the inspector itself doesn't know about messages.
   */
  onStepClick?: (stepId: string) => void;
  snapshot: WorkflowSnapshot;
}

// Custom node types — keep stable across renders so xyflow doesn't re-mount nodes.
const NODE_TYPES = { step: StepNode } satisfies ReactFlowProps['nodeTypes'];

const WorkflowGraph = memo<WorkflowGraphProps>(({ snapshot, onStepClick }) => {
  const { styles } = useStyles();

  const { nodes, edges } = useMemo(() => {
    const laidOut = layoutWorkflow(snapshot.nodes, snapshot.edges);
    const rfNodes: Node<StepNodeData>[] = laidOut.nodes.map((n) => ({
      data: {
        label: n.step.label,
        status: n.step.status,
        stepId: n.step.stepId,
      },
      id: n.step.stepId,
      position: { x: n.x, y: n.y },
      type: 'step',
    }));
    const rfEdges: Edge[] = laidOut.edges.map((e) => ({
      animated: true,
      id: e.id || `${e.from}__${e.to}`,
      source: e.from,
      target: e.to,
    }));
    return { edges: rfEdges, nodes: rfNodes };
  }, [snapshot]);

  const handleNodeClick = useCallback<NonNullable<ReactFlowProps['onNodeClick']>>(
    (_event, node) => {
      const stepId = (node.data as StepNodeData | undefined)?.stepId;
      if (stepId) onStepClick?.(stepId);
    },
    [onStepClick],
  );

  if (nodes.length === 0) {
    return (
      <div className={styles.empty} data-testid="workflow-inspector-empty">
        <span className={styles.emptyTitle}>No workflow yet</span>
        <span className={styles.emptyHint}>
          Send a message to a remote GAgent — steps will appear here as they execute.
        </span>
      </div>
    );
  }

  return (
    <div className={styles.wrapper} data-testid="workflow-inspector-graph">
      <ReactFlow
        fitView
        edges={edges}
        nodeTypes={NODE_TYPES}
        nodes={nodes}
        nodesConnectable={false}
        nodesDraggable={false}
        proOptions={{ hideAttribution: true }}
        onNodeClick={handleNodeClick}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
});

WorkflowGraph.displayName = 'WorkflowGraph';

export default WorkflowGraph;
