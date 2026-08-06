import {
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { jwtSecret } from './jwt.config';

// Roles allowed to preview another client's data via the X-View-As-Client
// header. Kept narrow on purpose — this is a real data-access override, not a
// UI convenience. Must stay in step with frontend/src/composables/useAccess.ts
// (canUseViewAs).
const VIEW_AS_ROLES = ['dev', 'admin'];

export interface AuthScope {
  userId: string;
  roleId: string;
  /** The account's OWN client (null for every internal role). */
  clientId: string | null;
  /**
   * The client ID every tenant-scoped query should filter by, or null for
   * "unfiltered — see everything" (only ever true for internal staff with no
   * view-as active). Resolved here, once, so no controller/service can get
   * this wrong by re-deriving it inline:
   *  - roleId 'client'  -> always their own clientId, never overridable.
   *  - dev/admin + X-View-As-Client header -> that header's value.
   *  - anyone else -> null (unfiltered).
   */
  effectiveClientId: string | null;
}

/**
 * Verifies the Bearer token the same way UserService/HealthService's
 * requireRole() do (same secret resolution, same "missing/invalid token"
 * errors), but returns the full decoded scope instead of throwing on an
 * unrecognised role — callers that need a role allowlist (e.g. admin-only
 * surfaces) still declare and check it themselves, matching this codebase's
 * existing per-handler convention. This decorator exists because dashboard/
 * narrative endpoints don't need a role allowlist at all (any authenticated
 * role, including the new 'client' role, may call them) — what they need is
 * the resolved client scope, in one place, so it can't be forgotten on any
 * one of the ~45 endpoints that must apply it.
 */
export const Auth = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthScope => {
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers?.['authorization'];

    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing token');
    }

    let payload: any;
    try {
      payload = new JwtService({ secret: jwtSecret() }).verify(
        header.slice('Bearer '.length),
      );
    } catch {
      throw new UnauthorizedException('Invalid token');
    }

    const roleId = String(payload.roleId ?? '').trim().toLowerCase();
    const clientId: string | null = payload.clientId ?? null;
    const viewAsClientId: string | undefined =
      req.headers?.['x-view-as-client'] || undefined;

    let effectiveClientId: string | null;
    if (roleId === 'client') {
      effectiveClientId = clientId;
    } else if (VIEW_AS_ROLES.includes(roleId) && viewAsClientId) {
      effectiveClientId = viewAsClientId;
    } else {
      effectiveClientId = null;
    }

    return {
      userId: payload.sub as string,
      roleId,
      clientId,
      effectiveClientId,
    };
  },
);

/** Throws ForbiddenException unless scope.roleId is one of `allowed`. */
export function requireRole(scope: AuthScope, allowed: string[]): void {
  if (!allowed.includes(scope.roleId)) {
    throw new ForbiddenException('Insufficient role');
  }
}
