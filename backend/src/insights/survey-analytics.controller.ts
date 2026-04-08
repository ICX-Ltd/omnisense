import {
  Controller,
  Get,
  Param,
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
    surveyTakenOnly?: string,
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
    @Query('surveyTakenOnly') surveyTakenOnly?: string,
  ) {
    return this.svc.getOverview(this.parseFilter(from, to, campaign, manufacture, model, dealer, surveyTakenOnly));
  }

  @Get('categories')
  async categories(
    @Query('from') from?: string, @Query('to') to?: string,
    @Query('campaign') campaign?: string, @Query('manufacture') manufacture?: string,
    @Query('model') model?: string, @Query('dealer') dealer?: string,
    @Query('surveyTakenOnly') surveyTakenOnly?: string,
  ) {
    return this.svc.getCategoryBreakdown(this.parseFilter(from, to, campaign, manufacture, model, dealer, surveyTakenOnly));
  }

  @Get('interest-factors')
  async interestFactors(
    @Query('from') from?: string, @Query('to') to?: string,
    @Query('campaign') campaign?: string, @Query('manufacture') manufacture?: string,
    @Query('model') model?: string, @Query('dealer') dealer?: string,
    @Query('surveyTakenOnly') surveyTakenOnly?: string,
  ) {
    return this.svc.getInterestFactors(this.parseFilter(from, to, campaign, manufacture, model, dealer, surveyTakenOnly));
  }

  @Get('not-purchase-reasons')
  async notPurchaseReasons(
    @Query('from') from?: string, @Query('to') to?: string,
    @Query('campaign') campaign?: string, @Query('manufacture') manufacture?: string,
    @Query('model') model?: string, @Query('dealer') dealer?: string,
    @Query('surveyTakenOnly') surveyTakenOnly?: string,
  ) {
    return this.svc.getNotPurchaseReasons(this.parseFilter(from, to, campaign, manufacture, model, dealer, surveyTakenOnly));
  }

  @Get('competitor-purchases')
  async competitorPurchases(
    @Query('from') from?: string, @Query('to') to?: string,
    @Query('campaign') campaign?: string, @Query('manufacture') manufacture?: string,
    @Query('model') model?: string, @Query('dealer') dealer?: string,
    @Query('surveyTakenOnly') surveyTakenOnly?: string,
  ) {
    return this.svc.getCompetitorPurchases(this.parseFilter(from, to, campaign, manufacture, model, dealer, surveyTakenOnly));
  }

  @Get('competitor-models')
  async competitorModels(
    @Query('make') make?: string,
    @Query('from') from?: string, @Query('to') to?: string,
    @Query('campaign') campaign?: string, @Query('manufacture') manufacture?: string,
    @Query('model') model?: string, @Query('dealer') dealer?: string,
    @Query('surveyTakenOnly') surveyTakenOnly?: string,
  ) {
    if (!make) throw new BadRequestException('make is required');
    return this.svc.getCompetitorModels(this.parseFilter(from, to, campaign, manufacture, model, dealer, surveyTakenOnly), make);
  }

  @Get('dealership-ratings')
  async dealershipRatings(
    @Query('from') from?: string, @Query('to') to?: string,
    @Query('campaign') campaign?: string, @Query('manufacture') manufacture?: string,
    @Query('model') model?: string, @Query('dealer') dealer?: string,
    @Query('surveyTakenOnly') surveyTakenOnly?: string,
  ) {
    return this.svc.getDealershipRatings(this.parseFilter(from, to, campaign, manufacture, model, dealer, surveyTakenOnly));
  }

  @Get('dealer-visits')
  async dealerVisits(
    @Query('from') from?: string, @Query('to') to?: string,
    @Query('campaign') campaign?: string, @Query('manufacture') manufacture?: string,
    @Query('model') model?: string, @Query('dealer') dealer?: string,
    @Query('surveyTakenOnly') surveyTakenOnly?: string,
  ) {
    return this.svc.getDealerVisitOutcomes(this.parseFilter(from, to, campaign, manufacture, model, dealer, surveyTakenOnly));
  }

  @Get('model-performance')
  async modelPerformance(
    @Query('from') from?: string, @Query('to') to?: string,
    @Query('campaign') campaign?: string, @Query('manufacture') manufacture?: string,
    @Query('model') model?: string, @Query('dealer') dealer?: string,
    @Query('surveyTakenOnly') surveyTakenOnly?: string,
  ) {
    return this.svc.getModelPerformance(this.parseFilter(from, to, campaign, manufacture, model, dealer, surveyTakenOnly));
  }

  @Get('records-by-category')
  async recordsByCategory(
    @Query('category') category?: string,
    @Query('limit') limit?: string, @Query('offset') offset?: string,
    @Query('from') from?: string, @Query('to') to?: string,
    @Query('campaign') campaign?: string, @Query('manufacture') manufacture?: string,
    @Query('model') model?: string, @Query('dealer') dealer?: string,
    @Query('surveyTakenOnly') surveyTakenOnly?: string,
  ) {
    if (!category) throw new BadRequestException('category is required');
    return this.svc.getRecordsByCategory(
      this.parseFilter(from, to, campaign, manufacture, model, dealer, surveyTakenOnly),
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
    @Query('surveyTakenOnly') surveyTakenOnly?: string,
  ) {
    if (!make) throw new BadRequestException('make is required');
    return this.svc.getRecordsByCompetitorMake(
      this.parseFilter(from, to, campaign, manufacture, model, dealer, surveyTakenOnly),
      make,
      Math.min(parseInt(limit ?? '200', 10) || 200, 500),
      parseInt(offset ?? '0', 10) || 0,
    );
  }

  @Get('record/:id')
  async recordDetail(@Param('id') id: string) {
    const record = await this.svc.getRecordDetail(parseInt(id, 10));
    if (!record) throw new NotFoundException('Survey record not found');
    return record;
  }
}
