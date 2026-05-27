import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { WorkflowSnapshot } from './types';
import WorkflowGraph from './WorkflowGraph';

// `@xyflow/react` brings real DOM measurement, which jsdom doesn't have.
// Stub it to a minimal render so the smoke tests stay fast and deterministic.
vi.mock('@xyflow/react', () => ({
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  Position: { Bottom: 'bottom', Left: 'left', Right: 'right', Top: 'top' },
  ReactFlow: ({ nodes }: { nodes: Array<{ id: string }> }) => (
    <div data-testid="rf-mock">
      {nodes.map((n) => (
        <span data-rf-node-id={n.id} key={n.id} />
      ))}
    </div>
  ),
}));

// `@xyflow/react/dist/style.css` — jsdom won't parse it. Empty stub.
vi.mock('@xyflow/react/dist/style.css', () => ({}));

const EMPTY: WorkflowSnapshot = { edges: [], lastUpdated: 0, messageByStep: {}, nodes: [] };

describe('WorkflowGraph', () => {
  it('renders the empty state when there are no nodes', () => {
    render(<WorkflowGraph snapshot={EMPTY} />);
    expect(screen.getByTestId('workflow-inspector-empty')).toBeTruthy();
  });

  it('renders one xyflow node per snapshot step', () => {
    const snap: WorkflowSnapshot = {
      edges: [{ from: 'a', id: 'a-b', to: 'b' }],
      lastUpdated: 1,
      messageByStep: {},
      nodes: [
        { label: 'A', status: 'success', stepId: 'a' },
        { label: 'B', status: 'running', stepId: 'b' },
      ],
    };
    render(<WorkflowGraph snapshot={snap} />);
    expect(screen.getByTestId('workflow-inspector-graph')).toBeTruthy();
    expect(screen.getAllByTestId('rf-mock')[0].children).toHaveLength(2);
  });
});
