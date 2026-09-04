import { createWithEqualityFn } from 'zustand/traditional';

/**
 * Minimal NyxID auth state used for aevatar-specific bearer injection and login flow UI.
 */
export interface NyxIdAuthState {
  expiresAt?: number;
  refreshToken?: string;
  status: 'authenticated' | 'idle' | 'pending';
  token?: string;
}

/**
 * Public NyxID auth actions for renderer-side state transitions.
 */
export interface NyxIdAuthAction {
  clearNyxIdAuth: () => void;
  setNyxIdAuthenticated: (params: {
    expiresAt?: number;
    refreshToken?: string;
    token: string;
  }) => void;
  setNyxIdPending: () => void;
}

export type NyxIdAuthStore = NyxIdAuthState & NyxIdAuthAction;

const initialState: NyxIdAuthState = {
  expiresAt: undefined,
  refreshToken: undefined,
  status: 'idle',
  token: undefined,
};

export const useNyxIdAuthStore = createWithEqualityFn<NyxIdAuthStore>()((set) => ({
  ...initialState,
  clearNyxIdAuth: () => set({ ...initialState }),
  setNyxIdAuthenticated: ({ token, refreshToken, expiresAt }) =>
    set({
      expiresAt,
      refreshToken,
      status: 'authenticated',
      token,
    }),
  setNyxIdPending: () => set({ status: 'pending' }),
}));

export const getNyxIdAuthStoreState = () => useNyxIdAuthStore.getState();
