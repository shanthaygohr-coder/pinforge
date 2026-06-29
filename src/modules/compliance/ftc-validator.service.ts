// ============================================================================
// FtcValidatorService — strat OBLIGATORIU de validare a metadatelor.
// ----------------------------------------------------------------------------
// Orice pin care duce catre o oferta COMERCIALA trebuie sa contina #ad sau
// #affiliate in descriere. Acest serviciu este un "gate" inainte de publicare:
// daca validarea pica, pin-ul NU intra in coada (sau este corectat automat).
// Fiecare verificare scrie un ComplianceAudit.
// ============================================================================

import { Injectable } from '@nestjs/common';

export interface FtcCheckInput {
  description: string;
  isCommercial: boolean;
  destinationUrl: string;
}

export interface FtcCheckResult {
  passed: boolean;
  violations: string[];
  // Descrierea corectata (cu hashtag-urile adaugate) daca a fost necesar.
  correctedDescription: string;
}

const FTC_TAG_REGEX = /#(ad|affiliate|sponsored)\b/i;
// Domenii brute care NU au voie sa apara direct in destinationUrl-ul unui pin.
const RAW_AFFILIATE_HOSTS = [/(^|\.)clickbank\.net$/i, /(^|\.)digistore24\.com$/i, /hop\.clickbank/i];

@Injectable()
export class FtcValidatorService {
  validate(input: FtcCheckInput): FtcCheckResult {
    const violations: string[] = [];
    let correctedDescription = input.description;

    if (input.isCommercial) {
      // 1) Trebuie sa existe #ad / #affiliate.
      if (!FTC_TAG_REGEX.test(correctedDescription)) {
        violations.push('Lipseste eticheta FTC (#ad / #affiliate) pe un pin comercial.');
        correctedDescription = `${correctedDescription.trim()}\n\n#ad #affiliate`;
      }

      // 2) Destinatia NU are voie sa fie un link brut de afiliere -> trebuie bridge page.
      if (this.isRawAffiliateLink(input.destinationUrl)) {
        violations.push(
          'Pin-ul comercial trimite direct catre un link brut de afiliere; trebuie sa foloseasca un bridge page.',
        );
      }
    }

    return {
      // "passed" = nicio incalcare NEremediabila. Lipsa hashtagului e auto-corectata,
      // dar linkul brut este o eroare blocanta (nu o corectam automat).
      passed: !violations.some((v) => v.includes('link brut')),
      violations,
      correctedDescription,
    };
  }

  private isRawAffiliateLink(url: string): boolean {
    try {
      const host = new URL(url).hostname;
      return RAW_AFFILIATE_HOSTS.some((re) => re.test(host));
    } catch {
      return false;
    }
  }
}
