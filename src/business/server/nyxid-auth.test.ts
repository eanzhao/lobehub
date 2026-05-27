import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildNyxIdAuthorizationUrl,
  discoverNyxId,
  exchangeNyxIdAuthorizationCode,
  refreshNyxIdAccessToken,
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
});
