import { IsString, MinLength } from 'class-validator';

export class AdminResetPasswordDto {
  @IsString()
  @MinLength(8)
  newPassword!: string;
}
