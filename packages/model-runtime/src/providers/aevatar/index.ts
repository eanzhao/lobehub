import type { LobeRuntimeAI } from '../../core/BaseAI';
import type {
  ChatMethodOptions,
  ChatStreamPayload,
  CreateImageMethodOptions,
  CreateImagePayload,
  CreateImageResponse,
  Embeddings,
  EmbeddingsOptions,
  EmbeddingsPayload,
  GenerateObjectOptions,
  GenerateObjectPayload,
} from '../../types';
import { AgentRuntimeErrorType } from '../../types/error';
import { AgentRuntimeError } from '../../utils/createError';
import { StreamingResponse } from '../../utils/response';
import { AevatarStream } from './stream';

const DEFAULT_BASE_URL = 'http://localhost:9000/api/scopes/default';
const AEVATAR_PROVIDER = 'aevatar';
const UNSUPPORTED_EMBEDDINGS_MESSAGE = 'Embeddings is not supported by this provider';
const UNSUPPORTED_CREATE_IMAGE_MESSAGE = 'CreateImage is not supported by this provider';
const UNSUPPORTED_GENERATE_OBJECT_MESSAGE = 'GenerateObject is not supported by this provider';

/**
 * Construction options for the aevatar runtime.
 */
export interface LobeAevatarAIParams {
  apiKey?: string;
  baseURL?: string;
  nyxIdToken?: string;
  /**
   * Optional remote GAgent (Actor) identifier. When set, the aevatar server
   * routes the chat invocation to the specific Actor instead of the
   * scope's default agent. Sourced per-agent from the lobehub `agents`
   * table when the row has `remoteKind === 'aevatar'`.
   */
  remoteAgentId?: string;
}

interface AevatarInputPart {
  text?: string;
  type: 'text';
}

interface AevatarStreamRequest {
  /**
   * Targeting hint for the aevatar server: id of the remote GAgent (Actor)
   * to dispatch this request to. Omitted when the lobehub agent has no
   * remote binding (i.e. local agent path).
   */
  agentId?: string;
  inputParts?: AevatarInputPart[];
  prompt?: string;
  sessionId?: string;
}

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

const resolveEndpoint = (baseURL: string): string => {
  const normalized = trimTrailingSlash(baseURL);

  if (normalized.endsWith('/invoke/chat:stream')) return normalized;

  return `${normalized}/invoke/chat:stream`;
};

const extractPromptFromPayload = (payload: ChatStreamPayload): string => {
  for (let index = payload.messages.length - 1; index >= 0; index -= 1) {
    const message = payload.messages[index];
    if (message.role !== 'user') continue;

    if (typeof message.content === 'string') return message.content;

    const text = message.content
      .filter((part): part is { text: string; type: 'text' } => part.type === 'text')
      .map((part) => part.text)
      .join('\n');

    if (text) return text;
  }

  return payload.messages
    .map((message) => {
      const content =
        typeof message.content === 'string'
          ? message.content
          : message.content
              .filter((part): part is { text: string; type: 'text' } => part.type === 'text')
              .map((part) => part.text)
              .join('\n');

      return `${message.role}: ${content}`;
    })
    .join('\n');
};

const buildRequestBody = (
  payload: ChatStreamPayload,
  remoteAgentId?: string,
): AevatarStreamRequest => {
  const prompt = extractPromptFromPayload(payload).trim();

  return {
    ...(remoteAgentId ? { agentId: remoteAgentId } : {}),
    inputParts: prompt ? [{ text: prompt, type: 'text' }] : undefined,
    prompt,
  };
};

const parseErrorBody = async (response: Response): Promise<unknown> => {
  const contentType = response.headers.get('content-type') || '';

  try {
    if (contentType.includes('application/json')) {
      return (await response.json()) as unknown;
    }

    const text = await response.text();
    return text ? { message: text } : undefined;
  } catch {
    return undefined;
  }
};

const mapErrorType = (status: number) => {
  if (status === 401) return AgentRuntimeErrorType.InvalidProviderAPIKey;
  if (status === 429) return AgentRuntimeErrorType.QuotaLimitReached;
  return AgentRuntimeErrorType.ProviderBizError;
};

export class LobeAevatarAI implements LobeRuntimeAI {
  baseURL: string;

  private readonly apiKey?: string;
  private readonly nyxIdToken?: string;
  private readonly remoteAgentId?: string;

  constructor({
    apiKey,
    baseURL = DEFAULT_BASE_URL,
    nyxIdToken,
    remoteAgentId,
  }: LobeAevatarAIParams = {}) {
    this.apiKey = apiKey;
    this.baseURL = trimTrailingSlash(baseURL);
    this.nyxIdToken = nyxIdToken;
    this.remoteAgentId = remoteAgentId;
  }

  async chat(payload: ChatStreamPayload, options?: ChatMethodOptions): Promise<Response> {
    const endpoint = resolveEndpoint(this.baseURL);
    const token = this.nyxIdToken || this.apiKey;
    const response = await fetch(endpoint, {
      body: JSON.stringify(buildRequestBody(payload, this.remoteAgentId)),
      headers: {
        'Accept': 'text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Content-Type': 'application/json',
        ...options?.requestHeaders,
      },
      method: 'POST',
      signal: options?.signal,
    });

    if (!response.ok) {
      throw AgentRuntimeError.createError(mapErrorType(response.status), {
        endpoint,
        error: await parseErrorBody(response),
        message: response.statusText || `aevatar request failed with status ${response.status}`,
        provider: AEVATAR_PROVIDER,
        status: response.status,
      });
    }

    if (!response.body) {
      throw AgentRuntimeError.createError(AgentRuntimeErrorType.ProviderBizError, {
        endpoint,
        error: { message: 'aevatar response body is empty' },
        provider: AEVATAR_PROVIDER,
      });
    }

    return StreamingResponse(AevatarStream(response.body, options?.callback), {
      headers: options?.headers,
    });
  }

  async embeddings(
    _payload: EmbeddingsPayload,
    _options?: EmbeddingsOptions,
  ): Promise<Embeddings[]> {
    throw new Error(UNSUPPORTED_EMBEDDINGS_MESSAGE);
  }

  async createImage(
    _payload: CreateImagePayload,
    _options?: CreateImageMethodOptions,
  ): Promise<CreateImageResponse> {
    throw new Error(UNSUPPORTED_CREATE_IMAGE_MESSAGE);
  }

  async generateObject(
    _payload: GenerateObjectPayload,
    _options?: GenerateObjectOptions,
  ): Promise<Record<string, unknown>> {
    throw new Error(UNSUPPORTED_GENERATE_OBJECT_MESSAGE);
  }
}
