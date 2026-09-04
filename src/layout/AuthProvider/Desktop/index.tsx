'use client';

import {
  type NyxIdAuthorizationPayload,
  useWatchBroadcast,
} from '@lobechat/electron-client-ipc';
import { type PropsWithChildren } from 'react';
import { memo, useEffect } from 'react';
import { createStoreUpdater } from 'zustand-utils';

import { useNyxIdAuthStore } from '@/store/auth/nyxid-slice';
import { useUserStore } from '@/store/user';

const DesktopAuthProvider = memo<PropsWithChildren>(({ children }) => {
  const useStoreUpdater = createStoreUpdater(useUserStore);
  const isUserStateInit = useUserStore((s) => s.isUserStateInit);
  const clearNyxIdAuth = useNyxIdAuthStore((s) => s.clearNyxIdAuth);
  const setNyxIdAuthenticated = useNyxIdAuthStore((s) => s.setNyxIdAuthenticated);
  const setNyxIdPending = useNyxIdAuthStore((s) => s.setNyxIdPending);

  const syncNyxIdAuth = (payload?: NyxIdAuthorizationPayload) => {
    if (!payload?.accessToken) {
      clearNyxIdAuth();
      return;
    }

    setNyxIdAuthenticated({
      expiresAt: payload.expiresAt,
      refreshToken: payload.refreshToken,
      token: payload.accessToken,
    });
  };

  useStoreUpdater('isLoaded', true);
  // Desktop mode uses local auth (DESKTOP_USER_ID) on server,
  // so client should be treated as signed-in to enable data initialization.
  useEffect(() => {
    if (isUserStateInit) {
      useUserStore.setState({ isSignedIn: true });
    }
  }, [isUserStateInit]);

  useWatchBroadcast('authorizationProgress', (progress) => {
    if (progress.phase === 'browser_opened' || progress.phase === 'verifying') {
      setNyxIdPending();
    }
  });

  useWatchBroadcast('authorizationSuccessful', syncNyxIdAuth);
  useWatchBroadcast('tokenRefreshed', syncNyxIdAuth);

  return children;
});

export default DesktopAuthProvider;
