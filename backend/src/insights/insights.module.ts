import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { InsightsController } from './insights.controller';
import { InsightsService } from './insights.service';
import { InsightsSummaryService } from './insights-summary.service';

import { InteractionInsight } from '../db/entities/interaction-insight.entity';
import { Interaction } from '../db/entities/interaction.entity';
import { InsightSummary } from '../db/entities/insight-summary.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([InteractionInsight, Interaction, InsightSummary]),
  ],
  controllers: [InsightsController],
  providers: [InsightsService, InsightsSummaryService],
})
export class InsightsModule {}
