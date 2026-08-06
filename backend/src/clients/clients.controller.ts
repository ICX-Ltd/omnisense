import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';

import { Auth, requireRole } from '../modules/auth/auth-scope.decorator';
import type { AuthScope } from '../modules/auth/auth-scope.decorator';
import { ClientsService } from './clients.service';

// Anyone internal (not the 'client' role itself) can read the client list —
// it's needed by several low-sensitivity selectors (view-as, data import,
// narrative generation). Only dev/admin can create/rename/deactivate a client.
const READ_ROLES = ['dev', 'admin', 'supervisor', 'user', 'agent'];
const WRITE_ROLES = ['dev', 'admin'];

@Controller('uiapi/clients')
export class ClientsController {
  constructor(private readonly svc: ClientsService) {}

  @Get()
  async list(@Auth() scope: AuthScope, @Query('includeInactive') includeInactive?: string) {
    requireRole(scope, READ_ROLES);
    return this.svc.list(includeInactive === 'true');
  }

  @Post()
  async create(@Auth() scope: AuthScope, @Body() body: { name?: string; key?: string }) {
    requireRole(scope, WRITE_ROLES);
    return this.svc.create((body.name ?? '').trim(), (body.key ?? '').trim().toLowerCase());
  }

  @Patch(':id')
  async rename(
    @Auth() scope: AuthScope,
    @Param('id') id: string,
    @Body() body: { name: string },
  ) {
    requireRole(scope, WRITE_ROLES);
    return this.svc.rename(id, body.name);
  }

  @Patch(':id/active')
  async setActive(
    @Auth() scope: AuthScope,
    @Param('id') id: string,
    @Body() body: { active: boolean },
  ) {
    requireRole(scope, WRITE_ROLES);
    return this.svc.setActive(id, !!body.active);
  }
}
