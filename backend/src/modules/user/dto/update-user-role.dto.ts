import { IsIn, IsOptional, IsUUID } from 'class-validator';

import { ROLE_IDS } from '../roles';

export class UpdateUserRoleDto {
  @IsIn(ROLE_IDS)
  roleId!: string;

  // Required by UserService.updateRole when roleId is 'client'.
  @IsOptional()
  @IsUUID()
  clientId?: string;
}
