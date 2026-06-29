// ============================================================================
// Diffusion Provider — integrare cu un API de Stable Diffusion (SDXL).
// ----------------------------------------------------------------------------
// Genereaza FUNDALUL/elementul vizual de baza. Compozitia finala (text, logo,
// white-space) este asamblata separat de ImageComposerService, pentru control
// determinist asupra tipografiei si a raportului 2:3.
//
// Variatia parametrica = combinatie {seed, prompt modifiers, paleta, layout}.
// Astfel obtinem creative AUTENTIC diferite (nu duplicate cosmetice), ceea ce
// este si ceea ce premiaza Pinterest.
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';

export interface DiffusionRequest {
  basePrompt: string;
  negativePrompt?: string;
  seed?: number;
  // Modifiers parametrici care diversifica real compozitia:
  styleModifiers: string[]; // ex: ["flat illustration", "soft gradient", "isometric"]
  palette: string[];        // hex colors
}

export interface DiffusionResult {
  imageBuffer: Buffer;
  seed: number;
  promptUsed: string;
}

@Injectable()
export class DiffusionProvider {
  private readonly logger = new Logger(DiffusionProvider.name);
  private readonly apiUrl = process.env.SD_API_URL ?? 'https://api.stability.ai/v2beta/stable-image/generate/sdxl';
  private readonly apiKey = process.env.SD_API_KEY ?? '';

  /**
   * Genereaza vizualul de baza la rezolutie nativa, apoi va fi redimensionat/
   * incadrat de compozitor la EXACT 1000x1500.
   */
  async generate(req: DiffusionRequest): Promise<DiffusionResult> {
    const seed = req.seed ?? this.randomSeed();
    const prompt = this.buildPrompt(req);

    const form = new FormData();
    form.append('prompt', prompt);
    form.append('negative_prompt', req.negativePrompt ?? this.defaultNegative());
    form.append('seed', String(seed));
    form.append('aspect_ratio', '2:3'); // ceream nativ raport vertical
    form.append('output_format', 'png');

    const res = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'image/*',
      },
      body: form,
    });

    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`Diffusion API a esuat: ${res.status} ${text}`);
      throw new Error(`Diffusion API error ${res.status}`);
    }

    const imageBuffer = Buffer.from(await res.arrayBuffer());
    return { imageBuffer, seed, promptUsed: prompt };
  }

  // Construieste promptul injectand modifiers parametrici => diversitate reala.
  private buildPrompt(req: DiffusionRequest): string {
    const style = req.styleModifiers.join(', ');
    const colors = req.palette.length ? `color palette: ${req.palette.join(', ')}` : '';
    return [
      req.basePrompt,
      style,
      colors,
      'clean composition, generous empty margins, high contrast, no text, no watermark',
    ]
      .filter(Boolean)
      .join('. ');
  }

  private defaultNegative(): string {
    // "no text" e crucial: textul il randam noi, vectorial/tipografic, controlat.
    return 'text, watermark, logo, low quality, blurry, distorted, extra limbs, nsfw';
  }

  private randomSeed(): number {
    return Math.floor(Math.random() * 2 ** 31);
  }
}
