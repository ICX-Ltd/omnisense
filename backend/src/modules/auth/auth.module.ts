import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserAccount } from '../../db/entities/user-account.entity';
import { TwoFactorService } from '../../infrastructure/common/2fa.service';
import { JwtSharedModule } from './jwt-shared.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserAccount]),
    // The former inline JwtModule.register read process.env.JWT_SECRET at
    // decorator time, before .env was loaded, so it always used the committed
    // dev fallback. Its signOptions.expiresIn was also dead configuration —
    // every sign() call in AuthService passes ACCESS_TTL/REFRESH_TTL explicitly.
    JwtSharedModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, TwoFactorService],
  exports: [AuthService],
})
export class AuthModule {}
