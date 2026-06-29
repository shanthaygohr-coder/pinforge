// ============================================================================
// PinForge Studio — aplicatie COMPLET FUNCTIONALA pentru Gemini Canvas
// (un singur fisier React, fara backend)
// ----------------------------------------------------------------------------
// Selectezi nisa -> "Genereaza" -> primesti N pinuri Pinterest:
//   * imagini cu NANO BANANA (gemini-2.5-flash-image), verticale 2:3
//   * copy non-generic optimizat CTR (hook + titlu + descriere + alt text)
//   * reguli de nisa (Fitness: listicle/infografic, fara before/after;
//     Finance/SaaS: cheat sheets & comparatii)
//   * regenerare per pin, editare titlu/descriere
//   * EXPORT: descarci fiecare imagine, toate odata, si un CSV cu tot copy-ul
//
// Cheia API Gemini este injectata automat de Canvas (apiKey = "").
// In afara Canvas, completeaza cheia in campul din UI.
// ============================================================================

import React, { useState, useCallback, useMemo } from "react";
import {
  Sparkles, Download, Loader2, AlertTriangle, Image as ImageIcon,
  Wand2, RefreshCw, FileDown, DownloadCloud, Pencil, Check,
} from "lucide-react";

const TEXT_MODEL = "gemini-2.5-flash";
const IMAGE_MODEL = "gemini-2.5-flash-image"; // Nano Banana
const API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models";

const NICHES = {
  HEALTH_FITNESS: {
    label: "Fitness & Sanatate",
    accent: "#16A34A",
    layouts: ["listicle numerotat", "infografic cu iconite"],
    bannedPatterns: "STRICT INTERZIS: imagini inainte/dupa (before/after), comparatii de greutate corporala.",
    visualStyle: "ilustratie vectoriala plata, energica, stil infografic curat",
    palette: "verde proaspat, albastru, alb",
    keywordHint: "rutina, slabit sanatos, energie, nutritie",
  },
  PERSONAL_FINANCE: {
    label: "Finante Personale",
    accent: "#1D4ED8",
    layouts: ["cheat sheet pe grila", "comparatie pe 2 coloane", "listicle numerotat"],
    bannedPatterns: "Fara promisiuni de castiguri garantate sau scheme de imbogatire rapida.",
    visualStyle: "infografic financiar modern, vizualizare de date, aspect de incredere",
    palette: "albastru inchis, verde bani, alb",
    keywordHint: "economisire, bugetare, investitii, venit pasiv",
  },
  B2B_SAAS: {
    label: "B2B SaaS",
    accent: "#6D28D9",
    layouts: ["comparatie pe 2 coloane", "cheat sheet pe grila", "listicle numerotat"],
    bannedPatterns: "Fara metrici fabricate sau testimoniale false.",
    visualStyle: "ilustratie de dashboard SaaS curata, isometric, profesional",
    palette: "violet, albastru, gri deschis",
    keywordHint: "productivitate, automatizare, ROI, integrare",
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

// Pas 1: N blueprint-uri distincte (copy + prompt imagine)
async function generateBlueprints({ apiKey, niche, brand, keyword, count }) {
  const n = NICHES[niche];
  const prompt = `Esti strateg de continut Pinterest expert in CTR ridicat si copywriting non-generic.
Nisa: ${n.label}. Brand/URL: ${brand || "(neprecizat)"}. Tema: ${keyword || n.keywordHint}.
Layout-uri permise: ${n.layouts.join(", ")}. ${n.bannedPatterns}

Genereaza EXACT ${count} concepte de pin DISTINCTE (unghiuri, hook-uri, layout-uri si palete diferite),
fiecare optimizat pentru CTR maxim (numere, curiosity gap, beneficiu clar, power words). Evita formularile generice.
Pentru fiecare: hook (idee scurta), title (max 100 car., benefit+actiune),
description (max 480 car., keyword in primul paragraf, se termina cu "#ad #affiliate"),
altText (descriptiv), imagePrompt (prompt DETALIAT pentru un generator de imagini: design vertical de pin 2:3,
titlu scurt randat ca text BOLD sans-serif, min 30% spatiu gol, layout din lista, paleta ${n.palette}, stil ${n.visualStyle};
text scurt si lizibil${niche === "HEALTH_FITNESS" ? "; FARA comparatii inainte/dupa sau corpuri" : ""}).`;

  const schema = {
    type: "ARRAY",
    items: {
      type: "OBJECT",
      properties: {
        hook: { type: "STRING" }, title: { type: "STRING" }, description: { type: "STRING" },
        altText: { type: "STRING" }, imagePrompt: { type: "STRING" },
      },
      required: ["hook", "title", "description", "altText", "imagePrompt"],
    },
  };

  const json = await fetchWithBackoff(`${API_ROOT}/${TEXT_MODEL}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 1.0 },
    }),
  });

  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]";
  let arr = JSON.parse(text);
  if (!Array.isArray(arr)) arr = [];
  return arr.slice(0, count);
}

// Pas 2: imaginea cu Nano Banana — cu fallback daca imageConfig nu e suportat
async function generateImage({ apiKey, imagePrompt, brand }) {
  const fullPrompt = `${imagePrompt}

Constrangeri stricte: orientare VERTICALA 2:3 (1000x1500 px), tipografie sans-serif GROASA (bold) lizibila,
minimum 30% spatiu gol (aerisit), URL brand "${brand || "brand.com"}" discret jos, calitate inalta, fara watermark.`;

  const url = `${API_ROOT}/${IMAGE_MODEL}:generateContent?key=${apiKey}`;
  const base = { contents: [{ role: "user", parts: [{ text: fullPrompt }] }] };
  // incearca pe rand; unele versiuni de API nu accepta imageConfig
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
  const [apiKey, setApiKey] = useState(""); // injectat de Canvas
  const [niche, setNiche] = useState("HEALTH_FITNESS");
  const [brand, setBrand] = useState("");
  const [keyword, setKeyword] = useState("");
  const [count, setCount] = useState(10);
  const [pins, setPins] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [editingId, setEditingId] = useState(null);

  const accent = NICHES[niche].accent;
  const readyPins = useMemo(() => pins.filter((p) => p.image), [pins]);

  const handleGenerate = useCallback(async () => {
    setError(""); setBusy(true); setPins([]); setProgress({ done: 0, total: count });
    try {
      const blueprints = await generateBlueprints({ apiKey, niche, brand, keyword, count });
      if (!blueprints.length) throw new Error("Nu am primit concepte. Reincearca.");

      // mix 80/20: ~fiecare al 5-lea pin = OFERTA
      const seeded = blueprints.map((b, i) => ({
        id: i, ...b, image: null, imgError: null,
        contentClass: (i + 1) % 5 === 0 ? "OFFER" : "EDUCATIONAL",
      }));
      setPins(seeded);
      setProgress({ done: 0, total: seeded.length });

      let completed = 0;
      await Promise.all(seeded.map(async (b) => {
        try {
          const image = await generateImage({ apiKey, imagePrompt: b.imagePrompt, brand });
          setPins((prev) => prev.map((p) => (p.id === b.id ? { ...p, image } : p)));
        } catch (e) {
          setPins((prev) => prev.map((p) => (p.id === b.id ? { ...p, imgError: e.message } : p)));
        } finally {
          completed++; setProgress({ done: completed, total: seeded.length });
        }
      }));
    } catch (e) {
      setError(e.message || "Eroare necunoscuta.");
    } finally { setBusy(false); }
  }, [apiKey, niche, brand, keyword, count]);

  const regeneratePin = useCallback(async (pin) => {
    setPins((prev) => prev.map((p) => (p.id === pin.id ? { ...p, image: null, imgError: null, regenerating: true } : p)));
    try {
      const image = await generateImage({ apiKey, imagePrompt: pin.imagePrompt + " (varianta noua, compozitie diferita)", brand });
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
    for (const p of readyPins) {
      downloadPin(p);
      await new Promise((r) => setTimeout(r, 350)); // mic delay ca browserul sa nu blocheze
    }
  }, [readyPins, downloadPin]);

  const exportCsv = useCallback(() => {
    const header = ["nr", "tip", "hook", "titlu", "descriere", "altText"].join(",");
    const rows = pins.map((p, i) =>
      [i + 1, p.contentClass, csvEscape(p.hook), csvEscape(p.title), csvEscape(p.description), csvEscape(p.altText)].join(",")
    );
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "pinforge-copy.csv"; a.click();
  }, [pins]);

  const updatePin = (id, field, value) =>
    setPins((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)));

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      <header className="border-b border-slate-200 bg-white sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-3">
          <div className="grid place-items-center w-10 h-10 rounded-xl" style={{ background: accent }}>
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight">PinForge Studio</h1>
            <p className="text-xs text-slate-500">Pinuri Pinterest optimizate CTR · Nano Banana · 100% in Canvas</p>
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

          <div className="mt-6 flex items-center gap-4">
            <button onClick={handleGenerate} disabled={busy}
              className="inline-flex items-center gap-2 rounded-xl px-6 py-3 font-bold text-white disabled:opacity-50 transition active:scale-95" style={{ background: accent }}>
              {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Wand2 className="w-5 h-5" />}
              {busy ? "Se genereaza..." : `Genereaza ${count} pinuri`}
            </button>
            {busy && progress.total > 0 && <span className="text-sm text-slate-500">Imagini: {progress.done}/{progress.total}</span>}
          </div>

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              <AlertTriangle className="w-5 h-5 shrink-0" /><span>{error}</span>
            </div>
          )}
        </section>

        {/* Bara de export */}
        {readyPins.length > 0 && (
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button onClick={downloadAll} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50">
              <DownloadCloud className="w-4 h-4" /> Descarca toate imaginile ({readyPins.length})
            </button>
            <button onClick={exportCsv} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50">
              <FileDown className="w-4 h-4" /> Export CSV (titluri + descrieri)
            </button>
          </div>
        )}

        {/* Galerie */}
        {pins.length > 0 && (
          <section className="mt-5 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-5">
            {pins.map((pin) => (
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
                      <input value={pin.title} onChange={(e) => updatePin(pin.id, "title", e.target.value)}
                        className="text-sm font-bold border border-slate-300 rounded px-2 py-1" />
                      <textarea value={pin.description} onChange={(e) => updatePin(pin.id, "description", e.target.value)} rows={4}
                        className="text-[11px] border border-slate-300 rounded px-2 py-1" />
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
                      <p className="text-[11px] text-slate-500 line-clamp-3">{pin.description}</p>
                      <span className="mt-auto pt-2 text-[10px] uppercase tracking-wide font-semibold" style={{ color: accent }}>{pin.hook}</span>
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
            <p>Alege o nisa si apasa „Genereaza".</p>
          </div>
        )}
      </main>
    </div>
  );
}
