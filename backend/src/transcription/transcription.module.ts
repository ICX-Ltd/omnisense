import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TranscriptionController } from './transcription.controller';
import { TranscriptionOpenAiService } from './transcriptionOpenAi.service';
import { TranscriptionDeepgramService } from './transcriptionDeepgram.service';
import { TranscriptionVocabService } from './transcription-vocab.service';
import { TranscriptionVocab } from '../db/entities/transcription-vocab.entity';

@Module({
  imports: [TypeOrmModule.forFeature([TranscriptionVocab])],
  controllers: [TranscriptionController],
  providers: [
    TranscriptionOpenAiService,
    TranscriptionDeepgramService,
    TranscriptionVocabService,
  ],
  // Exported so RecordingsModule shares a single Deepgram + vocab instance.
  exports: [TranscriptionDeepgramService, TranscriptionVocabService],
})
export class TranscriptionModule {}
