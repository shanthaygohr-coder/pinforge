import { Controller, Get, Post, Query, UnauthorizedException } from '@nestjs/common';
import { PublisherService } from './publisher.service';

// Endpoint apelat de un cron extern GRATUIT (ex. cron-job.org) la fiecare ~10 min.
// Trezeste serverul (chiar daca "doarme" pe planul gratuit) si publica pinurile scadente.
// Protejat cu CRON_SECRET ca sa nu fie apelat abuziv.
@Controller('cron')
export class CronController {
  constructor(private readonly publisher: PublisherService) {}

  @Get('publish-due')
  runGet(@Query('key') key: string) { return this.run(key); }

  @Post('publish-due')
  runPost(@Query('key') key: string) { return this.run(key); }

  private run(key: string) {
    const secret = process.env.CRON_SECRET || '';
    if (secret && key !== secret) throw new UnauthorizedException('Cheie cron invalida.');
    return this.publisher.publishDue(10);
  }
}
