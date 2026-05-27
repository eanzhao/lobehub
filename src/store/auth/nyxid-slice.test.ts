import { beforeEach, describe, expect, it } from 'vitest';

import { getNyxIdAuthStoreState, useNyxIdAuthStore } from './nyxid-slice';

describe('nyxid-slice', () => {
  beforeEach(() => {
    useNyxIdAuthStore.setState({
      clearNyxIdAuth: getNyxIdAuthStoreState().clearNyxIdAuth,
      expiresAt: undefined,
      refreshToken: undefined,
      setNyxIdAuthenticated: getNyxIdAuthStoreState().setNyxIdAuthenticated,
      setNyxIdPending: getNyxIdAuthStoreState().setNyxIdPending,
      status: 'idle',
      token: undefined,
    });
  });

  it('transitions into pending state', () => {
    getNyxIdAuthStoreState().setNyxIdPending();

    expect(getNyxIdAuthStoreState().status).toBe('pending');
  });

  it('stores authenticated credentials', () => {
    getNyxIdAuthStoreState().setNyxIdAuthenticated({
      expiresAt: 123,
      refreshToken: 'refresh-token',
      token: 'access-token',
    });

    expect(getNyxIdAuthStoreState()).toMatchObject({
      expiresAt: 123,
      refreshToken: 'refresh-token',
      status: 'authenticated',
      token: 'access-token',
    });
  });

  it('clears NyxID auth state', () => {
    getNyxIdAuthStoreState().setNyxIdAuthenticated({
      expiresAt: 123,
      refreshToken: 'refresh-token',
      token: 'access-token',
    });

    getNyxIdAuthStoreState().clearNyxIdAuth();

    expect(getNyxIdAuthStoreState()).toMatchObject({
      expiresAt: undefined,
      refreshToken: undefined,
      status: 'idle',
      token: undefined,
    });
  });
});
