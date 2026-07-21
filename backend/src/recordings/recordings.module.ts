import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Interaction } from '../db/entities/interaction.entity';
import { InteractionTranscript } from '../db/entities/interaction-transcript.entity';
import { InteractionInsight } from '../db/entities/interaction-insight.entity';
import { BatchJob } from '../db/entities/batch-job.entity';
import { LlmUsageLog } from '../db/entities/llm-usage-log.entity';
import { TranscriptionUsageLog } from '../db/entities/transcription-usage-log.entity';
import { RecordingsController } from './recordings.controller';
import { RecordingsService } from './recordings.service';
import { InsightsModule } from '../insights/insights.module';
import { TranscriptionModule } from '../transcription/transcription.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Interaction, InteractionTranscript, InteractionInsight, BatchJob, LlmUsageLog, TranscriptionUsageLog]),
    InsightsModule,
    // Provides the shared TranscriptionDeepgramService (+ its editable vocab).
    TranscriptionModule,
  ],
  controllers: [RecordingsController],
  providers: [RecordingsService],
})
export class RecordingsModule {}
