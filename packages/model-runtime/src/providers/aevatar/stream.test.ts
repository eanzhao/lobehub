import { describe, expect, it, vi } from 'vitest';

import { AevatarStream, translateAguiStream } from './stream';

const encoder = new TextEncoder();

const readAll = async (stream: ReadableStream<Uint8Array>) => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(decoder.decode(value, { stream: true }));
  }

  return chunks;
};

const streamFromFrames = (frames: string[]): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(frame));
      }
      controller.close();
    },
  });

/** Build a raw SSE frame from a JSON-serializable object. */
const sseFrame = (payload: Record<string, unknown>): string =>
  `data: ${JSON.stringify(payload)}\n\n`;

/** Parse the streamed lobehub SSE output into a list of `{ event, data, id }`. */
const parseLobehubFrames = (chunks: string[]) => {
  const combined = chunks.join('');
  const rawFrames = combined.split('\n\n').filter((frame) => frame.trim().length > 0);

  return rawFrames.map((frame) => {
    const lines = frame.split('\n');
    let id: string | undefined;
    let event: string | undefined;
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith('id: ')) id = line.slice(4);
      else if (line.startsWith('event: ')) event = line.slice(7);
      else if (line.startsWith('data: ')) dataLines.push(line.slice(6));
    }

    const rawData = dataLines.join('\n');
    let data: unknown = rawData;
    try {
      data = JSON.parse(rawData);
    } catch {
      // leave as string if it doesn't parse
    }

    return { data, event, id };
  });
};

describe('AevatarStream', () => {
  it('happy path: runStarted → 2 text deltas → textMessageEnd → runFinished', async () => {
    const onText = vi.fn();
    const onStart = vi.fn();
    const onCompletion = vi.fn();
    const onFinal = vi.fn();

    const upstream = streamFromFrames([
      sseFrame({ runStarted: { runId: 'run-1', threadId: 'thr-1' }, timestamp: 1 }),
      sseFrame({ textMessageContent: { delta: 'Hello', messageId: 'msg-1' }, timestamp: 2 }),
      sseFrame({ textMessageContent: { delta: ' world', messageId: 'msg-1' }, timestamp: 3 }),
      sseFrame({ textMessageEnd: { messageId: 'msg-1' }, timestamp: 4 }),
      sseFrame({ runFinished: { threadId: 'thr-1' }, timestamp: 5 }),
    ]);

    const chunks = await readAll(
      AevatarStream(upstream, { onCompletion, onFinal, onStart, onText }),
    );
    const frames = parseLobehubFrames(chunks);

    expect(frames).toEqual([
      { data: 'Hello', event: 'text', id: 'msg-1' },
      { data: ' world', event: 'text', id: 'msg-1' },
      { data: 'stop', event: 'stop', id: undefined },
    ]);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onText).toHaveBeenNthCalledWith(1, 'Hello');
    expect(onText).toHaveBeenNthCalledWith(2, ' world');
    expect(onCompletion).toHaveBeenCalledWith({ finishReason: 'stop', text: 'Hello world' });
    expect(onFinal).toHaveBeenCalledWith({ finishReason: 'stop', text: 'Hello world' });
  });

  it('emits one text event per textMessageContent delta (no concatenation)', async () => {
    const upstream = streamFromFrames([
      sseFrame({ textMessageContent: { delta: 'a', messageId: 'msg-1' } }),
      sseFrame({ textMessageContent: { delta: 'bb', messageId: 'msg-1' } }),
      sseFrame({ textMessageContent: { delta: 'ccc', messageId: 'msg-1' } }),
    ]);

    const chunks = await readAll(AevatarStream(upstream));
    const textFrames = parseLobehubFrames(chunks).filter((f) => f.event === 'text');

    expect(textFrames).toHaveLength(3);
    expect(textFrames.map((f) => f.data)).toEqual(['a', 'bb', 'ccc']);
  });

  it('handles concurrent tool calls with interleaved start/end', async () => {
    const upstream = streamFromFrames([
      sseFrame({ toolCallStart: { toolCallId: 'call-A', toolName: 'searchA' } }),
      sseFrame({ toolCallStart: { toolCallId: 'call-B', toolName: 'searchB' } }),
      sseFrame({ toolCallEnd: { result: 'resA', toolCallId: 'call-A' } }),
      sseFrame({ toolCallEnd: { result: 'resB', toolCallId: 'call-B' } }),
    ]);

    const chunks = await readAll(AevatarStream(upstream));
    const frames = parseLobehubFrames(chunks);

    const toolCallChunks = frames.filter((f) => f.event === 'tool_calls');
    expect(toolCallChunks).toHaveLength(4);

    // Each toolCallStart and toolCallEnd both emit a tool_calls chunk.
    // Indexes should be stable per toolCallId.
    const aChunks = toolCallChunks.filter((f) => f.id === 'call-A');
    const bChunks = toolCallChunks.filter((f) => f.id === 'call-B');
    expect(aChunks).toHaveLength(2);
    expect(bChunks).toHaveLength(2);

    const aIndexes = aChunks.map((f) => (f.data as Array<{ index: number }>)[0]?.index);
    const bIndexes = bChunks.map((f) => (f.data as Array<{ index: number }>)[0]?.index);
    expect(aIndexes[0]).toBe(0);
    expect(aIndexes[1]).toBe(0);
    expect(bIndexes[0]).toBe(1);
    expect(bIndexes[1]).toBe(1);

    // And workflow_state results for each toolCallEnd
    const stateFrames = frames.filter((f) => f.event === 'workflow_state');
    expect(stateFrames).toHaveLength(2);
    expect(stateFrames.map((f) => (f.data as { toolCallId: string }).toolCallId)).toEqual([
      'call-A',
      'call-B',
    ]);
  });

  it('toolCallEnd recovers tool name from earlier toolCallStart', async () => {
    const upstream = streamFromFrames([
      sseFrame({ toolCallStart: { toolCallId: 'call-1', toolName: 'foo' } }),
      sseFrame({ toolCallEnd: { result: '42', toolCallId: 'call-1' } }),
    ]);

    const chunks = await readAll(AevatarStream(upstream));
    const frames = parseLobehubFrames(chunks);

    const toolCallChunks = frames.filter((f) => f.event === 'tool_calls');
    expect(toolCallChunks).toHaveLength(2);

    const endChunk = toolCallChunks[1];
    const data = endChunk.data as Array<{ function?: { name?: string }; id?: string }>;
    expect(data[0]?.id).toBe('call-1');
    expect(data[0]?.function?.name).toBe('foo');

    const stateFrame = frames.find((f) => f.event === 'workflow_state');
    expect(stateFrame?.data).toMatchObject({
      result: '42',
      toolCallId: 'call-1',
      toolName: 'foo',
    });
  });

  it('runError emits an error event with message and type', async () => {
    const onError = vi.fn();
    const upstream = streamFromFrames([
      sseFrame({ runError: { code: 'INTERNAL', message: 'boom' } }),
    ]);

    const chunks = await readAll(AevatarStream(upstream, { onError }));
    const frames = parseLobehubFrames(chunks);

    expect(frames).toHaveLength(1);
    expect(frames[0].event).toBe('error');
    expect(frames[0].data).toMatchObject({
      code: 'INTERNAL',
      message: 'boom',
      type: 'AevatarRunError',
    });
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'boom', type: 'AevatarRunError' }),
    );
  });

  it('stateSnapshot emits a workflow_state event with passthrough snapshot', async () => {
    const snapshotPayload = { status: 'running', step: 'analyze' };
    const upstream = streamFromFrames([
      sseFrame({ stateSnapshot: { snapshot: { '@type': 'foo.bar', 'value': snapshotPayload } } }),
    ]);

    const chunks = await readAll(AevatarStream(upstream));
    const frames = parseLobehubFrames(chunks);

    expect(frames).toHaveLength(1);
    expect(frames[0].event).toBe('workflow_state');
    expect(frames[0].data).toEqual(snapshotPayload);
  });

  it('unknown eventField triggers console.warn and does not crash or emit', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const upstream = streamFromFrames([
      sseFrame({ timestamp: 1, unknownMysteryEvent: { foo: 'bar' } }),
      sseFrame({ textMessageContent: { delta: 'after-unknown', messageId: 'msg-x' } }),
    ]);

    const chunks = await readAll(AevatarStream(upstream));
    const frames = parseLobehubFrames(chunks);

    expect(warnSpy).toHaveBeenCalled();
    const warnArgs = warnSpy.mock.calls.flat();
    expect(warnArgs.some((arg) => typeof arg === 'string' && arg.includes('aevatar'))).toBe(true);

    // unknown event should not produce an output frame; the text one after should still arrive.
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ data: 'after-unknown', event: 'text' });

    warnSpy.mockRestore();
  });

  it('AbortSignal: aborts upstream and closes downstream when signal fires', async () => {
    const upstreamCancel = vi.fn();

    // An upstream that never closes on its own — it just hangs.
    const upstream = new ReadableStream<Uint8Array>({
      cancel(reason) {
        upstreamCancel(reason);
      },
      start(controller) {
        // Push one frame so the pipeline gets started, then hold open.
        controller.enqueue(
          encoder.encode(sseFrame({ textMessageContent: { delta: 'hi', messageId: 'm' } })),
        );
      },
    });

    const abortController = new AbortController();
    const downstream = translateAguiStream(upstream, { signal: abortController.signal });

    const reader = downstream.getReader();
    // Read first chunk so the transform is running.
    const first = await reader.read();
    expect(first.done).toBe(false);

    // Now abort.
    abortController.abort();

    // Downstream read should reject (signal aborted closes the pipe with an error).
    await expect(reader.read()).rejects.toBeDefined();

    // And the upstream's cancel hook should have fired.
    expect(upstreamCancel).toHaveBeenCalled();
  });
});
