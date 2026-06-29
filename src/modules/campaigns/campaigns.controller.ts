import { Body, Controller, Post } from '@nestjs/common';
import { CampaignsService, ScheduleRequest } from './campaigns.service';

@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  // POST /campaigns/schedule — primeste pinurile aprobate din Studio si le programeaza.
  @Post('schedule')
  schedule(@Body() body: ScheduleRequest) {
    return this.campaigns.schedule(body);
  }
}
