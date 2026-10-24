"""One-off: pull Jan 2026 wind actuals + forecasts from Elexon into data/*.json."""
import json, datetime as dt, httpx

B = "https://data.elexon.co.uk/bmrs/api/v1/datasets"
D = dt.date.fromisoformat
def days(a, b, step):
    d = D(a)
    while d < D(b):
        yield d, min(d + dt.timedelta(step), D(b)); d += dt.timedelta(step)

def get(url, **p):
    r = httpx.get(url, params=p, timeout=120); r.raise_for_status(); return r.json()

# actuals for target days in Jan 2026
act = []
for a, b in days("2026-01-01", "2026-02-02", 7):
    act += get(f"{B}/FUELHH/stream", settlementDateFrom=a, settlementDateTo=b - dt.timedelta(1), fuelType="WIND")
act = sorted({r["startTime"]: {"startTime": r["startTime"], "generation": r["generation"]} for r in act}.values(), key=lambda r: r["startTime"])

# forecasts published 3 days before Jan through end of Jan (decisions in Jan are on D-1 for delivery days Jan 2.. Feb 1)
fc = []
for a, b in days("2025-12-29", "2026-02-01", 2):
    fc += get(f"{B}/WINDFOR/stream", publishDateTimeFrom=f"{a}T00:00Z", publishDateTimeTo=f"{b}T00:00Z")
fc = [{k: r[k] for k in ("startTime", "publishTime", "generation")} for r in fc]

json.dump(act, open("data/actuals.json", "w")); json.dump(fc, open("data/forecasts.json", "w"))
print(len(act), "actuals", len(fc), "forecasts", act[0]["startTime"], act[-1]["startTime"])
