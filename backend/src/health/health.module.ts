import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [
    // DataSource is available from the global TypeORM connection (app.module).
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'dev-secret-change-me',
    }),
  ],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
