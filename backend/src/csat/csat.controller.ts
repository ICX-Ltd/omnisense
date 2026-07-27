import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';

import { CsatFeedItem, CsatService } from './csat.service';
import { InsightsProviderName } from '../insights/types/insights-provider.type';

@Controller('uiapi/csat')
export class CsatController {
  constructor(private readonly svc: CsatService) {}

  // Third-party CSAT feed. Accepts a single item or an array. If CSAT_INGEST_TOKEN
  // is set, requires a matching x-csat-token header (shared secret for the feed).
  @Post('ingest')
  async ingest(
    @Body() body: CsatFeedItem | CsatFeedItem[],
    @Headers('x-csat-token') token?: string,
  ) {
    const expected = process.env.CSAT_INGEST_TOKEN;
    if (expected && token !== expected) {
      throw new UnauthorizedException('Invalid CSAT ingest token');
    }
    const items = Array.isArray(body) ? body : [body];
    return this.svc.ingest(items.filter((i) => i && i.interactionTpsId));
  }

  @Post('rematch')
  rematch() {
    return this.svc.rematchUnmatched();
  }

  @Get('board')
  board(@Query('from') from?: string, @Query('to') to?: string) {
    return this.svc.board({ from, to });
  }

  @Get('list')
  list(
    @Query('status') status?: string,
    @Query('decision') decision?: string,
    @Query('campaign') campaign?: string,
    @Query('reviewOutcome') reviewOutcome?: string,
    @Query('raised') raised?: string,
    @Query('clientOutcome') clientOutcome?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.list({
      status,
      decision,
      campaign,
      reviewOutcome,
      raised,
      clientOutcome,
      from,
      to,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  // Mark records as actually sent to the client. Bulk (the export set) or single.
  @Post('raise')
  setRaised(
    @Body() body: { ids: string[]; user?: string; raised?: boolean },
  ) {
    return this.svc.setRaised(
      body?.ids ?? [],
      body?.user ?? null,
      body?.raised !== false,
    );
  }

  // Record the client's answer on raised records: they accept the contest (no
  // longer a fail) or reject it (it stands). Comment is required.
  @Post('client-response')
  setClientResponse(
    @Body()
    body: { ids: string[]; outcome: string; comment?: string; user?: string },
  ) {
    return this.svc.setClientResponse(
      body?.ids ?? [],
      body?.outcome ?? '',
      body?.comment ?? '',
      body?.user ?? null,
    );
  }

  @Post('run-batch')
  runBatch(
    @Body() body: { limit?: number; provider?: InsightsProviderName; model?: string },
  ) {
    return this.svc.runBatch(body?.limit ?? 25, body?.provider, body?.model);
  }

  @Post('item/:id/requeue')
  requeue(@Param('id') id: string) {
    return this.svc.requeue(id);
  }

  @Post('item/:id/assess')
  assessOne(
    @Param('id') id: string,
    @Body() body: { provider?: InsightsProviderName; model?: string },
  ) {
    return this.svc.assessOne(id, body?.provider, body?.model);
  }

  @Get('item/:id')
  detail(@Param('id') id: string) {
    return this.svc.getDetail(id);
  }

  @Post('item/:id/comment')
  addComment(
    @Param('id') id: string,
    @Body() body: { comment: string; user?: string },
  ) {
    return this.svc.addComment(id, body?.user ?? null, body?.comment ?? '');
  }

  @Post('item/:id/review')
  review(
    @Param('id') id: string,
    @Body() body: { action: string; user?: string },
  ) {
    return this.svc.setReview(id, body?.action ?? '', body?.user ?? null);
  }
}
