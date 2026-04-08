import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { InsightsController } from './insights.controller';
import { InsightsService } from './insights.service';
import { InsightsSummaryService } from './insights-summary.service';
import { SurveyAnalyticsController } from './survey-analytics.controller';
import { SurveyAnalyticsService } from './survey-analytics.service';

import { InteractionInsight } from '../db/entities/interaction-insight.entity';
import { Interaction } from '../db/entities/interaction.entity';
import { InteractionTranscript } from '../db/entities/interaction-transcript.entity';
import { InsightSummary } from '../db/entities/insight-summary.entity';
import { SurveyResponse } from '../db/entities/survey-response.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([InteractionInsight, Interaction, InteractionTranscript, InsightSummary, SurveyResponse]),
  ],
  controllers: [InsightsController, SurveyAnalyticsController],
  providers: [InsightsService, InsightsSummaryService, SurveyAnalyticsService],
})
export class InsightsModule {}
