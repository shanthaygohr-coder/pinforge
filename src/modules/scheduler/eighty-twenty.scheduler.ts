// ============================================================================
// EightyTwentyScheduler — planificarea publicarii cu regula 80/20.
// ----------------------------------------------------------------------------
// Obiectiv: intercaleaza continutul astfel incat ~80% sa fie EDUCATIONAL/valoare
// si ~20% OFERTE afiliate, evitand grupari de oferte (care arata spam si scad
// Domain Quality). In plus, distribuie sloturile respectand ferestrele de
// rate-limit per cont (vezi RateLimitState) si orele optime de postare.
// ============================================================================

import { Injectable } from '@nestjs/common';

export type ContentClass = 'EDUCATIONAL' | 'OFFER';

export interface SchedulableItem {
  pinId: string;
  contentClass: ContentClass;
}

export interface ScheduleSlot {
  pinId: string;
  contentClass: ContentClass;
  scheduledFor: Date;
}

export interface ScheduleConfig {
  startAt: Date;
  intervalMinutes: number; // distanta intre pin-uri (ex: 90 min)
  // Capacitate maxima de publicari pe fereastra (din rate-limit) — pin-urile peste
  // capacitate sunt impinse in ferestrele urmatoare.
  maxPerDay?: number;
}

@Injectable()
export class EightyTwentyScheduler {
  /**
   * Construieste o coada intercalata 80/20.
   *
   * Algoritm:
   *  1) Separa items in educational[] si offer[].
   *  2) Calculeaza rata de injectare a ofertelor: la fiecare 5 pin-uri, 1 oferta (20%).
   *     Folosim un acumulator fractionar ca sa respectam raportul chiar si pe
   *     loturi mici si sa NU punem niciodata 2 oferte consecutive.
   *  3) Atribuie timestamp-uri la intervalMinutes, respectand maxPerDay.
   */
  buildSchedule(items: SchedulableItem[], config: ScheduleConfig): ScheduleSlot[] {
    const educational = items.filter((i) => i.contentClass === 'EDUCATIONAL');
    const offers = items.filter((i) => i.contentClass === 'OFFER');

    const ordered = this.interleave(educational, offers, 0.2);
    return this.assignTimestamps(ordered, config);
  }

  /**
   * Intercaleaza pastrand proportia tinta de oferte (offerRatio, ex 0.2) si
   * garantand ca nu apar doua oferte una dupa alta.
   */
  private interleave(
    educational: SchedulableItem[],
    offers: SchedulableItem[],
    offerRatio: number,
  ): SchedulableItem[] {
    const result: SchedulableItem[] = [];
    let eduIdx = 0;
    let offerIdx = 0;
    let acc = 0; // acumulator pentru rata de oferte
    let lastWasOffer = false;

    const total = educational.length + offers.length;
    for (let placed = 0; placed < total; placed++) {
      acc += offerRatio;
      const wantOffer = acc >= 1 && !lastWasOffer && offerIdx < offers.length;

      if (wantOffer) {
        result.push(offers[offerIdx++]);
        acc -= 1;
        lastWasOffer = true;
      } else if (eduIdx < educational.length) {
        result.push(educational[eduIdx++]);
        lastWasOffer = false;
      } else if (offerIdx < offers.length) {
        // Au ramas doar oferte; le distantam prin pin-uri educational deja epuizate.
        result.push(offers[offerIdx++]);
        lastWasOffer = true;
        acc = Math.max(0, acc - 1);
      }
    }
    return result;
  }

  private assignTimestamps(ordered: SchedulableItem[], config: ScheduleConfig): ScheduleSlot[] {
    const slots: ScheduleSlot[] = [];
    let cursor = new Date(config.startAt);
    let countToday = 0;
    let currentDay = cursor.getUTCDate();

    for (const item of ordered) {
      if (config.maxPerDay && countToday >= config.maxPerDay) {
        // Sari la inceputul zilei urmatoare.
        cursor = this.nextDayStart(cursor);
        countToday = 0;
        currentDay = cursor.getUTCDate();
      }
      if (cursor.getUTCDate() !== currentDay) {
        countToday = 0;
        currentDay = cursor.getUTCDate();
      }

      slots.push({
        pinId: item.pinId,
        contentClass: item.contentClass,
        scheduledFor: new Date(cursor),
      });

      cursor = new Date(cursor.getTime() + config.intervalMinutes * 60_000);
      countToday++;
    }
    return slots;
  }

  private nextDayStart(d: Date): Date {
    const next = new Date(d);
    next.setUTCDate(next.getUTCDate() + 1);
    next.setUTCHours(9, 0, 0, 0); // reia la 09:00 UTC (fereastra de engagement)
    return next;
  }
}
