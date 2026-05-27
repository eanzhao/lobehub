import {
  type AWSBedrockKeyVault,
  type AzureOpenAIKeyVault,
  type CloudflareKeyVault,
  type ComfyUIKeyVault,
  type OpenAICompatibleKeyVault,
  type VertexAIKeyVault,
} from '@lobechat/types';
import { clientApiKeyManager } from '@lobechat/utils/client';
import { ModelProvider } from 'model-bank';

import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import { getNyxIdAuthStoreState } from '@/store/auth/nyxid-slice';

import { resolveRuntimeProvider } from './chat/helper';

type ProviderAuthKeyVaults = OpenAICompatibleKeyVault &
  AzureOpenAIKeyVault &
  AWSBedrockKeyVault &
  CloudflareKeyVault &
  ComfyUIKeyVault &
  VertexAIKeyVault;

const getBuiltinProviderBaseURL = (provider: string): string | undefined => {
  if (typeof window === 'undefined') return undefined;

  const serverConfig = window.global_serverConfigStore?.getState()?.serverConfig;
  const runtimeConfig =
    serverConfig?.aiProvider?.[provider as keyof typeof serverConfig.aiProvider];

  return runtimeConfig && 'baseURL' in runtimeConfig
    ? (runtimeConfig.baseURL as string | undefined)
    : undefined;
};

export const getProviderAuthPayload = (provider: string, keyVaults: ProviderAuthKeyVaults) => {
  switch (provider) {
    case ModelProvider.Bedrock: {
      const { accessKeyId, region, secretAccessKey, sessionToken } = keyVaults;

      const awsSecretAccessKey = secretAccessKey;
      const awsAccessKeyId = accessKeyId;

      const apiKey = (awsSecretAccessKey || '') + (awsAccessKeyId || '');

      return {
        accessKeyId,
        accessKeySecret: awsSecretAccessKey,
        apiKey,
        /** @deprecated */
        awsAccessKeyId,
        /** @deprecated */
        awsRegion: region,
        /** @deprecated */
        awsSecretAccessKey,
        /** @deprecated */
        awsSessionToken: sessionToken,
        region,
        sessionToken,
      };
    }

    case ModelProvider.Azure: {
      return {
        apiKey: clientApiKeyManager.pick(keyVaults.apiKey),
        baseURL: keyVaults.baseURL || keyVaults.endpoint,
      };
    }

    case ModelProvider.Ollama: {
      return { baseURL: keyVaults?.baseURL };
    }

    case ModelProvider.Cloudflare: {
      return {
        apiKey: clientApiKeyManager.pick(keyVaults?.apiKey),

        baseURLOrAccountID: keyVaults?.baseURLOrAccountID,
        /** @deprecated */
        cloudflareBaseURLOrAccountID: keyVaults?.baseURLOrAccountID,
      };
    }

    case ModelProvider.ComfyUI: {
      return {
        apiKey: keyVaults?.apiKey,
        authType: keyVaults?.authType,
        baseURL: keyVaults?.baseURL,
        customHeaders: keyVaults?.customHeaders,
        password: keyVaults?.password,
        username: keyVaults?.username,
      };
    }

    case ModelProvider.VertexAI: {
      // Vertex AI uses JSON credentials, should not split by comma
      return {
        apiKey: keyVaults?.apiKey,
        baseURL: keyVaults?.baseURL,
        vertexAIRegion: keyVaults?.region,
      };
    }

    case ModelProvider.Aevatar: {
      const token = getNyxIdAuthStoreState().token;

      return {
        apiKey: token,
        baseURL:
          keyVaults?.baseURL || getBuiltinProviderBaseURL(provider) || process.env.AEVATAR_BASE_URL,
        nyxIdToken: token,
      };
    }

    default: {
      return { apiKey: clientApiKeyManager.pick(keyVaults?.apiKey), baseURL: keyVaults?.baseURL };
    }
  }
};

interface AuthParams {
  headers?: HeadersInit;
  provider?: string;
}

export const createPayloadWithKeyVaults = (provider: string) => {
  const keyVaults =
    (aiProviderSelectors.providerKeyVaults(provider)(useAiInfraStore.getState()) as
      | ProviderAuthKeyVaults
      | undefined) || {};

  const runtimeProvider = resolveRuntimeProvider(provider);

  return {
    ...getProviderAuthPayload(runtimeProvider, keyVaults),
    runtimeProvider,
  };
};

export const createHeaderWithAuth = async (params?: AuthParams): Promise<HeadersInit> => {
  const headers = { ...params?.headers } as Record<string, string>;

  if (params?.provider === 'aevatar') {
    const token = getNyxIdAuthStoreState().token;
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  return headers;
};
