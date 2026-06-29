import { Controller, Get, Query, Param, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PinterestOAuthService } from './pinterest-oauth.service';
import { PinterestHttpClient } from './pinterest-http.client';
import { PrismaService } from '../../prisma/prisma.service';

// Conectarea contului Pinterest prin OAuth2 (Authorization Code Grant).
@Controller('pinterest')
export class PinterestController {
  constructor(
    private readonly oauth: PinterestOAuthService,
    private readonly http: PinterestHttpClient,
    private readonly prisma: PrismaService,
  ) {}

  // Pasul 1: frontend-ul deschide acest URL pentru consimtamantul userului.
  @Get('auth/url')
  authUrl() {
    const state = randomUUID();
    return { url: this.oauth.buildAuthUrl(state), state };
  }

  // Pasul 2: Pinterest redirectioneaza aici cu ?code=...
  // Schimbam code-ul pe tokenuri, le criptam si salvam contul.
  @Get('callback')
  async callback(@Query('code') code: string) {
    if (!code) throw new BadRequestException('Lipseste parametrul code.');
    const tokens = await this.oauth.exchangeCode(code);

    const me = await this.http.request<{ username: string }>({
      method: 'GET',
      path: '/user_account',
      accessToken: tokens.accessToken,
    });

    // MVP: un singur tenant demo. In productie, asociaza cu userul autentificat.
    let user = await this.prisma.user.findFirst();
    if (!user) {
      user = await this.prisma.user.create({
        data: { email: 'demo@pinforge.local', passwordHash: 'demo' },
      });
    }

    const account = await this.prisma.pinterestAccount.upsert({
      where: { userId_pinterestUserId: { userId: user.id, pinterestUserId: me.username } },
      update: {
        accessTokenEnc: this.oauth.encrypt(tokens.accessToken),
        refreshTokenEnc: this.oauth.encrypt(tokens.refreshToken),
        tokenExpiresAt: tokens.expiresAt,
        scopes: tokens.scopes,
      },
      create: {
        userId: user.id,
        pinterestUserId: me.username,
        username: me.username,
        accessTokenEnc: this.oauth.encrypt(tokens.accessToken),
        refreshTokenEnc: this.oauth.encrypt(tokens.refreshToken),
        tokenExpiresAt: tokens.expiresAt,
        scopes: tokens.scopes,
      },
    });

    return { connected: true, accountId: account.id, username: account.username };
  }

  // Listeaza boards-urile contului (ai nevoie de boardId la programare).
  @Get(':accountId/boards')
  async boards(@Param('accountId') accountId: string) {
    const account = await this.prisma.pinterestAccount.findUnique({ where: { id: accountId } });
    if (!account) throw new BadRequestException('Cont inexistent.');
    const accessToken = this.oauth.decrypt(account.accessTokenEnc);
    return this.http.request({ method: 'GET', path: '/boards', accessToken });
  }
}
