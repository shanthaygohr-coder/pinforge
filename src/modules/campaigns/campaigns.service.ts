import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PUBLISH_QUEUE } from '../../queue/queue.module';
import { EightyTwentyScheduler, SchedulableItem } from '../scheduler/eighty-twenty.scheduler';
import { PublishJobData } from '../../queue/publish.processor';
import { PrismaService } from '../../prisma/prisma.service';
import { PinterestOAuthService } from '../pinterest/pinterest-oauth.service';
import { BoardMatcherService } from '../pinterest/board-matcher.service';

export interface IncomingPin {
  // Userul NU trimite board ID; trimite numele sugerat de AI -> il rezolvam automat.
  boardName?: string;
  boardId?: string;          // optional, daca e deja cunoscut
  title: string;
  description: string;
  altText: string;
  link?: string;
  imageUrl?: string;
  imageBase64?: string;      // imaginea generata in Studio (Canvas)
  contentClass: 'EDUCATIONAL' | 'OFFER';
  isCommercial: boolean;
  scheduledFor?: string;     // ISO optional; daca lipseste, calculam noi (80/20 + pacing)
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
    private readonly prisma: PrismaService,
    private readonly oauth: PinterestOAuthService,
    private readonly boards: BoardMatcherService,
  ) {}

  /**
   * Bucla completa: ia toate pinurile din Studio, ALEGE automat board-ul potrivit
   * (sau il creeaza), calculeaza timpii (daca nu sunt dati) si pune totul in coada
   * BullMQ ca delayed jobs. Worker-ul le publica automat la timpul programat.
   */
  async schedule(req: ScheduleRequest) {
    if (!req.accountId) throw new BadRequestException('Lipseste accountId.');
    if (!req.pins?.length) throw new BadRequestException('Nu exista pinuri de programat.');

    const account = await this.prisma.pinterestAccount.findUnique({ where: { id: req.accountId } });
    if (!account) throw new BadRequestException('Cont Pinterest inexistent. Conecteaza contul intai.');
    const accessToken = this.oauth.decrypt(account.accessTokenEnc);

    // Resolver de board-uri (alege automat board-ul potrivit per pin).
    const boardResolver = await this.boards.createResolver(accessToken);

    // Calculam timpii pentru pinurile fara scheduledFor explicit.
    const needTimes = req.pins.some((p) => !p.scheduledFor);
    const timeByIndex: Record<string, Date> = {};
    if (needTimes) {
      const items: SchedulableItem[] = req.pins.map((p, i) => ({ pinId: String(i), contentClass: p.contentClass }));
      const slots = this.scheduler.buildSchedule(items, {
        startAt: new Date(Date.now() + (req.startInMinutes ?? 5) * 60_000),
        intervalMinutes: req.intervalMinutes ?? 90,
        maxPerDay: req.maxPerDay ?? 8,
      });
      slots.forEach((s) => { timeByIndex[s.pinId] = s.scheduledFor; });
    }

    const scheduled = [];
    for (let i = 0; i < req.pins.length; i++) {
      const pin = req.pins[i];
      const when = pin.scheduledFor ? new Date(pin.scheduledFor) : (timeByIndex[String(i)] ?? new Date());
      const boardId = pin.boardId ?? (await boardResolver.resolve(pin.boardName || 'PinForge'));
      const delay = Math.max(0, when.getTime() - Date.now());

      const job = await this.queue.add('publish', {
        accountId: req.accountId,
        boardId,
        title: pin.title,
        description: pin.description,
        altText: pin.altText,
        link: pin.link || '',
        imageUrl: pin.imageUrl,
        imageBase64: pin.imageBase64,
        isCommercial: pin.isCommercial,
      }, {
        delay,
        attempts: 6,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 1000,
        removeOnFail: 1000,
      });

      scheduled.push({
        jobId: job.id,
        title: pin.title,
        board: pin.boardName ?? boardId,
        scheduledFor: when.toISOString(),
      });
    }

    this.logger.log(`Programate ${scheduled.length} pinuri pe contul ${account.username}.`);
    return { count: scheduled.length, account: account.username, scheduled };
  }
}
