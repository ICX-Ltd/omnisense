import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Interaction } from '../db/entities/interaction.entity';
import { InteractionTranscript } from '../db/entities/interaction-transcript.entity';
import { InteractionInsight } from '../db/entities/interaction-insight.entity';
import { BatchJob } from '../db/entities/batch-job.entity';
import { RecordingsController } from './recordings.controller';
import { RecordingsService } from './recordings.service';
import { InsightsService } from '../insights/insights.service';
import { TranscriptionDeepgramService } from '../transcription/transcriptionDeepgram.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Interaction, InteractionTranscript, InteractionInsight, BatchJob]),
  ],
  controllers: [RecordingsController],
  providers: [RecordingsService, InsightsService, TranscriptionDeepgramService],
})
export class RecordingsModule {}
