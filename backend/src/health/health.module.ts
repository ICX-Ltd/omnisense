import { Module } from '@nestjs/common';

import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { JwtSharedModule } from '../modules/auth/jwt-shared.module';

@Module({
  imports: [
    // DataSource is available from the global TypeORM connection (app.module).
    JwtSharedModule,
  ],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
