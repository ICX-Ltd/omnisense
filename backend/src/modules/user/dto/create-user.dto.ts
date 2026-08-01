import { IsEmail, IsIn, IsString, MinLength, IsOptional } from 'class-validator';

import { ROLE_IDS } from '../roles';

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsOptional()
  @IsString()
  displayName?: string;

  /**
   * UserService.create already read this via `(dto as any).roleId`, but it was
   * never declared here — and main.ts runs ValidationPipe with
   * forbidNonWhitelisted, so sending it produced a 400 and every account was
   * created with a null role that could only be fixed with direct DB access.
   */
  @IsOptional()
  @IsIn(ROLE_IDS)
  roleId?: string;
}
