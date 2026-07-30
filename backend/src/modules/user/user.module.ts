import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UserController } from './user.controller';
import { UserService } from './user.service';
import { UserAccount } from '../../db/entities/user-account.entity';
import { JwtSharedModule } from '../auth/jwt-shared.module';

@Module({
  imports: [TypeOrmModule.forFeature([UserAccount]), JwtSharedModule],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
