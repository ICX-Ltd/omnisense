import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { InteractionCsat } from '../db/entities/interaction-csat.entity';
import { Interaction } from '../db/entities/interaction.entity';
import { InteractionTranscript } from '../db/entities/interaction-transcript.entity';
import { PromptsModule } from '../modules/prompts/prompts.module';
import { CsatController } from './csat.controller';
import { CsatService } from './csat.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([InteractionCsat, Interaction, InteractionTranscript]),
    PromptsModule,
  ],
  controllers: [CsatController],
  providers: [CsatService],
  exports: [CsatService],
})
export class CsatModule {}
