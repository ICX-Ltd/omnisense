// Single source of truth for the JWT signing secret.
//
// WHY THIS EXISTS
//
// Every module used to do this inline:
//
//   JwtModule.register({ secret: process.env.JWT_SECRET || 'dev-secret-change-me' })
//
// A module decorator evaluates as soon as its file is imported, which happens
// BEFORE ConfigModule.forRoot() loads .env into process.env. So process.env.
// JWT_SECRET was always undefined at that moment and every module silently fell
// back to the literal 'dev-secret-change-me' — a value committed to this
// repository. JWT_SECRET in .env was configured and completely ignored, meaning
// anyone who could read the repo could forge a valid admin token.
//
// The fix is to read the secret from a FACTORY (JwtModule.registerAsync), which
// Nest invokes during module initialisation, after the environment is loaded.
// Never call jwtSecret() from a decorator argument.

import { Logger } from '@nestjs/common';

/**
 * Fallback used for local development only. Deliberately obvious: if this value
 * ever appears in a deployed environment, the secret is not configured.
 */
export const DEV_JWT_SECRET = 'dev-secret-change-me';

/** Shortest secret we will accept. Below this, brute-forcing is realistic. */
const MIN_SECRET_LENGTH = 16;

const logger = new Logger('JwtConfig');

/**
 * Resolves the JWT secret at call time.
 *
 * Throws in production rather than starting with a publicly known secret — an
 * app that will not boot is far safer than one issuing forgeable admin tokens.
 */
export function jwtSecret(): string {
  const configured = process.env.JWT_SECRET?.trim();
  const isProduction = process.env.NODE_ENV === 'production';

  if (configured) {
    if (configured === DEV_JWT_SECRET && isProduction) {
      throw new Error(
        'JWT_SECRET is set to the development placeholder in production. ' +
          'Generate a real secret, e.g. `openssl rand -base64 48`.',
      );
    }
    if (configured.length < MIN_SECRET_LENGTH) {
      const message =
        `JWT_SECRET is only ${configured.length} characters; use at least ` +
        `${MIN_SECRET_LENGTH}.`;
      if (isProduction) throw new Error(message);
      logger.warn(message);
    }
    return configured;
  }

  if (isProduction) {
    throw new Error(
      'JWT_SECRET is not set. Refusing to start in production with the ' +
        'development fallback, which is committed to this repository and would ' +
        'let anyone forge an admin token. Set JWT_SECRET and restart.',
    );
  }

  logger.warn(
    'JWT_SECRET is not set — using the development fallback. Tokens are NOT ' +
      'secure. Set JWT_SECRET in backend/.env.',
  );
  return DEV_JWT_SECRET;
}

/**
 * Options for JwtModule.registerAsync.
 *
 * No module-level signOptions: every sign() call site in AuthService passes its
 * own expiresIn (ACCESS_TTL / REFRESH_TTL), so a default here would be dead
 * configuration that looks authoritative.
 */
export function jwtModuleOptions(): { secret: string } {
  return { secret: jwtSecret() };
}
