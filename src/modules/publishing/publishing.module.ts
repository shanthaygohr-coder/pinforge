import { Module } from '@nestjs/common';
import { PublisherService } from './publisher.service';
import { CronController } from './cron.controller';
import { PinterestModule } from '../pinterest/pinterest.module';
import { FtcValidatorService } from '../compliance/ftc-validator.service';

@Module({
  imports: [PinterestModule],
  controllers: [CronController],
  providers: [PublisherService, FtcValidatorService],
  exports: [PublisherService],
})
export class PublishingModule {}
