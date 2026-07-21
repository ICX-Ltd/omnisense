import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ModelOption } from '../db/entities/model-option.entity';
import { ModelRegistryService } from './model-registry.service';
import { ModelsController } from './models.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ModelOption])],
  controllers: [ModelsController],
  providers: [ModelRegistryService],
  // Exported so the transcription (Deepgram) service can read the active model.
  exports: [ModelRegistryService],
})
export class ModelsModule {}
