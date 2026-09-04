import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildNyxIdAuthorizationUrl,
  createNyxIdSessionCookieHeaders,
  discoverNyxId,
  exchangeNyxIdAuthorizationCode,
  isNyxIdAccessTokenExpired,
  nyxIdCookieNames,
  nyxIdRefreshCookieMaxAge,
  parseNyxIdCookies,
  refreshNyxIdAccessToken,
  refreshNyxIdSessionFromCookies,
} from './nyxid-auth';

vi.mock('@/envs/auth', () => ({
  authEnv: {
    AUTH_GENERIC_OIDC_ID: 'aevatar-desktop',
    AUTH_GENERIC_OIDC_ISSUER: 'https://nyxid.example.com',
  },
}));

const createJsonResponse = (body: Record<string, unknown>, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
    ...init,
  });

describe('nyxid-auth', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('discovers NyxID OpenID metadata', async () => {
    fetchSpy.mockResolvedValueOnce(
      createJsonResponse({
        authorization_endpoint: 'https://nyxid.example.com/oauth/authorize',
        code_challenge_methods_supported: ['S256'],
        issuer: 'https://nyxid.example.com',
        jwks_uri: 'https://nyxid.example.com/.well-known/jwks.json',
        token_endpoint: 'https://nyxid.example.com/oauth/token',
        token_endpoint_auth_methods_supported: ['none'],
        userinfo_endpoint: 'https://nyxid.example.com/oauth/userinfo',
      }),
    );

    await expect(discoverNyxId(fetchSpy)).resolves.toEqual({
      authorizationEndpoint: 'https://nyxid.example.com/oauth/authorize',
      codeChallengeMethodsSupported: ['S256'],
      issuer: 'https://nyxid.example.com',
      jwksUri: 'https://nyxid.example.com/.well-known/jwks.json',
      tokenEndpoint: 'https://nyxid.example.com/oauth/token',
      tokenEndpointAuthMethodsSupported: ['none'],
      userinfoEndpoint: 'https://nyxid.example.com/oauth/userinfo',
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://nyxid.example.com/.well-known/openid-configuration',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('builds an authorization url with PKCE parameters', async () => {
    fetchSpy.mockResolvedValueOnce(
      createJsonResponse({
        authorization_endpoint: 'https://nyxid.example.com/oauth/authorize',
        issuer: 'https://nyxid.example.com',
        token_endpoint: 'https://nyxid.example.com/oauth/token',
      }),
    );

    const url = await buildNyxIdAuthorizationUrl(
      {
        codeChallenge: 'challenge-123',
        redirectUri: 'aevatar://oauth-callback',
        state: 'state-123',
      },
      fetchSpy,
    );

    expect(url).toContain('https://nyxid.example.com/oauth/authorize?');
    expect(url).toContain('client_id=aevatar-desktop');
    expect(url).toContain('code_challenge=challenge-123');
    expect(url).toContain('code_challenge_method=S256');
    expect(url).toContain(`redirect_uri=${encodeURIComponent('aevatar://oauth-callback')}`);
    expect(url).toContain('response_type=code');
    expect(url).toContain('scope=openid+profile+email+offline_access');
    expect(url).toContain('state=state-123');
  });

  it('exchanges an authorization code for tokens', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        createJsonResponse({
          authorization_endpoint: 'https://nyxid.example.com/oauth/authorize',
          issuer: 'https://nyxid.example.com',
          token_endpoint: 'https://nyxid.example.com/oauth/token',
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          access_token: 'access-123',
          expires_in: 3600,
          refresh_token: 'refresh-123',
          scope: 'openid profile',
          token_type: 'Bearer',
        }),
      );

    await expect(
      exchangeNyxIdAuthorizationCode(
        {
          code: 'code-123',
          codeVerifier: 'verifier-123',
          redirectUri: 'aevatar://oauth-callback',
        },
        fetchSpy,
      ),
    ).resolves.toEqual({
      accessToken: 'access-123',
      expiresIn: 3600,
      refreshToken: 'refresh-123',
      scope: 'openid profile',
      tokenType: 'Bearer',
    });

    expect(fetchSpy).toHaveBeenLastCalledWith(
      'https://nyxid.example.com/oauth/token',
      expect.objectContaining({
        body: expect.stringContaining('grant_type=authorization_code'),
        method: 'POST',
      }),
    );
  });

  it('refreshes a token', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        createJsonResponse({
          authorization_endpoint: 'https://nyxid.example.com/oauth/authorize',
          issuer: 'https://nyxid.example.com',
          token_endpoint: 'https://nyxid.example.com/oauth/token',
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          access_token: 'access-next',
          expires_in: 1800,
          refresh_token: 'refresh-next',
          token_type: 'Bearer',
        }),
      );

    await expect(refreshNyxIdAccessToken({ refreshToken: 'refresh-123' }, fetchSpy)).resolves.toEqual(
      {
        accessToken: 'access-next',
        expiresIn: 1800,
        refreshToken: 'refresh-next',
        scope: undefined,
        tokenType: 'Bearer',
      },
    );

    expect(fetchSpy).toHaveBeenLastCalledWith(
      'https://nyxid.example.com/oauth/token',
      expect.objectContaining({
        body: expect.stringContaining('grant_type=refresh_token'),
        method: 'POST',
      }),
    );
  });

  it('surfaces oauth error details from the token endpoint', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        createJsonResponse({
          authorization_endpoint: 'https://nyxid.example.com/oauth/authorize',
          issuer: 'https://nyxid.example.com',
          token_endpoint: 'https://nyxid.example.com/oauth/token',
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse(
          {
            error: 'invalid_grant',
            error_description: 'Authorization code expired',
          },
          { status: 400, statusText: 'Bad Request' },
        ),
      );

    await expect(
      exchangeNyxIdAuthorizationCode(
        {
          code: 'expired-code',
          codeVerifier: 'verifier-123',
          redirectUri: 'aevatar://oauth-callback',
        },
        fetchSpy,
      ),
    ).rejects.toThrow(
      'NyxID token request failed: 400 Bad Request Authorization code expired',
    );
  });

  it('parses NyxID cookies from request header', () => {
    expect(
      parseNyxIdCookies(
        [
          `${nyxIdCookieNames.accessToken}=access-token`,
          `${nyxIdCookieNames.expiresAt}=123456`,
          `${nyxIdCookieNames.refreshToken}=refresh-token`,
          `${nyxIdCookieNames.scope}=openid%20profile`,
        ].join('; '),
      ),
    ).toEqual({
      accessToken: 'access-token',
      expiresAt: 123456,
      refreshToken: 'refresh-token',
      scope: 'openid profile',
    });
  });

  it('creates persistent NyxID session cookies', () => {
    const headers = createNyxIdSessionCookieHeaders(
      {
        accessToken: 'access-token',
        expiresIn: 3600,
        refreshToken: 'refresh-token',
        scope: 'openid profile',
        tokenType: 'Bearer',
      },
      { secure: true },
    );

    expect(headers).toHaveLength(4);
    expect(headers[0]).toContain(`${nyxIdCookieNames.accessToken}=access-token`);
    expect(headers[0]).toContain('HttpOnly');
    expect(headers[0]).toContain('Max-Age=3600');
    expect(headers[0]).toContain('Secure');
    expect(headers[2]).toContain(`${nyxIdCookieNames.scope}=openid%20profile`);
    expect(headers[3]).toContain(`${nyxIdCookieNames.refreshToken}=refresh-token`);
    expect(headers[3]).toContain(`Max-Age=${nyxIdRefreshCookieMaxAge}`);
  });

  it('detects when NyxID access token is expired or near expiry', () => {
    expect(isNyxIdAccessTokenExpired(Date.now() - 1000)).toBe(true);
    expect(isNyxIdAccessTokenExpired(Date.now() + 30 * 1000)).toBe(true);
    expect(isNyxIdAccessTokenExpired(Date.now() + 5 * 60 * 1000)).toBe(false);
  });

  it('refreshes expired NyxID session from cookies', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        createJsonResponse({
          authorization_endpoint: 'https://nyxid.example.com/oauth/authorize',
          issuer: 'https://nyxid.example.com',
          token_endpoint: 'https://nyxid.example.com/oauth/token',
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          access_token: 'access-next',
          expires_in: 1800,
          refresh_token: 'refresh-next',
          scope: 'openid profile',
          token_type: 'Bearer',
        }),
      );

    await expect(
      refreshNyxIdSessionFromCookies(
        [
          `${nyxIdCookieNames.accessToken}=access-old`,
          `${nyxIdCookieNames.expiresAt}=${Date.now() - 1000}`,
          `${nyxIdCookieNames.refreshToken}=refresh-old`,
        ].join('; '),
        { secure: false },
        fetchSpy,
      ),
    ).resolves.toMatchObject({
      tokenResponse: {
        accessToken: 'access-next',
        expiresIn: 1800,
        refreshToken: 'refresh-next',
        scope: 'openid profile',
        tokenType: 'Bearer',
      },
    });
  });

  it('skips NyxID refresh when token is still valid', async () => {
    await expect(
      refreshNyxIdSessionFromCookies(
        [
          `${nyxIdCookieNames.accessToken}=access-old`,
          `${nyxIdCookieNames.expiresAt}=${Date.now() + 10 * 60 * 1000}`,
          `${nyxIdCookieNames.refreshToken}=refresh-old`,
        ].join('; '),
        { secure: false },
        fetchSpy,
      ),
    ).resolves.toBeUndefined();

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
