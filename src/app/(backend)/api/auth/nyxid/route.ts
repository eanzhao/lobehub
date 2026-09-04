import { createHash, randomBytes } from 'node:crypto';

import { appEnv } from '@/envs/app';
import {
  buildNyxIdAuthorizationUrl,
  nyxIdCookieNames,
  nyxIdDefaultScope,
} from '@/business/server/nyxid-auth';
import { NextResponse } from 'next/server';

const codeVerifierBytes = 32;
const stateBytes = 16;
const cookieMaxAgeSeconds = 10 * 60;

const toBase64Url = (value: Buffer) => value.toString('base64url');

const createCodeVerifier = () => toBase64Url(randomBytes(codeVerifierBytes));

const createCodeChallenge = (codeVerifier: string) =>
  createHash('sha256').update(codeVerifier).digest('base64url');

const createState = () => randomBytes(stateBytes).toString('hex');

const getCallbackUrl = () => new URL('/api/auth/nyxid/callback', appEnv.APP_URL).toString();

const normalizeReturnTo = (returnTo: string | null): string => {
  if (!returnTo) return '/';
  if (!returnTo.startsWith('/')) return '/';
  if (returnTo.startsWith('//')) return '/';

  return returnTo;
};

export const GET = async (request: Request) => {
  const requestUrl = new URL(request.url);
  const returnTo = normalizeReturnTo(requestUrl.searchParams.get('returnTo'));
  const codeVerifier = createCodeVerifier();
  const state = createState();

  const authorizationUrl = await buildNyxIdAuthorizationUrl({
    codeChallenge: createCodeChallenge(codeVerifier),
    redirectUri: getCallbackUrl(),
    scope: nyxIdDefaultScope,
    state,
  });

  const response = NextResponse.redirect(authorizationUrl);

  response.cookies.set(nyxIdCookieNames.codeVerifier, codeVerifier, {
    httpOnly: true,
    maxAge: cookieMaxAgeSeconds,
    path: '/',
    sameSite: 'lax',
    secure: requestUrl.protocol === 'https:',
  });
  response.cookies.set(nyxIdCookieNames.returnTo, returnTo, {
    httpOnly: true,
    maxAge: cookieMaxAgeSeconds,
    path: '/',
    sameSite: 'lax',
    secure: requestUrl.protocol === 'https:',
  });
  response.cookies.set(nyxIdCookieNames.state, state, {
    httpOnly: true,
    maxAge: cookieMaxAgeSeconds,
    path: '/',
    sameSite: 'lax',
    secure: requestUrl.protocol === 'https:',
  });

  return response;
};
