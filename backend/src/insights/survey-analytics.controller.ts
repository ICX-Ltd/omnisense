import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { SurveyAnalyticsService, SurveyFilter } from './survey-analytics.service';

@Controller('uiapi/survey')
export class SurveyAnalyticsController {
  constructor(private readonly svc: SurveyAnalyticsService) {}

  private parseFilter(
    from?: string, to?: string, campaign?: string,
    manufacture?: string, model?: string, dealer?: string,
    surveyTakenOnly?: string, outcome?: string,
  ): SurveyFilter {
    const f: SurveyFilter = {};
    if (from) {
      f.from = new Date(from);
      if (Number.isNaN(f.from.getTime())) throw new BadRequestException('Invalid from date');
    }
    if (to) {
      f.to = new Date(to);
      if (Number.isNaN(f.to.getTime())) throw new BadRequestException('Invalid to date');
    }
    if (campaign) f.campaign = campaign;
    if (manufacture) f.manufacture = manufacture;
    if (model) f.model = model;
    if (dealer) f.dealer = dealer;
    if (surveyTakenOnly === 'true') f.surveyTakenOnly = true;
    if (outcome) f.outcome = outcome;
    return f;
  }

  @Get('filters')
  async filters() {
    return this.svc.getFilterOptions();
  }

  @Get('overview')
  async overview(
    @Query('from') from?: string, @Query('to') to?: string,
    @Query('campaign') campaign?: string, @Query('manufacture') manufacture?: string,
    @Query('model') model?: string, @Query('dealer') dealer?: string,
    @Query('surveyTakenOnly') surveyTakenOnly?: string, @Query('outcome') outcome?: string,
  ) {
    return this.svc.getOverview(this.parseFilter(from, to, campaign, manufacture, model, dealer, surveyTakenOnly, outcome));
  }

  @Get('categories')
  async categories(
    @Query('from') from?: string, @Query('to') to?: string,
    @Query('campaign') campaign?: string, @Query('manufacture') manufacture?: string,
    @Query('model') model?: string, @Query('dealer') dealer?: string,
    @Query('surveyTakenOnly') surveyTakenOnly?: string, @Query('outcome') outcome?: string,
  ) {
    return this.svc.getCategoryBreakdown(this.parseFilter(from, to, campaign, manufacture, model, dealer, surveyTakenOnly, outcome));
  }

  @Get('interest-factors')
  async interestFactors(
    @Query('from') from?: string, @Query('to') to?: string,
    @Query('campaign') campaign?: string, @Query('manufacture') manufacture?: string,
    @Query('model') model?: string, @Query('dealer') dealer?: string,
    @Query('surveyTakenOnly') surveyTakenOnly?: string, @Query('outcome') outcome?: string,
  ) {
    return this.svc.getInterestFactors(this.parseFilter(from, to, campaign, manufacture, model, dealer, surveyTakenOnly, outcome));
  }

  @Get('not-purchase-reasons')
  async notPurchaseReasons(
    @Query('from') from?: string, @Query('to') to?: string,
    @Query('campaign') campaign?: string, @Query('manufacture') manufacture?: string,
    @Query('model') model?: string, @Query('dealer') dealer?: string,
    @Query('surveyTakenOnly') surveyTakenOnly?: string, @Query('outcome') outcome?: string,
  ) {
    return this.svc.getNotPurchaseReasons(this.parseFilter(from, to, campaign, manufacture, model, dealer, surveyTakenOnly, outcome));
  }

  @Get('model-reason-radar')
  async modelReasonRadar(
    @Query('from') from?: string, @Query('to') to?: string,
    @Query('campaign') campaign?: string, @Query('manufacture') manufacture?: string,
    @Query('model') model?: string, @Query('dealer') dealer?: string,
    @Query('surveyTakenOnly') surveyTakenOnly?: string, @Query('outcome') outcome?: string,
  ) {
    return this.svc.getModelReasonRadar(this.parseFilter(from, to, campaign, manufacture, model, dealer, surveyTakenOnly, outcome));
  }

  @Get('competitor-purchases')
  async competitorPurchases(
    @Query('from') from?: string, @Query('to') to?: string,
    @Query('campaign') campaign?: string, @Query('manufacture') manufacture?: string,
    @Query('model') model?: string, @Query('dealer') dealer?: string,
    @Query('surveyTakenOnly') surveyTakenOnly?: string, @Query('outcome') outcome?: string,
  ) {
    return this.svc.getCompetitorPurchases(this.parseFilter(from, to, campaign, manufacture, model, dealer, surveyTakenOnly, outcome));
  }

  @Get('competitor-models')
  async competitorModels(
    @Query('make') make?: string,
    @Query('from') from?: string, @Query('to') to?: string,
    @Query('campaign') campaign?: string, @Query('manufacture') manufacture?: string,
    @Query('model') model?: string, @Query('dealer') dealer?: string,
    @Query('surveyTakenOnly') surveyTakenOnly?: string, @Query('outcome') outcome?: string,
  ) {
    if (!make) throw new BadRequestException('make is required');
    return this.svc.getCompetitorModels(this.parseFilter(from, to, campaign, manufacture, model, dealer, surveyTakenOnly, outcome), make);
  }

  @Get('dealership-ratings')
  async dealershipRatings(
    @Query('from') from?: string, @Query('to') to?: string,
    @Query('campaign') campaign?: string, @Query('manufacture') manufacture?: string,
    @Query('model') model?: string, @Query('dealer') dealer?: string,
    @Query('surveyTakenOnly') surveyTakenOnly?: string, @Query('outcome') outcome?: string,
  ) {
    return this.svc.getDealershipRatings(this.parseFilter(from, to, campaign, manufacture, model, dealer, surveyTakenOnly, outcome));
  }

  @Get('dealer-visits')
  async dealerVisits(
    @Query('from') from?: string, @Query('to') to?: string,
    @Query('campaign') campaign?: string, @Query('manufacture') manufacture?: string,
    @Query('model') model?: string, @Query('dealer') dealer?: string,
    @Query('surveyTakenOnly') surveyTakenOnly?: string, @Query('outcome') outcome?: string,
  ) {
    return this.svc.getDealerVisitOutcomes(this.parseFilter(from, to, campaign, manufacture, model, dealer, surveyTakenOnly, outcome));
  }

  @Get('model-performance')
  async modelPerformance(
    @Query('from') from?: string, @Query('to') to?: string,
    @Query('campaign') campaign?: string, @Query('manufacture') manufacture?: string,
    @Query('model') model?: string, @Query('dealer') dealer?: string,
    @Query('surveyTakenOnly') surveyTakenOnly?: string, @Query('outcome') outcome?: string,
  ) {
    return this.svc.getModelPerformance(this.parseFilter(from, to, campaign, manufacture, model, dealer, surveyTakenOnly, outcome));
  }

  @Get('records-by-category')
  async recordsByCategory(
    @Query('category') category?: string,
    @Query('limit') limit?: string, @Query('offset') offset?: string,
    @Query('from') from?: string, @Query('to') to?: string,
    @Query('campaign') campaign?: string, @Query('manufacture') manufacture?: string,
    @Query('model') model?: string, @Query('dealer') dealer?: string,
    @Query('surveyTakenOnly') surveyTakenOnly?: string, @Query('outcome') outcome?: string,
  ) {
    if (!category) throw new BadRequestException('category is required');
    return this.svc.getRecordsByCategory(
      this.parseFilter(from, to, campaign, manufacture, model, dealer, surveyTakenOnly, outcome),
      category,
      Math.min(parseInt(limit ?? '200', 10) || 200, 500),
      parseInt(offset ?? '0', 10) || 0,
    );
  }

  @Get('records-by-competitor')
  async recordsByCompetitor(
    @Query('make') make?: string,
    @Query('limit') limit?: string, @Query('offset') offset?: string,
    @Query('from') from?: string, @Query('to') to?: string,
    @Query('campaign') campaign?: string, @Query('manufacture') manufacture?: string,
    @Query('model') model?: string, @Query('dealer') dealer?: string,
    @Query('surveyTakenOnly') surveyTakenOnly?: string, @Query('outcome') outcome?: string,
  ) {
    if (!make) throw new BadRequestException('make is required');
    return this.svc.getRecordsByCompetitorMake(
      this.parseFilter(from, to, campaign, manufacture, model, dealer, surveyTakenOnly, outcome),
      make,
      Math.min(parseInt(limit ?? '200', 10) || 200, 500),
      parseInt(offset ?? '0', 10) || 0,
    );
  }

  @Get('competitor-analysis')
  async competitorAnalysis(
    @Query('from') from?: string, @Query('to') to?: string,
    @Query('campaign') campaign?: string, @Query('manufacture') manufacture?: string,
    @Query('model') model?: string, @Query('dealer') dealer?: string,
    @Query('surveyTakenOnly') surveyTakenOnly?: string, @Query('outcome') outcome?: string,
  ) {
    return this.svc.getCompetitorAnalysis(this.parseFilter(from, to, campaign, manufacture, model, dealer, surveyTakenOnly, outcome));
  }

  @Get('quarterly-trends')
  async quarterlyTrends(
    @Query('from') from?: string, @Query('to') to?: string,
    @Query('campaign') campaign?: string, @Query('manufacture') manufacture?: string,
    @Query('model') model?: string, @Query('dealer') dealer?: string,
    @Query('surveyTakenOnly') surveyTakenOnly?: string, @Query('outcome') outcome?: string,
  ) {
    return this.svc.getQuarterlyTrends(this.parseFilter(from, to, campaign, manufacture, model, dealer, surveyTakenOnly, outcome));
  }

  @Get('monthly-trends')
  async monthlyTrends(
    @Query('from') from?: string, @Query('to') to?: string,
    @Query('campaign') campaign?: string, @Query('manufacture') manufacture?: string,
    @Query('model') model?: string, @Query('dealer') dealer?: string,
    @Query('surveyTakenOnly') surveyTakenOnly?: string, @Query('outcome') outcome?: string,
  ) {
    return this.svc.getMonthlyTrends(this.parseFilter(from, to, campaign, manufacture, model, dealer, surveyTakenOnly, outcome));
  }

  @Get('model-risk')
  async modelRisk(
    @Query('from') from?: string, @Query('to') to?: string,
    @Query('campaign') campaign?: string, @Query('manufacture') manufacture?: string,
    @Query('model') model?: string, @Query('dealer') dealer?: string,
    @Query('surveyTakenOnly') surveyTakenOnly?: string, @Query('outcome') outcome?: string,
  ) {
    return this.svc.getModelRisk(this.parseFilter(from, to, campaign, manufacture, model, dealer, surveyTakenOnly, outcome));
  }

  @Get('why-we-lose')
  async whyWeLose(
    @Query('from') from?: string, @Query('to') to?: string,
    @Query('campaign') campaign?: string, @Query('manufacture') manufacture?: string,
    @Query('model') model?: string, @Query('dealer') dealer?: string,
    @Query('surveyTakenOnly') surveyTakenOnly?: string, @Query('outcome') outcome?: string,
  ) {
    return this.svc.getWhyWeLose(this.parseFilter(from, to, campaign, manufacture, model, dealer, surveyTakenOnly, outcome));
  }

  @Get('whats-working')
  async whatsWorking(
    @Query('from') from?: string, @Query('to') to?: string,
    @Query('campaign') campaign?: string, @Query('manufacture') manufacture?: string,
    @Query('model') model?: string, @Query('dealer') dealer?: string,
    @Query('surveyTakenOnly') surveyTakenOnly?: string, @Query('outcome') outcome?: string,
  ) {
    return this.svc.getWhatWorking(this.parseFilter(from, to, campaign, manufacture, model, dealer, surveyTakenOnly, outcome));
  }

  @Get('drill-records')
  async drillRecords(
    @Query('competitorMake') competitorMake?: string,
    @Query('chineseOnly') chineseOnly?: string,
    @Query('excludeChinese') excludeChinese?: string,
    @Query('notPurchaseReason') notPurchaseReason?: string,
    @Query('notPurchaseSubReason') notPurchaseSubReason?: string,
    @Query('interestFactor') interestFactor?: string,
    @Query('drillModel') drillModel?: string,
    @Query('defectedOnly') defectedOnly?: string,
    @Query('wonOnly') wonOnly?: string,
    @Query('flowStatus') flowStatus?: string,
    @Query('stillConsidering') stillConsidering?: string,
    @Query('ratingScore') ratingScore?: string,
    @Query('dealerVisit') dealerVisit?: string,
    @Query('ratedOnly') ratedOnly?: string,
    @Query('limit') limit?: string, @Query('offset') offset?: string,
    @Query('from') from?: string, @Query('to') to?: string,
    @Query('campaign') campaign?: string, @Query('manufacture') manufacture?: string,
    @Query('model') model?: string, @Query('dealer') dealer?: string,
    @Query('surveyTakenOnly') surveyTakenOnly?: string, @Query('outcome') outcome?: string,
  ) {
    const rating = ratingScore != null && ratingScore !== '' ? parseInt(ratingScore, 10) : undefined;
    return this.svc.getDrillRecords(
      this.parseFilter(from, to, campaign, manufacture, model, dealer, surveyTakenOnly, outcome),
      {
        competitorMake: competitorMake || undefined,
        chineseOnly: chineseOnly === 'true',
        excludeChinese: excludeChinese === 'true',
        notPurchaseReason: notPurchaseReason || undefined,
        notPurchaseSubReason: notPurchaseSubReason || undefined,
        interestFactor: interestFactor || undefined,
        model: drillModel || undefined,
        defectedOnly: defectedOnly === 'true',
        wonOnly: wonOnly === 'true',
        flowStatus: flowStatus || undefined,
        stillConsidering: stillConsidering === 'true',
        ratingScore: Number.isNaN(rating as number) ? undefined : rating,
        dealerVisit: dealerVisit || undefined,
        ratedOnly: ratedOnly === 'true',
      },
      Math.min(parseInt(limit ?? '200', 10) || 200, 500),
      parseInt(offset ?? '0', 10) || 0,
    );
  }

  @Get('transcript-drill-records')
  async transcriptDrillRecords(
    @Query('sentimentTopic') sentimentTopic?: string,
    @Query('sentimentValue') sentimentValue?: string,
    @Query('transcriptBrand') transcriptBrand?: string,
    @Query('transcriptChineseOnly') transcriptChineseOnly?: string,
    @Query('transcriptNonChineseOnly') transcriptNonChineseOnly?: string,
    @Query('competitorReason') competitorReason?: string,
    @Query('chineseReason') chineseReason?: string,
    @Query('notPurchaseReasonSurvey') notPurchaseReasonSurvey?: string,
    @Query('frustrationTheme') frustrationTheme?: string,
    @Query('frustrationSeverity') frustrationSeverity?: string,
    @Query('frustrationResolvable') frustrationResolvable?: string,
    @Query('priceGap') priceGap?: string,
    @Query('dealerFollowUp') dealerFollowUp?: string,
    @Query('evStance') evStance?: string,
    @Query('loyaltyAnswer') loyaltyAnswer?: string,
    @Query('limit') limit?: string, @Query('offset') offset?: string,
    @Query('from') from?: string, @Query('to') to?: string,
    @Query('campaign') campaign?: string, @Query('manufacture') manufacture?: string,
    @Query('model') model?: string, @Query('dealer') dealer?: string,
    @Query('surveyTakenOnly') surveyTakenOnly?: string, @Query('outcome') outcome?: string,
  ) {
    return this.svc.getTranscriptDrillRecords(
      this.parseFilter(from, to, campaign, manufacture, model, dealer, surveyTakenOnly, outcome),
      {
        sentimentTopic: sentimentTopic || undefined,
        sentimentValue: sentimentValue || undefined,
        transcriptBrand: transcriptBrand || undefined,
        transcriptChineseOnly: transcriptChineseOnly === 'true',
        transcriptNonChineseOnly: transcriptNonChineseOnly === 'true',
        competitorReason: competitorReason || undefined,
        chineseReason: chineseReason || undefined,
        notPurchaseReasonSurvey: notPurchaseReasonSurvey || undefined,
        frustrationTheme: frustrationTheme || undefined,
        frustrationSeverity: frustrationSeverity || undefined,
        frustrationResolvable: frustrationResolvable || undefined,
        priceGap: priceGap === 'true',
        dealerFollowUp: dealerFollowUp || undefined,
        evStance: evStance || undefined,
        loyaltyAnswer: loyaltyAnswer || undefined,
      },
      Math.min(parseInt(limit ?? '200', 10) || 200, 500),
      parseInt(offset ?? '0', 10) || 0,
    );
  }

  @Get('reason-cross-tab')
  async reasonCrossTab(
    @Query('from') from?: string, @Query('to') to?: string,
    @Query('campaign') campaign?: string, @Query('manufacture') manufacture?: string,
    @Query('model') model?: string, @Query('dealer') dealer?: string,
    @Query('surveyTakenOnly') surveyTakenOnly?: string, @Query('outcome') outcome?: string,
  ) {
    return this.svc.getReasonCrossTab(this.parseFilter(from, to, campaign, manufacture, model, dealer, surveyTakenOnly, outcome));
  }

  @Get('transcript-insights')
  async transcriptInsights(
    @Query('from') from?: string, @Query('to') to?: string,
    @Query('campaign') campaign?: string, @Query('manufacture') manufacture?: string,
    @Query('model') model?: string, @Query('dealer') dealer?: string,
    @Query('surveyTakenOnly') surveyTakenOnly?: string, @Query('outcome') outcome?: string,
  ) {
    return this.svc.getTranscriptInsights(this.parseFilter(from, to, campaign, manufacture, model, dealer, surveyTakenOnly, outcome));
  }

  // Grounded "Ask AI" over the filtered survey dataset. Filters come in the body
  // alongside the question so we don't overflow the query string.
  @Post('ask')
  async ask(
    @Body()
    body: {
      question?: string;
      provider?: string;
      from?: string; to?: string; campaign?: string;
      manufacture?: string; model?: string; dealer?: string; surveyTakenOnly?: string;
      outcome?: string;
    },
  ) {
    if (!body?.question?.trim()) throw new BadRequestException('question is required');
    const f = this.parseFilter(
      body.from, body.to, body.campaign, body.manufacture, body.model, body.dealer,
      body.surveyTakenOnly, body.outcome,
    );
    return this.svc.askSurvey(f, body.question, body.provider);
  }

  @Get('record/:id')
  async recordDetail(@Param('id') id: string) {
    const record = await this.svc.getRecordDetail(id);
    if (!record) throw new NotFoundException('Survey record not found');
    return record;
  }
}
