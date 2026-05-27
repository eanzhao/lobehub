import dagre from 'dagre';

import type { WorkflowStepEdge, WorkflowStepNode } from './types';

/** Default node footprint used for dagre's sizing — kept in sync with `StepNode.tsx`. */
export const STEP_NODE_WIDTH = 180;
export const STEP_NODE_HEIGHT = 56;

export interface LaidOutNode {
  height: number;
  step: WorkflowStepNode;
  width: number;
  /** Center x coordinate (matches @xyflow/react's `position.x`). */
  x: number;
  /** Center y coordinate (matches @xyflow/react's `position.y`). */
  y: number;
}

export interface LayoutResult {
  edges: WorkflowStepEdge[];
  nodes: LaidOutNode[];
}

/**
 * Auto-layout a DAG using dagre and emit positions in @xyflow/react's coord
 * system (top-left origin, y growing downward).
 *
 * The function is deterministic: given the same nodes + edges (in the same
 * order) it returns identical positions. Tests rely on this.
 */
export const layoutWorkflow = (
  nodes: WorkflowStepNode[],
  edges: WorkflowStepEdge[],
  options: { direction?: 'LR' | 'TB'; nodeHeight?: number; nodeWidth?: number } = {},
): LayoutResult => {
  const { direction = 'LR', nodeWidth = STEP_NODE_WIDTH, nodeHeight = STEP_NODE_HEIGHT } = options;

  if (nodes.length === 0) {
    return { edges: [], nodes: [] };
  }

  const graph = new dagre.graphlib.Graph<{}>({ multigraph: false });
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    nodesep: 24,
    rankdir: direction,
    ranksep: 60,
  });

  for (const node of nodes) {
    graph.setNode(node.stepId, { height: nodeHeight, width: nodeWidth });
  }

  // Only include edges whose endpoints exist — guards against partial
  // snapshots where the codec sent an edge before the node arrived.
  const validNodes = new Set(nodes.map((n) => n.stepId));
  const validEdges = edges.filter((e) => validNodes.has(e.from) && validNodes.has(e.to));
  for (const edge of validEdges) {
    graph.setEdge(edge.from, edge.to);
  }

  dagre.layout(graph);

  const laidOutNodes = nodes.map((step): LaidOutNode => {
    const positioned = graph.node(step.stepId) as
      | { height: number; width: number; x: number; y: number }
      | undefined;
    return {
      height: nodeHeight,
      step,
      width: nodeWidth,
      // dagre uses node-center coordinates; @xyflow/react uses top-left.
      // We expose top-left to keep callers simple.
      x: (positioned?.x ?? 0) - nodeWidth / 2,
      y: (positioned?.y ?? 0) - nodeHeight / 2,
    };
  });

  return { edges: validEdges, nodes: laidOutNodes };
};
