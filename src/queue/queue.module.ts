import { Global, Module } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { PublishProcessor } from './publish.processor';
import { PinterestModule } from '../modules/pinterest/pinterest.module';
import { FtcValidatorService } from '../modules/compliance/ftc-validator.service';

export const PUBLISH_QUEUE = 'PUBLISH_QUEUE';
export const REDIS_CONNECTION = 'REDIS_CONNECTION';

function buildRedis(): IORedis {
  return new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null, // cerut de BullMQ
  });
}

@Global()
@Module({
  imports: [PinterestModule],
  providers: [
    FtcValidatorService,
    {
      provide: REDIS_CONNECTION,
      useFactory: buildRedis,
    },
    {
      provide: PUBLISH_QUEUE,
      useFactory: (connection: IORedis) => new Queue('publish', { connection }),
      inject: [REDIS_CONNECTION],
    },
    PublishProcessor,
  ],
  exports: [PUBLISH_QUEUE, REDIS_CONNECTION],
})
export class QueueModule {}
