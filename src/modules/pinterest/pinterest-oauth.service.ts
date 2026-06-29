// ============================================================================
// PinterestOAuthService — flux OAuth 2.0 (Authorization Code Grant).
// ----------------------------------------------------------------------------
// Solicitam DOAR setul minim de scopes:
//     boards:read, boards:write, pins:read, pins:write
// Tokenurile sunt criptate (AES-256-GCM) inainte de persistare in DB.
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

const AUTH_BASE = 'https://www.pinterest.com/oauth/';
const TOKEN_URL = 'https://api.pinterest.com/v5/oauth/token';

// Principiul minimului de permisiuni — nimic in plus.
export const REQUIRED_SCOPES = ['boards:read', 'boards:write', 'pins:read', 'pins:write'] as const;

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scopes: string[];
}

@Injectable()
export class PinterestOAuthService {
  private readonly logger = new Logger(PinterestOAuthService.name);
  private readonly clientId = process.env.PINTEREST_CLIENT_ID ?? '';
  private readonly clientSecret = process.env.PINTEREST_CLIENT_SECRET ?? '';
  private readonly redirectUri = process.env.PINTEREST_REDIRECT_URI ?? '';
  // Cheie de 32 bytes pentru AES-256 (derivata din ENCRYPTION_KEY).
  private readonly encKey = createHash('sha256')
    .update(process.env.ENCRYPTION_KEY ?? 'dev-only-key')
    .digest();

  /** Pasul 1: URL-ul catre care redirectionam userul pentru consimtamant. */
  buildAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: REQUIRED_SCOPES.join(','),
      state, // CSRF protection — validat la callback
    });
    return `${AUTH_BASE}?${params.toString()}`;
  }

  /** Pasul 2: schimba authorization code-ul pe tokenuri. */
  async exchangeCode(code: string): Promise<TokenSet> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri,
    });
    return this.tokenRequest(body);
  }

  /** Reimprospatare token expirat. */
  async refresh(refreshToken: string): Promise<TokenSet> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    return this.tokenRequest(body);
  }

  private async tokenRequest(body: URLSearchParams): Promise<TokenSet> {
    // Pinterest cere Basic auth cu client_id:client_secret.
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    if (!res.ok) {
      const txt = await res.text();
      this.logger.error(`OAuth token request a esuat: ${res.status} ${txt}`);
      throw new Error(`Pinterest OAuth error ${res.status}`);
    }
    const json = await res.json();
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: new Date(Date.now() + json.expires_in * 1000),
      scopes: (json.scope ?? '').split(/[ ,]+/).filter(Boolean),
    };
  }

  // ---- Criptare AES-256-GCM pentru persistarea tokenurilor ----
  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encKey, iv);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
  }

  decrypt(ciphertext: string): string {
    const [ivHex, tagHex, dataHex] = ciphertext.split(':');
    const decipher = createDecipheriv('aes-256-gcm', this.encKey, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataHex, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  }
}
