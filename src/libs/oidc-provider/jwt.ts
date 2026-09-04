import { TRPCError } from '@trpc/server';
import debug from 'debug';
import type { JWTPayload } from 'jose';

import {
  discoverNyxId,
  getNyxIdOAuthConfig,
  isNyxIdOAuthEnabled,
} from '@/business/server/nyxid-auth';
import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';
import { authEnv } from '@/envs/auth';

const log = debug('oidc-jwt');
const NYX_ID_ACCESS_TOKEN_TYPE = 'access';

/**
 * JWT auth source used to determine follow-up handling like user bootstrap.
 */
export type OIDCJWTProvider = 'local' | 'nyxid';

/**
 * Normalized stateless JWT validation result shared across request entrypoints.
 */
export interface ValidatedOIDCJWT {
  clientId?: string | string[];
  payload: JWTPayload;
  provider: OIDCJWTProvider;
  tokenData: {
    aud: JWTPayload['aud'];
    client_id: string | string[] | undefined;
    exp: number | undefined;
    iat: number | undefined;
    jti: string | undefined;
    purpose: string | undefined;
    scope: unknown;
    sub: string;
  };
  userId: string;
}

/**
 * Get JWKS key string from environment
 * Uses JWKS_KEY which already has fallback to OIDC_JWKS_KEY in authEnv
 */
const getJwksKeyString = () => {
  return authEnv.JWKS_KEY;
};

/**
 * Get JWKS from environment variables
 * This JWKS is a JSON object containing RS256 private keys
 */
export const getJWKS = (): object => {
  try {
    const jwksString = getJwksKeyString();

    if (!jwksString) {
      throw new Error(
        'JWKS_KEY environment variable is required. Please use scripts/generate-oidc-jwk.mjs to generate JWKS.',
      );
    }

    // Attempt to parse JWKS JSON string
    const jwks = JSON.parse(jwksString);

    // Check if JWKS format is valid
    if (!jwks.keys || !Array.isArray(jwks.keys) || jwks.keys.length === 0) {
      throw new Error('Invalid JWKS format: missing or empty keys array');
    }

    // Check if there is an RS256 algorithm key
    const hasRS256Key = jwks.keys.some(
      (key: Record<string, unknown>) => key.alg === 'RS256' && key.kty === 'RSA',
    );
    if (!hasRS256Key) {
      throw new Error('No RSA key with RS256 algorithm found in JWKS');
    }

    return jwks;
  } catch (error) {
    console.error('Failed to parse JWKS:', error);
    throw new Error(`JWKS_KEY parse error: ${(error as Error).message}`, { cause: error });
  }
};

const getVerificationKey = async () => {
  try {
    const jwksString = getJwksKeyString();

    if (!jwksString) {
      throw new Error('JWKS_KEY environment variable is not set');
    }

    const jwks = JSON.parse(jwksString);

    if (!jwks.keys || !Array.isArray(jwks.keys) || jwks.keys.length === 0) {
      throw new Error('Invalid JWKS format: missing or empty keys array');
    }

    const privateRsaKey = jwks.keys.find(
      (key: Record<string, unknown>) => key.alg === 'RS256' && key.kty === 'RSA',
    );
    if (!privateRsaKey) {
      throw new Error('No RSA key with RS256 algorithm found in JWKS');
    }

    // Create a “clean” JWK object containing only public key components.
    // The key fields of an RSA public key are kty, n, e. Others like kid, alg, use are also public.
    const publicKeyJwk = {
      alg: privateRsaKey.alg,
      e: privateRsaKey.e,
      kid: privateRsaKey.kid,
      kty: privateRsaKey.kty,
      n: privateRsaKey.n,
      use: privateRsaKey.use,
    };

    // Remove any undefined fields to keep the object clean
    for (const [key, value] of Object.entries(publicKeyJwk)) {
      if (value === undefined) {
        delete publicKeyJwk[key as keyof typeof publicKeyJwk];
      }
    }

    const { importJWK } = await import('jose');

    // Now, in any environment, `importJWK` will correctly identify this object as a public key.
    return await importJWK(publicKeyJwk, 'RS256');
  } catch (error) {
    log('Failed to get JWKS public key: %O', error);
    throw new Error(`JWKS_KEY public key retrieval failed: ${(error as Error).message}`, {
      cause: error,
    });
  }
};

interface NyxIdVerifier {
  issuer: string;
  jwks: ReturnType<(typeof import('jose'))['createRemoteJWKSet']>;
}

let nyxIdVerifierPromise: Promise<NyxIdVerifier> | null = null;

const normalizeIssuer = (issuer: string) => issuer.replace(/\/+$/, '');

const getNyxIdIssuer = (): string | undefined => {
  if (!isNyxIdOAuthEnabled()) return;

  const { issuer } = getNyxIdOAuthConfig();
  return normalizeIssuer(issuer);
};

const safeDecodeJwt = async (token: string): Promise<JWTPayload | undefined> => {
  try {
    const { decodeJwt } = await import('jose');
    return decodeJwt(token);
  } catch {
    return;
  }
};

const getClientIdClaim = (value: unknown): string | string[] | undefined => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value;
  return undefined;
};

const createValidationResult = (
  payload: JWTPayload,
  provider: OIDCJWTProvider,
): ValidatedOIDCJWT => {
  const userId = payload.sub;
  const clientId = getClientIdClaim(payload.client_id);
  const aud = payload.aud;

  if (!userId) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'JWT token is missing user ID (sub)',
    });
  }

  return {
    clientId,
    payload,
    provider,
    tokenData: {
      aud,
      client_id: clientId,
      exp: payload.exp,
      iat: payload.iat,
      jti: payload.jti,
      purpose: typeof payload.purpose === 'string' ? payload.purpose : undefined,
      scope: payload.scope,
      sub: userId,
    },
    userId,
  };
};

const getNyxIdVerifier = async (): Promise<NyxIdVerifier> => {
  if (!isNyxIdOAuthEnabled()) {
    throw new Error('NyxID OAuth is not configured');
  }

  if (!nyxIdVerifierPromise) {
    nyxIdVerifierPromise = (async () => {
      const discovery = await discoverNyxId();
      const jwksUri = discovery.jwksUri;

      if (!jwksUri) {
        throw new Error('NyxID discovery document is missing jwks_uri');
      }

      const { createRemoteJWKSet } = await import('jose');

      return {
        issuer: normalizeIssuer(discovery.issuer),
        jwks: createRemoteJWKSet(new URL(jwksUri)),
      };
    })().catch((error) => {
      nyxIdVerifierPromise = null;
      throw error;
    });
  }

  return nyxIdVerifierPromise;
};

const validateWithLocalJwks = async (token: string): Promise<ValidatedOIDCJWT> => {
  const publicKey = await getVerificationKey();

  try {
    const { jwtVerify } = await import('jose');
    const { payload } = await jwtVerify(token, publicKey, {
      algorithms: ['RS256'],
    });

    log('Local JWT validation successful, payload: %O', payload);
    return createValidationResult(payload, 'local');
  } catch (error) {
    log('Local JWT validation failed: %O', error);

    throw new TRPCError({
      cause: error,
      code: 'UNAUTHORIZED',
      message: `JWT token validation failed: ${(error as Error).message}`,
    });
  }
};

const validateWithNyxId = async (token: string): Promise<ValidatedOIDCJWT> => {
  const verifier = await getNyxIdVerifier();

  try {
    const { jwtVerify } = await import('jose');
    const { payload } = await jwtVerify(token, verifier.jwks, {
      algorithms: ['RS256'],
      audience: verifier.issuer,
      issuer: verifier.issuer,
    });

    if (payload.token_type !== NYX_ID_ACCESS_TOKEN_TYPE) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: `NyxID token_type must be "${NYX_ID_ACCESS_TOKEN_TYPE}"`,
      });
    }

    log('NyxID JWT validation successful, payload: %O', payload);
    return createValidationResult(payload, 'nyxid');
  } catch (error) {
    if (error instanceof TRPCError) {
      throw error;
    }

    log('NyxID JWT validation failed: %O', error);

    throw new TRPCError({
      cause: error,
      code: 'UNAUTHORIZED',
      message: `JWT token validation failed: ${(error as Error).message}`,
    });
  }
};

/**
 * Ensure a local user row exists for NyxID subjects before applying existing user-state guards.
 */
export const ensureOIDCUserRecord = async (
  db: LobeChatDatabase,
  tokenInfo: ValidatedOIDCJWT,
): Promise<void> => {
  if (tokenInfo.provider !== 'nyxid') return;

  await UserModel.makeSureUserExist(db, tokenInfo.userId);
};

export const isStatelessOIDCAuthEnabled = (): boolean => {
  return Boolean(authEnv.ENABLE_OIDC || isNyxIdOAuthEnabled());
};

/**
 * Validate OIDC JWT Access Token
 * @param token - JWT access token
 * @returns Parsed token payload and user information
 */
export const validateOIDCJWT = async (token: string): Promise<ValidatedOIDCJWT> => {
  log('Starting OIDC JWT token validation');
  const tokenPayload = await safeDecodeJwt(token);
  const tokenIssuer =
    typeof tokenPayload?.iss === 'string' ? normalizeIssuer(tokenPayload.iss) : undefined;
  const nyxIdIssuer = getNyxIdIssuer();

  // When a token clearly declares the NyxID issuer, validate it against the remote
  // NyxID JWKS instead of the local OIDC provider keys.
  if (nyxIdIssuer && tokenIssuer === nyxIdIssuer) {
    return validateWithNyxId(token);
  }

  // JWKS / signing key retrieval is an infrastructure concern (misconfigured
  // env, malformed JWKS, key import failure). Let these errors propagate as
  // plain Error so upstream middleware maps them to 500 and triggers ops
  // alerts — treating them as 401 would incorrectly ask clients to re-auth
  // while the real problem is server-side.
  if (authEnv.JWKS_KEY) {
    return validateWithLocalJwks(token);
  }

  if (nyxIdIssuer) {
    return validateWithNyxId(token);
  }

  throw new Error('No OIDC JWT verification provider is configured');
};
