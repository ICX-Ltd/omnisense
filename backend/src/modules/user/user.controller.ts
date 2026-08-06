import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { AdminResetPasswordDto } from './dto/admin-reset-password.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { ROLES } from './roles';

// Resetting someone else's password is a privilege-escalation route, so it is
// narrower than the other admin surfaces (which also allow 'supervisor').
const RESET_ROLES = ['dev', 'admin'];
// Granting a role is the same class of action — it can hand someone full access.
const ROLE_ADMIN_ROLES = ['dev', 'admin'];

@Controller('uiapi/users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  list() {
    return this.userService.findAll();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.userService.findOne(id);
  }

  @Post('create')
  create(@Body() dto: CreateUserDto) {
    return this.userService.create(dto);
  }

  @Patch(':id/password')
  resetPassword(
    @Headers('authorization') auth: string,
    @Param('id') id: string,
    @Body() dto: AdminResetPasswordDto,
  ) {
    const { userId } = this.userService.requireRole(auth, RESET_ROLES);
    return this.userService.adminResetPassword(id, dto, userId);
  }

  @Patch(':id/deactivate')
  deactivate(@Param('id') id: string) {
    return this.userService.deactivate(id);
  }

  /**
   * The roles a user can be given. Served from the backend so the dropdown and
   * the validation share one definition — there is no roles table, so the list
   * in roles.ts IS the definition.
   */
  @Get('meta/roles')
  roles() {
    return ROLES;
  }

  /** Change a user's role. Guarded like a password reset — it grants access. */
  @Patch(':id/role')
  updateRole(
    @Headers('authorization') auth: string,
    @Param('id') id: string,
    @Body() dto: UpdateUserRoleDto,
  ) {
    const { userId } = this.userService.requireRole(auth, ROLE_ADMIN_ROLES);
    return this.userService.updateRole(id, dto.roleId, userId, dto.clientId);
  }
}
