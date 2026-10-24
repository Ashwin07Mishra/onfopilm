import hashlib, pathlib
import pandas as pd

DATA = pathlib.Path(__file__).parent.parent / "data"
# Day-ahead gate on D-1, UK local time. 09:20 = EPEX SPOT GB hourly auction gate closure;
# "00:00" = literal reading of the brief ("one day before the delivery day"). Overridable per request.
DEFAULT_GATE = "09:20"

def load():
    act = pd.read_json(DATA / "actuals.json", convert_dates=["startTime"]).rename(columns={"generation": "actual"})
    fc = pd.read_json(DATA / "forecasts.json", convert_dates=["startTime", "publishTime"]).rename(columns={"generation": "forecast"})
    return act, fc

def gate_utc(day, gate=DEFAULT_GATE):
    d = pd.Timestamp(day) - pd.Timedelta(days=1)
    return pd.Timestamp(f"{d:%Y-%m-%d} {gate}", tz="Europe/London").tz_convert("UTC")

def at_cutoff(fc, day, gate=DEFAULT_GATE):
    """Latest forecast per target hour of `day`, among forecasts published by the D-1 gate."""
    cutoff = gate_utc(day, gate)
    d = fc[(fc.startTime.dt.normalize() == pd.Timestamp(day, tz="UTC")) & (fc.publishTime <= cutoff)]
    return d.sort_values("publishTime").groupby("startTime", as_index=False).last(), cutoff

def cutoff_forecasts(fc, days, gate=DEFAULT_GATE):
    return pd.concat([at_cutoff(fc, d, gate)[0].assign(day=d) for d in days], ignore_index=True)

def summarise(e, actual=None):
    """e: forecast - actual (MW). Positive = over-forecast (less thermal bought than needed)."""
    s = {"n": int(len(e)), "mae": e.abs().mean(), "rmse": (e ** 2).mean() ** .5, "bias": e.mean(),
         "p10": e.quantile(.1), "p50": e.quantile(.5), "p90": e.quantile(.9),
         "abs_p90": e.abs().quantile(.9), "abs_p99": e.abs().quantile(.99), "max_abs": e.abs().max()}
    if actual is not None: s["wape_pct"] = 100 * e.abs().sum() / actual.sum()
    return {k: (v if k == "n" else float(v)) for k, v in s.items()}

def bias_adjusted(j):
    """Subtract the mean error of delivery days <= D-2 (all that is knowable at D-1 gate). Days without history are dropped."""
    days = sorted(j.day.unique())
    out = []
    for d in days:
        prior = j[j.day <= (pd.Timestamp(d) - pd.Timedelta(days=2)).strftime("%Y-%m-%d")]
        if prior.empty: continue
        out.append(j[j.day == d].assign(err=lambda x: x.err - prior.err.mean()))
    return pd.concat(out) if out else j.iloc[0:0]

def quality(act, fc, expected_actuals):
    present = set(act.startTime)
    missing = [t.strftime("%Y-%m-%dT%H:%MZ") for t in expected_actuals if t not in present]
    runs = fc.publishTime.drop_duplicates()
    slots = runs.dt.strftime("%H:%M").value_counts()
    schedule = sorted(slots[slots >= 5].index)  # data-driven: slots used regularly
    off = runs[~runs.dt.strftime("%H:%M").isin(schedule)]
    return {"actual_expected": len(expected_actuals), "actual_present": len(expected_actuals) - len(missing),
            "missing_actuals": missing[:20], "forecast_runs": int(len(runs)), "forecast_points": int(len(fc)),
            "forecast_after_target": int((fc.publishTime > fc.startTime).sum()),  # published after delivery: unusable
            "run_schedule_utc": schedule, "off_schedule_runs": off.dt.strftime("%Y-%m-%dT%H:%MZ").tolist()}

def file_meta():
    return [{"file": p.name, "rows": len(pd.read_json(p)), "sha256": hashlib.sha256(p.read_bytes()).hexdigest()[:16],
             "pulled_at": pd.Timestamp(p.stat().st_mtime, unit="s").strftime("%Y-%m-%dT%H:%MZ")}
            for p in sorted(DATA.glob("*.json"))] + [{"source": "Elexon BMRS FUELHH (WIND), WINDFOR"}]
