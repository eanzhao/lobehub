import crypto from 'node:crypto';
import querystring from 'node:querystring';
import { URL } from 'node:url';

import type {
  AuthorizationProgress,
  DataSyncConfig,
  MarketAuthorizationParams,
} from '@lobechat/electron-client-ipc';
import { BrowserWindow, shell } from 'electron';

import { AUTH_GENERIC_OIDC_ID, AUTH_GENERIC_OIDC_ISSUER } from '@/const/env';
import GatewayConnectionService from '@/services/gatewayConnectionSrv';
import { appendVercelCookie } from '@/utils/http-headers';
import { createLogger } from '@/utils/logger';
import { netFetch } from '@/utils/net-fetch';

import { AEVATAR_PROTOCOL_SCHEME } from '../utils/protocol';
import { ControllerModule, createProtocolHandler, IpcMethod } from './index';
import RemoteServerConfigCtr from './RemoteServerConfigCtr';

const logger = createLogger('controllers:AuthCtr');
const protocolHandler = createProtocolHandler('auth');
const DEFAULT_SCOPE = 'openid profile email offline_access';

// Refresh the access token only once it is within this window of its expiry. Kept
// small (minutes) on purpose: a buffer that is large relative to the server's
// access-token lifetime makes the token look "expiring soon" right after login,
// refreshing on every launch/activation and churning refresh-token rotations.
const TOKEN_REFRESH_BUFFER = 10 * 60 * 1000; // 10 minutes

/**
 * Authentication Controller
 * Implements NyxID OAuth authorization flow using PKCE + desktop deep links.
 */
export default class AuthCtr extends ControllerModule {
  static override readonly groupName = 'auth';
  /**
   * Remote server configuration controller
   */
  private get remoteServerConfigCtr() {
    return this.app.getController(RemoteServerConfigCtr);
  }

  /**
   * Current PKCE parameters
   */
  private codeVerifier: string | null = null;
  private authRequestState: string | null = null;

  private cachedRemoteUrl: string | null = null;

  /**
   * Auto-refresh timer
   */

  private autoRefreshTimer: NodeJS.Timeout | null = null;

  /**
   * Construct desktop callback URI for NyxID OAuth.
   */
  private constructRedirectUri(): string {
    return `${AEVATAR_PROTOCOL_SCHEME}://oauth-callback`;
  }

  private getNyxIdIssuer(): string {
    if (!AUTH_GENERIC_OIDC_ISSUER) {
      throw new Error('AUTH_GENERIC_OIDC_ISSUER is required for desktop NyxID OAuth');
    }

    return AUTH_GENERIC_OIDC_ISSUER.replace(/\/+$/, '');
  }

  private getNyxIdClientId(): string {
    if (!AUTH_GENERIC_OIDC_ID) {
      throw new Error('AUTH_GENERIC_OIDC_ID is required for desktop NyxID OAuth');
    }

    return AUTH_GENERIC_OIDC_ID;
  }

  private async getTokenEndpoint(): Promise<string> {
    const issuer = this.getNyxIdIssuer();
    const discoveryUrl = new URL('/.well-known/openid-configuration', `${issuer}/`).toString();
    const response = await netFetch(discoveryUrl, {
      headers: { Accept: 'application/json' },
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(`NyxID discovery failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as { token_endpoint?: string };
    if (!data.token_endpoint) {
      throw new Error('NyxID discovery document is missing token_endpoint');
    }

    return data.token_endpoint;
  }

  /**
   * Request OAuth authorization
   */
  @IpcMethod()
  async requestAuthorization(config: DataSyncConfig) {
    // Clear any old authorization state
    this.clearAuthorizationState();

    const remoteUrl = await this.remoteServerConfigCtr.getRemoteServerUrl(config);

    // Cache remote server URL for subsequent polling
    this.cachedRemoteUrl = remoteUrl;

    logger.info(
      `Requesting NyxID authorization, storageMode:${config.storageMode} server URL: ${remoteUrl}`,
    );
    try {
      // Generate PKCE parameters
      logger.debug('Generating PKCE parameters');
      const codeVerifier = this.generateCodeVerifier();
      const codeChallenge = await this.generateCodeChallenge(codeVerifier);
      this.codeVerifier = codeVerifier;

      // Generate state parameter to prevent CSRF attacks
      this.authRequestState = crypto.randomBytes(16).toString('hex');
      logger.debug(`Generated state parameter: ${this.authRequestState}`);

      const authUrl = new URL('/oauth/authorize', this.getNyxIdIssuer());
      const redirectUri = this.constructRedirectUri();

      logger.info('redirectUri', redirectUri);

      authUrl.search = querystring.stringify({
        client_id: this.getNyxIdClientId(),
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        prompt: 'consent',
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: DEFAULT_SCOPE,
        state: this.authRequestState,
      });

      logger.info(`Constructed authorization URL: ${authUrl.toString()}`);

      // Open authorization URL in the default browser
      await shell.openExternal(authUrl.toString());
      logger.debug('Opening authorization URL in default browser');

      this.broadcastAuthorizationProgress({
        elapsed: 0,
        maxPollTime: 0,
        phase: 'browser_opened',
      });

      return { success: true };
    } catch (error) {
      logger.error('Authorization request failed:', error);
      return {
        error: error instanceof Error ? error.message : String(error),
        success: false,
      };
    }
  }

  /**
   * Cancel current authorization process
   */
  @IpcMethod()
  async cancelAuthorization() {
    if (this.authRequestState) {
      logger.info('User cancelled authorization');
      this.clearAuthorizationState();
      this.broadcastAuthorizationProgress({
        elapsed: 0,
        maxPollTime: 0,
        phase: 'cancelled',
      });
      return { success: true };
    }
    return { error: 'No active authorization', success: false };
  }

  /**
   * Request Market OAuth authorization (desktop)
   */
  @IpcMethod()
  async requestMarketAuthorization(params: MarketAuthorizationParams) {
    const { authUrl } = params;

    if (!authUrl) {
      const errorMessage = 'Market authorization URL is required';
      logger.error(errorMessage);
      return { error: errorMessage, success: false };
    }

    logger.info(`Requesting market authorization via: ${authUrl}`);
    try {
      await shell.openExternal(authUrl);
      logger.debug('Opening market authorization URL in default browser');
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Market authorization request failed:', error);
      return { error: message, success: false };
    }
  }

  /**
   * Clear authorization state
   * Called before starting a new authorization flow or after authorization failure/timeout
   */
  private clearAuthorizationState() {
    logger.debug('Clearing authorization state');
    this.codeVerifier = null;
    this.authRequestState = null;
    this.cachedRemoteUrl = null;
  }

  /**
   * Start auto-refresh timer
   */
  private startAutoRefresh() {
    // Stop existing timer first
    this.stopAutoRefresh();

    const checkInterval = 2 * 60 * 1000; // Check every 2 minutes
    logger.debug('Starting auto-refresh timer');

    this.autoRefreshTimer = setInterval(async () => {
      try {
        if (!this.remoteServerConfigCtr.isTokenExpiringSoon(TOKEN_REFRESH_BUFFER)) {
          return;
        }
        const expiresAt = this.remoteServerConfigCtr.getTokenExpiresAt();
        logger.info(
          `Token is expiring soon, triggering auto-refresh. Expires at: ${expiresAt ? new Date(expiresAt).toISOString() : 'unknown'}`,
        );

        const result = await this.remoteServerConfigCtr.refreshAccessToken();
        if (result.success) {
          logger.info('Auto-refresh successful');
          this.broadcastTokenRefreshed();
        } else {
          logger.error(`Auto-refresh failed after retries: ${result.error}`);

          // Only clear tokens for non-retryable errors (e.g., invalid_grant)
          // The retry mechanism in RemoteServerConfigCtr already handles transient errors
          if (this.remoteServerConfigCtr.isNonRetryableError(result.error)) {
            logger.warn(
              'Non-retryable error detected, clearing tokens and requiring re-authorization',
            );
            this.stopAutoRefresh();
            await this.remoteServerConfigCtr.clearTokens();
            await this.remoteServerConfigCtr.setRemoteServerConfig({ active: false });
            this.broadcastAuthorizationRequired();
          } else {
            // For other errors (after retries exhausted), log but don't clear tokens immediately
            // The next refresh cycle will retry
            logger.warn('Refresh failed but error may be transient, will retry on next cycle');
          }
        }
      } catch (error) {
        logger.error('Error during auto-refresh check:', error);
      }
    }, checkInterval);
  }

  /**
   * Stop auto-refresh timer
   */
  private stopAutoRefresh() {
    if (this.autoRefreshTimer) {
      clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = null;
      logger.debug('Stopped auto-refresh timer');
    }
  }

  /**
   * Refresh access token
   * This method includes retry mechanism via RemoteServerConfigCtr.refreshAccessToken()
   */
  async refreshAccessToken() {
    logger.info('Starting to refresh access token');
    try {
      // Call the centralized refresh logic in RemoteServerConfigCtr (includes retry)
      const result = await this.remoteServerConfigCtr.refreshAccessToken();

      if (result.success) {
        logger.info('Token refresh successful via AuthCtr call.');
        // Notify render process that token has been refreshed
        this.broadcastTokenRefreshed();
        // Restart auto-refresh timer with new expiration time
        this.startAutoRefresh();
        return { success: true };
      } else {
        logger.error(`Token refresh failed via AuthCtr call: ${result.error}`);

        // Only clear tokens for non-retryable errors (e.g., invalid_grant)
        if (this.remoteServerConfigCtr.isNonRetryableError(result.error)) {
          logger.warn(
            'Non-retryable error detected, clearing tokens and requiring re-authorization',
          );
          this.stopAutoRefresh();
          await this.remoteServerConfigCtr.clearTokens();
          await this.remoteServerConfigCtr.setRemoteServerConfig({ active: false });
          this.broadcastAuthorizationRequired();
        } else {
          // For transient errors, don't clear tokens - allow manual retry
          logger.warn('Refresh failed but error may be transient, tokens preserved for retry');
        }

        return { error: result.error, success: false };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Token refresh operation failed via AuthCtr:', errorMessage);

      // Only clear tokens for non-retryable errors
      if (this.remoteServerConfigCtr.isNonRetryableError(errorMessage)) {
        logger.warn('Non-retryable error in catch block, clearing tokens');
        this.stopAutoRefresh();
        await this.remoteServerConfigCtr.clearTokens();
        await this.remoteServerConfigCtr.setRemoteServerConfig({ active: false });
        this.broadcastAuthorizationRequired();
      }

      return { error: errorMessage, success: false };
    }
  }

  /**
   * Exchange authorization code for token
   */
  private async exchangeCodeForToken(code: string, codeVerifier: string) {
    logger.info('Starting to exchange authorization code for token');
    try {
      const tokenUrl = await this.getTokenEndpoint();
      logger.debug(`Constructed token exchange URL: ${tokenUrl.toString()}`);

      const body = querystring.stringify({
        client_id: this.getNyxIdClientId(),
        code,
        code_verifier: codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: this.constructRedirectUri(),
      });

      logger.debug('Sending token exchange request');
      // Send request to get token
      const tokenHeaders: Record<string, string> = {
        'Content-Type': 'application/x-www-form-urlencoded',
      };
      appendVercelCookie(tokenHeaders);
      const response = await netFetch(tokenUrl, {
        body,
        headers: tokenHeaders,
        method: 'POST',
      });

      if (!response.ok) {
        // Try parsing the error response
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = `Failed to get token: ${response.status} ${response.statusText} ${errorData.error_description || errorData.error || ''}`;
        logger.error(errorMessage);
        throw new Error(errorMessage);
      }

      let data;

      // Parse response
      try {
        data = await response.clone().json();
      } catch {
        const status = response.status;

        throw new Error(
          `Parse JSON failed, please check your server, response status: ${status}, detail:\n\n ${await response.text()} `,
        );
      }

      logger.debug('Successfully received token exchange response');

      // Ensure response contains necessary fields
      if (!data.access_token || !data.refresh_token) {
        logger.error('Invalid token response: missing access_token or refresh_token');
        throw new Error('Invalid token response: missing required fields');
      }

      // Save tokens
      logger.debug('Starting to save exchanged tokens');
      await this.remoteServerConfigCtr.saveTokens(
        data.access_token,
        data.refresh_token,
        data.expires_in,
      );
      logger.info('Successfully saved exchanged tokens');

      logger.debug(`Setting remote server to active state: ${this.cachedRemoteUrl}`);
      await this.remoteServerConfigCtr.setRemoteServerConfig({ active: true });

      // Start auto-refresh timer
      this.startAutoRefresh();

      // Connect to device gateway after successful login
      this.connectGateway();
      this.clearAuthorizationState();

      return { success: true };
    } catch (error) {
      logger.error('Exchanging authorization code failed:', error);
      this.clearAuthorizationState();
      return {
        error: error instanceof Error ? error.message : String(error),
        success: false,
      };
    }
  }

  /**
   * Connect to device gateway (fire-and-forget)
   */
  private connectGateway() {
    const gatewaySrv = this.app.getService(GatewayConnectionService);
    if (gatewaySrv) {
      logger.info('Triggering gateway connection after login');
      gatewaySrv.connect().catch((error) => {
        logger.error('Gateway connection after login failed:', error);
      });
    }
  }

  /**
   * Broadcast token refreshed event
   */
  private broadcastTokenRefreshed() {
    logger.debug('Broadcasting tokenRefreshed event to all windows');
    const allWindows = BrowserWindow.getAllWindows();

    for (const win of allWindows) {
      if (!win.isDestroyed()) {
        win.webContents.send('tokenRefreshed');
      }
    }
  }

  /**
   * Broadcast authorization successful event
   */
  private broadcastAuthorizationSuccessful() {
    logger.debug('Broadcasting authorizationSuccessful event to all windows');
    const allWindows = BrowserWindow.getAllWindows();

    for (const win of allWindows) {
      if (!win.isDestroyed()) {
        win.webContents.send('authorizationSuccessful');
      }
    }
  }

  /**
   * Broadcast authorization progress event
   */
  private broadcastAuthorizationProgress(progress: AuthorizationProgress) {
    // Avoid logging too frequently
    // logger.debug('Broadcasting authorizationProgress event');
    const allWindows = BrowserWindow.getAllWindows();

    for (const win of allWindows) {
      if (!win.isDestroyed()) {
        win.webContents.send('authorizationProgress', progress);
      }
    }
  }

  /**
   * Broadcast authorization failed event
   */
  private broadcastAuthorizationFailed(error: string) {
    logger.debug(`Broadcasting authorizationFailed event to all windows, error: ${error}`);
    const allWindows = BrowserWindow.getAllWindows();

    for (const win of allWindows) {
      if (!win.isDestroyed()) {
        win.webContents.send('authorizationFailed', { error });
      }
    }
  }

  /**
   * Broadcast authorization required event
   */
  private broadcastAuthorizationRequired() {
    logger.debug('Broadcasting authorizationRequired event to all windows');
    const allWindows = BrowserWindow.getAllWindows();

    for (const win of allWindows) {
      if (!win.isDestroyed()) {
        win.webContents.send('authorizationRequired');
      }
    }
  }

  /**
   * Generate PKCE codeVerifier
   */
  private generateCodeVerifier(): string {
    logger.debug('Generating PKCE code verifier');
    // Generate a random string of at least 43 characters
    const verifier = crypto
      .randomBytes(32)
      .toString('base64')
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '');
    logger.debug('Generated code verifier (partial): ' + verifier.slice(0, 10) + '...'); // Avoid logging full sensitive info
    return verifier;
  }

  /**
   * Generate codeChallenge from codeVerifier (S256 method)
   */
  private async generateCodeChallenge(codeVerifier: string): Promise<string> {
    logger.debug('Generating PKCE code challenge (S256)');
    // Hash codeVerifier using SHA-256
    const encoder = new TextEncoder();
    const data = encoder.encode(codeVerifier);
    const digest = await crypto.subtle.digest('SHA-256', data.buffer);

    // Convert hash result to base64url encoding
    const challenge = Buffer.from(digest)
      .toString('base64')
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '');
    logger.debug('Generated code challenge (partial): ' + challenge.slice(0, 10) + '...'); // Avoid logging full sensitive info
    return challenge;
  }

  /**
   * Initialize after app is ready
   */
  afterAppReady() {
    logger.debug('AuthCtr initialized, checking for existing tokens');
    this.initializeAutoRefresh();
  }

  /**
   * Clean up all timers
   */
  cleanup() {
    logger.debug('Cleaning up AuthCtr timers');
    this.stopAutoRefresh();
  }

  /**
   * Initialize auto-refresh functionality
   * Checks for valid token at app startup and starts auto-refresh timer if token exists
   * Proactively refreshes the token only when it is expired or near expiry
   */
  private async initializeAutoRefresh() {
    try {
      const config = await this.remoteServerConfigCtr.getRemoteServerConfig();

      // Check if remote server is configured and active
      if (!(await this.remoteServerConfigCtr.isRemoteServerConfigured(config))) {
        logger.debug(
          'Remote server not active or configured, skipping auto-refresh initialization',
        );
        return;
      }

      // Check if valid access token exists
      const accessToken = await this.remoteServerConfigCtr.getAccessToken();
      if (!accessToken) {
        logger.debug('No access token found, skipping auto-refresh initialization');
        return;
      }

      // Check if token expiration time exists
      const expiresAt = this.remoteServerConfigCtr.getTokenExpiresAt();
      if (!expiresAt) {
        logger.debug('No token expiration time found, skipping auto-refresh initialization');
        return;
      }

      // Refresh proactively only when the token is actually near expiry. The access
      // token is long-lived; refreshing on every launch just multiplies refresh-token
      // rotations — and the chance of a lost-response logout — for no benefit.
      if (this.remoteServerConfigCtr.isTokenExpiringSoon(TOKEN_REFRESH_BUFFER)) {
        logger.info('Token is expired or expiring soon, refreshing on startup');
        await this.performProactiveRefresh();
        return;
      }

      // Start auto-refresh timer
      logger.info(
        `Token is valid, starting auto-refresh timer. Token expires at: ${new Date(expiresAt).toISOString()}`,
      );
      this.startAutoRefresh();
    } catch (error) {
      logger.error('Error during auto-refresh initialization:', error);
    }
  }

  /**
   * Perform proactive token refresh (used on startup and app activation)
   */
  private async performProactiveRefresh(): Promise<void> {
    const refreshResult = await this.remoteServerConfigCtr.refreshAccessToken();
    if (refreshResult.success) {
      logger.info('Proactive token refresh successful');
      this.broadcastTokenRefreshed();
      this.startAutoRefresh();
    } else {
      logger.error(`Proactive token refresh failed: ${refreshResult.error}`);

      // Only clear token for non-retryable errors
      if (this.remoteServerConfigCtr.isNonRetryableError(refreshResult.error)) {
        logger.warn('Non-retryable error during proactive refresh, clearing tokens');
        await this.remoteServerConfigCtr.clearTokens();
        await this.remoteServerConfigCtr.setRemoteServerConfig({ active: false });
        this.broadcastAuthorizationRequired();
      } else {
        // For transient errors, still start auto-refresh timer to retry later
        logger.warn('Transient error during proactive refresh, will retry via auto-refresh');
        this.startAutoRefresh();
      }
    }
  }

  /**
   * Handle app activation event (e.g., Mac dock click, window focus)
   * Proactively refresh token if it is expired or near expiry
   */
  async onAppActivate(): Promise<void> {
    logger.debug('App activated, checking if token refresh is needed');

    try {
      const config = await this.remoteServerConfigCtr.getRemoteServerConfig();

      // Check if remote server is configured and active
      if (!(await this.remoteServerConfigCtr.isRemoteServerConfigured(config))) {
        logger.debug('Remote server not active, skipping activation refresh');
        return;
      }

      // Check if valid access token exists
      const accessToken = await this.remoteServerConfigCtr.getAccessToken();
      if (!accessToken) {
        logger.debug('No access token found, skipping activation refresh');
        return;
      }

      // Refresh only when the token is actually near expiry (see initializeAutoRefresh).
      if (this.remoteServerConfigCtr.isTokenExpiringSoon(TOKEN_REFRESH_BUFFER)) {
        logger.info('Token is expiring soon on app activation, refreshing token');
        await this.performProactiveRefresh();
      } else {
        logger.debug('Token is still valid, skipping activation refresh');
      }
    } catch (error) {
      logger.error('Error during app activation refresh check:', error);
    }
  }

  @protocolHandler('oauth-callback')
  async handleOAuthCallback(params: Record<string, string>): Promise<boolean> {
    const code = params.code;
    const state = params.state;

    if (!code || !state || !this.authRequestState || !this.codeVerifier) {
      this.broadcastAuthorizationFailed('Invalid NyxID callback parameters');
      return false;
    }

    this.broadcastAuthorizationProgress({
      elapsed: 0,
      maxPollTime: 0,
      phase: 'verifying',
    });

    if (state !== this.authRequestState) {
      logger.error(`Invalid state parameter: expected ${this.authRequestState}, received ${state}`);
      this.clearAuthorizationState();
      this.broadcastAuthorizationFailed('Invalid state parameter');
      return false;
    }

    const exchangeResult = await this.exchangeCodeForToken(code, this.codeVerifier);

    if (exchangeResult.success) {
      logger.info('Authorization successful');
      this.broadcastAuthorizationSuccessful();
      return true;
    }

    logger.warn(`Authorization failed: ${exchangeResult.error || 'Unknown error'}`);
    this.broadcastAuthorizationFailed(exchangeResult.error || 'Unknown error');
    return false;
  }
}
