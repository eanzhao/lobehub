import type { MessageToolCallChunk } from '../../types';

/**
 * Tool-call chunk emitted by the aevatar codec.
 *
 * Extends the standard {@link MessageToolCallChunk} with two extra fields so
 * downstream consumers (StreamingHandler -> internal_transformToolCalls ->
 * renderer / agent-runtime) can distinguish aevatar GAgent tool calls (already
 * executed server-side) from regular client-dispatched tool calls.
 *
 *  - `source: 'aevatar'` — tags the origin so renderers/selectors can branch.
 *  - `executor: 'server'` — declares the dispatch target; the client guard in
 *    agent-runtime uses this to skip a redundant re-execution.
 */
export type AevatarToolCallChunk = MessageToolCallChunk & {
  /** Dispatch target for this tool call. Aevatar tools are server-executed. */
  executor: 'server';
  /** Origin tag. Always `'aevatar'` for chunks produced by this codec. */
  source: 'aevatar';
};

/** Protobuf Any value emitted by aevatar's camelCase JSON stream. */
export interface AguiAny {
  '@type'?: string;
  [key: string]: unknown;
  'value'?: unknown;
}

/** aevatar AGUI run-start event envelope. */
export interface AguiRunStartedEvent {
  runStarted: {
    runId: string;
    threadId: string;
  };
  timestamp?: number | string;
}

/** aevatar AGUI run-finished event envelope. */
export interface AguiRunFinishedEvent {
  runFinished: {
    result?: AguiAny;
    threadId: string;
  };
  timestamp?: number | string;
}

/** aevatar AGUI run-error event envelope. */
export interface AguiRunErrorEvent {
  runError: {
    code?: string;
    message: string;
  };
  timestamp?: number | string;
}

/** aevatar AGUI run-stopped event envelope. */
export interface AguiRunStoppedEvent {
  runStopped: {
    reason: string;
    runId: string;
  };
  timestamp?: number | string;
}

/** aevatar AGUI step-started event envelope. */
export interface AguiStepStartedEvent {
  stepStarted: {
    stepName: string;
  };
  timestamp?: number | string;
}

/** aevatar AGUI step-finished event envelope. */
export interface AguiStepFinishedEvent {
  stepFinished: {
    stepName: string;
  };
  timestamp?: number | string;
}

/** aevatar AGUI text-message-start event envelope. */
export interface AguiTextMessageStartEvent {
  textMessageStart: {
    messageId: string;
    role: 'assistant' | 'system' | 'user' | string;
  };
  timestamp?: number | string;
}

/** aevatar AGUI text delta event envelope. */
export interface AguiTextMessageContentEvent {
  textMessageContent: {
    delta: string;
    messageId: string;
  };
  timestamp?: number | string;
}

/** aevatar AGUI text-message-end event envelope. */
export interface AguiTextMessageEndEvent {
  textMessageEnd: {
    messageId: string;
  };
  timestamp?: number | string;
}

/** aevatar AGUI workflow state snapshot event envelope. */
export interface AguiStateSnapshotEvent {
  stateSnapshot: {
    snapshot: AguiAny;
  };
  timestamp?: number | string;
}

/** aevatar AGUI tool-call-start event envelope. */
export interface AguiToolCallStartEvent {
  timestamp?: number | string;
  toolCallStart: {
    toolCallId: string;
    toolName: string;
  };
}

/** aevatar AGUI tool-call-end event envelope. */
export interface AguiToolCallEndEvent {
  timestamp?: number | string;
  toolCallEnd: {
    result?: string;
    toolCallId: string;
  };
}

/** aevatar AGUI custom event envelope. */
export interface AguiCustomEvent {
  custom: {
    name: string;
    payload: AguiAny;
  };
  timestamp?: number | string;
}

/** All currently supported aevatar AGUI event envelopes. */
export type AguiEventEnvelope =
  | AguiRunStartedEvent
  | AguiRunFinishedEvent
  | AguiRunErrorEvent
  | AguiRunStoppedEvent
  | AguiStepStartedEvent
  | AguiStepFinishedEvent
  | AguiTextMessageStartEvent
  | AguiTextMessageContentEvent
  | AguiTextMessageEndEvent
  | AguiStateSnapshotEvent
  | AguiToolCallStartEvent
  | AguiToolCallEndEvent
  | AguiCustomEvent;

/** LobeHub stream event emitted by the aevatar stream codec. */
export type LobehubStreamEvent =
  | { data: string; event: 'text'; id?: string }
  | { data: AevatarToolCallChunk[]; event: 'tool_calls'; id?: string }
  | {
      data: { message: string; phase?: string; reason?: string; type: string };
      event: 'error';
      id?: string;
    }
  | { data: string; event: 'stop'; id?: string }
  | { data: unknown; event: 'workflow_state'; id?: string };
