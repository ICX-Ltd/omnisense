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
  board() {
    return this.svc.board();
  }

  @Get('list')
  list(
    @Query('status') status?: string,
    @Query('decision') decision?: string,
    @Query('campaign') campaign?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.list({
      status,
      decision,
      campaign,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
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
}
