// ============================================================================
// CopyGeneratorService — modulul NLP pentru titlu / descriere / alt-text.
// ----------------------------------------------------------------------------
// Reguli impuse (validate dupa generare):
//   - Titlu puternic, orientat pe BENEFICIU + ACTIUNE
//   - Descriere <= 500 caractere, cu primary keyword in PRIMUL paragraf
//   - Alt text descriptiv (accesibilitate + SEO)
//   - Pentru oferte comerciale: include #ad / #affiliate (FTC) — adaugat aici
//     si re-validat de FtcValidatorService inainte de publicare.
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';

export interface CopyInput {
  offerName: string;
  primaryKeyword: string;
  benefitPoints: string[];
  niche: 'HEALTH_FITNESS' | 'PERSONAL_FINANCE' | 'B2B_SAAS';
  isCommercial: boolean;
}

export interface GeneratedCopy {
  title: string;
  description: string;
  altText: string;
  keywordInFirstParagraph: boolean;
  hasFtcTag: boolean;
}

@Injectable()
export class CopyGeneratorService {
  private readonly logger = new Logger(CopyGeneratorService.name);
  private readonly apiKey = process.env.LLM_API_KEY ?? '';
  private readonly apiUrl = process.env.LLM_API_URL ?? 'https://api.openai.com/v1/chat/completions';
  private readonly model = process.env.LLM_MODEL ?? 'gpt-4o-mini';

  async generate(input: CopyInput): Promise<GeneratedCopy> {
    const system = this.systemPrompt(input.niche);
    const user = this.userPrompt(input);

    const raw = await this.callLLM(system, user);
    let parsed: { title: string; description: string; altText: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.logger.warn('LLM nu a returnat JSON valid; folosesc fallback.');
      parsed = this.fallback(input);
    }

    return this.enforceRules(parsed, input);
  }

  // ---- Aplica regulile DURE peste output-ul LLM ----
  private enforceRules(
    copy: { title: string; description: string; altText: string },
    input: CopyInput,
  ): GeneratedCopy {
    let description = copy.description.trim();

    // 1) Keyword in primul paragraf — daca lipseste, il prefixam natural.
    const firstParagraph = description.split('\n')[0] ?? description;
    let keywordInFirstParagraph = firstParagraph
      .toLowerCase()
      .includes(input.primaryKeyword.toLowerCase());
    if (!keywordInFirstParagraph) {
      description = `${this.capitalize(input.primaryKeyword)}: ${description}`;
      keywordInFirstParagraph = true;
    }

    // 2) FTC: pentru oferte comerciale, garantam #ad / #affiliate.
    let hasFtcTag = /#(ad|affiliate)\b/i.test(description);
    if (input.isCommercial && !hasFtcTag) {
      description = `${description}\n\n#ad #affiliate`;
      hasFtcTag = true;
    }

    // 3) Cap la 500 caractere (trunchiere sigura, fara a taia hashtagurile FTC).
    description = this.capTo500(description, input.isCommercial);

    return {
      title: copy.title.trim().slice(0, 100),
      description,
      altText: copy.altText.trim().slice(0, 500),
      keywordInFirstParagraph,
      hasFtcTag,
    };
  }

  private capTo500(text: string, keepFtc: boolean): string {
    if (text.length <= 500) return text;
    const ftc = keepFtc ? '\n\n#ad #affiliate' : '';
    const budget = 500 - ftc.length;
    const body = text.replace(/\n\n#ad #affiliate/i, '').slice(0, budget).trimEnd();
    return body + ftc;
  }

  private systemPrompt(niche: string): string {
    const nicheHint =
      niche === 'HEALTH_FITNESS'
        ? 'Foloseste un ton motivational, structureaza pe pasi/liste.'
        : niche === 'PERSONAL_FINANCE'
          ? 'Ton clar, credibil, orientat pe economii/randament.'
          : 'Ton profesional B2B, orientat pe ROI si productivitate.';
    return [
      'Esti copywriter expert pentru Pinterest, specializat in CTR ridicat.',
      'Genereaza copy orientat pe BENEFICIU + ACTIUNE.',
      nicheHint,
      'Raspunde STRICT in JSON: {"title": string, "description": string, "altText": string}.',
    ].join(' ');
  }

  private userPrompt(input: CopyInput): string {
    return JSON.stringify({
      instructiune:
        'Creeaza un titlu (max 100 car.), o descriere (max 500 car.) cu keyword-ul in primul paragraf, si un alt text descriptiv.',
      oferta: input.offerName,
      keyword: input.primaryKeyword,
      beneficii: input.benefitPoints,
    });
  }

  private async callLLM(system: string, user: string): Promise<string> {
    const res = await fetch(this.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.8, // diversitate textuala intre variante
      }),
    });
    if (!res.ok) throw new Error(`LLM error ${res.status}`);
    const json = await res.json();
    return json.choices?.[0]?.message?.content ?? '';
  }

  private fallback(input: CopyInput): { title: string; description: string; altText: string } {
    const kw = this.capitalize(input.primaryKeyword);
    return {
      title: `${kw}: ${input.benefitPoints[0] ?? 'Ghidul rapid'}`,
      description: `${kw} — ${input.benefitPoints.slice(0, 3).join(', ')}. Salveaza acest pin pentru mai tarziu!`,
      altText: `Infografic despre ${input.primaryKeyword} cu ${input.benefitPoints.length} sfaturi cheie.`,
    };
  }

  private capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
}
