# Gridbricks: GB day-ahead wind forecast portal

A web app for a UK energy supplier's day-ahead buying desk. It shows (1) the latest national wind forecast that was available at the moment a decision had to be made, and (2) how accurate those forecasts have been, in plain English and in numbers. Data: Elexon BMRS only (FUELHH actual wind, WINDFOR forecast wind). Decisions made in **January 2026** (delivery days 2 Jan to 1 Feb).

**Live app:** https://gridbricks-snowy.vercel.app

## What you can do in the app
- **Plan a day:** pick a delivery day and a deadline; read the forecast you would have had, a cautious (bias-adjusted) planning figure, what actually happened, how the forecast changed between updates, and download the forecast as CSV.
- **How accurate?:** average miss, lean (too high / too low), "9 in 10 hours within", plus day, hour-of-day, lead-time and error-size charts. Click a day to jump to it.
- **How it works:** data, method, glossary, data-quality checks.

## Files and directories
```
backend/
  main.py           FastAPI app: API routes, serves the built front end
  metrics.py        core logic: gate time, "latest forecast before the gate", error stats, bias adjustment, data checks
  fetch_data.py     one-off script that pulls Jan 2026 data from Elexon into data/
  test_metrics.py   pytest checks of the core logic
  requirements.txt  Python dependencies
frontend/           Vite + React + Recharts (src/App.jsx has all three pages, src/style.css the styling)
data/               JSON snapshot of the Elexon data (actuals.json, forecasts.json), so the app never calls Elexon at runtime
app.py              Vercel entry point (imports backend/main.py)
public/             pre-built front end served by Vercel
Dockerfile, docker-compose.yml, vercel.json, requirements.txt
```

## Start the application
With Docker (recommended):
```
docker compose up --build        # open http://localhost:8000
```
Without Docker:
```
python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt pytest
(cd frontend && npm ci && npx vite build --outDir ../backend/static)
cd backend && ../.venv/bin/uvicorn main:app --port 8000
../.venv/bin/pytest              # run the tests (from backend/)
```
Front-end dev with hot reload: `cd frontend && npm run dev` (proxies /api to port 8000).
Refresh the data snapshot: `python backend/fetch_data.py`.

## Method and assumptions
- **Deadline (gate):** default 09:20 UK time on the day before delivery (GB day-ahead auction gate closure). The brief only says "one day before the delivery day", so this is selectable in the app and via `?gate=HH:MM` (`00:00` is the strictest reading).
- For every delivery hour we use the **latest WINDFOR forecast published at or before the gate**, matched to the on-the-hour FUELHH actual. Error = forecast - actual (positive = forecast too high).
- **Cautious figure:** forecast minus the average error of delivery days up to D-2 (the only days fully known at the gate). No look-ahead.
- Scope is national wind only; demand and other generation are not modelled, so this supports but does not replace the buying decision.

## API
`GET /api/days`, `/api/decision/{day}?gate=`, `/api/export/{day}?gate=` (CSV), `/api/evolution/{day}?gate=`, `/api/accuracy?gate=`, `/api/quality`, `/api/meta`. Interactive docs at `/docs` when running locally.

## AI use
AI tools were used to assist with development (code, structure and copy). All figures come from the Elexon data and were checked against it.
