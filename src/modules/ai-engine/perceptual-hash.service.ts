// ============================================================================
// PerceptualHashService — QA de UNICITATE a creativelor (nu evaziune inselatoare).
// ----------------------------------------------------------------------------
// Scop: sa ne asiguram ca propriul nostru output este AUTENTIC diferit de la
// pin la pin. Calculam un pHash (DCT 8x8) si comparam distanta Hamming fata de
// creativele recente ale aceluiasi user. Daca e prea aproape (sub pragul nisei),
// regeneram cu alti parametri (alt seed/layout/paleta). Asta produce diversitate
// reala — exact ce premiaza algoritmul Pinterest — nu copii cosmetice.
// ============================================================================

import { Injectable } from '@nestjs/common';
import sharp from 'sharp';

@Injectable()
export class PerceptualHashService {
  /**
   * pHash pe baza DCT: redimensioneaza la 32x32 grayscale, aplica DCT 2D,
   * pastreaza coltul 8x8 de frecvente joase, prag la mediana => 64 biti.
   * Returneaza hex de 16 caractere.
   */
  async computeHash(png: Buffer): Promise<string> {
    const size = 32;
    const { data } = await sharp(png)
      .resize(size, size, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pixels: number[][] = [];
    for (let y = 0; y < size; y++) {
      pixels[y] = [];
      for (let x = 0; x < size; x++) pixels[y][x] = data[y * size + x];
    }

    const dct = this.dct2d(pixels, size);

    // Pastreaza blocul 8x8 low-frequency (exclus DC la calculul medianei).
    const vals: number[] = [];
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) vals.push(dct[y][x]);
    const median = [...vals].sort((a, b) => a - b)[Math.floor(vals.length / 2)];

    let bits = '';
    for (const v of vals) bits += v > median ? '1' : '0';
    return this.bitsToHex(bits);
  }

  /** Distanta Hamming intre doua hash-uri hex (numar de biti diferiti). */
  hammingDistance(hexA: string, hexB: string): number {
    const a = BigInt('0x' + hexA);
    const b = BigInt('0x' + hexB);
    let x = a ^ b;
    let count = 0;
    while (x > 0n) {
      count += Number(x & 1n);
      x >>= 1n;
    }
    return count;
  }

  /**
   * Verifica unicitatea fata de o lista de hash-uri existente.
   * @returns true daca este suficient de UNIC (distanta >= minDistance fata de toate).
   */
  isUnique(hash: string, existingHashes: string[], minDistance: number): boolean {
    return existingHashes.every((h) => this.hammingDistance(hash, h) >= minDistance);
  }

  // ---- DCT 2D separabil (suficient pentru pHash 32x32) ----
  private dct2d(m: number[][], n: number): number[][] {
    const out: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    const c = (k: number) => (k === 0 ? Math.SQRT1_2 : 1);
    for (let u = 0; u < n; u++) {
      for (let v = 0; v < n; v++) {
        let sum = 0;
        for (let x = 0; x < n; x++) {
          for (let y = 0; y < n; y++) {
            sum +=
              m[x][y] *
              Math.cos(((2 * x + 1) * u * Math.PI) / (2 * n)) *
              Math.cos(((2 * y + 1) * v * Math.PI) / (2 * n));
          }
        }
        out[u][v] = 0.25 * c(u) * c(v) * sum;
      }
    }
    return out;
  }

  private bitsToHex(bits: string): string {
    let hex = '';
    for (let i = 0; i < bits.length; i += 4) {
      hex += parseInt(bits.substr(i, 4), 2).toString(16);
    }
    return hex.padStart(16, '0');
  }
}
