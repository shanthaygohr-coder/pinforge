import { Module } from '@nestjs/common';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { EightyTwentyScheduler } from '../scheduler/eighty-twenty.scheduler';
import { PinterestModule } from '../pinterest/pinterest.module';

@Module({
  imports: [PinterestModule], // pentru PinterestOAuthService + BoardMatcherService
  controllers: [CampaignsController],
  providers: [CampaignsService, EightyTwentyScheduler],
})
export class CampaignsModule {}
