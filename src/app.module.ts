import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { QueueModule } from './queue/queue.module';
import { PinterestModule } from './modules/pinterest/pinterest.module';
import { CampaignsModule } from './modules/campaigns/campaigns.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    PrismaModule,    // global: PrismaService
    PinterestModule, // OAuth + publicare
    QueueModule,     // global: coada BullMQ + worker-ul Autopilot
    CampaignsModule, // endpoint-ul de programare 80/20
  ],
  controllers: [HealthController],
})
export class AppModule {}
