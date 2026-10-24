import pandas as pd
from metrics import at_cutoff, summarise, bias_adjusted

def test_latest_forecast_before_cutoff():
    t = lambda s: pd.Timestamp(s, tz="UTC")
    fc = pd.DataFrame({"startTime": [t("2026-01-15 12:00")] * 3,
                       "publishTime": [t("2026-01-13 02:00"), t("2026-01-14 09:00"), t("2026-01-14 10:00")],
                       "forecast": [1, 2, 3]})
    f, _ = at_cutoff(fc, "2026-01-15")
    assert f.forecast.tolist() == [2]  # 10:00 is after the 09:20 gate, 09:00 is the latest usable

def test_summarise():
    s = summarise(pd.Series([-1.0, 1.0, 3.0]))
    assert s["mae"] == 5 / 3 and s["bias"] == 1.0

def test_gate_is_uk_local_time():
    from metrics import gate_utc
    assert gate_utc("2026-07-02", "09:20") == pd.Timestamp("2026-07-01 08:20", tz="UTC")  # BST = UTC+1

def test_bias_adjusted_uses_only_past_days():
    j = pd.DataFrame({"day": ["2026-01-02", "2026-01-03", "2026-01-04"], "err": [10.0, 99.0, 30.0], "actual": [1.0] * 3})
    a = bias_adjusted(j)
    assert a.day.tolist() == ["2026-01-04"] and a.err.tolist() == [20.0]  # only Jan 2 (<= D-2) is known: 30 - 10
