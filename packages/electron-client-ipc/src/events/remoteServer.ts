export interface MarketAuthorizationParams {
  authUrl: string;
}

export interface NyxIdAuthorizationPayload {
  accessToken: string;
  expiresAt?: number;
  refreshToken?: string;
}

/**
 * Authorization phase for progress tracking
 */
export type AuthorizationPhase =
  | 'browser_opened' // Browser has been opened for authorization
  | 'waiting_for_auth' // Waiting for user to complete browser login
  | 'verifying' // Received credentials, verifying with server
  | 'cancelled'; // Authorization was cancelled by user

/**
 * Authorization progress info for UI updates
 */
export interface AuthorizationProgress {
  /** Elapsed time in milliseconds since authorization started */
  elapsed: number;
  /** Maximum polling time in milliseconds */
  maxPollTime: number;
  /** Current authorization phase */
  phase: AuthorizationPhase;
}

/**
 * Remote server related events broadcast from main process
 */
export interface RemoteServerBroadcastEvents {
  authorizationFailed: (params: { error: string }) => void;
  /** Broadcast authorization progress for UI updates */
  authorizationProgress: (params: AuthorizationProgress) => void;
  authorizationRequired: (params: void) => void;
  authorizationSuccessful: (params: NyxIdAuthorizationPayload) => void;
  remoteServerConfigUpdated: (params: void) => void;
  tokenRefreshed: (params: NyxIdAuthorizationPayload) => void;
}
