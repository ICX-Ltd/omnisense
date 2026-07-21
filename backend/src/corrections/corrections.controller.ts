import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { CorrectionsService } from './corrections.service';

@Controller('uiapi/corrections')
export class CorrectionsController {
  constructor(private readonly svc: CorrectionsService) {}

  @Get(':recordingId')
  list(@Param('recordingId') recordingId: string) {
    return this.svc.list(recordingId);
  }

  @Post(':recordingId')
  add(@Param('recordingId') recordingId: string, @Body() body: any) {
    return this.svc.add(recordingId, body ?? {});
  }

  @Delete('item/:id')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
