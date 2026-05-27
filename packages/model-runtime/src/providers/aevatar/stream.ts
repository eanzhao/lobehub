import type { ChatStreamCallbacks } from '../../types';

const SSE_DELIMITER = '\n\n';
const textEncoder = new TextEncoder();

/**
 * Minimal AGUI payload emitted by aevatar's SSE writer.
 */
export interface AevatarAguiEvent {
  runError?: {
    code?: string;
    message?: string;
    runId?: string;
  };
  runFinished?: {
    result?: unknown;
    runId?: string;
    threadId?: string;
  };
  textMessageContent?: {
    delta?: string;
    messageId?: string;
  };
  textMessageEnd?: {
    messageId?: string;
  };
  textMessageStart?: {
    messageId?: string;
    role?: string;
  };
  timestamp?: string;
  toolCallEnd?: Record<string, unknown>;
  toolCallStart?: Record<string, unknown>;
}

const encodeSseFrame = (event: string, data: string, id?: string): Uint8Array => {
  const lines = [];

  if (id) lines.push(`id: ${id}`);

  lines.push(`event: ${event}`);
  lines.push(`data: ${data}`);

  return textEncoder.encode(`${lines.join('\n')}${SSE_DELIMITER}`);
};

const extractDataPayload = (rawEvent: string): string | undefined => {
  const payload = rawEvent
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');

  return payload || undefined;
};

const safeJsonParse = (value: string): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
};

const resolveEventId = (event: AevatarAguiEvent): string | undefined =>
  event.textMessageContent?.messageId ||
  event.textMessageStart?.messageId ||
  event.textMessageEnd?.messageId ||
  event.runFinished?.runId ||
  event.runError?.runId;

/**
 * Translate aevatar AGUI SSE frames into LobeHub SSE frames.
 * This issue only maps content delta to `text`; all other events are passed
 * through as generic `data` events for follow-up work in issue #2.
 */
export const AevatarStream = (
  stream: ReadableStream<Uint8Array>,
  callbacks?: ChatStreamCallbacks,
): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = stream.getReader();
      const decoder = new TextDecoder();

      let buffer = '';
      let text = '';

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) break;
          if (!value) continue;

          buffer += decoder.decode(value, { stream: true });

          while (true) {
            const delimiterIndex = buffer.indexOf(SSE_DELIMITER);
            if (delimiterIndex === -1) break;

            const rawEvent = buffer.slice(0, delimiterIndex);
            buffer = buffer.slice(delimiterIndex + SSE_DELIMITER.length);

            const payload = extractDataPayload(rawEvent);
            if (!payload) continue;

            const parsed = safeJsonParse(payload);
            if (!parsed || typeof parsed !== 'object') {
              controller.enqueue(encodeSseFrame('data', JSON.stringify({ raw: payload })));
              continue;
            }

            const aguiEvent = parsed as AevatarAguiEvent;
            const eventId = resolveEventId(aguiEvent);
            const delta = aguiEvent.textMessageContent?.delta;

            if (typeof delta === 'string' && delta.length > 0) {
              text += delta;
              await callbacks?.onText?.(delta);
              controller.enqueue(encodeSseFrame('text', JSON.stringify(delta), eventId));
              continue;
            }

            if (aguiEvent.runFinished) {
              const finishData = {
                finishReason: 'stop',
                text,
              } as const;

              await callbacks?.onCompletion?.(finishData);
              await callbacks?.onFinal?.(finishData);
              controller.enqueue(encodeSseFrame('stop', JSON.stringify('stop'), eventId));
              continue;
            }

            if (aguiEvent.runError?.message) {
              controller.enqueue(
                encodeSseFrame('error', JSON.stringify(aguiEvent.runError), eventId),
              );
              continue;
            }

            controller.enqueue(encodeSseFrame('data', JSON.stringify(aguiEvent), eventId));
          }
        }

        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        reader.releaseLock();
      }
    },
  });
