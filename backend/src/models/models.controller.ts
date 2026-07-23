import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ModelRegistryService } from './model-registry.service';

@Controller('uiapi/models')
export class ModelsController {
  constructor(private readonly svc: ModelRegistryService) {}

  // Full list (optionally by kind) — for the editor.
  @Get()
  list(@Query('kind') kind?: string) {
    return this.svc.list(kind);
  }

  // Active insights options grouped by provider — for the dashboard dropdowns.
  @Get('insights-options')
  insightsOptions() {
    return this.svc.insightsByProvider();
  }

  // Live check: which models each provider now offers that aren't registered yet.
  @Get('discover')
  discover() {
    return this.svc.discover();
  }

  @Post()
  add(@Body() body: any) {
    return this.svc.add(body ?? {});
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: { label?: string; active?: boolean; sortOrder?: number }) {
    return this.svc.update(id, body ?? {});
  }

  @Patch(':id/default')
  setDefault(@Param('id') id: string) {
    return this.svc.setDefault(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
