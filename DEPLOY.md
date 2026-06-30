# PinForge — Deploy gratuit (fara cod)

Buton rapid (instaleaza serverul pe Render, citeste `render.yaml`):

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/shanthaygohr-coder/pinforge)

## Cei 4 pasi (≈30 min, doar clicuri si copy-paste)

1. **Baza de date (Supabase, gratis):** creezi un proiect → copiezi „Connection string" (URI) → asta e `DATABASE_URL`.
2. **Serverul (Render, gratis):** apesi butonul de mai sus → lipesti `DATABASE_URL` → primesti un URL public (ex. `https://pinforge-autopilot.onrender.com`).
3. **Aplicatia Pinterest (gratis):** pe developers.pinterest.com creezi un app → iei `CLIENT_ID` + `CLIENT_SECRET` → la Redirect URI pui `https://URL-UL-TAU/pinterest/callback` → pui cele 3 valori in Render.
4. **Cron (cron-job.org, gratis):** job nou care apeleaza `https://URL-UL-TAU/cron/publish-due?key=CRON_SECRET` la fiecare 10 minute.

Gata: in aplicatia Canvas pui URL-ul serverului, apesi „Connect Pinterest", generezi pinuri, apesi „Publish" — restul e automat.
