// ============================================================================
// BridgePageService — genereaza si gazduieste pagini punte (bridge pages).
// ----------------------------------------------------------------------------
// DE CE: Pin-urile NU trimit niciodata direct catre linkul brut ClickBank /
// Digistore24. In schimb, trimit catre o pagina punte gazduita pe domeniul
// userului. Asta:
//   - protejeaza scorul "Domain Quality" al contului Pinterest
//   - permite continut de VALOARE inainte de redirect (mai bun pentru conversie)
//   - centralizeaza dezvaluirea FTC si tracking-ul
//
// Pagina este randata ca HTML static/ISR (Next.js) si servita la /go/:slug.
// Redirectionarea catre linkul de afiliere se face server-side, la click pe CTA.
// ============================================================================

import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';

export interface BridgePageInput {
  offerName: string;
  primaryKeyword: string;
  benefitPoints: string[];
  rawAffiliateUrl: string;
  brandName: string;
  niche: 'HEALTH_FITNESS' | 'PERSONAL_FINANCE' | 'B2B_SAAS';
}

export interface BridgePageDraft {
  slug: string;
  headline: string;
  bodyHtml: string;
  ftcDisclosure: string;
  ctaUrl: string;
}

const FTC_DISCLOSURE =
  'Dezvaluire: Aceasta pagina contine linkuri de afiliere. Daca achizitionezi prin ' +
  'ele, putem primi un comision, fara cost suplimentar pentru tine. Recomandam doar ' +
  'produse pe care le consideram valoroase. (#ad / #affiliate)';

@Injectable()
export class BridgePageService {
  /**
   * Construieste un draft de bridge page. Persistarea (BridgePage) si publicarea
   * (deploy ISR / scriere in storage) sunt gestionate de caller.
   */
  build(input: BridgePageInput): BridgePageDraft {
    const slug = this.slugify(input.primaryKeyword);
    const headline = `${this.capitalize(input.primaryKeyword)} — ${input.benefitPoints[0] ?? 'Ghidul complet'}`;

    return {
      slug,
      headline,
      ftcDisclosure: FTC_DISCLOSURE,
      ctaUrl: input.rawAffiliateUrl, // folosit DOAR server-side la redirect
      bodyHtml: this.renderHtml(input, headline),
    };
  }

  // Slug unic, prietenos SEO: keyword + sufix scurt anti-coliziune.
  private slugify(keyword: string): string {
    const base = keyword
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    return `${base}-${randomBytes(2).toString('hex')}`;
  }

  // Continut de VALOARE (educational) + dezvaluire FTC vizibila + CTA.
  private renderHtml(input: BridgePageInput, headline: string): string {
    const bullets = input.benefitPoints
      .slice(0, 6)
      .map((b) => `<li>${this.escape(b)}</li>`)
      .join('');

    return `<!doctype html>
<html lang="ro">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${this.escape(headline)} | ${this.escape(input.brandName)}</title>
  <meta name="description" content="${this.escape(input.primaryKeyword)} — ghid practic." />
</head>
<body>
  <!-- Dezvaluirea FTC apare SUS, vizibil, inainte de orice link de afiliere -->
  <aside role="note" class="ftc-disclosure">${this.escape(FTC_DISCLOSURE)}</aside>

  <article>
    <h1>${this.escape(headline)}</h1>
    <p>${this.capitalize(this.escape(input.primaryKeyword))} este esential daca vrei rezultate reale. Iata ce conteaza cu adevarat:</p>
    <ul>${bullets}</ul>

    <a class="cta" rel="sponsored nofollow noopener" href="/api/bridge/${this.slugify(input.primaryKeyword)}/click">
      Vezi oferta recomandata &rarr;
    </a>
  </article>
</body>
</html>`;
  }

  private capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  private escape(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
