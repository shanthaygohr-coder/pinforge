import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { REDIS_CONNECTION } from './queue.module';
import { PinterestPublishService } from '../modules/pinterest/pinterest-publish.service';
import { PinterestOAuthService } from '../modules/pinterest/pinterest-oauth.service';
import { FtcValidatorService } from '../modules/compliance/ftc-validator.service';
import { PrismaService } from '../prisma/prisma.service';

// Payload-ul unui job de publicare (trimis de CampaignsService).
export interface PublishJobData {
  accountId: string;
  boardId: string;
  title: string;
  description: string;
  altText: string;
  link: string;          // bridge page URL
  imageUrl?: string;     // URL public al creative-ului (optional)
  imageBase64?: string;  // base64 (din Studio Canvas) — publicare directa
  isCommercial: boolean;
}

// Worker-ul = inima Autopilotului. Ruleaza 24/7 cat timp serverul e pornit si
// publica pin-urile la timpul programat, cu gate FTC + gestionarea rate-limit.
@Injectable()
export class PublishProcessor implements OnModuleInit, OnModuleDestroy {
  private worker?: Worker<PublishJobData>;
  private readonly logger = new Logger(PublishProcessor.name);

  constructor(
    @Inject(REDIS_CONNECTION) private readonly connection: IORedis,
    private readonly publisher: PinterestPublishService,
    private readonly oauth: PinterestOAuthService,
    private readonly ftc: FtcValidatorService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.worker = new Worker<PublishJobData>('publish', (job) => this.handle(job), {
      connection: this.connection,
      concurrency: 2, // conservator, ca sa protejam Domain Quality
    });
    this.worker.on('completed', (job) => this.logger.log(`Pin publicat (job ${job.id}).`));
    this.worker.on('failed', (job, err) =>
      this.logger.error(`Job ${job?.id} esuat: ${err.message}`),
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private async handle(job: Job<PublishJobData>): Promise<{ id: string }> {
    const d = job.data;

    // 1) Gate FTC — pin comercial fara #ad/#affiliate sau cu link brut => esueaza.
    const check = this.ftc.validate({
      description: d.description,
      isCommercial: d.isCommercial,
      destinationUrl: d.link,
    });
    if (!check.passed) {
      throw new Error(`Conformitate FTC esuata: ${check.violations.join('; ')}`);
    }

    // 2) Token-ul contului (decriptat la runtime).
    const account = await this.prisma.pinterestAccount.findUnique({
      where: { id: d.accountId },
    });
    if (!account) throw new Error(`Cont Pinterest inexistent: ${d.accountId}`);
    const accessToken = this.oauth.decrypt(account.accessTokenEnc);

    // 3) Publicare (PinterestHttpClient gestioneaza intern 429 + backoff 32s).
    return this.publisher.createImagePin({
      accessToken,
      boardId: d.boardId,
      title: d.title,
      description: check.correctedDescription,
      altText: d.altText,
      link: d.link,
      imageUrl: d.imageUrl,
      imageBase64: d.imageBase64,
    });
  }
}
