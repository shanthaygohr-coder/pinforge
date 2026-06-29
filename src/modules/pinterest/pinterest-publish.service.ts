// ============================================================================
// PinterestPublishService — publicarea pin-urilor (imagine si VIDEO).
// ----------------------------------------------------------------------------
// Pentru pinii VIDEO, Pinterest proceseaza fisierul asincron. NU putem publica
// containerul cu text inainte ca media sa fie "succeeded". Implementam o bucla
// de POLLING care verifica statusul media inainte de a crea pin-ul final.
// Toate apelurile trec prin PinterestHttpClient (rate-limit + backoff).
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { PinterestHttpClient } from './pinterest-http.client';

export interface CreateImagePinInput {
  accessToken: string;
  boardId: string;
  title: string;
  description: string;
  altText: string;
  link: string;          // bridge page URL
  // Furnizezi UNA dintre cele doua surse:
  imageUrl?: string;     // URL public al creative-ului (S3/R2)
  imageBase64?: string;  // base64 PUR (fara prefixul "data:image/...;base64,")
}

export interface CreateVideoPinInput extends Omit<CreateImagePinInput, 'imageUrl' | 'imageBase64'> {
  mediaId: string;    // id-ul media obtinut dupa upload + procesare
  coverImageUrl: string;
}

interface MediaStatusResponse {
  media_id: string;
  status: 'registered' | 'processing' | 'succeeded' | 'failed';
}

@Injectable()
export class PinterestPublishService {
  private readonly logger = new Logger(PinterestPublishService.name);

  constructor(private readonly http: PinterestHttpClient) {}

  /** Pin imagine — un singur apel. Accepta sursa base64 (din Studio) sau URL. */
  async createImagePin(input: CreateImagePinInput): Promise<{ id: string }> {
    // Pinterest v5 suporta image_base64 -> putem publica direct din Studio,
    // fara a mai gazdui imaginea pe un storage extern.
    let media_source: Record<string, unknown>;
    if (input.imageBase64) {
      media_source = {
        source_type: 'image_base64',
        content_type: 'image/png',
        data: this.stripDataUrl(input.imageBase64),
      };
    } else if (input.imageUrl) {
      media_source = { source_type: 'image_url', url: input.imageUrl };
    } else {
      throw new Error('createImagePin: lipseste imageBase64 sau imageUrl.');
    }

    return this.http.request<{ id: string }>({
      method: 'POST',
      path: '/pins',
      accessToken: input.accessToken,
      body: {
        board_id: input.boardId,
        title: input.title,
        description: input.description,
        alt_text: input.altText,
        link: input.link,
        media_source,
      },
    });
  }

  // Elimina prefixul "data:image/png;base64," daca a fost lasat din greseala.
  private stripDataUrl(b64: string): string {
    const idx = b64.indexOf('base64,');
    return idx >= 0 ? b64.slice(idx + 'base64,'.length) : b64;
  }

  /**
   * Pin video — necesita POLLING pana cand media e "succeeded".
   * Polling cu backoff propriu (separat de rate-limit-ul HTTP), pana la timeout.
   */
  async createVideoPin(
    input: CreateVideoPinInput,
    opts: { maxWaitMs?: number; pollIntervalMs?: number } = {},
  ): Promise<{ id: string }> {
    const maxWaitMs = opts.maxWaitMs ?? 5 * 60_000; // 5 min
    const pollIntervalMs = opts.pollIntervalMs ?? 5_000;

    const ready = await this.waitForMedia(input.accessToken, input.mediaId, maxWaitMs, pollIntervalMs);
    if (!ready) {
      throw new Error(`Media ${input.mediaId} nu a finalizat procesarea in timp util.`);
    }

    // Abia DUPA ce media e procesat, cream containerul cu text.
    return this.http.request<{ id: string }>({
      method: 'POST',
      path: '/pins',
      accessToken: input.accessToken,
      body: {
        board_id: input.boardId,
        title: input.title,
        description: input.description,
        alt_text: input.altText,
        link: input.link,
        media_source: {
          source_type: 'video_id',
          media_id: input.mediaId,
          cover_image_url: input.coverImageUrl,
        },
      },
    });
  }

  /** Bucla de polling: verifica statusul media pana la succeeded / failed / timeout. */
  private async waitForMedia(
    accessToken: string,
    mediaId: string,
    maxWaitMs: number,
    pollIntervalMs: number,
  ): Promise<boolean> {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      const status = await this.http.request<MediaStatusResponse>({
        method: 'GET',
        path: `/media/${mediaId}`,
        accessToken,
      });

      if (status.status === 'succeeded') return true;
      if (status.status === 'failed') {
        throw new Error(`Procesarea media ${mediaId} a esuat la Pinterest.`);
      }
      this.logger.debug(`Media ${mediaId} status=${status.status}; reverific in ${pollIntervalMs}ms.`);
      await this.sleep(pollIntervalMs);
    }
    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
