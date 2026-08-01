import { IsIn } from 'class-validator';

import { ROLE_IDS } from '../roles';

export class UpdateUserRoleDto {
  @IsIn(ROLE_IDS)
  roleId!: string;
}
