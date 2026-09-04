import {
  exchangeNyxIdAuthorizationCode,
  nyxIdCookieNames,
  nyxIdRefreshCookieMaxAge,
} from '@/business/server/nyxid-auth';
import { appEnv } from '@/envs/app';
import { NextResponse } from 'next/server';

const clearNyxIdCookie = (
  response: NextResponse,
  name: (typeof nyxIdCookieNames)[keyof typeof nyxIdCookieNames],
) => {
  response.cookies.set(name, '', {
    expires: new Date(0),
    httpOnly: true,
    path: '/',
  });
};

const getCallbackUrl = () => new URL('/api/auth/nyxid/callback', appEnv.APP_URL).toString();

const buildSigninRedirect = (reason: string) => {
  const redirectUrl = new URL('/signin', appEnv.APP_URL);
  redirectUrl.searchParams.set('nyxid', reason);
  return redirectUrl;
};

export const GET = async (request: Request) => {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const state = requestUrl.searchParams.get('state');
  const responseError = NextResponse.redirect(buildSigninRedirect('callback_error'));

  const requestCookies = request.headers.get('cookie') ?? '';
  const expectedState = requestCookies
    .split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${nyxIdCookieNames.state}=`))
    ?.slice(`${nyxIdCookieNames.state}=`.length);
  const codeVerifier = requestCookies
    .split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${nyxIdCookieNames.codeVerifier}=`))
    ?.slice(`${nyxIdCookieNames.codeVerifier}=`.length);
  const returnTo =
    requestCookies
      .split(';')
      .map((value) => value.trim())
      .find((value) => value.startsWith(`${nyxIdCookieNames.returnTo}=`))
      ?.slice(`${nyxIdCookieNames.returnTo}=`.length) || '/';

  if (!code || !state || !expectedState || !codeVerifier || state !== expectedState) {
    clearNyxIdCookie(responseError, nyxIdCookieNames.codeVerifier);
    clearNyxIdCookie(responseError, nyxIdCookieNames.returnTo);
    clearNyxIdCookie(responseError, nyxIdCookieNames.state);
    return responseError;
  }

  try {
    const tokenResponse = await exchangeNyxIdAuthorizationCode({
      code,
      codeVerifier,
      redirectUri: getCallbackUrl(),
    });
    const redirectUrl = new URL(returnTo, appEnv.APP_URL);
    const response = NextResponse.redirect(redirectUrl);
    const secure = requestUrl.protocol === 'https:';
    const expiresAt = Date.now() + tokenResponse.expiresIn * 1000;

    response.cookies.set(nyxIdCookieNames.accessToken, tokenResponse.accessToken, {
      httpOnly: true,
      maxAge: tokenResponse.expiresIn,
      path: '/',
      sameSite: 'lax',
      secure,
    });
    response.cookies.set(nyxIdCookieNames.expiresAt, String(expiresAt), {
      httpOnly: true,
      maxAge: tokenResponse.expiresIn,
      path: '/',
      sameSite: 'lax',
      secure,
    });
    response.cookies.set(nyxIdCookieNames.scope, tokenResponse.scope ?? '', {
      httpOnly: true,
      maxAge: tokenResponse.expiresIn,
      path: '/',
      sameSite: 'lax',
      secure,
    });

    if (tokenResponse.refreshToken) {
      response.cookies.set(nyxIdCookieNames.refreshToken, tokenResponse.refreshToken, {
        httpOnly: true,
        maxAge: nyxIdRefreshCookieMaxAge,
        path: '/',
        sameSite: 'lax',
        secure,
      });
    }

    clearNyxIdCookie(response, nyxIdCookieNames.codeVerifier);
    clearNyxIdCookie(response, nyxIdCookieNames.returnTo);
    clearNyxIdCookie(response, nyxIdCookieNames.state);

    return response;
  } catch {
    clearNyxIdCookie(responseError, nyxIdCookieNames.codeVerifier);
    clearNyxIdCookie(responseError, nyxIdCookieNames.returnTo);
    clearNyxIdCookie(responseError, nyxIdCookieNames.state);
    return responseError;
  }
};
