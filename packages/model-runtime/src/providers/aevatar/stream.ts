import type { ChatStreamCallbacks, MessageToolCall, MessageToolCallChunk } from '../../types';
import type { AguiAny, AguiEventEnvelope, LobehubStreamEvent } from './types';

const SSE_DELIMITER = '\n\n';
const textEncoder = new TextEncoder();

interface TranslateAguiStreamOptions {
  callbacks?: ChatStreamCallbacks;
  signal?: AbortSignal;
}

interface StreamState {
  text: string;
  toolCallIndexes: Map<string, number>;
  toolCallNames: Map<string, string>;
  toolsCalling: MessageToolCall[];
}

const isRecord = (value: unknown): value is Record<PropertyKey, unknown> =>
  typeof value === 'object' && value !== null;

const encodeSseFrame = ({ data, event, id }: LobehubStreamEvent): Uint8Array => {
  const lines = [];

  if (id) lines.push(`id: ${id}`);

  lines.push(`event: ${event}`);

  const dataString = typeof data === 'string' ? JSON.stringify(data) : JSON.stringify(data);
  for (const line of dataString.split('\n')) {
    lines.push(`data: ${line}`);
  }

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

const parseAguiEvent = (payload: string): AguiEventEnvelope | undefined => {
  try {
    const parsed = JSON.parse(payload) as unknown;

    if (isRecord(parsed)) return parsed as unknown as AguiEventEnvelope;
  } catch (error) {
    console.warn('[aevatar] failed to parse AGUI stream frame', error);
  }

  return undefined;
};

const extractAnyValue = (value: AguiAny | undefined): unknown => {
  if (!value) return undefined;

  return 'value' in value ? value.value : value;
};

const resolveToolCallIndex = (state: StreamState, toolCallId: string) => {
  const existingIndex = state.toolCallIndexes.get(toolCallId);
  if (existingIndex !== undefined) return existingIndex;

  const index = state.toolCallIndexes.size;
  state.toolCallIndexes.set(toolCallId, index);

  return index;
};

const emitEvent = (
  controller: TransformStreamDefaultController<Uint8Array>,
  event: LobehubStreamEvent,
) => {
  controller.enqueue(encodeSseFrame(event));
};

const emitToolCallChunk = async (
  controller: TransformStreamDefaultController<Uint8Array>,
  callbacks: ChatStreamCallbacks | undefined,
  state: StreamState,
  chunk: MessageToolCallChunk,
) => {
  emitEvent(controller, {
    data: [chunk],
    event: 'tool_calls',
    id: chunk.id,
  });

  const existingIndex = state.toolsCalling.findIndex((toolCall) => toolCall.id === chunk.id);
  if (existingIndex === -1) {
    state.toolsCalling.push({
      function: {
        arguments: chunk.function?.arguments || '',
        name: chunk.function?.name || '',
      },
      id: chunk.id || '',
      type: chunk.type || 'function',
    });
  } else {
    const existing = state.toolsCalling[existingIndex];
    state.toolsCalling[existingIndex] = {
      ...existing,
      function: {
        arguments: existing.function.arguments + (chunk.function?.arguments || ''),
        name: existing.function.name || chunk.function?.name || '',
      },
    };
  }

  await callbacks?.onToolsCalling?.({
    chunk: [chunk],
    toolsCalling: state.toolsCalling,
  });
};

const emitWorkflowState = (
  controller: TransformStreamDefaultController<Uint8Array>,
  data: unknown,
  id?: string,
) => {
  emitEvent(controller, {
    data,
    event: 'workflow_state',
    id,
  });
};

const translateEvent = async (
  event: AguiEventEnvelope,
  controller: TransformStreamDefaultController<Uint8Array>,
  callbacks: ChatStreamCallbacks | undefined,
  state: StreamState,
) => {
  if ('runStarted' in event) {
    await callbacks?.onStart?.();
    return;
  }

  if ('runFinished' in event) {
    const finishData = {
      finishReason: 'stop',
      text: state.text,
    } as const;

    await callbacks?.onCompletion?.(finishData);
    await callbacks?.onFinal?.(finishData);
    emitEvent(controller, {
      data: 'stop',
      event: 'stop',
    });
    return;
  }

  if ('runError' in event) {
    const errorData = {
      code: event.runError.code,
      message: event.runError.message,
      phase: 'run',
      type: 'AevatarRunError',
    };

    await callbacks?.onError?.(errorData);
    emitEvent(controller, {
      data: errorData,
      event: 'error',
    });
    return;
  }

  if ('runStopped' in event) {
    const errorData = {
      message: event.runStopped.reason,
      phase: 'run',
      reason: event.runStopped.reason,
      type: 'AevatarRunStopped',
    };

    await callbacks?.onError?.(errorData);
    emitEvent(controller, {
      data: errorData,
      event: 'error',
      id: event.runStopped.runId,
    });
    return;
  }

  if ('stepStarted' in event) {
    emitWorkflowState(controller, {
      stepName: event.stepStarted.stepName,
      type: 'step_started',
    });
    return;
  }

  if ('stepFinished' in event) {
    emitWorkflowState(controller, {
      stepName: event.stepFinished.stepName,
      type: 'step_finished',
    });
    return;
  }

  if ('textMessageStart' in event || 'textMessageEnd' in event) return;

  if ('textMessageContent' in event) {
    const { delta, messageId } = event.textMessageContent;

    if (delta.length === 0) return;

    state.text += delta;
    await callbacks?.onText?.(delta);
    emitEvent(controller, {
      data: delta,
      event: 'text',
      id: messageId,
    });
    return;
  }

  if ('stateSnapshot' in event) {
    emitWorkflowState(controller, extractAnyValue(event.stateSnapshot.snapshot));
    return;
  }

  if ('toolCallStart' in event) {
    const { toolCallId, toolName } = event.toolCallStart;
    const index = resolveToolCallIndex(state, toolCallId);
    state.toolCallNames.set(toolCallId, toolName);

    await emitToolCallChunk(controller, callbacks, state, {
      function: {
        arguments: '',
        name: toolName,
      },
      id: toolCallId,
      index,
      type: 'function',
    });
    return;
  }

  if ('toolCallEnd' in event) {
    const { result, toolCallId } = event.toolCallEnd;
    const index = resolveToolCallIndex(state, toolCallId);
    const toolName = state.toolCallNames.get(toolCallId) || '';

    await emitToolCallChunk(controller, callbacks, state, {
      function: {
        arguments: '',
        name: toolName,
      },
      id: toolCallId,
      index,
      type: 'function',
    });
    emitWorkflowState(
      controller,
      {
        result,
        toolCallId,
        toolName,
        type: 'tool_call_result',
      },
      toolCallId,
    );
    return;
  }

  if ('custom' in event) {
    emitWorkflowState(controller, {
      name: event.custom.name,
      payload: extractAnyValue(event.custom.payload),
      type: 'custom',
    });
    return;
  }

  console.warn('[aevatar] dropped unknown AGUI stream event', event);
};

/**
 * Translate aevatar AGUI SSE frames into LobeHub SSE frames.
 */
export const translateAguiStream = (
  stream: ReadableStream<Uint8Array>,
  options: TranslateAguiStreamOptions = {},
): ReadableStream<Uint8Array> => {
  const decoder = new TextDecoder();
  const state: StreamState = {
    text: '',
    toolCallIndexes: new Map(),
    toolCallNames: new Map(),
    toolsCalling: [],
  };

  let buffer = '';

  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      async flush(controller) {
        const trailingPayload = extractDataPayload(buffer.trim());
        if (trailingPayload) {
          const event = parseAguiEvent(trailingPayload);
          if (event) await translateEvent(event, controller, options.callbacks, state);
        }
      },
      async transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });

        while (true) {
          const delimiterIndex = buffer.indexOf(SSE_DELIMITER);
          if (delimiterIndex === -1) break;

          const rawEvent = buffer.slice(0, delimiterIndex);
          buffer = buffer.slice(delimiterIndex + SSE_DELIMITER.length);

          const payload = extractDataPayload(rawEvent);
          if (!payload) continue;

          const event = parseAguiEvent(payload);
          if (!event) continue;

          await translateEvent(event, controller, options.callbacks, state);
        }
      },
    }),
    { signal: options.signal },
  );
};

/**
 * Compatibility wrapper for the issue #1 aevatar stream export.
 */
export const AevatarStream = (
  stream: ReadableStream<Uint8Array>,
  callbacks?: ChatStreamCallbacks,
): ReadableStream<Uint8Array> => translateAguiStream(stream, { callbacks });
