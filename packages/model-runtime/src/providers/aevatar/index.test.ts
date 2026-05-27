// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentRuntimeErrorType } from '../../types/error';
import { LobeAevatarAI } from './index';

const mockFetch = vi.fn<typeof fetch>();

describe('LobeAevatarAI', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns text SSE chunks for AGUI content deltas', async () => {
    mockFetch.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"textMessageContent":{"messageId":"msg-1","delta":"Hello from aevatar"}}\n\n' +
                  'data: {"runFinished":{"runId":"run-1"}}\n\n',
              ),
            );
            controller.close();
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' }, status: 200 },
      ),
    );

    const runtime = new LobeAevatarAI({
      apiKey: 'nyxid-token',
      baseURL: 'https://aevatar.example.com/api/scopes/demo',
    });

    const response = await runtime.chat({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'aevatar-chat',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://aevatar.example.com/api/scopes/demo/invoke/chat:stream',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Accept': 'text/event-stream',
          'Authorization': 'Bearer nyxid-token',
          'Content-Type': 'application/json',
        }),
        method: 'POST',
      }),
    );

    const text = await response.text();
    expect(text).toContain('event: text');
    expect(text).toContain('Hello from aevatar');
    expect(text).toContain('event: stop');
  });

  it('maps 401 to InvalidProviderAPIKey', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Unauthorized' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 401,
        statusText: 'Unauthorized',
      }),
    );

    const runtime = new LobeAevatarAI({
      apiKey: 'bad-token',
      baseURL: 'https://aevatar.example.com/api/scopes/demo',
    });

    await expect(
      runtime.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'aevatar-chat',
      }),
    ).rejects.toMatchObject({
      errorType: AgentRuntimeErrorType.InvalidProviderAPIKey,
    });
  });

  it('forwards AbortSignal to fetch and allows upstream cancellation', async () => {
    let capturedSignal: AbortSignal | undefined;

    mockFetch.mockImplementation(async (_input, init) => {
      capturedSignal = init?.signal as AbortSignal | undefined;

      return new Response(
        new ReadableStream({
          start(controller) {
            capturedSignal?.addEventListener('abort', () => {
              controller.error(new DOMException('Aborted', 'AbortError'));
            });
          },
        }),
        { status: 200 },
      );
    });

    const runtime = new LobeAevatarAI({
      apiKey: 'nyxid-token',
      baseURL: 'https://aevatar.example.com/api/scopes/demo',
    });
    const abortController = new AbortController();

    await runtime.chat(
      {
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'aevatar-chat',
      },
      { signal: abortController.signal },
    );

    abortController.abort();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: abortController.signal }),
    );
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('forwards remoteAgentId from constructor into the request body (issue #4)', async () => {
    let capturedBody: string | undefined;
    mockFetch.mockImplementation(async (_input, init) => {
      capturedBody = init?.body as string | undefined;

      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode('data: {"runFinished":{"runId":"run-1"}}\n\n'),
            );
            controller.close();
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' }, status: 200 },
      );
    });

    const runtime = new LobeAevatarAI({
      apiKey: 'nyxid-token',
      baseURL: 'https://aevatar.example.com/api/scopes/demo',
      remoteAgentId: 'gagent-bound-7',
    });

    await runtime.chat({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'aevatar-chat',
    });

    expect(capturedBody).toBeDefined();
    const parsed = JSON.parse(capturedBody!);
    expect(parsed.agentId).toBe('gagent-bound-7');
    expect(parsed.prompt).toBe('Hello');
  });

  it('omits agentId from the request body when no remoteAgentId is set', async () => {
    let capturedBody: string | undefined;
    mockFetch.mockImplementation(async (_input, init) => {
      capturedBody = init?.body as string | undefined;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode('data: {"runFinished":{"runId":"run-1"}}\n\n'),
            );
            controller.close();
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' }, status: 200 },
      );
    });

    const runtime = new LobeAevatarAI({
      apiKey: 'nyxid-token',
      baseURL: 'https://aevatar.example.com/api/scopes/demo',
    });

    await runtime.chat({ messages: [{ content: 'Hi', role: 'user' }], model: 'aevatar-chat' });

    expect(capturedBody).toBeDefined();
    const parsed = JSON.parse(capturedBody!);
    expect(parsed.agentId).toBeUndefined();
  });
});
