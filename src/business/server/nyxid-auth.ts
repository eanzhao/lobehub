import { parse, serialize } from 'cookie';

import { authEnv } from '@/envs/auth';

const DEFAULT_SCOPE = 'openid profile email offline_access';
const OPENID_DISCOVERY_PATH = '/.well-known/openid-configuration';
const NYXID_REFRESH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;
const NYXID_REFRESH_WINDOW_MS = 60 * 1000;

/**
 * NyxID OAuth client configuration resolved from server env.
 */
export interface NyxIdOAuthConfig {
  clientId: string;
  issuer: string;
}

/**
 * Discovery metadata fields consumed by the NyxID OAuth client.
 */
export interface NyxIdDiscoveryDocument {
  authorizationEndpoint: string;
  codeChallengeMethodsSupported?: string[];
  issuer: string;
  jwksUri?: string;
  tokenEndpoint: string;
  tokenEndpointAuthMethodsSupported?: string[];
  userinfoEndpoint?: string;
}

/**
 * Parameters used to construct a NyxID authorization URL.
 */
export interface BuildNyxIdAuthorizationUrlParams {
  codeChallenge: string;
  prompt?: 'consent' | 'login' | 'none';
  redirectUri: string;
  scope?: string;
  state: string;
}

/**
 * Standardized NyxID token response returned by the OAuth token endpoint.
 */
export interface NyxIdTokenResponse {
  accessToken: string;
  expiresIn: number;
  idToken?: string;
  refreshToken?: string;
  scope?: string;
  tokenType: string;
}

/**
 * Parameters required to exchange an authorization code for NyxID tokens.
 */
export interface ExchangeNyxIdCodeParams {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

/**
 * Parameters required to refresh a NyxID access token.
 */
export interface RefreshNyxIdTokenParams {
  refreshToken: string;
}

export interface NyxIdCookieOptions {
  secure: boolean;
}

export interface RefreshedNyxIdSession {
  setCookieHeaders: string[];
  tokenResponse: NyxIdTokenResponse;
}

type FetchLike = typeof fetch;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const getString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`NyxID ${field} is missing or invalid`);
  }

  return value;
};

const getOptionalStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;

  const strings = value.filter((item): item is string => typeof item === 'string');
  return strings.length === value.length ? strings : undefined;
};

const normalizeIssuer = (issuer: string) => issuer.replace(/\/+$/, '');

const parseJsonResponse = async (response: Response) => {
  try {
    return await response.json();
  } catch (error) {
    throw new Error(
      `NyxID returned a non-JSON response: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

const parseTokenResponse = (payload: unknown): NyxIdTokenResponse => {
  if (!isRecord(payload)) {
    throw new Error('NyxID token response is not an object');
  }

  const accessToken = getString(payload.access_token, 'token response access_token');
  const tokenType = getString(payload.token_type, 'token response token_type');
  const expiresInRaw = payload.expires_in;

  if (typeof expiresInRaw !== 'number' || !Number.isFinite(expiresInRaw) || expiresInRaw <= 0) {
    throw new Error('NyxID token response expires_in is missing or invalid');
  }

  const idToken =
    typeof payload.id_token === 'string' && payload.id_token ? payload.id_token : undefined;
  const refreshToken =
    typeof payload.refresh_token === 'string' && payload.refresh_token
      ? payload.refresh_token
      : undefined;
  const scope = typeof payload.scope === 'string' && payload.scope ? payload.scope : undefined;

  return {
    accessToken,
    expiresIn: expiresInRaw,
    idToken,
    refreshToken,
    scope,
    tokenType,
  };
};

const getConfig = (): NyxIdOAuthConfig => {
  const clientId = authEnv.AUTH_GENERIC_OIDC_ID;
  const issuer = authEnv.AUTH_GENERIC_OIDC_ISSUER;

  if (!clientId) {
    throw new Error('AUTH_GENERIC_OIDC_ID is required for NyxID OAuth');
  }

  if (!issuer) {
    throw new Error('AUTH_GENERIC_OIDC_ISSUER is required for NyxID OAuth');
  }

  return {
    clientId,
    issuer: normalizeIssuer(issuer),
  };
};

export const getNyxIdOAuthConfig = (): NyxIdOAuthConfig => {
  return getConfig();
};

export const isNyxIdOAuthEnabled = (): boolean => {
  return Boolean(authEnv.AUTH_GENERIC_OIDC_ID && authEnv.AUTH_GENERIC_OIDC_ISSUER);
};

export const discoverNyxId = async (fetcher: FetchLike = fetch): Promise<NyxIdDiscoveryDocument> => {
  const { issuer } = getConfig();
  const discoveryUrl = new URL(OPENID_DISCOVERY_PATH, `${issuer}/`).toString();
  const response = await fetcher(discoveryUrl, {
    headers: { Accept: 'application/json' },
    method: 'GET',
  });

  if (!response.ok) {
    throw new Error(`NyxID discovery failed: ${response.status} ${response.statusText}`);
  }

  const payload = await parseJsonResponse(response);
  if (!isRecord(payload)) {
    throw new Error('NyxID discovery document is not an object');
  }

  return {
    authorizationEndpoint: getString(
      payload.authorization_endpoint,
      'discovery authorization_endpoint',
    ),
    codeChallengeMethodsSupported: getOptionalStringArray(payload.code_challenge_methods_supported),
    issuer: getString(payload.issuer, 'discovery issuer'),
    jwksUri: typeof payload.jwks_uri === 'string' ? payload.jwks_uri : undefined,
    tokenEndpoint: getString(payload.token_endpoint, 'discovery token_endpoint'),
    tokenEndpointAuthMethodsSupported: getOptionalStringArray(
      payload.token_endpoint_auth_methods_supported,
    ),
    userinfoEndpoint: typeof payload.userinfo_endpoint === 'string' ? payload.userinfo_endpoint : undefined,
  };
};

export const buildNyxIdAuthorizationUrl = async (
  params: BuildNyxIdAuthorizationUrlParams,
  fetcher: FetchLike = fetch,
): Promise<string> => {
  const discovery = await discoverNyxId(fetcher);
  const { clientId } = getConfig();

  const url = new URL(discovery.authorizationEndpoint);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('prompt', params.prompt ?? 'consent');
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', params.scope ?? DEFAULT_SCOPE);
  url.searchParams.set('state', params.state);

  return url.toString();
};

const parseOAuthErrorMessage = async (response: Response) => {
  const payload = await parseJsonResponse(response).catch(() => undefined);

  if (isRecord(payload)) {
    const description =
      typeof payload.error_description === 'string' ? payload.error_description : undefined;
    const errorCode = typeof payload.error === 'string' ? payload.error : undefined;
    return [response.status, response.statusText, description || errorCode].filter(Boolean).join(' ');
  }

  return `${response.status} ${response.statusText}`.trim();
};

const postTokenRequest = async (
  body: URLSearchParams,
  fetcher: FetchLike = fetch,
): Promise<NyxIdTokenResponse> => {
  const discovery = await discoverNyxId(fetcher);
  const response = await fetcher(discovery.tokenEndpoint, {
    body: body.toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(`NyxID token request failed: ${await parseOAuthErrorMessage(response)}`);
  }

  const payload = await parseJsonResponse(response);
  return parseTokenResponse(payload);
};

export const exchangeNyxIdAuthorizationCode = async (
  params: ExchangeNyxIdCodeParams,
  fetcher: FetchLike = fetch,
): Promise<NyxIdTokenResponse> => {
  const { clientId } = getConfig();
  const body = new URLSearchParams({
    client_id: clientId,
    code: params.code,
    code_verifier: params.codeVerifier,
    grant_type: 'authorization_code',
    redirect_uri: params.redirectUri,
  });

  return postTokenRequest(body, fetcher);
};

export const refreshNyxIdAccessToken = async (
  params: RefreshNyxIdTokenParams,
  fetcher: FetchLike = fetch,
): Promise<NyxIdTokenResponse> => {
  const { clientId } = getConfig();
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
  });

  return postTokenRequest(body, fetcher);
};

export const nyxIdCookieNames = {
  accessToken: 'nyxid_access_token',
  codeVerifier: 'nyxid_code_verifier',
  expiresAt: 'nyxid_token_expires_at',
  refreshToken: 'nyxid_refresh_token',
  returnTo: 'nyxid_return_to',
  scope: 'nyxid_token_scope',
  state: 'nyxid_auth_state',
} as const;

export const nyxIdDefaultScope = DEFAULT_SCOPE;

export const nyxIdRefreshCookieMaxAge = NYXID_REFRESH_COOKIE_MAX_AGE;

export const extractNyxIdAccessTokenFromCookieHeader = (
  cookieHeader?: string | null,
): string | undefined => {
  if (!cookieHeader) return;

  const cookies = parse(cookieHeader);
  const accessToken = cookies[nyxIdCookieNames.accessToken];

  return typeof accessToken === 'string' && accessToken ? accessToken : undefined;
};

export const parseNyxIdCookies = (cookieHeader?: string | null) => {
  const cookies = cookieHeader ? parse(cookieHeader) : {};

  return {
    accessToken:
      typeof cookies[nyxIdCookieNames.accessToken] === 'string' &&
      cookies[nyxIdCookieNames.accessToken]
        ? cookies[nyxIdCookieNames.accessToken]
        : undefined,
    expiresAt: Number(cookies[nyxIdCookieNames.expiresAt]) || undefined,
    refreshToken:
      typeof cookies[nyxIdCookieNames.refreshToken] === 'string' &&
      cookies[nyxIdCookieNames.refreshToken]
        ? cookies[nyxIdCookieNames.refreshToken]
        : undefined,
    scope:
      typeof cookies[nyxIdCookieNames.scope] === 'string' && cookies[nyxIdCookieNames.scope]
        ? cookies[nyxIdCookieNames.scope]
        : undefined,
  };
};

export const createNyxIdSessionCookieHeaders = (
  tokenResponse: NyxIdTokenResponse,
  options: NyxIdCookieOptions,
): string[] => {
  const expiresAt = Date.now() + tokenResponse.expiresIn * 1000;
  const cookieOptions = {
    httpOnly: true,
    path: '/',
    sameSite: 'lax' as const,
    secure: options.secure,
  };

  const headers = [
    serialize(nyxIdCookieNames.accessToken, tokenResponse.accessToken, {
      ...cookieOptions,
      maxAge: tokenResponse.expiresIn,
    }),
    serialize(nyxIdCookieNames.expiresAt, String(expiresAt), {
      ...cookieOptions,
      maxAge: tokenResponse.expiresIn,
    }),
    serialize(nyxIdCookieNames.scope, tokenResponse.scope ?? '', {
      ...cookieOptions,
      maxAge: tokenResponse.expiresIn,
    }),
  ];

  if (tokenResponse.refreshToken) {
    headers.push(
      serialize(nyxIdCookieNames.refreshToken, tokenResponse.refreshToken, {
        ...cookieOptions,
        maxAge: NYXID_REFRESH_COOKIE_MAX_AGE,
      }),
    );
  }

  return headers;
};

export const isNyxIdAccessTokenExpired = (expiresAt?: number): boolean => {
  if (!expiresAt) return false;

  return expiresAt <= Date.now() + NYXID_REFRESH_WINDOW_MS;
};

export const refreshNyxIdSessionFromCookies = async (
  cookieHeader: string | null | undefined,
  options: NyxIdCookieOptions,
  fetcher?: FetchLike,
): Promise<RefreshedNyxIdSession | undefined> => {
  const { accessToken, expiresAt, refreshToken } = parseNyxIdCookies(cookieHeader);

  if (!accessToken || !refreshToken || !isNyxIdAccessTokenExpired(expiresAt)) {
    return;
  }

  const tokenResponse = await refreshNyxIdAccessToken({ refreshToken }, fetcher);

  return {
    setCookieHeaders: createNyxIdSessionCookieHeaders(tokenResponse, options),
    tokenResponse,
  };
};
