import {
  Body,
  Controller,
  Query,
  Post,
  Get,
  BadRequestException,
} from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { InsightsService } from './insights.service';
import { InsightsSummaryService, InteractionFilter, NarrativeType } from './insights-summary.service';
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

  @Get('summary')
  async summary(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('filterKey') filterKey?: string,
  ) {
    const { fromDate, toDate } = parseDateRange(from, to);
    const filter = normalizeInteractionFilter(filterKey);
    return this.svcSummary.getMetricsSummary(fromDate, toDate, filter);
  }

  @Get('summary/operations')
  async summaryOperations(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('filterKey') filterKey?: string,
  ) {
    const { fromDate, toDate } = parseDateRange(from, to);
    const filter = normalizeInteractionFilter(filterKey);
    return this.svcSummary.getOperationsMetrics(fromDate, toDate, filter);
  }

  @Get('summary/client-services')
  async summaryClientServices(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('filterKey') filterKey?: string,
  ) {
    const { fromDate, toDate } = parseDateRange(from, to);
    const filter = normalizeInteractionFilter(filterKey);
    return this.svcSummary.getClientServicesMetrics(fromDate, toDate, filter);
  }

  @Get('summary/objections')
  async summaryObjections(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('filterKey') filterKey?: string,
  ) {
    const { fromDate, toDate } = parseDateRange(from, to);
    const filter = normalizeInteractionFilter(filterKey);
    return this.svcSummary.getObjectionsMetrics(fromDate, toDate, filter);
  }

  @Get('summary/compliance')
  async summaryCompliance(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('filterKey') filterKey?: string,
  ) {
    const { fromDate, toDate } = parseDateRange(from, to);
    const filter = normalizeInteractionFilter(filterKey);
    return this.svcSummary.getCampaignComplianceMetrics(fromDate, toDate, filter);
  }

  @Post('summary/narrative')
  async narrative(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('filterKey') filterKey?: string,
    @Query('provider') providerRaw?: string,
    @Query('narrativeType') narrativeTypeRaw?: string,
  ) {
    const { fromDate, toDate } = parseDateRange(from, to);
    const provider = normalizeProvider(providerRaw);
    const filter = normalizeInteractionFilter(filterKey);
    const narrativeType = normalizeNarrativeType(narrativeTypeRaw);

    return this.svcSummary.getNarrativeSummary(fromDate, toDate, filter, provider, narrativeType);
  }

  @Get('summary/narratives')
  async narratives(
    @Query('limit') limit?: string,
    @Query('filterKey') filterKey?: string,
    @Query('provider') providerRaw?: string,
    @Query('narrativeType') narrativeTypeRaw?: string,
  ) {
    const parsedLimit = parseInt(limit ?? '20', 10);

    if (Number.isNaN(parsedLimit) || parsedLimit < 1) {
      throw new BadRequestException('limit must be a positive integer');
    }

    const provider = normalizeProvider(providerRaw);
    const filter = normalizeInteractionFilter(filterKey);
    const narrativeType = normalizeNarrativeType(narrativeTypeRaw);

    return this.svcSummary.listNarratives({
      limit: Math.min(parsedLimit, 200),
      filterKey: filter,
      provider,
      narrativeType,
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
