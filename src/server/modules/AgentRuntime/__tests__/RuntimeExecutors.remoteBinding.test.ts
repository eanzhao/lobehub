import { type AgentState } from '@lobechat/agent-runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

import { createRuntimeExecutors, type RuntimeExecutorContext } from '../RuntimeExecutors';

const mockBuiltinModels = vi.hoisted(() => [
  {
    abilities: { functionCall: true, video: false, vision: true },
    id: 'aevatar-chat',
    providerId: 'aevatar',
  },
  {
    abilities: { functionCall: true, video: false, vision: true },
    id: 'gpt-4',
    providerId: 'openai',
  },
]);

// Mock dependencies (mirrors RuntimeExecutors.test.ts setup but isolated).
vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn().mockResolvedValue({
    chat: vi.fn().mockResolvedValue(new Response('done')),
  }),
}));

vi.mock('@/server/services/message', () => ({
  MessageService: vi.fn().mockImplementation(() => ({
    createCompressionGroup: vi.fn(),
    finalizeCompression: vi.fn(),
  })),
}));

vi.mock('@lobechat/model-runtime', () => ({
  consumeStreamUntilDone: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/business/client/model-bank/loadModels', () => ({
  loadModels: vi.fn().mockResolvedValue(mockBuiltinModels),
}));

vi.mock('model-bank', () => ({
  LOBE_DEFAULT_MODEL_LIST: mockBuiltinModels,
}));

describe('RuntimeExecutors — remote GAgent binding (issue #4)', () => {
  let mockMessageModel: any;
  let mockStreamManager: any;
  let mockToolExecutionService: any;
  let ctx: RuntimeExecutorContext;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMessageModel = {
      create: vi.fn().mockResolvedValue({ id: 'msg-remote' }),
      findById: vi.fn().mockResolvedValue({ id: 'msg-existing' }),
      query: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
      updateToolMessage: vi.fn().mockResolvedValue({ success: true }),
    };
    mockStreamManager = {
      publishStreamChunk: vi.fn().mockResolvedValue('event-1'),
      publishStreamEvent: vi.fn().mockResolvedValue('event-2'),
    };
    mockToolExecutionService = {
      executeTool: vi.fn().mockResolvedValue({
        content: 'Tool result',
        error: null,
        executionTime: 100,
        state: {},
        success: true,
      }),
    };
    ctx = {
      loadAgentState: vi.fn().mockResolvedValue(null),
      messageModel: mockMessageModel,
      operationId: 'op-remote-1',
      serverDB: {} as any,
      stepIndex: 0,
      streamManager: mockStreamManager,
      toolExecutionService: mockToolExecutionService,
      userId: 'user-remote',
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const createMockUsage = () => ({
    humanInteraction: {
      approvalRequests: 0,
      promptRequests: 0,
      selectRequests: 0,
      totalWaitingTimeMs: 0,
    },
    llm: {
      apiCalls: 0,
      processingTimeMs: 0,
      tokens: { input: 0, output: 0, total: 0 },
    },
    tools: {
      byTool: [],
      totalCalls: 0,
      totalTimeMs: 0,
    },
  });

  const createMockCost = () => ({
    calculatedAt: new Date().toISOString(),
    currency: 'USD',
    llm: { byModel: [], currency: 'USD', total: 0 },
    tools: { byTool: [], currency: 'USD', total: 0 },
    total: 0,
  });

  const createMockState = (overrides?: Partial<AgentState>): AgentState =>
    ({
      cost: createMockCost(),
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      maxSteps: 100,
      messages: [],
      metadata: {
        agentId: 'agent-remote-1',
        threadId: 'thread-remote',
        topicId: 'topic-remote',
      },
      modelRuntimeConfig: {
        model: 'aevatar-chat',
        provider: 'aevatar',
      },
      operationId: 'op-remote-1',
      status: 'running',
      stepCount: 0,
      toolManifestMap: {},
      usage: createMockUsage(),
      ...overrides,
    }) as AgentState;

  it('forwards remoteEndpoint + remoteAgentId to initModelRuntimeFromDB and forces aevatar provider', async () => {
    const executors = createRuntimeExecutors(ctx);
    const state = createMockState({
      metadata: {
        agentId: 'agent-remote-1',
        agentConfig: {
          provider: 'openai', // intentional "stale" hint — should be ignored
          remoteAgentId: 'gagent-target-42',
          remoteEndpoint: 'https://aevatar.example.com/api/scopes/demo',
          remoteKind: 'aevatar',
        },
        threadId: 'thread-remote',
        topicId: 'topic-remote',
      },
    });

    const instruction = {
      payload: {
        // Payload carries the local hint — runtime should still override to aevatar
        messages: [{ content: 'Hello aevatar', role: 'user' }],
        model: 'gpt-4',
        provider: 'openai',
        tools: [],
      },
      type: 'call_llm' as const,
    };

    await executors.call_llm!(instruction, state);

    expect(initModelRuntimeFromDB).toHaveBeenCalledWith(ctx.serverDB, ctx.userId, 'aevatar', {
      baseURL: 'https://aevatar.example.com/api/scopes/demo',
      remoteAgentId: 'gagent-target-42',
    });
  });

  it('does not pass remote binding when the agent is local', async () => {
    const executors = createRuntimeExecutors(ctx);
    const state = createMockState({
      metadata: {
        agentId: 'agent-local',
        agentConfig: { provider: 'openai', remoteKind: null },
        threadId: 'thread-local',
        topicId: 'topic-local',
      },
      modelRuntimeConfig: { model: 'gpt-4', provider: 'openai' },
    });

    const instruction = {
      payload: {
        messages: [{ content: 'Hello local', role: 'user' }],
        model: 'gpt-4',
        provider: 'openai',
        tools: [],
      },
      type: 'call_llm' as const,
    };

    await executors.call_llm!(instruction, state);

    expect(initModelRuntimeFromDB).toHaveBeenCalledWith(
      ctx.serverDB,
      ctx.userId,
      'openai',
      undefined,
    );
  });
});
