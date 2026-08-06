import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DataImportController } from './data-import.controller';
import { DataImportService } from './data-import.service';
import { ImportParseService } from './import-parse.service';
import { ImportPromoteService } from './import-promote.service';
import { ImportRunsService } from './import-runs.service';
import { ImportRun } from '../db/entities/import-run.entity';
import { ImportConversation } from '../db/entities/import-conversation.entity';
import { ImportMessage } from '../db/entities/import-message.entity';
import { BatchJob } from '../db/entities/batch-job.entity';
import { Interaction } from '../db/entities/interaction.entity';
import { JwtSharedModule } from '../modules/auth/jwt-shared.module';
import { ClientsModule } from '../clients/clients.module';

/**
 * Upload storage is configured at the interceptor in data-import.controller.ts
 * (lazyImportDiskStorage), NOT via MulterModule here.
 *
 * Reason: a module decorator evaluates as soon as the file is imported, which
 * happens before ConfigModule.forRoot() loads .env into process.env. Anything
 * reading IMPORT_UPLOAD_DIR at that point sees it unset and silently falls back
 * to multer's in-memory storage — which is precisely the failure this comment
 * exists to prevent a future edit from reintroducing.
 */
@Module({
  imports: [
    JwtSharedModule,
    ClientsModule,
    TypeOrmModule.forFeature([
      ImportRun,
      ImportConversation,
      ImportMessage,
      BatchJob,
      Interaction,
    ]),
  ],
  controllers: [DataImportController],
  providers: [
    DataImportService,
    ImportParseService,
    ImportPromoteService,
    ImportRunsService,
  ],
})
export class DataImportModule {}
