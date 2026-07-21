import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { InsightCorrection } from '../db/entities/insight-correction.entity';
import { CorrectionsController } from './corrections.controller';
import { CorrectionsService } from './corrections.service';

@Module({
  imports: [TypeOrmModule.forFeature([InsightCorrection])],
  controllers: [CorrectionsController],
  providers: [CorrectionsService],
})
export class CorrectionsModule {}
