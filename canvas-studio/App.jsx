// ============================================================================
// PinForge Studio — aplicatie COMPLET FUNCTIONALA pentru Gemini Canvas
// (un singur fisier React, fara backend)
// ----------------------------------------------------------------------------
// FLUX OPTIMIZAT PENTRU CTR (click-through rate):
//   PAS 0 (gandire): AI-ul construieste intai o STRATEGIE de click pentru nisa
//                    (formule de titlu, curiosity gap, text overlay, greseli de evitat)
//   PAS 1: genereaza N concepte DISTINCTE aplicand strategia, fiecare cu:
//          overlayText (titlu bold pe imagine, orientat pe ACTIUNE + cifre),
//          title, description (keyword in primul paragraf, #ad), altText descriptiv
//          (alt text bun = +123% click-uri de iesire), board sugerat, scor CTR + motiv
//   PAS 2: NANO BANANA (gemini-2.5-flash-image) randeaza imaginea verticala 2:3
//          cu overlayText ca titlu bold sans-serif, min 30% spatiu gol, brand jos
//   + regenerare per pin, editare, sortare dupa scor CTR, export imagini + CSV
//
// Cheia API Gemini e injectata automat de Canvas (apiKey = "").
// ============================================================================

import React, { useState, useCallback, useMemo } from "react";
import {
  Sparkles, Download, Loader2, AlertTriangle, Image as ImageIcon,
  Wand2, RefreshCw, FileDown, DownloadCloud, Pencil, Check, TrendingUp, ArrowUpDown,
} from "lucide-react";

const TEXT_MODEL = "gemini-2.5-flash";
const IMAGE_MODEL = "gemini-2.5-flash-image"; // Nano Banana
const API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models";

// Reguli de nisa derivate din cercetare (formule CTR + politici Pinterest)
const NICHES = {
  HEALTH_FITNESS: {
    label: "Fitness & Sanatate",
    accent: "#16A34A",
    layouts: ["listicle numerotat", "infografic cu iconite", "rutina in pasi"],
    bannedPatterns: "STRICT INTERZIS: imagini inainte/dupa (before/after) socante, comparatii de greutate corporala, promisiuni irationale.",
    visualStyle: "ilustratie vectoriala plata, energica, stil infografic curat",
    palette: "verde proaspat, albastru, alb",
    keywordHint: "rutina, slabit sanatos, energie, nutritie",
    ctrFormulas: "liste numerotate ('5 mic-dejunuri pentru...'), rezultate specifice si masurabile, rutine scurte ('in 10 minute')",
  },
  PERSONAL_FINANCE: {
    label: "Finante Personale",
    accent: "#1D4ED8",
    layouts: ["cheat sheet pe grila", "comparatie pe 2 coloane", "listicle numerotat"],
    bannedPatterns: "Fara promisiuni de castiguri garantate sau scheme de imbogatire rapida.",
    visualStyle: "infografic financiar modern, vizualizare de date, aspect de incredere",
    palette: "albastru inchis, verde bani, alb",
    keywordHint: "economisire, bugetare, investitii, venit pasiv",
    ctrFormulas: "sume specifice in $/lei ('Economiseste 500$ luna asta'), cheat sheets, comparatii clare, pasi concreti",
  },
  B2B_SAAS: {
    label: "B2B SaaS",
    accent: "#6D28D9",
    layouts: ["comparatie pe 2 coloane", "cheat sheet pe grila", "listicle numerotat"],
    bannedPatterns: "Fara metrici fabricate sau testimoniale false.",
    visualStyle: "ilustratie de dashboard SaaS curata, isometric, profesional",
    palette: "violet, albastru, gri deschis",
    keywordHint: "productivitate, automatizare, ROI, integrare",
    ctrFormulas: "timp economisit ('Automatizeaza X in 5 min'), comparatii de tool-uri, listicle de unelte, ROI concret",
  },
};

// fetch cu exponential backoff (max ~32s) pentru rate limits / supraincarcare
async function fetchWithBackoff(url, options, maxAttempts = 5) {
  let attempt = 0;
  while (true) {
    attempt++;
    let res;
    try {
      res = await fetch(url, options);
    } catch (networkErr) {
      if (attempt >= maxAttempts) throw networkErr;
      await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** (attempt - 1), 32000)));
      continue;
    }
    if (res.status === 429 || res.status === 503) {
      if (attempt >= maxAttempts) throw new Error(`API ocupat (${res.status}).`);
      await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** (attempt - 1), 32000) + Math.random() * 400));
      continue;
    }
    if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 250)}`);
    return res.json();
  }
}

async function callText(apiKey, prompt, generationConfig) {
  const json = await fetchWithBackoff(`${API_ROOT}/${TEXT_MODEL}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig }),
  });
  return json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

// PAS 0 — AI-ul GANDESTE strategia de CTR pentru nisa, inainte sa genereze pinuri
async function generateCtrStrategy({ apiKey, niche, brand, keyword }) {
  const n = NICHES[niche];
  const prompt = `Esti un expert in maximizarea CTR (click-through rate) pe Pinterest, motor de cautare vizuala cu intentie de achizitie.
Nisa: ${n.label}. Brand: ${brand || "(neprecizat)"}. Tema: ${keyword || n.keywordHint}.

Gandeste pas cu pas si formuleaza STRATEGIA de click pentru aceasta campanie, in 6-8 principii ACTIONABILE:
- formule de titlu care castiga statistic clicuri (numere, sume/rezultate SPECIFICE, curiosity gap, power words);
- ce text overlay scurt (titlu pe imagine) opreste scroll-ul pe mobil;
- ce stil vizual si ierarhie atrag ochiul (folosind: ${n.ctrFormulas});
- ce greseli sa evitam (${n.bannedPatterns});
- cum sa fie fiecare pin DISTINCT (unghiuri diferite), nu variatii cosmetice.
Raspunde concis, doar lista de principii, fara introducere.`;
  return callText(apiKey, prompt, { temperature: 0.7 });
}

// PAS 1 — N blueprint-uri distincte care APLICA strategia CTR
async function generateBlueprints({ apiKey, niche, brand, keyword, count, strategy }) {
  const n = NICHES[niche];
  const prompt = `Esti strateg de continut Pinterest, expert in CTR ridicat si copywriting non-generic.
Nisa: ${n.label}. Brand/URL: ${brand || "(neprecizat)"}. Tema: ${keyword || n.keywordHint}.
Layout-uri permise: ${n.layouts.join(", ")}. ${n.bannedPatterns}

APLICA STRICT aceasta strategie CTR pe care ai conceput-o:
"""${strategy}"""

Genereaza EXACT ${count} concepte de pin DISTINCTE (unghiuri, hook-uri, layout-uri si palete diferite), maximizand clicurile.
Reguli obligatorii per concept:
- "overlayText": titlul SCURT (3-7 cuvinte) randat BOLD pe imagine, orientat pe ACTIUNE + cifra/rezultat specific (ex: "Economiseste 500$ luna asta"). NU pasiv (nu "Sfaturi utile").
- "title": titlu pin (max 100 car.), benefit + actiune.
- "description": max 480 car., cu keyword-ul in PRIMUL paragraf; se termina cu "#ad #affiliate".
- "altText": text alternativ DESCRIPTIV si bogat (alt text bun creste click-urile de iesire cu pana la 123%).
- "boardSuggestion": numele unui board Pinterest relevant semantic (ex: "Retete Slabit si Fitness"), nu generic.
- "ctrScore": numar 1-100, estimarea ta a potentialului de click.
- "ctrRationale": o propozitie scurta, de ce acest concept atrage clicuri.
- "imagePrompt": prompt DETALIAT pentru generatorul de imagini: design vertical pin 2:3, overlayText randat ca text BOLD sans-serif lizibil, min 30% spatiu gol, layout din lista, paleta ${n.palette}, stil ${n.visualStyle}${niche === "HEALTH_FITNESS" ? "; FARA comparatii inainte/dupa sau corpuri" : ""}.`;

  const schema = {
    type: "ARRAY",
    items: {
      type: "OBJECT",
      properties: {
        overlayText: { type: "STRING" },
        title: { type: "STRING" },
        description: { type: "STRING" },
        altText: { type: "STRING" },
        boardSuggestion: { type: "STRING" },
        ctrScore: { type: "NUMBER" },
        ctrRationale: { type: "STRING" },
        imagePrompt: { type: "STRING" },
      },
      required: ["overlayText", "title", "description", "altText", "boardSuggestion", "ctrScore", "ctrRationale", "imagePrompt"],
    },
  };

  const text = await callText(apiKey, prompt, {
    responseMimeType: "application/json", responseSchema: schema, temperature: 1.0,
  });
  let arr = JSON.parse(text || "[]");
  if (!Array.isArray(arr)) arr = [];
  return arr.slice(0, count);
}

// PAS 2 — imaginea cu Nano Banana; overlayText e titlul randat in imagine
async function generateImage({ apiKey, imagePrompt, overlayText, brand }) {
  const fullPrompt = `${imagePrompt}

Text overlay OBLIGATORIU randat clar pe imagine, ca titlu principal: "${overlayText}".
Constrangeri stricte: orientare VERTICALA 2:3 (1000x1500 px); tipografie sans-serif GROASA (bold) foarte lizibila pe mobil
(fara fonturi script/decorative); minimum 30% spatiu gol (aerisit, sa "respire"); URL brand "${brand || "brand.com"}" discret jos;
contrast ridicat care opreste scroll-ul; calitate inalta, fara watermark.`;

  const url = `${API_ROOT}/${IMAGE_MODEL}:generateContent?key=${apiKey}`;
  const base = { contents: [{ role: "user", parts: [{ text: fullPrompt }] }] };
  const variants = [
    { ...base, generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "2:3" } } },
    { ...base, generationConfig: { responseModalities: ["IMAGE"] } },
    base,
  ];
  let lastErr;
  for (const body of variants) {
    try {
      const json = await fetchWithBackoff(url, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const parts = json?.candidates?.[0]?.content?.parts ?? [];
      const imgPart = parts.find((p) => p.inlineData?.data);
      if (imgPart) return `data:${imgPart.inlineData.mimeType || "image/png"};base64,${imgPart.inlineData.data}`;
      lastErr = new Error("Raspuns fara imagine.");
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("Generarea imaginii a esuat.");
}

function csvEscape(s) { return `"${String(s ?? "").replace(/"/g, '""')}"`; }

export default function App() {
  const [apiKey, setApiKey] = useState("");
  const [niche, setNiche] = useState("HEALTH_FITNESS");
  const [brand, setBrand] = useState("");
  const [keyword, setKeyword] = useState("");
  const [count, setCount] = useState(10);
  const [pins, setPins] = useState([]);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [editingId, setEditingId] = useState(null);
  const [sortByCtr, setSortByCtr] = useState(true);
  const [strategy, setStrategy] = useState("");

  const accent = NICHES[niche].accent;
  const readyPins = useMemo(() => pins.filter((p) => p.image), [pins]);
  const displayPins = useMemo(
    () => (sortByCtr ? [...pins].sort((a, b) => (b.ctrScore || 0) - (a.ctrScore || 0)) : pins),
    [pins, sortByCtr]
  );

  const handleGenerate = useCallback(async () => {
    setError(""); setBusy(true); setPins([]); setStrategy(""); setProgress({ done: 0, total: count });
    try {
      // PAS 0: AI-ul gandeste strategia de CTR
      setPhase("Analizez strategia de click (CTR)...");
      const strat = await generateCtrStrategy({ apiKey, niche, brand, keyword });
      setStrategy(strat);

      // PAS 1: blueprint-urile care aplica strategia
      setPhase("Generez conceptele de pin...");
      const blueprints = await generateBlueprints({ apiKey, niche, brand, keyword, count, strategy: strat });
      if (!blueprints.length) throw new Error("Nu am primit concepte. Reincearca.");

      // mix 80/20: ~fiecare al 5-lea pin = OFERTA
      const seeded = blueprints.map((b, i) => ({
        id: i, ...b, image: null, imgError: null,
        contentClass: (i + 1) % 5 === 0 ? "OFFER" : "EDUCATIONAL",
      }));
      setPins(seeded);
      setPhase("Randez imaginile (Nano Banana)...");
      setProgress({ done: 0, total: seeded.length });

      // PAS 2: imaginile, in paralel
      let completed = 0;
      await Promise.all(seeded.map(async (b) => {
        try {
          const image = await generateImage({ apiKey, imagePrompt: b.imagePrompt, overlayText: b.overlayText, brand });
          setPins((prev) => prev.map((p) => (p.id === b.id ? { ...p, image } : p)));
        } catch (e) {
          setPins((prev) => prev.map((p) => (p.id === b.id ? { ...p, imgError: e.message } : p)));
        } finally {
          completed++; setProgress({ done: completed, total: seeded.length });
        }
      }));
      setPhase("");
    } catch (e) {
      setError(e.message || "Eroare necunoscuta."); setPhase("");
    } finally { setBusy(false); }
  }, [apiKey, niche, brand, keyword, count]);

  const regeneratePin = useCallback(async (pin) => {
    setPins((prev) => prev.map((p) => (p.id === pin.id ? { ...p, image: null, imgError: null, regenerating: true } : p)));
    try {
      const image = await generateImage({
        apiKey, imagePrompt: pin.imagePrompt + " (varianta noua, compozitie diferita)",
        overlayText: pin.overlayText, brand,
      });
      setPins((prev) => prev.map((p) => (p.id === pin.id ? { ...p, image, regenerating: false } : p)));
    } catch (e) {
      setPins((prev) => prev.map((p) => (p.id === pin.id ? { ...p, imgError: e.message, regenerating: false } : p)));
    }
  }, [apiKey, brand]);

  const downloadPin = useCallback((pin) => {
    if (!pin.image) return;
    const a = document.createElement("a");
    a.href = pin.image; a.download = `pin-${pin.id + 1}.png`; a.click();
  }, []);

  const downloadAll = useCallback(async () => {
    for (const p of readyPins) { downloadPin(p); await new Promise((r) => setTimeout(r, 350)); }
  }, [readyPins, downloadPin]);

  const exportCsv = useCallback(() => {
    const header = ["nr", "tip", "scorCTR", "overlayText", "titlu", "descriere", "altText", "board", "motivCTR"].join(",");
    const rows = displayPins.map((p, i) =>
      [i + 1, p.contentClass, p.ctrScore ?? "", csvEscape(p.overlayText), csvEscape(p.title),
       csvEscape(p.description), csvEscape(p.altText), csvEscape(p.boardSuggestion), csvEscape(p.ctrRationale)].join(",")
    );
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "pinforge-pinuri.csv"; a.click();
  }, [displayPins]);

  const updatePin = (id, field, value) =>
    setPins((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)));

  const ctrColor = (s) => (s >= 80 ? "#16A34A" : s >= 60 ? "#CA8A04" : "#DC2626");

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      <header className="border-b border-slate-200 bg-white sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-3">
          <div className="grid place-items-center w-10 h-10 rounded-xl" style={{ background: accent }}>
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight">PinForge Studio</h1>
            <p className="text-xs text-slate-500">Pinuri optimizate CTR · strategie AI + Nano Banana · 100% in Canvas</p>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <label className="block text-sm font-semibold mb-2">Nisa</label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            {Object.entries(NICHES).map(([key, n]) => (
              <button key={key} onClick={() => setNiche(key)}
                className={`rounded-xl border-2 px-4 py-3 text-left transition ${niche === key ? "border-current shadow-sm" : "border-slate-200 hover:border-slate-300"}`}
                style={{ color: niche === key ? n.accent : undefined }}>
                <div className="font-bold text-slate-900">{n.label}</div>
                <div className="text-xs text-slate-500 mt-1">{n.layouts[0]}</div>
              </button>
            ))}
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-semibold mb-2">Brand / URL (optional)</label>
              <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="ex: myfitsite.com"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2" style={{ "--tw-ring-color": accent }} />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-2">Keyword / Oferta (optional)</label>
              <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder={NICHES[niche].keywordHint}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2" style={{ "--tw-ring-color": accent }} />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-2">Cheie API Gemini (gol in Canvas)</label>
              <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="auto in Canvas" type="password"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2" style={{ "--tw-ring-color": accent }} />
            </div>
          </div>

          <div className="mt-4">
            <label className="block text-sm font-semibold mb-2">Numar de pinuri: {count}</label>
            <input type="range" min="1" max="12" value={count} onChange={(e) => setCount(Number(e.target.value))} className="w-full" style={{ accentColor: accent }} />
          </div>

          <div className="mt-6 flex items-center gap-4 flex-wrap">
            <button onClick={handleGenerate} disabled={busy}
              className="inline-flex items-center gap-2 rounded-xl px-6 py-3 font-bold text-white disabled:opacity-50 transition active:scale-95" style={{ background: accent }}>
              {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Wand2 className="w-5 h-5" />}
              {busy ? "Se lucreaza..." : `Genereaza ${count} pinuri`}
            </button>
            {busy && phase && <span className="text-sm text-slate-500">{phase} {progress.total > 0 ? `(${progress.done}/${progress.total})` : ""}</span>}
          </div>

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              <AlertTriangle className="w-5 h-5 shrink-0" /><span>{error}</span>
            </div>
          )}
        </section>

        {/* Strategia CTR gandita de AI */}
        {strategy && (
          <details className="mt-6 bg-white rounded-2xl border border-slate-200 p-5 shadow-sm" open>
            <summary className="flex items-center gap-2 cursor-pointer font-bold">
              <TrendingUp className="w-5 h-5" style={{ color: accent }} /> Strategia de CTR (gandita de AI inainte de generare)
            </summary>
            <pre className="mt-3 whitespace-pre-wrap text-sm text-slate-600 font-sans">{strategy}</pre>
          </details>
        )}

        {/* Bara de actiuni */}
        {pins.length > 0 && (
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button onClick={() => setSortByCtr((v) => !v)} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50">
              <ArrowUpDown className="w-4 h-4" /> {sortByCtr ? "Sortat dupa scor CTR" : "Ordine originala"}
            </button>
            {readyPins.length > 0 && (
              <>
                <button onClick={downloadAll} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50">
                  <DownloadCloud className="w-4 h-4" /> Descarca toate imaginile ({readyPins.length})
                </button>
                <button onClick={exportCsv} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50">
                  <FileDown className="w-4 h-4" /> Export CSV (copy + scor CTR + board)
                </button>
              </>
            )}
          </div>
        )}

        {/* Galerie */}
        {pins.length > 0 && (
          <section className="mt-5 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
            {displayPins.map((pin) => (
              <article key={pin.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm flex flex-col">
                <div className="relative w-full bg-slate-100" style={{ aspectRatio: "2 / 3" }}>
                  {pin.image ? (
                    <img src={pin.image} alt={pin.altText} className="w-full h-full object-cover" />
                  ) : pin.imgError ? (
                    <div className="absolute inset-0 grid place-items-center text-center p-3 text-xs text-red-500">
                      <div><AlertTriangle className="w-6 h-6 mx-auto mb-1" />Imagine esuata</div>
                    </div>
                  ) : (
                    <div className="absolute inset-0 grid place-items-center text-slate-400"><Loader2 className="w-7 h-7 animate-spin" /></div>
                  )}
                  <span className="absolute top-2 left-2 text-[9px] font-bold uppercase px-2 py-1 rounded-md text-white"
                    style={{ background: pin.contentClass === "OFFER" ? "#DC2626" : accent }}>
                    {pin.contentClass === "OFFER" ? "Oferta" : "Valoare"}
                  </span>
                  {typeof pin.ctrScore === "number" && (
                    <span className="absolute bottom-2 left-2 text-[10px] font-bold px-2 py-1 rounded-md text-white flex items-center gap-1"
                      style={{ background: ctrColor(pin.ctrScore) }}>
                      <TrendingUp className="w-3 h-3" /> CTR {pin.ctrScore}
                    </span>
                  )}
                  <div className="absolute top-2 right-2 flex gap-1">
                    <button onClick={() => regeneratePin(pin)} disabled={pin.regenerating}
                      className="grid place-items-center w-8 h-8 rounded-lg bg-white/90 hover:bg-white shadow" title="Regenereaza">
                      <RefreshCw className={`w-4 h-4 text-slate-700 ${pin.regenerating ? "animate-spin" : ""}`} />
                    </button>
                    {pin.image && (
                      <button onClick={() => downloadPin(pin)} className="grid place-items-center w-8 h-8 rounded-lg bg-white/90 hover:bg-white shadow" title="Descarca">
                        <Download className="w-4 h-4 text-slate-700" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="p-3 flex-1 flex flex-col gap-1">
                  {editingId === pin.id ? (
                    <>
                      <input value={pin.overlayText} onChange={(e) => updatePin(pin.id, "overlayText", e.target.value)}
                        className="text-xs font-bold border border-slate-300 rounded px-2 py-1" placeholder="Text pe imagine" />
                      <input value={pin.title} onChange={(e) => updatePin(pin.id, "title", e.target.value)}
                        className="text-sm font-bold border border-slate-300 rounded px-2 py-1" placeholder="Titlu" />
                      <textarea value={pin.description} onChange={(e) => updatePin(pin.id, "description", e.target.value)} rows={4}
                        className="text-[11px] border border-slate-300 rounded px-2 py-1" placeholder="Descriere" />
                      <button onClick={() => setEditingId(null)} className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: accent }}>
                        <Check className="w-3 h-3" /> Gata
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-1">
                        <h3 className="text-sm font-bold leading-snug line-clamp-2">{pin.title}</h3>
                        <button onClick={() => setEditingId(pin.id)} className="shrink-0 text-slate-400 hover:text-slate-700" title="Editeaza">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <p className="text-[11px] text-slate-500 line-clamp-2">{pin.description}</p>
                      {pin.ctrRationale && <p className="text-[10px] italic text-slate-400 line-clamp-2">CTR: {pin.ctrRationale}</p>}
                      {pin.boardSuggestion && (
                        <span className="mt-auto pt-2 text-[10px] font-semibold" style={{ color: accent }}>Board: {pin.boardSuggestion}</span>
                      )}
                    </>
                  )}
                </div>
              </article>
            ))}
          </section>
        )}

        {pins.length === 0 && !busy && (
          <div className="mt-16 text-center text-slate-400">
            <ImageIcon className="w-12 h-12 mx-auto mb-3" />
            <p>Alege o nisa si apasa „Genereaza". AI-ul gandeste intai strategia de click, apoi creeaza pinurile.</p>
          </div>
        )}
      </main>
    </div>
  );
}
