import { Controller, Get, Headers } from '@nestjs/common';
import { HealthService } from './health.service';

// Same role set that gates the other admin surfaces (Prompts).
const READ_ROLES = ['dev', 'admin', 'supervisor'];

@Controller('uiapi/health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  // Cheap, always-on checks (DB, schema drift, prompts, provider keys, config).
  @Get()
  async report(@Headers('authorization') auth: string) {
    this.health.requireRole(auth, READ_ROLES);
    return this.health.getReport();
  }

  // Outbound network probes (Deepgram + the recording host). Slower — run on
  // demand from the UI, not on every page load.
  @Get('connectivity')
  async connectivity(@Headers('authorization') auth: string) {
    this.health.requireRole(auth, READ_ROLES);
    return this.health.getConnectivity();
  }

  // Live LLM provider probes — a minimal real call to each provider to verify the
  // API key is valid and the account still has tokens/credit. On demand (spends
  // a trivial number of tokens), not on every page load.
  @Get('providers')
  async providers(@Headers('authorization') auth: string) {
    this.health.requireRole(auth, READ_ROLES);
    return this.health.getProviderConnectivity();
  }
}
