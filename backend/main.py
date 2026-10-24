import pathlib
import pandas as pd
from functools import lru_cache
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from metrics import (load, at_cutoff, cutoff_forecasts, summarise, bias_adjusted, quality, file_meta,
                     DEFAULT_GATE, gate_utc)

app = FastAPI(title="Gridbricks")
ACT, FC = load()
ACT_IDX = ACT.set_index("startTime").actual
# delivery days with a Jan decision (D-1 in Jan) and actuals available
DAYS = [d.strftime("%Y-%m-%d") for d in pd.date_range("2026-01-02", "2026-02-01")]

def iso(s): return s.dt.strftime("%Y-%m-%dT%H:%M:%SZ")

def joined(fc):
    j = fc.join(ACT_IDX, on="startTime").dropna(subset=["actual"])
    j["err"] = j.forecast - j.actual
    return j

@lru_cache(maxsize=16)
def cutoff_joined(gate):
    return joined(cutoff_forecasts(FC, DAYS, gate))

def known_bias(day, gate):
    """Mean forecast error over delivery days <= D-2: everything the desk could know at the D-1 gate."""
    jc = cutoff_joined(gate)
    prior = jc[jc.day <= (pd.Timestamp(day) - pd.Timedelta(days=2)).strftime("%Y-%m-%d")]
    return (float(prior.err.mean()), int(prior.day.nunique())) if len(prior) else (0.0, 0)

def check(day, gate):
    if day not in DAYS: raise HTTPException(404, "day not in Jan-2026 decision window")
    try: gate_utc(day, gate)
    except ValueError: raise HTTPException(422, "gate must be HH:MM (UK time on D-1)")

@app.get("/api/days")
def days(): return {"days": DAYS, "default_gate_uk": DEFAULT_GATE}

@app.get("/api/meta")
def meta(): return {"decision_window": [DAYS[0], DAYS[-1]], "default_gate_uk": DEFAULT_GATE, "snapshot": file_meta()}

@app.get("/api/quality")
def data_quality():
    exp = pd.date_range("2026-01-01", "2026-02-01 23:30", freq="30min", tz="UTC")
    return quality(ACT, FC, exp)

@app.get("/api/decision/{day}")
def decision(day: str, gate: str = DEFAULT_GATE):
    check(day, gate)
    f, cutoff = at_cutoff(FC, day, gate)
    j = joined(f)
    rows = ACT[ACT.startTime.dt.strftime("%Y-%m-%d") == day]
    out = rows.assign(startTime=iso(rows.startTime)).to_dict("records")
    fmap = dict(zip(iso(f.startTime), f.forecast))
    pmap = dict(zip(iso(f.startTime), iso(f.publishTime)))
    for r in out:
        r["forecast"] = fmap.get(r["startTime"]); r["publishTime"] = pmap.get(r["startTime"])
    bias, bias_days = known_bias(day, gate)
    for r in out:
        if r["forecast"] is not None: r["adjusted"] = r["forecast"] - bias
    return {"day": day, "cutoff": cutoff.strftime("%Y-%m-%dT%H:%MZ"), "gate_uk": gate, "rows": out,
            "known_bias_mw": bias, "known_bias_days": bias_days,
            "day_stats": summarise(j.err, j.actual) if len(j) else None}

@app.get("/api/export/{day}")
def export(day: str, gate: str = DEFAULT_GATE):
    """CSV of the forecast the desk would have used for `day`, to drop into their own tools."""
    check(day, gate)
    f, cutoff = at_cutoff(FC, day, gate)
    f = f.assign(gate_utc=cutoff.strftime("%Y-%m-%dT%H:%MZ"), startTime=iso(f.startTime), publishTime=iso(f.publishTime))
    return Response(f[["startTime", "forecast", "publishTime", "gate_utc"]].to_csv(index=False), media_type="text/csv")

@app.get("/api/evolution/{day}")
def evolution(day: str, gate: str = DEFAULT_GATE):
    """How the forecast for `day` moved from run to run, flagged by whether it was known at the gate."""
    check(day, gate)
    cutoff = gate_utc(day, gate)
    d = FC[FC.startTime.dt.normalize() == pd.Timestamp(day, tz="UTC")]
    runs = d.groupby("publishTime").forecast.agg(["mean", "count"]).reset_index()
    return {"day": day, "gate": cutoff.strftime("%Y-%m-%dT%H:%MZ"),
            "actual_mean": ACT_IDX[ACT_IDX.index.normalize() == pd.Timestamp(day, tz="UTC")].mean(),
            "runs": [{"publishTime": r.publishTime.strftime("%Y-%m-%dT%H:%MZ"), "mean_mw": r["mean"], "hours": int(r["count"]),
                      "known_at_gate": bool(r.publishTime <= cutoff)} for _, r in runs.iterrows()]}

@app.get("/api/accuracy")
def accuracy(gate: str = DEFAULT_GATE):
    check(DAYS[0], gate)
    j = cutoff_joined(gate)
    adj = bias_adjusted(j)
    by_hour = j.groupby(j.startTime.dt.hour).err.apply(lambda e: e.abs().mean()).round(1)
    by_day = [{"day": d, "mae": round(float(g.err.abs().mean()), 1), "bias": round(float(g.err.mean()), 1)} for d, g in j.groupby("day")]
    # all published forecasts, by lead time (hours between publishTime and target)
    a = joined(FC[FC.startTime >= "2026-01-01"])
    a["lead"] = (a.startTime - a.publishTime).dt.total_seconds() / 3600
    a = a[a.lead >= 0]
    a["bucket"] = (a.lead // 6 * 6).astype(int)
    by_lead = a.groupby("bucket").err.apply(lambda e: e.abs().mean()).round(1)
    hist = pd.cut(j.err, bins=range(-8000, 8001, 1000)).value_counts().sort_index()
    return {"gate_uk": gate, "overall": summarise(j.err, j.actual),
            "bias_adjusted": summarise(adj.err, adj.actual) if len(adj) else None,
            "by_hour": by_hour.to_dict(), "by_day": by_day, "share_over_pct": round(float((j.err > 0).mean() * 100), 1),
            "by_lead": by_lead.to_dict(), "hist": [{"bin": int(b.left), "count": int(c)} for b, c in hist.items()]}

static = pathlib.Path(__file__).parent / "static"
if static.exists(): app.mount("/", StaticFiles(directory=static, html=True))
