import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { EightyTwentyScheduler, SchedulableItem } from '../scheduler/eighty-twenty.scheduler';
import { PrismaService } from '../../prisma/prisma.service';

export interface IncomingPin {
  boardName?: string;   // numele sugerat de AI; board-ul real e rezolvat la publicare
  boardId?: string;
  title: string;
  description: string;
  altText: string;
  link?: string;
  imageUrl?: string;
  imageBase64?: string;
  contentClass: 'EDUCATIONAL' | 'OFFER';
  isCommercial: boolean;
  scheduledFor?: string; // ISO optional; altfel calculam noi
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
    private readonly scheduler: EightyTwentyScheduler,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Salveaza pinurile in coada (tabelul scheduled_pins) cu ora calculata.
   * Publicarea efectiva o face PublisherService, declansat de /cron/publish-due.
   * Astfel nu mai e nevoie de Redis sau de un server non-stop -> deploy gratuit.
   */
  async schedule(req: ScheduleRequest) {
    if (!req.accountId) throw new BadRequestException('Lipseste accountId.');
    if (!req.pins?.length) throw new BadRequestException('Nu exista pinuri de programat.');

    const account = await this.prisma.pinterestAccount.findUnique({ where: { id: req.accountId } });
    if (!account) throw new BadRequestException('Cont Pinterest inexistent. Conecteaza contul intai.');

    // Calculeaza orele pentru pinurile fara scheduledFor explicit.
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

    const data = req.pins.map((p, i) => ({
      accountId: req.accountId,
      boardName: p.boardName ?? null,
      boardId: p.boardId ?? null,
      title: p.title,
      description: p.description,
      altText: p.altText,
      link: p.link ?? null,
      imageBase64: p.imageBase64 ?? null,
      imageUrl: p.imageUrl ?? null,
      contentClass: p.contentClass,
      isCommercial: p.isCommercial ?? true,
      scheduledFor: p.scheduledFor ? new Date(p.scheduledFor) : (timeByIndex[String(i)] ?? new Date()),
    }));

    await this.prisma.scheduledPin.createMany({ data });

    this.logger.log(`Programate ${data.length} pinuri pe contul ${account.username}.`);
    return {
      count: data.length,
      account: account.username,
      scheduled: data.map((d) => ({ title: d.title, board: d.boardName, scheduledFor: d.scheduledFor.toISOString() })),
    };
  }
}
