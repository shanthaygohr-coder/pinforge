// ============================================================================
// ImageComposerService — asamblarea compozitiei finale a pin-ului.
// ----------------------------------------------------------------------------
// CONSTRANGERI STRICTE DE RANDARE (hard rules, validate la runtime):
//   - Dimensiune EXACTA 1000x1500 px (raport vertical 2:3) -> fara trunchiere mobil
//   - Fonturi sans-serif BOLD pentru titluri (lizibilitate in feed)
//   - Minimum 30% spatiu negativ (white space) -> calculat si verificat
//   - Logo / URL atasat automat in partea de jos a fiecarui pin
//
// Folosim `sharp` (libvips) pentru compozitare raster + SVG pentru text vectorial
// (control total asupra greutatii fontului, kerning, wrapping).
// ============================================================================

import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import sharp from 'sharp';

export const PIN_WIDTH = 1000;
export const PIN_HEIGHT = 1500;
export const MIN_WHITE_SPACE_RATIO = 0.3;

export interface ComposeInput {
  backgroundPng: Buffer;       // de la DiffusionProvider
  title: string;
  bullets?: string[];          // pentru listicles / cheat sheets
  brandUrl: string;            // ex: "myfitsite.com"
  logoPng?: Buffer;            // logo optional (PNG cu transparenta)
  accentColor?: string;        // hex
}

export interface ComposeOutput {
  png: Buffer;
  width: number;
  height: number;
  whiteSpaceRatio: number;
}

@Injectable()
export class ImageComposerService {
  private readonly logger = new Logger(ImageComposerService.name);

  async compose(input: ComposeInput): Promise<ComposeOutput> {
    const accent = input.accentColor ?? '#111111';

    // 1) Normalizeaza fundalul la EXACT 1000x1500 (cover, fara distorsiune).
    const background = await sharp(input.backgroundPng)
      .resize(PIN_WIDTH, PIN_HEIGHT, { fit: 'cover', position: 'attention' })
      .png()
      .toBuffer();

    // 2) Layer-ul de text ca SVG -> font sans-serif bold, wrapping controlat.
    const textSvg = this.buildTextSvg(input.title, input.bullets ?? [], accent);
    const textLayer = Buffer.from(textSvg);

    // 3) Banda de brand (URL/logo) jos.
    const footerSvg = this.buildFooterSvg(input.brandUrl, accent);
    const footerLayer = Buffer.from(footerSvg);

    const composites: sharp.OverlayOptions[] = [
      { input: textLayer, top: 0, left: 0 },
      { input: footerLayer, top: 0, left: 0 },
    ];

    if (input.logoPng) {
      const logo = await sharp(input.logoPng).resize({ height: 70 }).png().toBuffer();
      composites.push({ input: logo, gravity: 'southwest', top: PIN_HEIGHT - 95, left: 40 });
    }

    const finalPng = await sharp(background).composite(composites).png().toBuffer();

    // 4) Verifica constrangerile DURE inainte de a returna.
    const meta = await sharp(finalPng).metadata();
    if (meta.width !== PIN_WIDTH || meta.height !== PIN_HEIGHT) {
      throw new BadRequestException(
        `Dimensiune invalida ${meta.width}x${meta.height}; necesar ${PIN_WIDTH}x${PIN_HEIGHT}`,
      );
    }

    const whiteSpaceRatio = await this.estimateWhiteSpace(finalPng);
    if (whiteSpaceRatio < MIN_WHITE_SPACE_RATIO) {
      throw new BadRequestException(
        `Spatiu negativ insuficient: ${(whiteSpaceRatio * 100).toFixed(1)}% < ${MIN_WHITE_SPACE_RATIO * 100}%`,
      );
    }

    return { png: finalPng, width: PIN_WIDTH, height: PIN_HEIGHT, whiteSpaceRatio };
  }

  // ---- Titlu bold + bullets, cu wrapping manual la latimea pin-ului ----
  private buildTextSvg(title: string, bullets: string[], accent: string): string {
    const titleLines = this.wrap(title, 18); // ~18 caractere/linie la 64px bold
    let y = 140;
    const titleTspans = titleLines
      .map((line) => {
        const t = `<tspan x="60" y="${y}">${this.escape(line)}</tspan>`;
        y += 78;
        return t;
      })
      .join('');

    let by = y + 60;
    const bulletText = bullets
      .slice(0, 6)
      .map((b) => {
        const wrapped = this.wrap(b, 30);
        const first = `<tspan x="100" y="${by}">•  ${this.escape(wrapped[0] ?? '')}</tspan>`;
        by += 56;
        const rest = wrapped
          .slice(1)
          .map((w) => {
            const t = `<tspan x="130" y="${by}">${this.escape(w)}</tspan>`;
            by += 56;
            return t;
          })
          .join('');
        return first + rest;
      })
      .join('');

    // font-weight 800 = sans-serif bold/extra-bold
    return `
<svg width="${PIN_WIDTH}" height="${PIN_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <style>
    .title { font-family: 'Inter','Montserrat','Arial',sans-serif; font-weight: 800; font-size: 64px; fill: ${accent}; }
    .bullet { font-family: 'Inter','Arial',sans-serif; font-weight: 600; font-size: 40px; fill: ${accent}; }
  </style>
  <text class="title">${titleTspans}</text>
  <text class="bullet">${bulletText}</text>
</svg>`;
  }

  private buildFooterSvg(brandUrl: string, accent: string): string {
    return `
<svg width="${PIN_WIDTH}" height="${PIN_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="${PIN_HEIGHT - 80}" width="${PIN_WIDTH}" height="80" fill="${accent}" opacity="0.9"/>
  <text x="${PIN_WIDTH - 40}" y="${PIN_HEIGHT - 30}" text-anchor="end"
        font-family="Inter,Arial,sans-serif" font-weight="700" font-size="32" fill="#ffffff">
    ${this.escape(brandUrl)}
  </text>
</svg>`;
  }

  /**
   * Estimeaza procentul de "spatiu negativ" ca proportie de pixeli luminosi+uniformi.
   * Heuristica: zonele foarte luminoase (luma > 235) sunt considerate white space.
   * Pentru productie se poate inlocui cu o analiza pe blocuri (variance per tile).
   */
  private async estimateWhiteSpace(png: Buffer): Promise<number> {
    const { data, info } = await sharp(png)
      .resize(100, 150, { fit: 'fill' }) // downsample pentru viteza
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    let bright = 0;
    const totalPixels = info.width * info.height;
    for (let i = 0; i < data.length; i += info.channels) {
      const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      if (luma > 235) bright++;
    }
    return bright / totalPixels;
  }

  private wrap(text: string, maxChars: number): string[] {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      if ((cur + ' ' + w).trim().length > maxChars) {
        if (cur) lines.push(cur.trim());
        cur = w;
      } else {
        cur = (cur + ' ' + w).trim();
      }
    }
    if (cur) lines.push(cur.trim());
    return lines;
  }

  private escape(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
