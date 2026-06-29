// ============================================================================
// CreativeOrchestratorService — leaga intregul pipeline de generare.
// ----------------------------------------------------------------------------
// Flux:
//   1) NicheRulesEngine -> profil (layout permis, paleta, guardrails, prag pHash)
//   2) DiffusionProvider -> fundal vizual (cu modifiers parametrici)
//   3) ImageComposerService -> compozitie finala 1000x1500 (text bold, white-space, brand)
//   4) PerceptualHashService -> QA de UNICITATE; daca e prea similar, REGENEREAZA
//      cu alt seed/layout/paleta (diversitate reala, nu copii cosmetice)
//   5) CopyGeneratorService -> titlu/descriere/alt-text (keyword-first, FTC)
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { DiffusionProvider } from './diffusion.provider';
import { ImageComposerService } from './image-composer.service';
import { PerceptualHashService } from './perceptual-hash.service';
import { CopyGeneratorService } from './copy-generator.service';
import { NicheRulesEngine, Niche } from '../niche/niche-rules.engine';

export interface GenerateCreativeInput {
  niche: Niche;
  offerName: string;
  primaryKeyword: string;
  benefitPoints: string[];
  brandUrl: string;
  isCommercial: boolean;
  existingHashes: string[]; // hash-urile creativelor recente ale userului (din DB)
  logoPng?: Buffer;
}

export interface GeneratedCreative {
  png: Buffer;
  perceptualHash: string;
  whiteSpaceRatio: number;
  layoutVariant: string;
  diffusionSeed: number;
  copy: { title: string; description: string; altText: string };
  attempts: number;
}

const MAX_REGEN_ATTEMPTS = 4;

@Injectable()
export class CreativeOrchestratorService {
  private readonly logger = new Logger(CreativeOrchestratorService.name);

  constructor(
    private readonly diffusion: DiffusionProvider,
    private readonly composer: ImageComposerService,
    private readonly phash: PerceptualHashService,
    private readonly copyGen: CopyGeneratorService,
    private readonly niche: NicheRulesEngine,
  ) {}

  async generate(input: GenerateCreativeInput): Promise<GeneratedCreative> {
    const profile = this.niche.getProfile(input.niche);

    let attempts = 0;
    let lastHash = '';
    let png: Buffer | null = null;
    let whiteSpaceRatio = 0;
    let seed = 0;
    let layoutVariant = '';

    // Bucla de unicitate: regenereaza cu parametri DIFERITI pana e suficient de unic.
    while (attempts < MAX_REGEN_ATTEMPTS) {
      attempts++;
      const layout = this.niche.pickLayout(input.niche, attempts - 1);
      layoutVariant = layout;

      const base = await this.diffusion.generate({
        basePrompt: this.buildBasePrompt(input, layout),
        styleModifiers: profile.styleModifiers,
        palette: profile.palette,
        negativePrompt: [...profile.promptGuardrails, 'text, watermark'].join(', '),
      });
      seed = base.seed;

      const composed = await this.composer.compose({
        backgroundPng: base.imageBuffer,
        title: input.offerName,
        bullets: input.benefitPoints,
        brandUrl: input.brandUrl,
        logoPng: input.logoPng,
        accentColor: profile.palette[3],
      });

      const hash = await this.phash.computeHash(composed.png);
      lastHash = hash;

      if (this.phash.isUnique(hash, input.existingHashes, profile.pHashMinDistance)) {
        png = composed.png;
        whiteSpaceRatio = composed.whiteSpaceRatio;
        break;
      }
      this.logger.warn(
        `Creative prea similar (incercare ${attempts}); regenerez cu alt seed/layout.`,
      );
    }

    if (!png) {
      throw new Error(
        `Nu am putut genera un creative suficient de unic dupa ${MAX_REGEN_ATTEMPTS} incercari.`,
      );
    }

    const copy = await this.copyGen.generate({
      offerName: input.offerName,
      primaryKeyword: input.primaryKeyword,
      benefitPoints: input.benefitPoints,
      niche: input.niche,
      isCommercial: input.isCommercial,
    });

    return {
      png,
      perceptualHash: lastHash,
      whiteSpaceRatio,
      layoutVariant,
      diffusionSeed: seed,
      copy: { title: copy.title, description: copy.description, altText: copy.altText },
      attempts,
    };
  }

  private buildBasePrompt(input: GenerateCreativeInput, layout: string): string {
    const layoutHint =
      layout === 'comparison-2col'
        ? 'side-by-side comparison layout, two clear columns'
        : layout === 'cheatsheet-grid'
          ? 'organized grid cheat-sheet layout'
          : layout === 'infographic'
            ? 'infographic with icons and sections'
            : 'numbered list (listicle) layout';
    return `${input.primaryKeyword}, ${layoutHint}, vertical Pinterest pin background`;
  }
}
