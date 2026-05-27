import { nyxIdCookieNames } from '@/business/server/nyxid-auth';
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

export const POST = async () => {
  const response = NextResponse.json({ ok: true });

  for (const cookieName of Object.values(nyxIdCookieNames)) {
    clearNyxIdCookie(response, cookieName);
  }

  return response;
};
