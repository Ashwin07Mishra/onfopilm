import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, ComposedChart, LineChart, BarChart, Bar, Line, Area, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, Cell } from "recharts";

const get = (u) => fetch(u).then((r) => r.json());
const gw = (v, d = 1) => (v / 1000).toFixed(d) + " GW";
const mw = (v) => Math.round(v).toLocaleString() + " MW";
const dayName = (iso, long) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: long ? "long" : "short", day: "numeric", month: "short", timeZone: "UTC" });
const prevDay = (iso) => new Date(Date.parse(iso + "T12:00:00Z") - 864e5).toISOString().slice(0, 10);
const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const GATES = [["09:20", "09:20 - real market deadline"], ["00:00", "Midnight - strict reading of the brief"]];
const css = (v) => `var(--${v})`;

function Gate({ gate, setGate }) {
  const preset = GATES.some(([g]) => g === gate);
  return (
    <div>
      <div className="chips" role="group" aria-label="Decision deadline">
        {GATES.map(([g, label]) => <button key={g} className={"chip" + (gate === g ? " on" : "")} onClick={() => setGate(g)}>{label}</button>)}
        <button className={"chip" + (!preset ? " on" : "")} onClick={() => setGate("12:00")}>Pick my own time</button>
      </div>
      {!preset && <label style={{ display: "block", marginTop: 10, fontSize: 14, color: css("mut") }}>Deadline (UK time, day before delivery){" "}
        <input type="time" value={gate} onChange={(e) => e.target.value && setGate(e.target.value)} /></label>}
    </div>
  );
}

const Chart = ({ h = 280, children }) => <div style={{ height: h }}><ResponsiveContainer>{children}</ResponsiveContainer></div>;
const axis = { stroke: "var(--mut)", fontSize: 13 };
const noAnim = { isAnimationActive: false };

/* ---------- Plan a day ---------- */
function Plan({ days, gate, setGate, day, setDay, acc }) {
  const [d, setD] = useState(null), [ev, setEv] = useState(null);
  const [showActual, setShowActual] = useState(true), [showAdj, setShowAdj] = useState(true), [showBand, setShowBand] = useState(true);
  useEffect(() => { setD(null); setEv(null); get(`/api/decision/${day}?gate=${gate}`).then(setD); get(`/api/evolution/${day}?gate=${gate}`).then(setEv); }, [day, gate]);
  const i = days.indexOf(day);
  const o = acc.overall;
  const rows = useMemo(() => d && d.rows.filter((r) => r.startTime.endsWith(":00:00Z") && r.forecast != null).map((r) => ({
    t: r.startTime.slice(11, 16), forecast: r.forecast, adjusted: Math.max(0, r.adjusted), actual: r.actual,
    band: [Math.max(0, r.forecast - o.p90), Math.max(0, r.forecast - o.p10)],
  })), [d, o]);
  const hasAdj = d && d.known_bias_days > 0;
  const aF = rows && avg(rows.map((r) => r.forecast)), aA = rows && avg(rows.map((r) => r.actual));
  const aAdj = hasAdj ? aF - d.known_bias_mw : null;
  const lo = rows && rows.reduce((a, r) => (r.forecast < a.forecast ? r : a)), hi = rows && rows.reduce((a, r) => (r.forecast > a.forecast ? r : a));
  const late = ev ? ev.runs.filter((r) => !r.known_at_gate).length : 0;
  const known = ev ? ev.runs.filter((r) => r.known_at_gate) : [];
  const fmtRun = (s) => new Date(s.replace("Z", ":00Z")).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

  return (<>
    <h1>Plan a delivery day</h1>
    <p className="lead">Pick the day you are buying power for. We show the wind forecast you would have had at your deadline the day before, and how much to trust it.</p>

    <div className="card">
      <div className="ctl">
        <button className="btn" disabled={i <= 0} onClick={() => setDay(days[i - 1])} aria-label="Previous day">←</button>
        <label>Delivery day
          <select value={day} onChange={(e) => setDay(e.target.value)}>{days.map((x) => <option key={x} value={x}>{dayName(x, true)}</option>)}</select></label>
        <button className="btn" disabled={i >= days.length - 1} onClick={() => setDay(days[i + 1])} aria-label="Next day">→</button>
      </div>
      <h3>When do you have to decide?</h3>
      <Gate gate={gate} setGate={setGate} />
    </div>

    {!d || !rows ? <p>Loading...</p> : <>
      <div className="card story">
        <p style={{ marginTop: 0 }}>You are buying for <b>{dayName(day, true)}</b>. Your deadline is <b>{gate} UK time on {dayName(prevDay(day), true)}</b>. The latest wind forecast you could see by then expected GB wind to produce <b>{gw(aF)}</b> on average, ranging from about {gw(lo.forecast)} around {lo.t} to {gw(hi.forecast)} around {hi.t}.</p>
        {hasAdj
          ? <p>Over the {d.known_bias_days} earlier day{d.known_bias_days > 1 ? "s" : ""} of January you could already compare with, this forecast ran <b>{gw(Math.abs(d.known_bias_mw))} {d.known_bias_mw > 0 ? "too high" : "too low"}</b> on average. A more cautious planning figure is therefore about <b>{gw(aAdj)}</b>. Less wind means more power to buy from other sources.</p>
          : <p>This is the first day in the window, so there is no earlier forecast record to learn from yet.</p>}
        <div className="big">
          <div className="stat"><b style={{ color: css("fc") }}>{gw(aF)}</b><span>Forecast average at your deadline</span></div>
          {hasAdj && <div className="stat"><b style={{ color: css("adj") }}>{gw(aAdj)}</b><span>Cautious figure (adjusted for past lean)</span></div>}
          {showActual && <div className="stat"><b style={{ color: css("act") }}>{gw(aA)}</b><span>What wind actually produced (hindsight)</span></div>}
        </div>
        {showActual && d.day_stats && <p className="how" style={{ marginBottom: 0 }}>In hindsight, hour by hour the forecast was off by <b>{gw(d.day_stats.mae)}</b> on average on this day ({d.day_stats.bias > 0 ? "too high" : "too low"} overall). A typical January day is off by {gw(o.mae)}.{" "}
          {d.day_stats.mae > 1.4 * o.mae ? "That makes this a harder-than-usual day." : d.day_stats.mae < 0.6 * o.mae ? "That makes this an easier-than-usual day." : ""}</p>}
      </div>

      <div className="card">
        <h2>Wind forecast vs what happened</h2>
        <p className="sub">Hour by hour across the day. Tick or untick the lines to explore; hover (or tap) for exact values.</p>
        <div className="sw">
          <label><input type="checkbox" checked={showActual} onChange={(e) => setShowActual(e.target.checked)} />Show what actually happened</label>
          {hasAdj && <label><input type="checkbox" checked={showAdj} onChange={(e) => setShowAdj(e.target.checked)} />Show cautious line</label>}
          <label><input type="checkbox" checked={showBand} onChange={(e) => setShowBand(e.target.checked)} />Show usual range</label>
        </div>
        <Chart h={300}><ComposedChart data={rows} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--line)" /><XAxis dataKey="t" {...axis} interval={2} /><YAxis {...axis} width={64} tickFormatter={(v) => +(v / 1000).toFixed(1) + " GW"} domain={[0, "auto"]} />
          <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 8 }} formatter={(v, n) => [Array.isArray(v) ? `${mw(v[0])} to ${mw(v[1])}` : mw(v), n]} />
          {showBand && <Area dataKey="band" name="Usual range (80% of hours)" stroke="none" fill="var(--fc)" fillOpacity={0.14} {...noAnim} />}
          <Line dataKey="forecast" name="Forecast at your deadline" stroke="var(--fc)" strokeWidth={3} dot={false} {...noAnim} />
          {hasAdj && showAdj && <Line dataKey="adjusted" name="Cautious figure" stroke="var(--adj)" strokeWidth={2} strokeDasharray="6 4" dot={false} {...noAnim} />}
          {showActual && <Line dataKey="actual" name="Actually produced" stroke="var(--act)" strokeWidth={3} dot={false} {...noAnim} />}
        </ComposedChart></Chart>
        <div className="legend"><span><i style={{ background: css("fc") }} />Forecast you had</span>{hasAdj && showAdj && <span><i style={{ background: css("adj") }} />Cautious figure</span>}{showActual && <span><i style={{ background: css("act") }} />What happened</span>}{showBand && <span>Shaded: where actual wind landed in 8 of 10 hours in January</span>}</div>
        <p className="how"><a href={`/api/export/${day}?gate=${gate}`}>Download this forecast as a spreadsheet (CSV)</a></p>
      </div>

      {ev && <div className="card">
        <h2>Did the forecast change before your deadline?</h2>
        <p className="sub">The forecast is re-issued several times a day. Each dot is one update, showing its average for {dayName(day)}.</p>
        <Chart h={240}><LineChart data={ev.runs.map((r) => ({ t: fmtRun(r.publishTime), mw: r.mean_mw, known: r.known_at_gate ? r.mean_mw : null }))} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--line)" /><XAxis dataKey="t" {...axis} interval="preserveStartEnd" minTickGap={40} /><YAxis {...axis} width={64} tickFormatter={(v) => +(v / 1000).toFixed(1) + " GW"} domain={["auto", "auto"]} />
          <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 8 }} formatter={(v, n) => [mw(v), n]} />
          <Line dataKey="mw" name="Update (after deadline, unusable)" stroke="var(--mut)" strokeDasharray="4 4" dot={{ r: 3 }} {...noAnim} />
          <Line dataKey="known" name="Update you could use" stroke="var(--fc)" strokeWidth={3} dot={{ r: 4 }} {...noAnim} />
          {showActual && <ReferenceLine y={ev.actual_mean} stroke="var(--act)" strokeWidth={2} label={{ value: "Actual", fill: "var(--act)", position: "insideTopRight" }} />}
          {known.length > 0 && <ReferenceLine x={fmtRun(known[known.length - 1].publishTime)} stroke="var(--fg)" strokeDasharray="2 3" label={{ value: "Your deadline", fill: "var(--fg)", position: "insideTopRight", fontSize: 12 }} />}
        </LineChart></Chart>
        <p className="how" style={{ marginBottom: 0 }}>{known.length > 1
          ? <>Before your deadline the day's average moved from <b>{gw(known[0].mean_mw)}</b> (first update) to <b>{gw(known[known.length - 1].mean_mw)}</b> (last update you could use). </>
          : null}{late > 0 ? <>{late} later update{late > 1 ? "s" : ""} arrived after your deadline, so they are shown in grey and were not available to you.</> : null}</p>
      </div>}
    </>}
  </>);
}

/* ---------- How accurate ---------- */
function Accuracy({ gate, setGate, acc, openDay }) {
  const [adj, setAdj] = useState(false);
  const o = adj && acc.bias_adjusted ? acc.bias_adjusted : acc.overall;
  const bd = acc.by_day, worst = [...bd].sort((a, b) => b.mae - a.mae).slice(0, 3), best = [...bd].sort((a, b) => a.mae - b.mae)[0];
  const hrs = Object.entries(acc.by_hour), hMax = hrs.reduce((a, b) => (b[1] > a[1] ? b : a)), hMin = hrs.reduce((a, b) => (b[1] < a[1] ? b : a));
  const hh = (h) => String(h).padStart(2, "0") + ":00";
  const lead = Object.entries(acc.by_lead).map(([k, v]) => [+k, v]), l0 = lead[0], lN = lead[lead.length - 1];
  const hist = acc.hist.map((b) => ({ ...b, label: `${b.bin / 1000}` }));
  return (<>
    <h1>How good are the forecasts?</h1>
    <p className="lead">We replayed every January decision: what the forecast said at the deadline, against what the wind actually did.</p>
    <div className="card"><h3 style={{ marginTop: 0 }}>Deadline used for this check</h3><Gate gate={gate} setGate={setGate} />
      {acc.bias_adjusted && <div className="sw"><label><input type="checkbox" checked={adj} onChange={(e) => setAdj(e.target.checked)} />Judge the cautious (adjusted) figure instead of the raw forecast</label></div>}</div>

    <div className="card story">
      <p style={{ marginTop: 0 }}>Across <b>{o.n.toLocaleString()} hours</b>, the {adj ? "adjusted" : "day-ahead"} forecast was off by about <b>{gw(o.mae)}</b> on average, roughly <b>{o.wape_pct.toFixed(0)}%</b> of the wind that was actually produced. Nine in ten hours were within <b>{gw(o.abs_p90)}</b>, and the single worst hour missed by <b>{gw(o.max_abs)}</b>.</p>
      <p>{Math.abs(o.bias) < 300 ? <>It did not lean either way on average.</>
        : <>It <b>leaned {o.bias > 0 ? "high" : "low"}</b>: on average {gw(Math.abs(o.bias))} {o.bias > 0 ? "more" : "less"} wind was forecast than arrived{!adj ? <>, and it was too high in <b>{acc.share_over_pct.toFixed(0)}%</b> of hours</> : null}.</>}</p>
      <div className="big">
        <div className="stat"><b>{gw(o.mae)}</b><span>Average miss</span></div>
        <div className="stat"><b>{gw(o.abs_p90)}</b><span>9 in 10 hours within</span></div>
        <div className="stat"><b>{(o.bias > 0 ? "+" : "") + gw(o.bias)}</b><span>Average lean ({o.bias > 0 ? "too high" : "too low"})</span></div>
      </div>
      <div className="note"><b>What to look out for</b><ul>
        {o.bias > 300 && !adj && <li>The forecast was too high far more often than too low. Planning on the raw number risks <b>buying too little</b> backup power. The cautious figure on the Plan page corrects for this.</li>}
        <li>Accuracy varies a lot by day: the worst were {worst.map((w) => `${dayName(w.day)} (${gw(w.mae)})`).join(", ")}; the best was {dayName(best.day)} ({gw(best.mae)}). Click a bar below to open a day.</li>
        <li>{hh(hMax[0])} was the hardest hour of the day to forecast ({gw(hMax[1])} average miss) and {hh(hMin[0])} the easiest ({gw(hMin[1])}).</li>
        {l0 && lN && l0[1] !== lN[1] && <li>Forecasts made closer to delivery were {l0[1] < lN[1] ? "more" : "less"} accurate: {gw(l0[1])} miss when made {l0[0]}-{l0[0] + 6} hours ahead against {gw(lN[1])} at {lN[0]}-{lN[0] + 6} hours.</li>}
      </ul></div>
    </div>

    <div className="card"><h2>Day by day</h2><p className="sub">Average miss on each delivery day. <b>Click a bar</b> to plan that day.</p>
      <Chart><BarChart data={bd} margin={{ left: 0, right: 8 }}><CartesianGrid stroke="var(--line)" vertical={false} /><XAxis dataKey="day" {...axis} tickFormatter={(x) => +x.slice(8)} interval={1} /><YAxis {...axis} width={64} tickFormatter={(v) => +(v / 1000).toFixed(1) + " GW"} />
        <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 8 }} labelFormatter={(x) => dayName(x, true)} formatter={(v, n, p) => [mw(v) + ` (${p.payload.bias > 0 ? "forecast too high" : "forecast too low"} by ${mw(Math.abs(p.payload.bias))} on average)`, "Average miss"]} />
        <Bar dataKey="mae" className="clickable" onClick={(p) => openDay(p.day)} {...noAnim}>{bd.map((b) => <Cell key={b.day} fill={b.bias > 0 ? "var(--fc)" : "var(--act)"} />)}</Bar></BarChart></Chart>
      <div className="legend"><span><i style={{ background: css("fc") }} />Forecast too high on average</span><span><i style={{ background: css("act") }} />Forecast too low on average</span></div></div>

    <div className="card"><h2>Which hours are hardest?</h2><p className="sub">Average miss by hour of the day.</p>
      <Chart h={240}><BarChart data={hrs.map(([h, v]) => ({ h: hh(h), v }))} margin={{ left: 0, right: 8 }}><CartesianGrid stroke="var(--line)" vertical={false} /><XAxis dataKey="h" {...axis} interval={2} /><YAxis {...axis} width={64} tickFormatter={(v) => +(v / 1000).toFixed(1) + " GW"} /><Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 8 }} formatter={(v) => [mw(v), "Average miss"]} /><Bar dataKey="v" fill="var(--fc)" {...noAnim} /></BarChart></Chart></div>

    <div className="card"><h2>Do later forecasts do better?</h2><p className="sub">Average miss for every forecast published, grouped by how many hours before delivery it was made.</p>
      <Chart h={240}><BarChart data={lead.map(([k, v]) => ({ k: `${k}-${k + 6}h`, v }))} margin={{ left: 0, right: 8 }}><CartesianGrid stroke="var(--line)" vertical={false} /><XAxis dataKey="k" {...axis} /><YAxis {...axis} width={64} tickFormatter={(v) => +(v / 1000).toFixed(1) + " GW"} /><Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 8 }} formatter={(v) => [mw(v), "Average miss"]} /><Bar dataKey="v" fill="var(--adj)" {...noAnim} /></BarChart></Chart></div>

    <div className="card"><h2>How big are the misses?</h2><p className="sub">Number of hours for each size of miss, in GW. Bars right of zero are hours where the forecast was <b>too high</b>.</p>
      <Chart h={240}><BarChart data={hist} margin={{ left: 0, right: 8 }}><CartesianGrid stroke="var(--line)" vertical={false} /><XAxis dataKey="label" {...axis} /><YAxis {...axis} width={40} /><Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 8 }} labelFormatter={(x) => `Miss from ${x} GW`} formatter={(v) => [v + " hours", "Count"]} />
        <Bar dataKey="count" {...noAnim}>{hist.map((b) => <Cell key={b.bin} fill={b.bin >= 0 ? "var(--fc)" : "var(--act)"} />)}</Bar></BarChart></Chart></div>
  </>);
}

/* ---------- How it works ---------- */
function How({ q, meta }) {
  return (<>
    <h1>How this works</h1>
    <p className="lead">The short version, for anyone who wants to check our workings.</p>
    <div className="card"><h2>The question</h2>
      <p>A UK energy supplier has to buy tomorrow's electricity today. Wind power is cheap but varies with the weather, so the buyer needs a forecast of wind output to know how much <i>extra</i> power to buy from other sources. This tool shows (1) the latest wind forecast available at the moment of decision and (2) how wrong that forecast usually is.</p></div>
    <div className="card"><h2>The data</h2>
      <dl><dt>Actual wind output</dt><dd>Elexon dataset <b>FUELHH</b>, fuel type WIND: what the whole of Great Britain's wind generated, every 30 minutes.</dd>
        <dt>Forecast wind output</dt><dd>Elexon dataset <b>WINDFOR</b>: hourly forecasts, each stamped with the time it was published, so we know what was available when.</dd>
        <dt>Scope</dt><dd>National wind only, no other data. Decisions made in January 2026, meaning delivery days from 2 January to 1 February. This is not a full buying recommendation: it does not include demand or other generation.</dd></dl></div>
    <div className="card"><h2>The method</h2>
      <ol><li>For each delivery day, take your <b>deadline</b> on the day before (default 09:20 UK time, when the GB day-ahead auction closes).</li>
        <li>For every hour, keep the <b>latest forecast published before that deadline</b>. Anything newer could not have been used.</li>
        <li>Compare with the actual output. The gap is the <b>miss</b> (forecast minus actual).</li>
        <li>The <b>cautious figure</b> removes the average miss seen on earlier days. It only uses days that had fully finished by your deadline, so it never peeks at the future.</li></ol></div>
    <div className="card"><h2>Plain-English glossary</h2>
      <dl><dt>MW / GW</dt><dd>Megawatts and gigawatts of power. 1 GW = 1,000 MW.</dd>
        <dt>Average miss</dt><dd>How far off the forecast is on average, ignoring direction (mean absolute error).</dd>
        <dt>Lean (bias)</dt><dd>Whether it tends to be too high or too low. Positive = too high = risk of under-buying.</dd>
        <dt>9 in 10 hours within</dt><dd>The 90th percentile of the miss: only 1 hour in 10 is worse.</dd>
        <dt>Deadline (gate)</dt><dd>The last moment you can decide. You can change it on any page.</dd></dl></div>
    {q && <div className="card"><h2>Data checks</h2>
      <p>{q.actual_present.toLocaleString()} of {q.actual_expected.toLocaleString()} expected half-hourly actuals are present. {q.forecast_runs} forecast updates were loaded ({q.forecast_points.toLocaleString()} data points). {q.off_schedule_runs.length ? `${q.off_schedule_runs.length} update(s) came outside the usual schedule (${q.off_schedule_runs.join(", ")}); we use the real publish time so this is handled correctly.` : ""} {q.forecast_after_target.toLocaleString()} points were published after the hour they describe and can never be used for a decision.</p>
      {meta && <p className="how">Data snapshot: {meta.snapshot.filter((s) => s.rows).map((s) => `${s.file} (${s.rows.toLocaleString()} rows, ${s.sha256})`).join("; ")}. Source: Elexon BMRS.</p>}</div>}
  </>);
}

const sys = () => (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
function useTheme() {
  const [t, setT] = useState(() => { try { return localStorage.getItem("theme") || sys(); } catch { return sys(); } });
  useEffect(() => { document.documentElement.dataset.theme = t; try { localStorage.setItem("theme", t); } catch {} }, [t]);
  return [t, () => setT(t === "dark" ? "light" : "dark")];
}

export default function App() {
  const [theme, flip] = useTheme();
  const [tab, setTab] = useState("plan"), [gate, setGate] = useState("09:20"), [days, setDays] = useState(), [acc, setAcc] = useState(), [day, setDay] = useState();
  const [q, setQ] = useState(), [meta, setMeta] = useState();
  useEffect(() => { get("/api/days").then((d) => { setDays(d.days); setDay(d.days[14]); }); get("/api/quality").then(setQ); get("/api/meta").then(setMeta); }, []);
  useEffect(() => { get(`/api/accuracy?gate=${gate}`).then(setAcc); }, [gate]);
  const nav = [["plan", "Plan a day"], ["acc", "How accurate?"], ["how", "How it works"]];
  return (<>
    <header><div className="wrap top"><span className="brand"><img src="/favicon.svg" alt="" />Gridbricks</span>
      <nav>{nav.map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</nav>
      <button className="theme" onClick={flip} aria-label="Switch between light and dark mode">{theme === "dark" ? "Light mode" : "Dark mode"}</button></div></header>
    <main className="wrap">
      {tab === "how" ? <How q={q} meta={meta} /> : !days || !acc || !day ? <p style={{ marginTop: 40 }}>Loading...</p> :
        tab === "plan" ? <Plan days={days} gate={gate} setGate={setGate} day={day} setDay={setDay} acc={acc} />
          : <Accuracy gate={gate} setGate={setGate} acc={acc} openDay={(x) => { setDay(x); setTab("plan"); window.scrollTo(0, 0); }} />}
    </main>
    <div className="wrap"><footer>Great Britain national wind only | Elexon BMRS data | decisions made in January 2026</footer></div>
  </>);
}
