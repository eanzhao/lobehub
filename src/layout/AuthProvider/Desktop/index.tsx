'use client';

import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { type PropsWithChildren } from 'react';
import { memo, useEffect } from 'react';
import { createStoreUpdater } from 'zustand-utils';

import { useNyxIdAuthStore } from '@/store/auth/nyxid-slice';
import { useUserStore } from '@/store/user';

const DesktopAuthProvider = memo<PropsWithChildren>(({ children }) => {
  const useStoreUpdater = createStoreUpdater(useUserStore);
  const isUserStateInit = useUserStore((s) => s.isUserStateInit);
  const setNyxIdPending = useNyxIdAuthStore((s) => s.setNyxIdPending);

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

  return children;
});

export default DesktopAuthProvider;
