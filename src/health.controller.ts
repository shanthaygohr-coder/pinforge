import { Controller, Get } from '@nestjs/common';

// Endpoint simplu pentru a verifica ca serverul a pornit corect.
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok', service: 'pinforge-autopilot', time: new Date().toISOString() };
  }
}
