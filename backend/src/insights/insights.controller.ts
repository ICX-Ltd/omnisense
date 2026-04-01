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

  @Get('ops/dimensions')
  async opsDimensions(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('filterKey') filterKey?: string,
    @Query('campaign') campaign?: string,
    @Query('agent') agent?: string,
    @Query('excludeOutcomes') excludeOutcomesRaw?: string,
  ) {
    const { fromDate, toDate } = parseDateRange(from, to);
    const filter = normalizeInteractionFilter(filterKey);
    return this.svcSummary.getOpsDimensionComparison(fromDate, toDate, filter, campaign, agent, parseExcludeOutcomes(excludeOutcomesRaw));
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

  @Get('ops/interaction-detail/:id')
  async opsInteractionDetail(@Param('id') id: string) {
    const detail = await this.svcSummary.getInteractionDetail(id);
    if (!detail) throw new NotFoundException('Interaction not found');
    return detail;
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
  ) {
    const { fromDate, toDate } = parseDateRange(from, to);
    const filter = normalizeInteractionFilter(filterKey);
    return this.svcSummary.getOperationsMetrics(fromDate, toDate, filter, campaign, agent, parseExcludeOutcomes(excludeOutcomesRaw));
  }

  @Get('summary/client-services')
  async summaryClientServices(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('filterKey') filterKey?: string,
    @Query('campaign') campaign?: string,
    @Query('agent') agent?: string,
    @Query('excludeOutcomes') excludeOutcomesRaw?: string,
  ) {
    const { fromDate, toDate } = parseDateRange(from, to);
    const filter = normalizeInteractionFilter(filterKey);
    return this.svcSummary.getClientServicesMetrics(fromDate, toDate, filter, campaign, agent, parseExcludeOutcomes(excludeOutcomesRaw));
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
  ) {
    const { fromDate, toDate } = parseDateRange(from, to);
    const provider = normalizeProvider(providerRaw);
    const filter = normalizeInteractionFilter(filterKey);
    const narrativeType = normalizeNarrativeType(narrativeTypeRaw);

    return this.svcSummary.getNarrativeSummary(fromDate, toDate, filter, provider, narrativeType, campaign, agent, parseExcludeOutcomes(excludeOutcomesRaw));
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

function normalizeNarrativeType(raw?: string): NarrativeType {
  const valid: NarrativeType[] = [
    'generic',
    'calls_operations',
    'calls_client_services',
    'chats_operations',
    'chats_client_services',
  ];
  if (raw && valid.includes(raw as NarrativeType)) return raw as NarrativeType;
  return 'generic';
}
