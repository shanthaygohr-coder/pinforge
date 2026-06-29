import { Inject, Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PUBLISH_QUEUE } from '../../queue/queue.module';
import { EightyTwentyScheduler, SchedulableItem } from '../scheduler/eighty-twenty.scheduler';
import { PublishJobData } from '../../queue/publish.processor';

export interface IncomingPin {
  boardId: string;
  title: string;
  description: string;
  altText: string;
  link: string;
  imageUrl?: string;
  imageBase64?: string; // imaginea generata in Studio (Canvas)
  contentClass: 'EDUCATIONAL' | 'OFFER';
  isCommercial: boolean;
}

export interface ScheduleRequest {
  accountId: string;
  pins: IncomingPin[];
  startInMinutes?: number;
  intervalMinutes?: number;
  maxPerDay?: number;
}

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    @Inject(PUBLISH_QUEUE) private readonly queue: Queue<PublishJobData>,
    private readonly scheduler: EightyTwentyScheduler,
  ) {}

  /**
   * Primeste pinurile aprobate din Studio (Canvas), le intercaleaza 80/20,
   * calculeaza timpii si le pune in coada BullMQ cu intarziere (delayed jobs).
   */
  async schedule(req: ScheduleRequest) {
    const items: SchedulableItem[] = req.pins.map((p, i) => ({
      pinId: String(i),
      contentClass: p.contentClass,
    }));

    const startAt = new Date(Date.now() + (req.startInMinutes ?? 5) * 60_000);
    const slots = this.scheduler.buildSchedule(items, {
      startAt,
      intervalMinutes: req.intervalMinutes ?? 90,
      maxPerDay: req.maxPerDay ?? 8, // pacing conservator pentru Domain Quality
    });

    const scheduled = [];
    for (const slot of slots) {
      const pin = req.pins[Number(slot.pinId)];
      const delay = Math.max(0, slot.scheduledFor.getTime() - Date.now());

      const job = await this.queue.add(
        'publish',
        {
          accountId: req.accountId,
          boardId: pin.boardId,
          title: pin.title,
          description: pin.description,
          altText: pin.altText,
          link: pin.link,
          imageUrl: pin.imageUrl,
          imageBase64: pin.imageBase64,
          isCommercial: pin.isCommercial,
        },
        {
          delay,
          attempts: 6,
          backoff: { type: 'exponential', delay: 1000 }, // pe langa backoff-ul intern 32s
          removeOnComplete: 1000,
          removeOnFail: 1000,
        },
      );

      scheduled.push({
        jobId: job.id,
        title: pin.title,
        contentClass: slot.contentClass,
        scheduledFor: slot.scheduledFor.toISOString(),
      });
    }

    this.logger.log(`Programate ${scheduled.length} pinuri pe contul ${req.accountId}.`);
    return { count: scheduled.length, scheduled };
  }
}
