import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, ComposedChart, LineChart, BarChart, Bar, Line, Area, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, Cell } from "recharts";

const get = (u) => fetch(u).then((r) => r.json());
const gw = (v, d = 1) => (v / 1000).toFixed(d) + " GW";
const mw = (v) => Math.round(v).toLocaleString() + " MW";
const dayName = (iso, long) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: long ? "long" : "short", day: "numeric", month: "short", timeZone: "UTC" });
const prevDay = (iso) => new Date(Date.parse(iso + "T12:00:00Z") - 864e5).toISOString().slice(0, 10);
const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const GATES = [["09:20", "09:20 UK (day-ahead auction close)"], ["00:00", "00:00 UK (start of the day before)"]];
const tip = { contentStyle: { background: "var(--card)", border: "1px solid var(--line)", borderRadius: 8 } };
const axis = { stroke: "var(--mut)", fontSize: 13 };
const yGW = { ...axis, width: 74, tickFormatter: (v) => +(v / 1000).toFixed(1) + " GW" };
const still = { isAnimationActive: false };

const Chart = ({ h = 280, children }) => <div style={{ height: h }}><ResponsiveContainer>{children}</ResponsiveContainer></div>;
const Stat = ({ v, label, note }) => <div className="stat"><span>{label}</span><b>{v}</b>{note && <small>{note}</small>}</div>;
const Banner = ({ headline, stats }) => <section className="banner"><div><small>Key takeaway</small><h2>{headline}</h2></div>
  <div className="bstats">{stats.map(([v, l]) => <div key={l}><b>{v}</b><span>{l}</span></div>)}</div></section>;
const Card = ({ title, sub, children }) => <section className="panel"><h2>{title}</h2>{sub && <p className="sub">{sub}</p>}{children}</section>;

function GateSelect({ gate, setGate }) {
  return <label className="field">Decision deadline
    <select value={gate} onChange={(e) => setGate(e.target.value)}>{GATES.map(([g, l]) => <option key={g} value={g}>{l}</option>)}</select></label>;
}

/* ---------- Forecast ---------- */
function Forecast({ days, gate, setGate, day, setDay, acc, tl }) {
  const [d, setD] = useState(null), [ev, setEv] = useState(null);
  useEffect(() => { get(`/api/decision/${day}?gate=${gate}`).then(setD); get(`/api/evolution/${day}?gate=${gate}`).then(setEv); }, [day, gate]);
  const i = days.indexOf(day), o = acc.overall;
  const rows = useMemo(() => d && d.rows.filter((r) => r.startTime.endsWith(":00:00Z") && r.forecast != null).map((r) => ({
    t: r.startTime.slice(11, 16), forecast: r.forecast, actual: r.actual,
    band: [Math.max(0, r.forecast - o.p90), Math.max(0, r.forecast - o.p10)],
  })), [d, o]);
  const known = ev ? ev.runs.filter((r) => r.known_at_gate) : [];
  const last = known[known.length - 1];
  const fmtRun = (s) => new Date(s.replace("Z", ":00Z")).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  const errs = rows ? rows.map((r) => ({ t: r.t, e: r.forecast - r.actual })) : [];
  const meanA = rows ? avg(rows.map((r) => r.actual)) : 0, bias = errs.length ? avg(errs.map((x) => x.e)) : 0;
  const worst = errs.length ? errs.reduce((a, x) => (Math.abs(x.e) > Math.abs(a.e) ? x : a)) : null;
  const dayHeadline = d && rows ? (Math.abs(bias) < 0.02 * meanA ? "The forecast available at the deadline was close to actual wind on this day."
    : bias > 0 ? `The forecast overstated wind by ${gw(bias)} (${(100 * bias / meanA).toFixed(0)}%) on this day, which would have meant buying too little backup power.`
      : `The forecast understated wind by ${gw(-bias)} (${(100 * -bias / meanA).toFixed(0)}%) on this day, which would have meant buying more backup power than needed.`) : "";
  const dayStats = d && rows ? [[`${errs.filter((x) => x.e > 0).length} of ${errs.length}`, "hours forecast above actual"], [gw(d.day_stats.mae), `average error (${d.day_stats.mae > o.mae ? "above" : "below"} the ${gw(o.mae)} January average)`], [worst ? gw(Math.abs(worst.e)) : "-", `largest hourly miss${worst ? ` (${worst.t})` : ""}`]] : [];
  const lo = rows && rows.reduce((a, r) => (r.forecast < a.forecast ? r : a)), hi = rows && rows.reduce((a, r) => (r.forecast > a.forecast ? r : a));

  return (<>
    <h1>Wind forecast at decision time</h1>
    <p className="lead">GB national wind generation, forecast versus actual, for each delivery day of January 2026.</p>

    <Card title="January timeline" sub="Daily average wind per delivery day. Select a day on the chart to inspect it.">
      <Chart h={240}><ComposedChart data={tl} onClick={(e) => e && e.activeLabel && setDay(e.activeLabel)} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} style={{ cursor: "pointer" }}>
        <CartesianGrid stroke="var(--line)" vertical={false} /><XAxis dataKey="day" {...axis} tickFormatter={(x) => +x.slice(8)} interval={1} /><YAxis {...yGW} />
        <Tooltip {...tip} labelFormatter={(x) => dayName(x, true)} formatter={(v, n) => [mw(v), n]} />
        <Line dataKey="forecast" name="Forecast at deadline" stroke="var(--fc)" strokeWidth={2.5} dot={{ r: 3 }} {...still} />
        <Line dataKey="actual" name="Actual" stroke="var(--act)" strokeWidth={2.5} dot={{ r: 3 }} {...still} />
        <ReferenceLine x={day} stroke="var(--fg)" strokeDasharray="3 3" />
      </ComposedChart></Chart>
      <div className="legend"><span><i style={{ background: "var(--fc)" }} />Forecast available at the deadline</span><span><i style={{ background: "var(--act)" }} />Actual</span></div>
    </Card>

    <Card title={dayName(day, true)}>
      <div className="toolbar">
        <div className="seg"><button disabled={i <= 0} onClick={() => setDay(days[i - 1])} aria-label="Previous day"><Chev dir="l" /></button>
          <button disabled={i >= days.length - 1} onClick={() => setDay(days[i + 1])} aria-label="Next day"><Chev dir="r" /></button></div>
        <GateSelect gate={gate} setGate={setGate} />
      </div>
      {!d || !rows ? <p className="sub">Loading</p> : <>
        <p className="sub" style={{ marginTop: 12 }}>Forecast shown is the latest published before {gate} UK on {dayName(prevDay(day), true)}{last ? ` (issued ${fmtRun(last.publishTime)} UTC)` : ""}. Average {gw(avg(rows.map((r) => r.forecast)))}, from {gw(lo.forecast)} at {lo.t} to {gw(hi.forecast)} at {hi.t}.</p>
        <Banner headline={dayHeadline} stats={dayStats} />
        <div className="strip">
          <Stat v={gw(avg(rows.map((r) => r.forecast)))} label="Forecast average" />
          <Stat v={gw(avg(rows.map((r) => r.actual)))} label="Actual average" />
          <Stat v={gw(d.day_stats.mae)} label="Average error this day" note={`January average: ${gw(o.mae)}`} />
          <Stat v={(d.day_stats.bias > 0 ? "+" : "") + gw(d.day_stats.bias)} label="Bias this day" note={d.day_stats.bias > 0 ? "forecast above actual" : "forecast below actual"} />
        </div>
        <Chart h={300}><ComposedChart data={rows} margin={{ top: 14, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--line)" /><XAxis dataKey="t" {...axis} interval={2} /><YAxis {...yGW} domain={[0, "auto"]} />
          <Tooltip {...tip} formatter={(v, n) => [Array.isArray(v) ? `${mw(v[0])} to ${mw(v[1])}` : mw(v), n]} />
          <Area dataKey="band" name="Expected range" stroke="none" fill="var(--fc)" fillOpacity={0.14} {...still} />
          <Line dataKey="forecast" name="Forecast" stroke="var(--fc)" strokeWidth={3} dot={false} {...still} />
          <Line dataKey="actual" name="Actual" stroke="var(--act)" strokeWidth={3} dot={false} {...still} />
        </ComposedChart></Chart>
        <div className="legend"><span><i style={{ background: "var(--fc)" }} />Forecast</span><span><i style={{ background: "var(--act)" }} />Actual</span><span>Shaded: range containing 80% of January's forecast errors, applied to this forecast</span></div>
      </>}
    </Card>

    {ev && <Card title="Forecast updates for this day" sub={`Each point is one forecast run, showing its average for ${dayName(day)}. Runs after the deadline were not available for the decision.`}>
      <Chart h={240}><LineChart data={ev.runs.map((r) => ({ t: fmtRun(r.publishTime), mw: r.mean_mw, known: r.known_at_gate ? r.mean_mw : null }))} margin={{ top: 14, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="var(--line)" /><XAxis dataKey="t" {...axis} interval="preserveStartEnd" minTickGap={40} /><YAxis {...yGW} domain={["auto", "auto"]} />
        <Tooltip {...tip} formatter={(v, n) => [mw(v), n]} />
        <Line dataKey="mw" name="After deadline" stroke="var(--bar)" strokeDasharray="4 4" dot={{ r: 3, fill: "var(--panel)", stroke: "var(--bar)" }} {...still} />
        <Line dataKey="known" name="Available at deadline" stroke="var(--fc)" strokeWidth={3} dot={{ r: 4 }} {...still} />
        <ReferenceLine y={ev.actual_mean} stroke="var(--act)" strokeWidth={2} label={{ value: "Actual", fill: "var(--act)", position: "insideTopRight" }} />
        {last && <ReferenceLine x={fmtRun(last.publishTime)} stroke="var(--fg)" strokeDasharray="2 3" label={{ value: "Deadline", fill: "var(--fg)", position: "insideTopRight", fontSize: 12 }} />}
      </LineChart></Chart>
      {known.length > 1 && <p className="how">Between the first and last run available at the deadline, the day's average forecast moved from {gw(known[0].mean_mw)} to {gw(last.mean_mw)}.</p>}
    </Card>}
  </>);
}

/* ---------- Accuracy ---------- */
function Accuracy({ gate, setGate, acc, openDay }) {
  const o = acc.overall, bd = acc.by_day, daysOver = bd.filter((b) => b.bias > 0).length, meanActual = o.mae / (o.wape_pct / 100);
  const sorted = [...bd].sort((a, b) => b.mae - a.mae), worst = sorted.slice(0, 3), best = sorted[sorted.length - 1];
  const hrs = Object.entries(acc.by_hour), hMax = hrs.reduce((a, b) => (b[1] > a[1] ? b : a)), hMin = hrs.reduce((a, b) => (b[1] < a[1] ? b : a));
  const hh = (h) => String(h).padStart(2, "0") + ":00";
  const lead = Object.entries(acc.by_lead).map(([k, v]) => [+k, v]), l0 = lead[0], lN = lead[lead.length - 1];
  const hist = acc.hist.map((b) => ({ ...b, label: `${b.bin / 1000}` }));
  return (<>
    <h1>Forecast accuracy</h1>
    <p className="lead">Forecast available at the decision deadline compared with actual generation, for every delivery day in the window.</p>
    <div className="toolbar" style={{ marginTop: 0, marginBottom: 16 }}><GateSelect gate={gate} setGate={setGate} /></div>

    <Banner headline={`Across January the forecast available at the deadline overstated wind by ${(100 * o.bias / meanActual).toFixed(0)}%, about ${Math.round(o.bias * o.n / 1000).toLocaleString()} GWh that never arrived.`}
      stats={[[`${daysOver} of ${bd.length}`, "delivery days forecast above actual"], [`${o.wape_pct.toFixed(0)}%`, "average error as a share of output"], [gw(o.abs_p90), "9 in 10 hours are within this error"]]} />
    <div className="strip">
      <Stat v={gw(o.mae)} label="Average error" note={`${o.wape_pct.toFixed(0)}% of actual output`} />
      <Stat v={(o.bias > 0 ? "+" : "") + gw(o.bias)} label="Bias" note={o.bias > 0 ? "forecast above actual: less backup power than needed would be bought" : "forecast below actual: more backup power than needed would be bought"} />
      <Stat v={gw(o.abs_p90)} label="90th percentile error" note="9 in 10 hours are within this" />
      <Stat v={o.n.toLocaleString()} label="Hours compared" note={`worst single hour ${gw(o.max_abs)}`} />
    </div>

    <Card title="Observations">
      <ul className="obs">
        <li>The forecast was above actual in {acc.share_over_pct.toFixed(0)}% of hours. Over-forecasting wind means less backup power would be bought than needed.</li>
        <li>Largest daily errors: {worst.map((w) => `${dayName(w.day)} (${gw(w.mae)})`).join(", ")}. Smallest: {dayName(best.day)} ({gw(best.mae)}).</li>
        <li>Error by hour: highest at {hh(hMax[0])} ({gw(hMax[1])}), lowest at {hh(hMin[0])} ({gw(hMin[1])}).</li>
        {l0 && lN && l0[1] !== lN[1] && <li>Forecasts issued {l0[0]} to {l0[0] + 6} hours before delivery had an average error of {gw(l0[1])}; those issued {lN[0]} to {lN[0] + 6} hours before had {gw(lN[1])}.</li>}
      </ul>
    </Card>

    <Card title="Error by day" sub="Average absolute error per delivery day. Select a bar to open that day.">
      <Chart><BarChart data={bd} margin={{ left: 0, right: 8 }} style={{ cursor: "pointer" }}><CartesianGrid stroke="var(--line)" vertical={false} /><XAxis dataKey="day" {...axis} tickFormatter={(x) => +x.slice(8)} interval={1} /><YAxis {...yGW} />
        <Tooltip {...tip} labelFormatter={(x) => dayName(x, true)} formatter={(v, n, p) => [`${mw(v)} (${p.payload.bias > 0 ? "forecast above actual" : "forecast below actual"} by ${mw(Math.abs(p.payload.bias))} on average)`, "Average error"]} />
        <Bar dataKey="mae" onClick={(p) => openDay(p.day)} {...still}>{bd.map((b) => <Cell key={b.day} fill={b.bias > 0 ? "var(--fc)" : "var(--act)"} />)}</Bar></BarChart></Chart>
      <div className="legend"><span><i style={{ background: "var(--fc)" }} />Forecast above actual on average</span><span><i style={{ background: "var(--act)" }} />Forecast below actual on average</span></div>
    </Card>

    <Card title="Error by hour of day" sub="Average absolute error across all days.">
      <Chart h={240}><BarChart data={hrs.map(([h, v]) => ({ h: hh(h), v }))} margin={{ left: 0, right: 8 }}><CartesianGrid stroke="var(--line)" vertical={false} /><XAxis dataKey="h" {...axis} interval={2} /><YAxis {...yGW} /><Tooltip {...tip} formatter={(v) => [mw(v), "Average error"]} /><Bar dataKey="v" fill="var(--bar)" {...still} /></BarChart></Chart>
    </Card>

    <Card title="Error by forecast lead time" sub="Average absolute error of every forecast run, grouped by hours between publication and delivery.">
      <Chart h={240}><BarChart data={lead.map(([k, v]) => ({ k: `${k}-${k + 6}h`, v }))} margin={{ left: 0, right: 8 }}><CartesianGrid stroke="var(--line)" vertical={false} /><XAxis dataKey="k" {...axis} /><YAxis {...yGW} /><Tooltip {...tip} formatter={(v) => [mw(v), "Average error"]} /><Bar dataKey="v" fill="var(--bar)" {...still} /></BarChart></Chart>
    </Card>

    <Card title="Distribution of errors" sub="Hours per error size, in GW (forecast minus actual). Right of zero: forecast above actual.">
      <Chart h={240}><BarChart data={hist} margin={{ left: 0, right: 8 }}><CartesianGrid stroke="var(--line)" vertical={false} /><XAxis dataKey="label" {...axis} /><YAxis {...axis} width={40} /><Tooltip {...tip} labelFormatter={(x) => `Error from ${x} GW`} formatter={(v) => [v + " hours", "Count"]} />
        <Bar dataKey="count" {...still}>{hist.map((b) => <Cell key={b.bin} fill={b.bin >= 0 ? "var(--fc)" : "var(--act)"} />)}</Bar></BarChart></Chart>
    </Card>
  </>);
}

/* ---------- About ---------- */
function About({ q }) {
  return (<>
    <h1>About this analysis</h1>
    <Card title="Purpose">
      <p>Day-ahead electricity for GB is bought the day before delivery, so wind generation has to be taken from forecasts. This portal shows the wind forecast that was available at the decision deadline, and measures how far such forecasts were from actual generation.</p>
    </Card>
    <Card title="Data">
      <dl>
        <dt>Actual generation</dt><dd>Elexon FUELHH, fuel type WIND. National output every 30 minutes (startTime, generation).</dd>
        <dt>Forecast generation</dt><dd>Elexon WINDFOR. Hourly forecasts with startTime (target hour), publishTime (when the forecast was made) and generation.</dd>
        <dt>Scope</dt><dd>National wind only. Delivery days 2 January to 1 February 2026, i.e. decisions made in January 2026.</dd>
      </dl>
    </Card>
    <Card title="Method">
      <ol>
        <li>The decision deadline is set on the day before delivery (default 09:20 UK time, the GB day-ahead auction close).</li>
        <li>For each delivery hour, the latest forecast published at or before the deadline is selected.</li>
        <li>It is compared with the actual generation for the same hour. Error = forecast minus actual.</li>
        <li>Errors are summarised overall, by day, by hour of day and by forecast lead time.</li>
      </ol>
    </Card>
    <Card title="Terms">
      <dl>
        <dt>MW, GW</dt><dd>Units of power. 1 GW = 1,000 MW.</dd>
        <dt>Average error</dt><dd>Mean of the absolute errors (MAE).</dd>
        <dt>Bias</dt><dd>Mean of the signed errors. Positive: forecast above actual.</dd>
        <dt>90th percentile error</dt><dd>Absolute error that 9 in 10 hours stay within.</dd>
        <dt>Expected range</dt><dd>Band between the 10th and 90th percentile of January's errors, applied around a forecast.</dd>
      </dl>
    </Card>
    {q && <Card title="Data checks">
      <p>{q.actual_present.toLocaleString()} of {q.actual_expected.toLocaleString()} expected half-hourly actuals present. {q.forecast_runs} forecast runs loaded ({q.forecast_points.toLocaleString()} points); {q.forecast_after_target.toLocaleString()} points were published after the hour they describe and are never selected.{q.off_schedule_runs.length ? ` Off-schedule run(s): ${q.off_schedule_runs.join(", ")}; selection uses real publish times.` : ""}</p>
    </Card>}
  </>);
}

const Chev = ({ dir }) => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={dir === "l" ? "M10 3 5 8l5 5" : "M6 3l5 5-5 5"} /></svg>;
const Sun = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>;
const Moon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></svg>;
const sys = () => (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
function useTheme() {
  const [t, setT] = useState(() => { try { return localStorage.getItem("theme") || sys(); } catch { return sys(); } });
  useEffect(() => { document.documentElement.dataset.theme = t; try { localStorage.setItem("theme", t); } catch {} }, [t]);
  return [t, () => setT(t === "dark" ? "light" : "dark")];
}

export default function App() {
  const [theme, flip] = useTheme();
  const [tab, setTab] = useState("fc"), [gate, setGate] = useState("09:20"), [days, setDays] = useState(), [day, setDay] = useState();
  const [acc, setAcc] = useState(), [tl, setTl] = useState(), [q, setQ] = useState();
  useEffect(() => { get("/api/days").then((d) => { setDays(d.days); setDay(d.days[14]); }); get("/api/quality").then(setQ); }, []);
  useEffect(() => { get(`/api/accuracy?gate=${gate}`).then(setAcc); get(`/api/timeline?gate=${gate}`).then(setTl); }, [gate]);
  const nav = [["fc", "Forecast"], ["acc", "Accuracy"], ["about", "About"]];
  const ready = days && acc && tl && day;
  return (<>
    <header><div className="wrap top"><span className="brand"><img src="/favicon.svg" alt="" />Gridbricks</span>
      <nav>{nav.map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</nav>
      <button className="theme" onClick={flip} aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} title={theme === "dark" ? "Light theme" : "Dark theme"}>{theme === "dark" ? <Sun /> : <Moon />}</button></div></header>
    <main className="wrap">
      {tab === "about" ? <About q={q} /> : !ready ? <p className="sub" style={{ marginTop: 40 }}>Loading</p> :
        tab === "fc" ? <Forecast days={days} gate={gate} setGate={setGate} day={day} setDay={setDay} acc={acc} tl={tl} />
          : <Accuracy gate={gate} setGate={setGate} acc={acc} openDay={(x) => { setDay(x); setTab("fc"); window.scrollTo(0, 0); }} />}
    </main>
    <div className="wrap"><footer>Great Britain national wind | Elexon BMRS data | decisions made in January 2026</footer></div>
  </>);
}
