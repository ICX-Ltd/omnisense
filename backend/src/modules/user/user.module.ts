import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';

import { UserController } from './user.controller';
import { UserService } from './user.service';
import { UserAccount } from '../../db/entities/user-account.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserAccount]),
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'dev-secret-change-me',
    }),
  ],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
