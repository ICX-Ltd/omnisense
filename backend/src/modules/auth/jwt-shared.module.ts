import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { jwtModuleOptions } from './jwt.config';

/**
 * Provides a correctly-configured JwtService to any module that signs or
 * verifies tokens.
 *
 * Import THIS rather than calling JwtModule.register({ secret: ... }) directly.
 * register() takes its options at decorator-evaluation time, which runs before
 * .env is loaded, so the secret silently became the committed dev fallback.
 * registerAsync defers the factory to module initialisation, when the
 * environment is actually available.
 *
 * Having one module also means the secret is defined in exactly one place —
 * previously five copies of the same broken expression had to agree.
 */
@Module({
  imports: [JwtModule.registerAsync({ useFactory: jwtModuleOptions })],
  exports: [JwtModule],
})
export class JwtSharedModule {}
