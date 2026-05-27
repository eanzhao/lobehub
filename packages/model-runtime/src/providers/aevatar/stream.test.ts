import { describe, expect, it, vi } from 'vitest';

import { AevatarStream } from './stream';

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

describe('AevatarStream', () => {
  it('maps textMessageContent to text chunks', async () => {
    const onText = vi.fn();
    const onCompletion = vi.fn();
    const onFinal = vi.fn();
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(
          encoder.encode(
            'data: {"textMessageContent":{"messageId":"msg-1","delta":"Hello"}}\n\n' +
              'data: {"textMessageContent":{"messageId":"msg-1","delta":" world"}}\n\n' +
              'data: {"runFinished":{"runId":"run-1"}}\n\n',
          ),
        );
        controller.close();
      },
    });

    const chunks = await readAll(AevatarStream(upstream, { onCompletion, onFinal, onText }));

    expect(chunks).toEqual([
      'id: msg-1\nevent: text\ndata: "Hello"\n\n',
      'id: msg-1\nevent: text\ndata: " world"\n\n',
      'id: run-1\nevent: stop\ndata: "stop"\n\n',
    ]);
    expect(onText).toHaveBeenNthCalledWith(1, 'Hello');
    expect(onText).toHaveBeenNthCalledWith(2, ' world');
    expect(onCompletion).toHaveBeenCalledWith({ finishReason: 'stop', text: 'Hello world' });
    expect(onFinal).toHaveBeenCalledWith({ finishReason: 'stop', text: 'Hello world' });
  });

  it('passes through non-text AGUI frames as data events', async () => {
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"toolCallStart":{"toolCallId":"call-1","toolName":"search"}}\n\n',
          ),
        );
        controller.close();
      },
    });

    const chunks = await readAll(AevatarStream(upstream));

    expect(chunks).toEqual([
      'event: data\ndata: {"toolCallStart":{"toolCallId":"call-1","toolName":"search"}}\n\n',
    ]);
  });
});
