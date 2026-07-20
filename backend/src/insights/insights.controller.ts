import {
  Body,
  Controller,
  Param,
  Query,
  Post,
  Get,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { InsightsService } from './insights.service';
import { InsightsSummaryService, InteractionFilter, NarrativeType, FilterOptions } from './insights-summary.service';
import { normalizeProvider } from './helpers/provider.helper';

class InsightsRequestDto {
  @IsString()
  transcript!: string;

  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsString()
  interactionType?: string;

  @IsOptional()
  @IsString()
  campaign?: string;
}

@Controller('uiapi/insights')
export class InsightsController {
  constructor(
    private readonly svc: InsightsService,
    private readonly svcSummary: InsightsSummaryService,
  ) {}

  @Post('call')
  async getCallInsights(@Body() body: InsightsRequestDto) {
    if (!body?.transcript || body.transcript.trim().length < 20) {
      throw new BadRequestException(
        'Please provide a transcript (at least ~20 characters).',
      );
    }

    const provider = normalizeProvider(body.provider);

    return this.svc.extractInsights(body.transcript, body.interactionType ?? null, body.campaign ?? null, provider);
  }

  @Get('summary/filters')
  async summaryFilters(
    @Query('filterKey') filterKey?: string,
  ): Promise<FilterOptions> {
    const filter = filterKey ? normalizeInteractionFilter(filterKey) : undefined;
    return this.svcSummary.getFilterOptions(filter);
  }

  // ── Ops endpoints ──────────────────────────────────────────────────────────

  @Get('ops/chat-response-time')
  async opsChatResponseTime(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('filterKey') filterKey?: string,
    @Query('campaign') campaign?: string,
    @Query('agent') agent?: string,
    @Query('excludeOutcomes') excludeOutcomesRaw?: string,
  ) {
    const { fromDate, toDate } = parseDateRange(from, to);
    const filter = normalizeInteractionFilter(filterKey);
    return this.svcSummary.getChatResponseTimeMetrics(
      fromDate, toDate, filter, campaign, agent,
      parseExcludeOutcomes(excludeOutcomesRaw),
    );
  }

  // Recompute chat response-time metrics from the transcript text for every
  // chat in the supplied filter window. Always overwrites — backend code is
  // the canonical source of these numbers.
  @Post('ops/recompute-chat-response-time')
  async opsRecomputeChatResponseTime(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('filterKey') filterKey?: string,
    @Query('campaign') campaign?: string,
    @Query('agent') agent?: string,
    @Query('excludeOutcomes') excludeOutcomesRaw?: string,
  ) {
    const { fromDate, toDate } = parseDateRange(from, to);
    const filter = normalizeInteractionFilter(filterKey);
    return this.svcSummary.recomputeChatResponseTimeMetrics(
      fromDate, toDate, filter, campaign, agent,
      parseExcludeOutcomes(excludeOutcomesRaw),
    );
  }

  @Get('ops/dimensions')
  async opsDimensions(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('filterKey') filterKey?: string,
    @Query('campaign') campaign?: string,
    @Query('agent') agent?: string,
    @Query('excludeOutcomes') excludeOutcomesRaw?: string,
    @Query('excludePartial') excludePartial?: string,
  ) {
    const { fromDate, toDate } = parseDateRange(from, to);
    const filter = normalizeInteractionFilter(filterKey);
    return this.svcSummary.getOpsDimensionComparison(
      fromDate, toDate, filter, campaign, agent,
      parseExcludeOutcomes(excludeOutcomesRaw),
      undefined, undefined,
      excludePartial === 'true',
    );
  }

  @Get('ops/interactions-by-bucket')
  async opsByBucket(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('filterKey') filterKey?: string,
    @Query('bucket') bucket?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('campaign') campaign?: string,
    @Query('agent') agent?: string,
    @Query('excludeOutcomes') excludeOutcomesRaw?: string,
  ) {
    if (!bucket) throw new BadRequestException('bucket is required');
    const { fromDate, toDate } = parseDateRange(from, to);
    const filter = normalizeInteractionFilter(filterKey);
    return this.svcSummary.getInteractionsByScoreBucket(
      fromDate, toDate, filter, bucket,
      Math.min(parseInt(limit ?? '200', 10) || 200, 500),
      parseInt(offset ?? '0', 10) || 0,
      campaign, agent, parseExcludeOutcomes(excludeOutcomesRaw),
    );
  }

  @Get('ops/interactions-by-coaching-need')
  async opsByCoachingNeed(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('filterKey') filterKey?: string,
    @Query('need') need?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('campaign') campaign?: string,
    @Query('agent') agent?: string,
    @Query('excludeOutcomes') excludeOutcomesRaw?: string,
  ) {
    if (!need) throw new BadRequestException('need is required');
    const { fromDate, toDate } = parseDateRange(from, to);
    const filter = normalizeInteractionFilter(filterKey);
    return this.svcSummary.getInteractionsByCoachingNeed(
      fromDate, toDate, filter, need,
      Math.min(parseInt(limit ?? '200', 10) || 200, 500),
      parseInt(offset ?? '0', 10) || 0,
      campaign, agent, parseExcludeOutcomes(excludeOutcomesRaw),
    );
  }

  @Get('ops/interactions-by-outcome')
  async opsByOutcome(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('filterKey') filterKey?: string,
    @Query('outcome') outcome?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('campaign') campaign?: string,
    @Query('agent') agent?: string,
    @Query('excludeOutcomes') excludeOutcomesRaw?: string,
  ) {
    if (!outcome) throw new BadRequestException('outcome is required');
    const { fromDate, toDate } = parseDateRange(from, to);
    const filter = normalizeInteractionFilter(filterKey);
    return this.svcSummary.getInteractionsByOutcome(
      fromDate, toDate, filter, outcome,
      Math.min(parseInt(limit ?? '200', 10) || 200, 500),
      parseInt(offset ?? '0', 10) || 0,
      campaign, agent, parseExcludeOutcomes(excludeOutcomesRaw),
    );
  }

  @Get('ops/interactions-by-partial-outcome')
  async opsByPartialOutcome(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('filterKey') filterKey?: string,
    @Query('outcome') outcome?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('campaign') campaign?: string,
    @Query('agent') agent?: string,
    @Query('excludeOutcomes') excludeOutcomesRaw?: string,
    @Query('layer') layer?: string,
  ) {
    if (!outcome) throw new BadRequestException('outcome is required');
    const { fromDate, toDate } = parseDateRange(from, to);
    const filter = normalizeInteractionFilter(filterKey);
    const layerKey: 'ops' | 'qa' = layer === 'qa' ? 'qa' : 'ops';
    return this.svcSummary.getInteractionsByPartialScoreOutcome(
      fromDate, toDate, filter, outcome,
      Math.min(parseInt(limit ?? '200', 10) || 200, 500),
      parseInt(offset ?? '0', 10) || 0,
      campaign, agent, parseExcludeOutcomes(excludeOutcomesRaw),
      layerKey,
    );
  }

  @Get('ops/interactions-by-low-score-agent')
  async opsByLowScoreAgent(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('filterKey') filterKey?: string,
    @Query('agent') targetAgent?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('campaign') campaign?: string,
    @Query('filterAgent') filterAgent?: string,
    @Query('excludeOutcomes') excludeOutcomesRaw?: string,
    @Query('layer') layer?: string,
  ) {
    if (!targetAgent) throw new BadRequestException('agent is required');
    const { fromDate, toDate } = parseDateRange(from, to);
    const filter = normalizeInteractionFilter(filterKey);
    const layerKey: 'ops' | 'qa' = layer === 'qa' ? 'qa' : 'ops';
    return this.svcSummary.getInteractionsByLowScoreAlertAgent(
      fromDate, toDate, filter, targetAgent,
      Math.min(parseInt(limit ?? '200', 10) || 200, 500),
      parseInt(offset ?? '0', 10) || 0,
      campaign, filterAgent, parseExcludeOutcomes(excludeOutcomesRaw),
      layerKey,
    );
  }

  @Get('ops/interactions-by-interest-level')
  async opsByInterestLevel(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('filterKey') filterKey?: string,
    @Query('interestLevel') interestLevel?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('campaign') campaign?: string,
    @Query('agent') agent?: string,
    @Query('excludeOutcomes') excludeOutcomesRaw?: string,
    @Query('vehicleMake') vehicleMake?: string,
    @Query('vehicleModels') vehicleModelsRaw?: string,
  ) {
    if (!interestLevel) throw new BadRequestException('interestLevel is required');
    const { fromDate, toDate } = parseDateRange(from, to);
    const filter = normalizeInteractionFilter(filterKey);
    return this.svcSummary.getInteractionsByInterestLevel(
      fromDate, toDate, filter, interestLevel,
      Math.min(parseInt(limit ?? '200', 10) || 200, 500),
      parseInt(offset ?? '0', 10) || 0,
      campaign, agent, parseExcludeOutcomes(excludeOutcomesRaw),
      vehicleMake, parseCsvParam(vehicleModelsRaw),
    );
  }

  @Get('ops/interactions-by-objection-category')
  async opsByObjectionCategory(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('filterKey') filterKey?: string,
    @Query('category') category?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('campaign') campaign?: string,
    @Query('agent') agent?: string,
    @Query('excludeOutcomes') excludeOutcomesRaw?: string,
    @Query('opportunitiesOnly') opportunitiesOnly?: string,
  ) {
    if (!category) throw new BadRequestException('category is required');
    const { fromDate, toDate } = parseDateRange(from, to);
    const filter = normalizeInteractionFilter(filterKey);
    return this.svcSummary.getInteractionsByObjectionCategory(
      fromDate, toDate, filter, category,
      Math.min(parseInt(limit ?? '200', 10) || 200, 500),
      parseInt(offset ?? '0', 10) || 0,
      campaign, agent, parseExcludeOutcomes(excludeOutcomesRaw),
      undefined, undefined,
      opportunitiesOnly === 'true',
    );
  }

  @Get('ops/interactions-by-competitor')
  async opsByCompetitor(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('filterKey') filterKey?: string,
    @Query('competitor') competitor?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('campaign') campaign?: string,
    @Query('agent') agent?: string,
    @Query('excludeOutcomes') excludeOutcomesRaw?: string,
    @Query('vehicleMake') vehicleMake?: string,
    @Query('vehicleModels') vehicleModelsRaw?: string,
  ) {
    if (!competitor) throw new BadRequestException('competitor is required');
    const { fromDate, toDate } = parseDateRange(from, to);
    const filter = normalizeInteractionFilter(filterKey);
    return this.svcSummary.getInteractionsByCompetitor(
      fromDate, toDate, filter, competitor,
      Math.min(parseInt(limit ?? '200', 10) || 200, 500),
      parseInt(offset ?? '0', 10) || 0,
      campaign, agent, parseExcludeOutcomes(excludeOutcomesRaw),
      vehicleMake, parseCsvParam(vehicleModelsRaw),
    );
  }

  @Get('ops/opportunity')
  async opsOpportunity(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('filterKey') filterKey?: string,
    @Query('campaign') campaign?: string,
    @Query('agent') agent?: string,
    @Query('excludeOutcomes') excludeOutcomesRaw?: string,
    @Query('vehicleMake') vehicleMake?: string,
    @Query('vehicleModels') vehicleModelsRaw?: string,
  ) {
    const { fromDate, toDate } = parseDateRange(from, to);
    const filter = normalizeInteractionFilter(filterKey);
    return this.svcSummary.getOpportunityMetrics(fromDate, toDate, filter, campaign, agent, parseExcludeOutcomes(excludeOutcomesRaw), vehicleMake, parseCsvParam(vehicleModelsRaw));
  }

  @Get('ops/interactions-by-opportunity-reason')
  async opsByOpportunityReason(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('filterKey') filterKey?: string,
    @Query('reason') reason?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('campaign') campaign?: string,
    @Query('agent') agent?: string,
    @Query('excludeOutcomes') excludeOutcomesRaw?: string,
    @Query('vehicleMake') vehicleMake?: string,
    @Query('vehicleModels') vehicleModelsRaw?: string,
  ) {
    if (!reason) throw new BadRequestException('reason is required');
    const { fromDate, toDate } = parseDateRange(from, to);
    const filter = normalizeInteractionFilter(filterKey);
    return this.svcSummary.getInteractionsByOpportunityReason(
      fromDate, toDate, filter, reason,
      Math.min(parseInt(limit ?? '200', 10) || 200, 500),
      parseInt(offset ?? '0', 10) || 0,
      campaign, agent, parseExcludeOutcomes(excludeOutcomesRaw),
      vehicleMake, parseCsvParam(vehicleModelsRaw),
    );
  }

  @Get('ops/interaction-detail/:id')
  async opsInteractionDetail(@Param('id') id: string) {
    const detail = await this.svcSummary.getInteractionDetail(id);
    if (!detail) throw new NotFoundException('Interaction not found');
    return detail;
  }

  @Post('ask')
  async ask(@Body() body: { id?: string; question?: string; provider?: string }) {
    if (!body?.id || !body?.question?.trim()) {
      throw new BadRequestException('id and question are required');
    }
    return this.svcSummary.askInteraction(String(body.id), body.question, body.provider);
  }

  @Get('parity/campaign-analysis')
  async parityCampaignAnalysis(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('filterKey') filterKey?: string,
    @Query('campaign') campaign?: string,
    @Query('agent') agent?: string,
    @Query('excludeOutcomes') excludeOutcomesRaw?: string,
    @Query('vehicleMake') vehicleMake?: string,
    @Query('vehicleModels') vehicleModelsRaw?: string,
  ) {
    const { fromDate, toDate } = parseDateRange(from, to);
    const filter = normalizeInteractionFilter(filterKey);
    return this.svcSummary.getParityCampaignAnalysis(
      fromDate,
      toDate,
      filter,
      campaign,
      agent,
      parseExcludeOutcomes(excludeOutcomesRaw),
      vehicleMake,
      parseCsvParam(vehicleModelsRaw),
    );
  }

  @Get('client-services/trends')
  async clientServicesTrends(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('filterKey') filterKey?: string,
    @Query('campaign') campaign?: string,
    @Query('agent') agent?: string,
    @Query('excludeOutcomes') excludeOutcomesRaw?: string,
    @Query('vehicleMake') vehicleMake?: string,
    @Query('vehicleModels') vehicleModelsRaw?: string,
  ) {
    const { fromDate, toDate } = parseDateRange(from, to);
    const filter = normalizeInteractionFilter(filterKey);
    return this.svcSummary.getClientServicesTrends(
      fromDate, toDate, filter, campaign, agent,
      parseExcludeOutcomes(excludeOutcomesRaw), vehicleMake, parseCsvParam(vehicleModelsRaw),
    );
  }

  @Get('parity/interactions')
  async parityInteractions(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('filterKey') filterKey?: string,
    @Query('consentAnswer') consentAnswer?: string,
    @Query('decisionAnswer') decisionAnswer?: string,
    @Query('dealerInTouch') dealerInTouch?: string,
    @Query('competitorBrand') competitorBrand?: string,
    @Query('competitorReason') competitorReason?: string,
    @Query('viewKey') viewKey?: string,
    @Query('viewAnswer') viewAnswer?: string,
    @Query('affordabilityAnswer') affordabilityAnswer?: string,
    @Query('lifestyleVehicleAnswer') lifestyleVehicleAnswer?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('campaign') campaign?: string,
    @Query('agent') agent?: string,
    @Query('excludeOutcomes') excludeOutcomesRaw?: string,
    @Query('vehicleMake') vehicleMake?: string,
    @Query('vehicleModels') vehicleModelsRaw?: string,
  ) {
    const { fromDate, toDate } = parseDateRange(from, to);
    const filter = normalizeInteractionFilter(filterKey);

    const normalizeAnswer = (v?: string): 'yes' | 'no' | 'n_a' | undefined => {
      if (!v) return undefined;
      if (v === 'yes' || v === 'no' || v === 'n_a') return v;
      throw new BadRequestException(
        `Answer must be one of: yes, no, n_a (got "${v}")`,
      );
    };

    const normalizeViewKey = (v?: string):
      | 'brand'
      | 'current_vehicle'
      | 'dealer'
      | 'finance_agreement'
      | undefined => {
      if (!v) return undefined;
      if (
        v === 'brand' ||
        v === 'current_vehicle' ||
        v === 'dealer' ||
        v === 'finance_agreement'
      ) {
        return v;
      }
      throw new BadRequestException(
        `viewKey must be one of: brand, current_vehicle, dealer, finance_agreement`,
      );
    };

    return this.svcSummary.getParityInteractions(
      fromDate,
      toDate,
      filter,
      {
        consentAnswer: normalizeAnswer(consentAnswer),
        decisionAnswer: normalizeAnswer(decisionAnswer),
        dealerInTouch: normalizeAnswer(dealerInTouch),
        competitorBrand: competitorBrand || undefined,
        competitorReason: competitorReason || undefined,
        viewKey: normalizeViewKey(viewKey),
        viewAnswer: normalizeAnswer(viewAnswer),
        affordabilityAnswer: normalizeAnswer(affordabilityAnswer),
        lifestyleVehicleAnswer: normalizeAnswer(lifestyleVehicleAnswer),
      },
      Math.min(parseInt(limit ?? '200', 10) || 200, 500),
      parseInt(offset ?? '0', 10) || 0,
      campaign,
      agent,
      parseExcludeOutcomes(excludeOutcomesRaw),
      vehicleMake,
      parseCsvParam(vehicleModelsRaw),
    );
  }

  @Get('interactions/search')
  async searchInteractions(@Query('q') q?: string) {
    return this.svcSummary.searchInteractions(q ?? '');
  }

  @Get('summary')
  async summary(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('filterKey') filterKey?: string,
    @Query('campaign') campaign?: string,
    @Query('agent') agent?: string,
    @Query('excludeOutcomes') excludeOutcomesRaw?: string,
  ) {
    const { fromDate, toDate } = parseDateRange(from, to);
    const filter = normalizeInteractionFilter(filterKey);
    return this.svcSummary.getMetricsSummary(fromDate, toDate, filter, campaign, agent, parseExcludeOutcomes(excludeOutcomesRaw));
  }

  @Get('summary/operations')
  async summaryOperations(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('filterKey') filterKey?: string,
    @Query('campaign') campaign?: string,
    @Query('agent') agent?: string,
    @Query('excludeOutcomes') excludeOutcomesRaw?: string,
    @Query('excludePartial') excludePartial?: string,
  ) {
    const { fromDate, toDate } = parseDateRange(from, to);
    const filter = normalizeInteractionFilter(filterKey);
    return this.svcSummary.getOperationsMetrics(
      fromDate, toDate, filter, campaign, agent,
      parseExcludeOutcomes(excludeOutcomesRaw),
      undefined, undefined,
      excludePartial === 'true',
    );
  }

  @Get('summary/client-services')
  async summaryClientServices(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('filterKey') filterKey?: string,
    @Query('campaign') campaign?: string,
    @Query('agent') agent?: string,
    @Query('excludeOutcomes') excludeOutcomesRaw?: string,
    @Query('vehicleMake') vehicleMake?: string,
    @Query('vehicleModels') vehicleModelsRaw?: string,
  ) {
    const { fromDate, toDate } = parseDateRange(from, to);
    const filter = normalizeInteractionFilter(filterKey);
    return this.svcSummary.getClientServicesMetrics(fromDate, toDate, filter, campaign, agent, parseExcludeOutcomes(excludeOutcomesRaw), vehicleMake, parseCsvParam(vehicleModelsRaw));
  }

  @Get('usage')
  async insightsUsage(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('filterKey') filterKey?: string,
    @Query('campaign') campaign?: string,
    @Query('agent') agent?: string,
    @Query('excludeOutcomes') excludeOutcomesRaw?: string,
    @Query('vehicleMake') vehicleMake?: string,
    @Query('vehicleModels') vehicleModelsRaw?: string,
  ) {
    const { fromDate, toDate } = parseDateRange(from, to);
    const filter = normalizeInteractionFilter(filterKey);
    return this.svcSummary.getInsightsUsage(fromDate, toDate, filter, campaign, agent, parseExcludeOutcomes(excludeOutcomesRaw), vehicleMake, parseCsvParam(vehicleModelsRaw));
  }

  @Get('summary/objections')
  async summaryObjections(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('filterKey') filterKey?: string,
    @Query('campaign') campaign?: string,
    @Query('agent') agent?: string,
    @Query('excludeOutcomes') excludeOutcomesRaw?: string,
  ) {
    const { fromDate, toDate } = parseDateRange(from, to);
    const filter = normalizeInteractionFilter(filterKey);
    return this.svcSummary.getObjectionsMetrics(fromDate, toDate, filter, campaign, agent, parseExcludeOutcomes(excludeOutcomesRaw));
  }

  @Get('summary/objection-assessments')
  async summaryObjectionAssessments(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('filterKey') filterKey?: string,
    @Query('campaign') campaign?: string,
    @Query('agent') agent?: string,
    @Query('excludeOutcomes') excludeOutcomesRaw?: string,
    @Query('opportunitiesOnly') opportunitiesOnly?: string,
  ) {
    const { fromDate, toDate } = parseDateRange(from, to);
    const filter = normalizeInteractionFilter(filterKey);
    return this.svcSummary.getObjectionAssessmentMetrics(fromDate, toDate, filter, campaign, agent, parseExcludeOutcomes(excludeOutcomesRaw), undefined, undefined, opportunitiesOnly === 'true');
  }

  @Get('summary/compliance')
  async summaryCompliance(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('filterKey') filterKey?: string,
    @Query('campaign') campaign?: string,
    @Query('agent') agent?: string,
    @Query('excludeOutcomes') excludeOutcomesRaw?: string,
  ) {
    const { fromDate, toDate } = parseDateRange(from, to);
    const filter = normalizeInteractionFilter(filterKey);
    return this.svcSummary.getCampaignComplianceMetrics(fromDate, toDate, filter, campaign, agent, parseExcludeOutcomes(excludeOutcomesRaw));
  }

  @Post('summary/narrative')
  async narrative(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('filterKey') filterKey?: string,
    @Query('provider') providerRaw?: string,
    @Query('narrativeType') narrativeTypeRaw?: string,
    @Query('campaign') campaign?: string,
    @Query('agent') agent?: string,
    @Query('excludeOutcomes') excludeOutcomesRaw?: string,
    @Query('model') model?: string,
  ) {
    const { fromDate, toDate } = parseDateRange(from, to);
    const provider = normalizeProvider(providerRaw);
    const filter = normalizeInteractionFilter(filterKey);
    const narrativeType = normalizeNarrativeType(narrativeTypeRaw);

    return this.svcSummary.getNarrativeSummary(
      fromDate, toDate, filter, provider, narrativeType, campaign, agent,
      parseExcludeOutcomes(excludeOutcomesRaw), undefined, undefined,
      model?.trim() || undefined,
    );
  }

  @Get('summary/narratives')
  async narratives(
    @Query('limit') limit?: string,
    @Query('filterKey') filterKey?: string,
    @Query('provider') providerRaw?: string,
    @Query('narrativeType') narrativeTypeRaw?: string,
    @Query('createdFrom') createdFromRaw?: string,
    @Query('createdTo') createdToRaw?: string,
  ) {
    const parsedLimit = parseInt(limit ?? '20', 10);

    if (Number.isNaN(parsedLimit) || parsedLimit < 1) {
      throw new BadRequestException('limit must be a positive integer');
    }

    const provider = normalizeProvider(providerRaw);
    const filter = filterKey ? normalizeInteractionFilter(filterKey) : undefined;
    const narrativeType = narrativeTypeRaw ? normalizeNarrativeType(narrativeTypeRaw) : undefined;

    const createdFrom = createdFromRaw ? new Date(createdFromRaw) : undefined;
    let createdTo = createdToRaw ? new Date(createdToRaw) : undefined;

    // If the value is a date-only string (no time component), push to end-of-next-day
    // so that records created on the selected date are included.
    if (createdTo && createdToRaw && !createdToRaw.includes('T')) {
      createdTo = new Date(createdTo.getTime() + 24 * 60 * 60 * 1000);
    }

    if (createdFrom && Number.isNaN(createdFrom.getTime())) {
      throw new BadRequestException('createdFrom must be a valid ISO date/time');
    }
    if (createdTo && Number.isNaN(createdTo.getTime())) {
      throw new BadRequestException('createdTo must be a valid ISO date/time');
    }

    return this.svcSummary.listNarratives({
      limit: Math.min(parsedLimit, 200),
      filterKey: filter,
      provider,
      narrativeType,
      createdFrom,
      createdTo,
    });
  }
}

function parseDateRange(from?: string, to?: string) {
  if (!from || !to) {
    throw new BadRequestException('from and to are required (ISO date/time)');
  }

  const fromDate = new Date(from);
  const toDate = new Date(to);

  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    throw new BadRequestException(
      'from and to must be valid ISO date/time values',
    );
  }

  return { fromDate, toDate };
}

function normalizeInteractionFilter(raw?: string): InteractionFilter {
  if (raw === 'chats') return 'chats';
  if (raw === 'all') return 'all';
  return 'calls';
}

function parseExcludeOutcomes(raw?: string): string[] | undefined {
  if (!raw) return undefined;
  const items = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return items.length ? items : undefined;
}

// Comma-separated query param → trimmed string array (e.g. multi-select model filter).
function parseCsvParam(raw?: string): string[] | undefined {
  if (!raw) return undefined;
  const items = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return items.length ? items : undefined;
}

function normalizeNarrativeType(raw?: string): NarrativeType {
  const valid: NarrativeType[] = [
    'generic',
    'calls_operations',
    'calls_client_services',
    'chats_operations',
    'chats_client_services',
    'survey_analytics',
  ];
  if (raw && valid.includes(raw as NarrativeType)) return raw as NarrativeType;
  return 'generic';
}
