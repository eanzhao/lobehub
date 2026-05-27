import { describe, expect, it, vi } from 'vitest';

import * as nyxIdAuth from '@/business/server/nyxid-auth';

import { GET } from '../route';

vi.mock('@/envs/app', () => ({
  appEnv: {
    APP_URL: 'https://app.example.com',
  },
}));

describe('GET /api/auth/nyxid/callback', () => {
  const createCallbackRequest = (url: string, cookie?: string) =>
    ({
      headers: {
        get: (name: string) => (name.toLowerCase() === 'cookie' ? cookie ?? null : null),
      },
      url,
    }) as Request;

  it('redirects to signin with callback_error when required cookies are missing', async () => {
    const response = await GET(new Request('https://app.example.com/api/auth/nyxid/callback'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://app.example.com/signin?nyxid=callback_error');
  });

  it('redirects to signin with callback_error on state mismatch', async () => {
    const request = createCallbackRequest(
      'https://app.example.com/api/auth/nyxid/callback?code=code-123&state=wrong-state',
      [
        `${nyxIdAuth.nyxIdCookieNames.codeVerifier}=verifier-123`,
        `${nyxIdAuth.nyxIdCookieNames.returnTo}=%2Fdesktop`,
        `${nyxIdAuth.nyxIdCookieNames.state}=expected-state`,
      ].join('; '),
    );

    const response = await GET(request);

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://app.example.com/signin?nyxid=callback_error');
  });

  it('sets all NyxID cookies with httpOnly and maxAge on success', async () => {
    vi.spyOn(nyxIdAuth, 'exchangeNyxIdAuthorizationCode').mockResolvedValueOnce({
      accessToken: 'access-123',
      expiresIn: 3600,
      refreshToken: 'refresh-123',
      scope: 'openid profile',
      tokenType: 'Bearer',
    });

    const request = createCallbackRequest(
      'https://app.example.com/api/auth/nyxid/callback?code=code-123&state=expected-state',
      [
        `${nyxIdAuth.nyxIdCookieNames.codeVerifier}=verifier-123`,
        `${nyxIdAuth.nyxIdCookieNames.returnTo}=/desktop`,
        `${nyxIdAuth.nyxIdCookieNames.state}=expected-state`,
      ].join('; '),
    );

    const response = await GET(request);
    const setCookies = response.headers.getSetCookie();

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://app.example.com/desktop');
    expect(setCookies).toHaveLength(7);

    const accessCookie = setCookies.find((value) =>
      value.startsWith(`${nyxIdAuth.nyxIdCookieNames.accessToken}=access-123;`),
    );
    const expiresCookie = setCookies.find((value) =>
      value.startsWith(`${nyxIdAuth.nyxIdCookieNames.expiresAt}=`),
    );
    const scopeCookie = setCookies.find((value) =>
      value.startsWith(`${nyxIdAuth.nyxIdCookieNames.scope}=openid%20profile;`),
    );
    const refreshCookie = setCookies.find((value) =>
      value.startsWith(`${nyxIdAuth.nyxIdCookieNames.refreshToken}=refresh-123;`),
    );

    expect(accessCookie).toContain('HttpOnly');
    expect(accessCookie).toContain('Max-Age=3600');
    expect(expiresCookie).toContain('HttpOnly');
    expect(expiresCookie).toContain('Max-Age=3600');
    expect(scopeCookie).toContain('HttpOnly');
    expect(scopeCookie).toContain('Max-Age=3600');
    expect(refreshCookie).toContain('HttpOnly');
    expect(refreshCookie).toContain(`Max-Age=${nyxIdAuth.nyxIdRefreshCookieMaxAge}`);
    expect(accessCookie).toContain('Secure');
    expect(expiresCookie).toContain('Secure');
    expect(scopeCookie).toContain('Secure');
    expect(refreshCookie).toContain('Secure');
  });
});
