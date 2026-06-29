// ============================================================================
// BoardMatcherService — alege AUTOMAT board-ul potrivit pentru fiecare pin.
// ----------------------------------------------------------------------------
// Primeste numele de board sugerat de AI (ex: "Healthy Weight Loss Recipes"),
// il compara cu board-urile reale ale contului (potrivire pe cuvinte cheie) si:
//   - daca exista unul suficient de apropiat -> foloseste acel board
//   - daca NU -> creeaza un board nou cu acel nume
// Asa userul nu trebuie sa stie niciun "board ID"; softul alege singur.
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { PinterestHttpClient } from './pinterest-http.client';

interface Board { id: string; name: string }
interface BoardsResponse { items?: Board[]; bookmark?: string }

@Injectable()
export class BoardMatcherService {
  private readonly logger = new Logger(BoardMatcherService.name);
  private readonly MATCH_THRESHOLD = 0.45;

  constructor(private readonly http: PinterestHttpClient) {}

  /** Aduce toate board-urile contului (paginat). */
  async listBoards(accessToken: string): Promise<Board[]> {
    const all: Board[] = [];
    let bookmark: string | undefined;
    do {
      const path = '/boards?page_size=100' + (bookmark ? `&bookmark=${encodeURIComponent(bookmark)}` : '');
      const res = await this.http.request<BoardsResponse>({ method: 'GET', path, accessToken });
      all.push(...(res.items ?? []));
      bookmark = res.bookmark;
    } while (bookmark);
    return all;
  }

  /**
   * Creeaza un "resolver" care tine lista de board-uri in memorie pe durata unei
   * campanii: potriveste numele, iar board-urile nou create sunt adaugate in cache
   * ca pinurile urmatoare sa le reutilizeze (fara duplicate).
   */
  async createResolver(accessToken: string) {
    const boards = await this.listBoards(accessToken);
    const self = this;
    return {
      async resolve(desiredName: string): Promise<string> {
        const name = (desiredName || 'PinForge').trim();
        let best: Board | null = null;
        let bestScore = 0;
        for (const b of boards) {
          const s = self.similarity(name, b.name);
          if (s > bestScore) { bestScore = s; best = b; }
        }
        if (best && bestScore >= self.MATCH_THRESHOLD) {
          self.logger.log(`Board potrivit: "${name}" -> "${best.name}" (scor ${bestScore.toFixed(2)})`);
          return best.id;
        }
        // Creeaza board nou
        const created = await self.http.request<{ id: string }>({
          method: 'POST', path: '/boards', accessToken,
          body: { name: name.slice(0, 180), privacy: 'PUBLIC' },
        });
        boards.push({ id: created.id, name });
        self.logger.log(`Board nou creat: "${name}" (${created.id})`);
        return created.id;
      },
    };
  }

  private normalize(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // Suprapunere de cuvinte (Jaccard pe tokenuri) — simplu si robust.
  private similarity(a: string, b: string): number {
    const ta = new Set(this.normalize(a).split(' ').filter(Boolean));
    const tb = new Set(this.normalize(b).split(' ').filter(Boolean));
    if (!ta.size || !tb.size) return 0;
    let inter = 0;
    ta.forEach((t) => { if (tb.has(t)) inter++; });
    return inter / Math.max(ta.size, tb.size);
  }
}
