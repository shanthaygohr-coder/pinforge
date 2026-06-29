// ============================================================================
// NicheRulesEngine — reguli specifice de nisa pentru generare si validare.
// ----------------------------------------------------------------------------
//  HEALTH_FITNESS : layout = listicle / infografic. INTERZIS "before/after".
//  PERSONAL_FINANCE / B2B_SAAS : "cheat sheets" si comparatii vizuale clare.
//
// Engine-ul ofera (a) parametrii de generare pe care ii consuma AI-ul si
// (b) o validare a politicii inainte de publicare (scrie ComplianceAudit).
// ============================================================================

import { Injectable } from '@nestjs/common';

export type Niche = 'HEALTH_FITNESS' | 'PERSONAL_FINANCE' | 'B2B_SAAS';
export type LayoutVariant = 'listicle' | 'infographic' | 'cheatsheet-grid' | 'comparison-2col';

export interface NicheGenerationProfile {
  allowedLayouts: LayoutVariant[];
  bannedVisualPatterns: string[]; // verificate semantic in prompt/instructiuni
  styleModifiers: string[];       // injectate in DiffusionProvider
  palette: string[];
  pHashMinDistance: number;       // pragul de unicitate (Hamming)
  promptGuardrails: string[];     // adaugate in negative prompt / instructiuni
}

export interface NichePolicyResult {
  passed: boolean;
  violations: string[];
}

const PROFILES: Record<Niche, NicheGenerationProfile> = {
  HEALTH_FITNESS: {
    allowedLayouts: ['listicle', 'infographic'],
    // Politica Pinterest: fara comparatii inainte/dupa pentru greutate corporala.
    bannedVisualPatterns: ['before_after', 'weight_comparison', 'body_shaming'],
    styleModifiers: ['flat vector illustration', 'energetic', 'clean infographic style'],
    palette: ['#16A34A', '#0EA5E9', '#F8FAFC', '#111827'],
    pHashMinDistance: 14,
    promptGuardrails: [
      'no before-and-after body comparison',
      'no weight-loss transformation imagery',
      'focus on healthy activities, food, routines',
    ],
  },
  PERSONAL_FINANCE: {
    allowedLayouts: ['cheatsheet-grid', 'comparison-2col', 'listicle'],
    bannedVisualPatterns: ['guaranteed_returns', 'get_rich_quick'],
    styleModifiers: ['modern financial infographic', 'data visualization', 'trustworthy'],
    palette: ['#1D4ED8', '#059669', '#F1F5F9', '#0F172A'],
    pHashMinDistance: 12,
    promptGuardrails: ['no promises of guaranteed returns', 'no misleading wealth claims'],
  },
  B2B_SAAS: {
    allowedLayouts: ['comparison-2col', 'cheatsheet-grid', 'listicle'],
    bannedVisualPatterns: ['fake_testimonials'],
    styleModifiers: ['clean SaaS dashboard illustration', 'isometric', 'professional'],
    palette: ['#6D28D9', '#2563EB', '#F8FAFC', '#1E293B'],
    pHashMinDistance: 12,
    promptGuardrails: ['no fabricated metrics', 'no fake customer logos'],
  },
};

@Injectable()
export class NicheRulesEngine {
  getProfile(niche: Niche): NicheGenerationProfile {
    return PROFILES[niche];
  }

  /** Alege un layout permis (rotatie pentru diversitate). */
  pickLayout(niche: Niche, rotationIndex: number): LayoutVariant {
    const layouts = PROFILES[niche].allowedLayouts;
    return layouts[rotationIndex % layouts.length];
  }

  /**
   * Valideaza ca planul creative-ului respecta politica de nisa inainte de generare/publicare.
   * `requestedLayout` si `semanticTags` provin din planul de generare / analiza imaginii.
   */
  validatePolicy(
    niche: Niche,
    requestedLayout: LayoutVariant,
    semanticTags: string[],
  ): NichePolicyResult {
    const profile = PROFILES[niche];
    const violations: string[] = [];

    if (!profile.allowedLayouts.includes(requestedLayout)) {
      violations.push(
        `Layout "${requestedLayout}" nepermis pentru nisa ${niche}. Permise: ${profile.allowedLayouts.join(', ')}.`,
      );
    }

    const lowered = semanticTags.map((t) => t.toLowerCase().replace(/[\s-]+/g, '_'));
    for (const banned of profile.bannedVisualPatterns) {
      if (lowered.includes(banned)) {
        violations.push(`Pattern vizual interzis pentru ${niche}: "${banned}".`);
      }
    }

    return { passed: violations.length === 0, violations };
  }
}
