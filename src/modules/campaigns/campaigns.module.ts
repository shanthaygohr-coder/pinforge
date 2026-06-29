import { Module } from '@nestjs/common';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { EightyTwentyScheduler } from '../scheduler/eighty-twenty.scheduler';

@Module({
  controllers: [CampaignsController],
  providers: [CampaignsService, EightyTwentyScheduler],
})
export class CampaignsModule {}
