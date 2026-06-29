// ============================================================================
// PublisherService — publica pinurile SCADENTE (varianta gratuita, fara Redis).
// ----------------------------------------------------------------------------
// Apelat de /cron/publish-due (un cron extern gratuit, ex. cron-job.org, il
// loveste la fiecare ~10 min). Ia pinurile cu status PENDING si scheduledFor <= acum,
// alege/creeaza board-ul potrivit, trece prin gate-ul FTC si publica pe Pinterest.
// Reimprospateaza automat token-ul daca a expirat.
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PinterestPublishService } from '../pinterest/pinterest-publish.service';
import { PinterestOAuthService } from '../pinterest/pinterest-oauth.service';
import { BoardMatcherService } from '../pinterest/board-matcher.service';
import { FtcValidatorService } from '../compliance/ftc-validator.service';

@Injectable()
export class PublisherService {
  private readonly logger = new Logger(PublisherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly publish: PinterestPublishService,
    private readonly oauth: PinterestOAuthService,
    private readonly boards: BoardMatcherService,
    private readonly ftc: FtcValidatorService,
  ) {}

  async publishDue(limit = 10) {
    const due = await this.prisma.scheduledPin.findMany({
      where: { status: 'PENDING', scheduledFor: { lte: new Date() } },
      orderBy: { scheduledFor: 'asc' },
      take: limit,
    });

    const tokenCache = new Map<string, string>();
    const resolverCache = new Map<string, { resolve(name: string): Promise<string> }>();
    const results: Array<{ id: string; ok: boolean; pinId?: string; error?: string }> = [];

    for (const p of due) {
      try {
        let token = tokenCache.get(p.accountId);
        if (!token) { token = await this.getFreshToken(p.accountId); tokenCache.set(p.accountId, token); }

        const check = this.ftc.validate({ description: p.description, isCommercial: p.isCommercial, destinationUrl: p.link || '' });
        if (!check.passed) throw new Error('FTC: ' + check.violations.join('; '));

        let resolver = resolverCache.get(p.accountId);
        if (!resolver) { resolver = await this.boards.createResolver(token); resolverCache.set(p.accountId, resolver); }
        const boardId = p.boardId || (await resolver.resolve(p.boardName || 'PinForge'));

        const res = await this.publish.createImagePin({
          accessToken: token,
          boardId,
          title: p.title,
          description: check.correctedDescription,
          altText: p.altText,
          link: p.link || '',
          imageBase64: p.imageBase64 || undefined,
          imageUrl: p.imageUrl || undefined,
        });

        await this.prisma.scheduledPin.update({ where: { id: p.id }, data: { status: 'PUBLISHED', pinterestPinId: res.id, lastError: null } });
        results.push({ id: p.id, ok: true, pinId: res.id });
        this.logger.log(`Pin publicat: ${res.id}`);
      } catch (e: any) {
        const attempts = (p.attempts || 0) + 1;
        await this.prisma.scheduledPin.update({
          where: { id: p.id },
          data: { attempts, status: attempts >= 5 ? 'FAILED' : 'PENDING', lastError: String(e?.message || e).slice(0, 500) },
        });
        results.push({ id: p.id, ok: false, error: String(e?.message || e) });
        this.logger.warn(`Pin ${p.id} esuat (incercare ${attempts}): ${e?.message}`);
      }
    }

    return { processed: due.length, published: results.filter((r) => r.ok).length, results };
  }

  // Token valid: reimprospateaza daca expira in mai putin de 60s.
  private async getFreshToken(accountId: string): Promise<string> {
    const account = await this.prisma.pinterestAccount.findUnique({ where: { id: accountId } });
    if (!account) throw new Error('Cont inexistent: ' + accountId);
    if (account.tokenExpiresAt && new Date(account.tokenExpiresAt).getTime() < Date.now() + 60_000) {
      const refreshed = await this.oauth.refresh(this.oauth.decrypt(account.refreshTokenEnc));
      await this.prisma.pinterestAccount.update({
        where: { id: accountId },
        data: {
          accessTokenEnc: this.oauth.encrypt(refreshed.accessToken),
          refreshTokenEnc: this.oauth.encrypt(refreshed.refreshToken),
          tokenExpiresAt: refreshed.expiresAt,
        },
      });
      return refreshed.accessToken;
    }
    return this.oauth.decrypt(account.accessTokenEnc);
  }
}
