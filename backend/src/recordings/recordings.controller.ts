import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { RecordingsService } from './recordings.service';
import { normalizeProvider } from '../insights/helpers/provider.helper';

class RecordingInsightsDto {
  @IsOptional()
  @IsString()
  provider?: string;
}

class BatchInsightsDto {
  @IsOptional()
  @IsString()
  provider?: string;
}

@Controller('uiapi/recordings')
export class RecordingsController {
  constructor(private readonly svc: RecordingsService) {}

  @Get()
  list(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('interactionType') interactionType?: string,
    @Query('campaign') campaign?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('order') order?: string,
  ) {
    const parsedLimit = parseInt(limit ?? '50', 10);

    if (Number.isNaN(parsedLimit) || parsedLimit < 1) {
      throw new BadRequestException('limit must be a positive integer');
    }

    // dateTo is treated as end-of-day inclusive
    let parsedDateTo: Date | undefined;
    if (dateTo) {
      parsedDateTo = new Date(dateTo);
      parsedDateTo.setHours(23, 59, 59, 999);
    }

    return this.svc.list({
      status: status as any,
      limit: Math.min(parsedLimit, 1000),
      interactionType,
      campaign: campaign || undefined,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: parsedDateTo,
      order: order === 'ASC' ? 'ASC' : 'DESC',
    });
  }

  @Post()
  create(@Body() body: { recordingUrl: string; provider?: string }) {
    return this.svc.createRecording(
      body.recordingUrl,
      body.provider ?? 'manual',
    );
  }

  @Get('summary')
  summary() {
    return this.svc.summaryByStatus();
  }

  @Get('jobs')
  listJobs() {
    return this.svc.listJobs(20);
  }

  @Get('jobs/:jobId')
  getJob(@Param('jobId') jobId: string) {
    return this.svc.getJob(jobId);
  }

  @Post('batch/transcribe')
  batchTranscribe(@Query('limit') limit?: string) {
    const parsedLimit = parseInt(limit ?? '10', 10);

    if (Number.isNaN(parsedLimit) || parsedLimit < 1) {
      throw new BadRequestException('limit must be a positive integer');
    }

    return this.svc.startBatchTranscribe(Math.min(parsedLimit, 1000));
  }

  @Post('batch/insights')
  batchInsights(
    @Query('limit') limit?: string,
    @Body() body?: BatchInsightsDto,
  ) {
    const parsedLimit = parseInt(limit ?? '10', 10);

    if (Number.isNaN(parsedLimit) || parsedLimit < 1) {
      throw new BadRequestException('limit must be a positive integer');
    }

    const provider = normalizeProvider(body?.provider);

    return this.svc.startBatchInsights(Math.min(parsedLimit, 1000), provider);
  }

  @Post('batch/insights/chats')
  batchInsightsChats(
    @Query('limit') limit?: string,
    @Body() body?: BatchInsightsDto,
  ) {
    const parsedLimit = parseInt(limit ?? '10', 10);

    if (Number.isNaN(parsedLimit) || parsedLimit < 1) {
      throw new BadRequestException('limit must be a positive integer');
    }

    const provider = normalizeProvider(body?.provider);

    return this.svc.startBatchInsightsChats(Math.min(parsedLimit, 1000), provider);
  }

  @Post(':id/transcribe')
  transcribe(@Param('id') id: string) {
    return this.svc.transcribeRecordingById(id);
  }

  @Post(':id/insights')
  async generateInsights(
    @Param('id') id: string,
    @Body() body: RecordingInsightsDto,
  ) {
    const provider = normalizeProvider(body?.provider);
    return this.svc.generateInsights(id, provider);
  }

  @Get(':id/transcript')
  async getTranscript(@Param('id') id: string) {
    const row = await this.svc.getTranscript(id);
    if (!row) throw new NotFoundException('Transcript not found');
    return row;
  }

  @Get(':id/insight')
  async getInsight(@Param('id') id: string) {
    const row = await this.svc.getInsight(id);
    if (!row) throw new NotFoundException('Insight not found');
    return row;
  }
}
