import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requireAuth, userAuthMiddleware } from './auth';

interface TestHonoEnv {
  Variables: {
    authData: unknown;
    authorizationHeader: string | null;
    authType: string | null;
    userId: string | null;
  };
}

const {
  mockAssertOIDCUserActive,
  mockAuthEnv,
  mockEnsureOIDCUserRecord,
  mockExtractBearerToken,
  mockExtractNyxIdAccessTokenFromCookieHeader,
  mockGetServerDB,
  mockIsStatelessOIDCAuthEnabled,
  mockRefreshNyxIdSessionFromCookies,
  mockServerDB,
  mockValidateApiKeyFormat,
  mockValidateOIDCJWT,
} = vi.hoisted(() => ({
  mockAssertOIDCUserActive: vi.fn(),
  mockAuthEnv: { ENABLE_OIDC: true },
  mockEnsureOIDCUserRecord: vi.fn(),
  mockExtractBearerToken: vi.fn(),
  mockExtractNyxIdAccessTokenFromCookieHeader: vi.fn(),
  mockGetServerDB: vi.fn(),
  mockIsStatelessOIDCAuthEnabled: vi.fn(),
  mockRefreshNyxIdSessionFromCookies: vi.fn(),
  mockServerDB: {},
  mockValidateApiKeyFormat: vi.fn(),
  mockValidateOIDCJWT: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: mockGetServerDB,
}));

vi.mock('@/database/models/apiKey', () => ({
  ApiKeyModel: class {},
}));

vi.mock('@/business/server/nyxid-auth', () => ({
  extractNyxIdAccessTokenFromCookieHeader: mockExtractNyxIdAccessTokenFromCookieHeader,
  refreshNyxIdSessionFromCookies: mockRefreshNyxIdSessionFromCookies,
}));

vi.mock('@/envs/auth', () => ({
  authEnv: mockAuthEnv,
}));

vi.mock('@/libs/oidc-provider/access-control', () => ({
  assertOIDCUserActive: mockAssertOIDCUserActive,
}));

vi.mock('@/libs/oidc-provider/jwt', () => ({
  ensureOIDCUserRecord: mockEnsureOIDCUserRecord,
  isStatelessOIDCAuthEnabled: mockIsStatelessOIDCAuthEnabled,
  validateOIDCJWT: mockValidateOIDCJWT,
}));

vi.mock('@/utils/apiKey', () => ({
  validateApiKeyFormat: mockValidateApiKeyFormat,
}));

vi.mock('@/utils/server/auth', () => ({
  extractBearerToken: mockExtractBearerToken,
}));

const createApp = () => {
  const app = new Hono<TestHonoEnv>();

  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse();

    return c.text(error.message, 500);
  });

  app.use('*', userAuthMiddleware);
  app.get('/protected', requireAuth, (c) =>
    c.json({
      authType: c.get('authType'),
      userId: c.get('userId'),
    }),
  );

  return app;
};

describe('OpenAPI auth middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthEnv.ENABLE_OIDC = true;
    mockExtractBearerToken.mockReturnValue('oidc-token');
    mockExtractNyxIdAccessTokenFromCookieHeader.mockReturnValue(undefined);
    mockGetServerDB.mockResolvedValue(mockServerDB);
    mockIsStatelessOIDCAuthEnabled.mockReturnValue(true);
    mockRefreshNyxIdSessionFromCookies.mockResolvedValue(undefined);
    mockValidateApiKeyFormat.mockReturnValue(false);
    mockEnsureOIDCUserRecord.mockResolvedValue(undefined);
    mockValidateOIDCJWT.mockResolvedValue({
      tokenData: { sub: 'oidc-user' },
      userId: 'oidc-user',
    });
    mockAssertOIDCUserActive.mockResolvedValue(undefined);
  });

  it('should authenticate an active OIDC bearer token', async () => {
    const app = createApp();

    const response = await app.request('/protected', {
      headers: { Authorization: 'Bearer oidc-token' },
    });

    await expect(response.json()).resolves.toEqual({
      authType: 'oidc',
      userId: 'oidc-user',
    });
    expect(response.status).toBe(200);
    expect(mockValidateOIDCJWT).toHaveBeenCalledWith('oidc-token');
    expect(mockEnsureOIDCUserRecord).toHaveBeenCalledWith(mockServerDB, expect.any(Object));
    expect(mockAssertOIDCUserActive).toHaveBeenCalledWith(mockServerDB, 'oidc-user');
  });

  it('should reject an inactive OIDC bearer token without authenticating the request', async () => {
    const app = createApp();
    const inactiveError = Object.assign(new Error('OIDC user is no longer active'), {
      code: 'UNAUTHORIZED',
    });
    mockValidateOIDCJWT.mockResolvedValueOnce({
      tokenData: { sub: 'banned-user' },
      userId: 'banned-user',
    });
    mockEnsureOIDCUserRecord.mockResolvedValueOnce(undefined);
    mockAssertOIDCUserActive.mockRejectedValueOnce(inactiveError);

    const response = await app.request('/protected', {
      headers: { Authorization: 'Bearer oidc-token' },
    });

    expect(response.status).toBe(401);
    expect(mockAssertOIDCUserActive).toHaveBeenCalledWith(mockServerDB, 'banned-user');
  });

  it('should refresh expired NyxID cookie auth and append Set-Cookie', async () => {
    const app = createApp();
    mockExtractBearerToken.mockReturnValue(undefined);
    mockRefreshNyxIdSessionFromCookies.mockResolvedValueOnce({
      setCookieHeaders: ['nyxid_access_token=fresh; Path=/; HttpOnly'],
      tokenResponse: { accessToken: 'fresh-token' },
    });

    const response = await app.request('/protected', {
      headers: { cookie: 'nyxid_access_token=stale' },
    });

    await expect(response.json()).resolves.toEqual({
      authType: 'oidc',
      userId: 'oidc-user',
    });
    expect(mockValidateOIDCJWT).toHaveBeenCalledWith('fresh-token');
    expect(response.headers.get('set-cookie')).toContain('nyxid_access_token=fresh');
  });
});
