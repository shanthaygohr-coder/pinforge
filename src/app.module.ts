import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { PinterestModule } from './modules/pinterest/pinterest.module';
import { CampaignsModule } from './modules/campaigns/campaigns.module';
import { PublishingModule } from './modules/publishing/publishing.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    PrismaModule,     // global: PrismaService
    PinterestModule,  // OAuth + publicare + board matching
    CampaignsModule,  // /campaigns/schedule -> scrie in DB
    PublishingModule, // /cron/publish-due -> publica pinurile scadente (fara Redis)
  ],
  controllers: [HealthController],
})
export class AppModule {}
