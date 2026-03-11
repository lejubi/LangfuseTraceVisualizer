import { useState, useEffect, useRef } from "react";

const LANGFUSE_BASE = "http://localhost:3000";

const PRICING = {
  "gpt-4o":                 { input: 2.50,  output: 10.00 },
  "gpt-4o-2024-08-06":      { input: 2.50,  output: 10.00 },
  "gpt-4o-mini":            { input: 0.15,  output: 0.60  },
  "gpt-4o-mini-2024-07-18": { input: 0.15,  output: 0.60  },
  "gpt-4-turbo":            { input: 10.00, output: 30.00 },
  "gpt-3.5-turbo":          { input: 0.50,  output: 1.50  },
  "o1":                     { input: 15.00, output: 60.00 },
  "o1-mini":                { input: 3.00,  output: 12.00 },
  "o3-mini":                { input: 1.10,  output: 4.40  },
  "gpt-5":                  { input: 15.00, output: 60.00 },
};

function estimateCost(model, i, o) {
  if (!model) return null;
  const key = Object.keys(PRICING).find(k => model.toLowerCase().includes(k));
  if (!key) return null;
  const p = PRICING[key];
  return ((i || 0) / 1e6) * p.input + ((o || 0) / 1e6) * p.output;
}

function fmtCost(usd) {
  if (usd == null || usd === 0) return null;
  if (usd < 0.0001) return "<$0.0001";
  if (usd < 0.01)   return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

function dur(ms) {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function fmt(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function elapsed(start, end) {
  if (!start || !end) return null;
  return new Date(end) - new Date(start);
}

function extractText(val, limit = 800) {
  if (!val) return null;
  if (typeof val === "string") return val.slice(0, limit);
  if (Array.isArray(val)) {
    return val.map(m => {
      if (typeof m === "string") return m;
      if (m?.content) {
        if (typeof m.content === "string") return `[${m.role || "?"}] ${m.content}`;
        if (Array.isArray(m.content)) return `[${m.role || "?"}] ` + m.content.map(c => c.text || "").join("");
      }
      return null;
    }).filter(Boolean).join("\n").slice(0, limit);
  }
  if (val?.text) return String(val.text).slice(0, limit);
  if (val?.content) return extractText(val.content, limit);
  return JSON.stringify(val).slice(0, limit);
}

function spanColor(type) {
  const t = type?.toUpperCase?.();
  if (t === "LLM" || t === "GENERATION") return "#f59e0b";
  if (t === "TOOL")  return "#34d399";
  if (t === "AGENT") return "#f472b6";
  if (t === "CHAIN") return "#60a5fa";
  if (t === "EVENT") return "#a78bfa";
  return "#6366f1";
}

function buildTree(observations) {
  const map = {};
  observations.forEach(o => { map[o.id] = { ...o, children: [] }; });
  const roots = [];
  observations.forEach(o => {
    if (o.parentObservationId && map[o.parentObservationId]) {
      map[o.parentObservationId].children.push(map[o.id]);
    } else {
      roots.push(map[o.id]);
    }
  });
  function sort(nodes) {
    nodes.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    nodes.forEach(n => sort(n.children));
  }
  sort(roots);
  return roots;
}

// ── IOPanel ───────────────────────────────────────────────────────────────────

function IOPanel({ node, color }) {
  const [tab, setTab] = useState("output");
  const inputText  = extractText(node.input);
  const outputText = extractText(node.output);
  const inTok  = node.usage?.promptTokens     ?? node.usage?.input_tokens     ?? node.usage?.prompt_tokens;
  const outTok = node.usage?.completionTokens ?? node.usage?.output_tokens    ?? node.usage?.completion_tokens;
  const cost   = estimateCost(node.model, inTok, outTok);
  const ms     = elapsed(node.startTime, node.endTime);

  return (
    <div style={{
      marginTop: 6, marginBottom: 10,
      background: "#0a0d13",
      border: `1px solid ${color}20`,
      borderRadius: 8, overflow: "hidden",
    }}>
      <div style={{
        display: "flex", alignItems: "center",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
        paddingLeft: 4,
      }}>
        {[
          { id: "output", label: "Output", show: !!outputText },
          { id: "input",  label: "Input",  show: !!inputText  },
          { id: "meta",   label: "Meta",   show: true         },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: "6px 14px", fontSize: 10, letterSpacing: "0.07em",
            cursor: "pointer", background: "transparent", fontFamily: "inherit",
            color: tab === t.id ? color : "#374151",
            border: "none", borderBottom: tab === t.id ? `1px solid ${color}` : "1px solid transparent",
            marginBottom: -1, transition: "color 0.1s", opacity: t.show ? 1 : 0.3,
          }}>{t.label}</button>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", gap: 12, paddingRight: 14 }}>
          {inTok != null && <span style={{ fontSize: 10, color: "#374151" }}>{inTok.toLocaleString()} / {(outTok||0).toLocaleString()}</span>}
          {cost  != null && <span style={{ fontSize: 10, color: "#34d399" }}>{fmtCost(cost)}</span>}
          {ms    != null && <span style={{ fontSize: 10, color: "#374151" }}>{dur(ms)}</span>}
        </div>
      </div>
      <div style={{ padding: "12px 16px", maxHeight: 260, overflowY: "auto" }}>
        {tab === "output" && (outputText
          ? <pre style={{ color: "#86efac", whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, lineHeight: 1.7, fontSize: 11 }}>{outputText}</pre>
          : <span style={{ color: "#1f2937", fontSize: 11 }}>no output</span>
        )}
        {tab === "input" && (inputText
          ? <pre style={{ color: "#93c5fd", whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, lineHeight: 1.7, fontSize: 11 }}>{inputText}</pre>
          : <span style={{ color: "#1f2937", fontSize: 11 }}>no input</span>
        )}
        {tab === "meta" && (
          <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: "2px 16px", fontSize: 11, lineHeight: 2 }}>
            {[
              ["id",       node.id],
              ["name",     node.name],
              ["model",    node.model],
              ["start",    fmt(node.startTime)],
              ["duration", dur(ms)],
              ["in tok",   inTok?.toLocaleString()],
              ["out tok",  outTok?.toLocaleString()],
              ["cost",     fmtCost(cost)],
            ].filter(([,v]) => v != null).map(([k, v]) => (
              <>
                <span key={k+"-k"} style={{ color: "#374151" }}>{k}</span>
                <span key={k+"-v"} style={{ color: "#9ca3af" }}>{v}</span>
              </>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── TraceNode ─────────────────────────────────────────────────────────────────

function TraceNode({ node, depth = 0, traceStart, totalDur, isLast }) {
  const [open, setOpen]         = useState(depth < 3);
  const [expanded, setExpanded] = useState(false);
  const [hover, setHover]       = useState(false);

  const ms      = elapsed(node.startTime, node.endTime);
  const color   = spanColor(node.type || node.observationType);
  const hasKids = node.children?.length > 0;

  const tStart   = traceStart ? (new Date(node.startTime) - new Date(traceStart)) : 0;
  const barLeft  = totalDur > 0 ? (tStart / totalDur) * 100 : 0;
  const barWidth = totalDur > 0 && ms ? Math.max((ms / totalDur) * 100, 1) : 2;

  return (
    <div style={{ position: "relative" }}>
      {depth > 0 && (
        <>
          <div style={{
            position: "absolute", left: -14, top: 0,
            bottom: isLast ? 14 : 0, width: 1,
            background: "rgba(255,255,255,0.05)", pointerEvents: "none",
          }} />
          <div style={{
            position: "absolute", left: -14, top: 14,
            width: 10, height: 1,
            background: "rgba(255,255,255,0.05)", pointerEvents: "none",
          }} />
        </>
      )}

      <div style={{ marginLeft: depth > 0 ? 22 : 0 }}>
        <div
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          onClick={() => setExpanded(e => !e)}
          style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "5px 10px", borderRadius: 6, cursor: "pointer",
            background: expanded ? `${color}08` : hover ? "rgba(255,255,255,0.015)" : "transparent",
            border: expanded ? `1px solid ${color}18` : "1px solid transparent",
            transition: "all 0.1s", marginBottom: 1,
          }}
        >
          <span
            onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
            style={{
              width: 14, fontSize: 7, textAlign: "center",
              color: hasKids ? "#4b5563" : "transparent",
              cursor: hasKids ? "pointer" : "default", userSelect: "none", flexShrink: 0,
            }}
          >
            {hasKids ? (open ? "▾" : "▸") : "·"}
          </span>

          {/* color dot */}
          <div style={{
            width: 6, height: 6, borderRadius: "50%",
            background: color, flexShrink: 0, opacity: 0.7,
          }} />

          {/* name */}
          <span style={{
            flex: 1, fontSize: 12,
            color: hover || expanded ? "#e2e8f0" : "#6b7280",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            transition: "color 0.1s",
          }}>
            {node.name || node.id}
          </span>

          {/* duration */}
          <span style={{ fontSize: 10, color: "#374151", flexShrink: 0, minWidth: 50, textAlign: "right" }}>
            {dur(ms)}
          </span>

          {/* waterfall */}
          <div style={{
            width: 120, height: 2, background: "rgba(255,255,255,0.04)",
            borderRadius: 2, flexShrink: 0, position: "relative", overflow: "hidden",
          }}>
            <div style={{
              position: "absolute", left: `${barLeft}%`, width: `${barWidth}%`,
              height: "100%", background: color, borderRadius: 2,
              opacity: expanded ? 1 : 0.5,
              transition: "all 0.1s",
            }} />
          </div>
        </div>

        {expanded && (
          <div style={{ marginLeft: 26, animation: "slideDown 0.1s ease" }}>
            <IOPanel node={node} color={color} />
          </div>
        )}

        {open && hasKids && (
          <div style={{ position: "relative", marginLeft: 14 }}>
            {node.children.map((child, i) => (
              <TraceNode
                key={child.id} node={child} depth={depth + 1}
                traceStart={traceStart} totalDur={totalDur}
                isLast={i === node.children.length - 1}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── TraceDetail ───────────────────────────────────────────────────────────────

function TraceDetail({ trace, onBack }) {
  const [obs, setObs]         = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const creds = btoa(`${window._lfPub}:${window._lfSec}`);
        const r = await fetch(`${LANGFUSE_BASE}/api/public/observations?traceId=${trace.id}&limit=100`, {
          headers: { Authorization: `Basic ${creds}` },
        });
        const text = await r.text();
        if (!r.ok) throw new Error(`${r.status}: ${text.slice(0, 200)}`);
        setObs(JSON.parse(text).data || []);
      } catch (e) { setErr(e.message); }
      finally { setLoading(false); }
    }
    load();
  }, [trace.id]);

  const tree     = obs ? buildTree(obs) : [];
  const lastEnd  = obs?.reduce((mx, o) => (!o.endTime ? mx : o.endTime > mx ? o.endTime : mx), trace.timestamp);
  const totalDur = elapsed(trace.timestamp, lastEnd);

  // Roll up stats from observations
  const totalInTok  = obs?.reduce((s, o) => s + (o.usage?.promptTokens     ?? o.usage?.input_tokens     ?? o.usage?.prompt_tokens     ?? 0), 0) || null;
  const totalOutTok = obs?.reduce((s, o) => s + (o.usage?.completionTokens ?? o.usage?.output_tokens    ?? o.usage?.completion_tokens  ?? 0), 0) || null;
  const totalCost   = obs?.reduce((s, o) => {
    const c = estimateCost(o.model,
      o.usage?.promptTokens ?? o.usage?.input_tokens ?? o.usage?.prompt_tokens,
      o.usage?.completionTokens ?? o.usage?.output_tokens ?? o.usage?.completion_tokens,
    );
    return s + (c || 0);
  }, 0) || null;
  const models = obs ? [...new Set(obs.map(o => o.model).filter(Boolean))] : [];

  const stats = [
    { label: "duration", val: dur(totalDur) },
    { label: "spans",    val: obs?.length },
    ...(totalInTok  ? [{ label: "in tokens",  val: totalInTok.toLocaleString()  }] : []),
    ...(totalOutTok ? [{ label: "out tokens", val: totalOutTok.toLocaleString() }] : []),
    ...(totalCost   ? [{ label: "cost",        val: fmtCost(totalCost), green: true }] : []),
  ];

  return (
    <div>
      {/* header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 14,
        padding: "16px 0",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
      }}>
        <button onClick={onBack} style={btnStyle}>← back</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, color: "#e2e8f0", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {trace.name || trace.id}
          </div>
          <div style={{ fontSize: 9, color: "#1f2937", marginTop: 2 }}>
            {fmt(trace.timestamp)} · {trace.id}
          </div>
        </div>
        {/* stats pills */}
        {obs && (
          <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {stats.map(s => (
              <div key={s.label} style={{
                padding: "5px 12px", borderRadius: 6, textAlign: "center",
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.05)",
              }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: s.green ? "#34d399" : "#e2e8f0" }}>{s.val}</div>
                <div style={{ fontSize: 8, color: "#374151", marginTop: 1, letterSpacing: "0.08em" }}>{s.label.toUpperCase()}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* model tags */}
      {models.length > 0 && (
        <div style={{
          display: "flex", gap: 6, padding: "8px 0",
          borderBottom: "1px solid rgba(255,255,255,0.03)",
        }}>
          {models.map(m => (
            <span key={m} style={{
              fontSize: 9, color: "#f59e0b",
              background: "rgba(245,158,11,0.08)",
              border: "1px solid rgba(245,158,11,0.15)",
              borderRadius: 4, padding: "2px 8px",
            }}>{m}</span>
          ))}
        </div>
      )}

      {/* tree */}
      <div style={{ padding: "12px 0" }}>
        {loading && <Spinner />}
        {err && <ErrMsg msg={err} />}
        {!loading && !err && tree.length === 0 && (
          <div style={{ color: "#1f2937", fontSize: 12, padding: 40, textAlign: "center" }}>no observations</div>
        )}
        {tree.map((node, i) => (
          <TraceNode
            key={node.id} node={node} depth={0}
            traceStart={trace.timestamp} totalDur={totalDur}
            isLast={i === tree.length - 1}
          />
        ))}
      </div>
    </div>
  );
}

// ── TraceList ─────────────────────────────────────────────────────────────────

function TraceList({ traces }) {
  // We enrich each trace by fetching its observations summary
  const [enriched, setEnriched] = useState({});

  useEffect(() => {
    // Fetch observations for visible traces to get real token/cost data
    traces.forEach(async (t) => {
      if (enriched[t.id]) return;
      try {
        const creds = btoa(`${window._lfPub}:${window._lfSec}`);
        const r = await fetch(`${LANGFUSE_BASE}/api/public/observations?traceId=${t.id}&limit=100`, {
          headers: { Authorization: `Basic ${creds}` },
        });
        if (!r.ok) return;
        const obs = (await r.json()).data || [];
        const inTok  = obs.reduce((s, o) => s + (o.usage?.promptTokens     ?? o.usage?.input_tokens     ?? o.usage?.prompt_tokens     ?? 0), 0);
        const outTok = obs.reduce((s, o) => s + (o.usage?.completionTokens ?? o.usage?.output_tokens    ?? o.usage?.completion_tokens  ?? 0), 0);
        const cost   = obs.reduce((s, o) => {
          const c = estimateCost(o.model,
            o.usage?.promptTokens ?? o.usage?.input_tokens ?? o.usage?.prompt_tokens,
            o.usage?.completionTokens ?? o.usage?.output_tokens ?? o.usage?.completion_tokens,
          );
          return s + (c || 0);
        }, 0);
        const models = [...new Set(obs.map(o => o.model).filter(Boolean))];
        const lastEnd = obs.reduce((mx, o) => (!o.endTime ? mx : o.endTime > mx ? o.endTime : mx), t.timestamp);
        const latency = elapsed(t.timestamp, lastEnd);
        setEnriched(prev => ({
          ...prev,
          [t.id]: {
            inTok:   inTok  || null,
            outTok:  outTok || null,
            cost:    cost   || null,
            models,
            latency,
            spans: obs.length,
          },
        }));
      } catch {}
    });
  }, [traces]);

  return (
    <div>
      {/* col headers */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 140px 100px 80px 70px 80px",
        gap: 0, padding: "0 16px 8px",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
        marginBottom: 4,
      }}>
        {["name", "model", "tokens", "cost", "dur", "time"].map(h => (
          <span key={h} style={{
            fontSize: 9, color: "#1f2937", letterSpacing: "0.1em",
            textAlign: h === "name" ? "left" : "right",
            paddingRight: h !== "name" ? 8 : 0,
          }}>{h.toUpperCase()}</span>
        ))}
      </div>

      {traces.map((t, idx) => {
        const e = enriched[t.id];
        const model = e?.models?.[0] ?? null;
        const tokens = e ? (e.inTok || e.outTok) ? `${((e.inTok||0)+(e.outTok||0)).toLocaleString()}` : null : null;
        const cost   = e?.cost   ? fmtCost(e.cost)   : null;
        const latency = e?.latency ? dur(e.latency) : null;

        return (
          <TraceRow
            key={t.id} t={t} idx={idx}
            model={model} tokens={tokens} cost={cost} latency={latency}
            spans={e?.spans}
          />
        );
      })}
    </div>
  );
}

function TraceRow({ t, idx, model, tokens, cost, latency, spans, onSelect }) {
  const [hover, setHover] = useState(false);
  // Need onSelect from parent — receive via prop from App
  return (
    <div
      onClick={() => t._onSelect && t._onSelect(t)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 140px 100px 80px 70px 80px",
        alignItems: "center",
        padding: "10px 16px", marginBottom: 3, borderRadius: 8,
        border: `1px solid ${hover ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.03)"}`,
        background: hover ? "rgba(255,255,255,0.02)" : "transparent",
        cursor: "pointer", transition: "all 0.1s",
        animation: `fadeIn 0.2s ease ${idx * 0.015}s both`,
      }}
    >
      {/* name */}
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 500,
          color: hover ? "#e2e8f0" : "#9ca3af",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          transition: "color 0.1s",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <div style={{
            width: 5, height: 5, borderRadius: "50%",
            background: "#6366f1", flexShrink: 0, opacity: 0.6,
          }} />
          {t.name || t.id}
        </div>
        <div style={{ fontSize: 9, color: "#1f2937", marginTop: 2, paddingLeft: 13 }}>
          {t.id.slice(0, 22)}…
          {spans != null && <span style={{ marginLeft: 8, color: "#1f2937" }}>{spans} spans</span>}
        </div>
      </div>

      {/* model */}
      <div style={{ textAlign: "right", paddingRight: 8 }}>
        {model
          ? <span style={{
              fontSize: 9, color: "#4b5563",
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.05)",
              borderRadius: 4, padding: "2px 6px",
            }}>{model.replace("gpt-","").replace(/-\d{4}-\d{2}-\d{2}/,"")}</span>
          : <span style={{ fontSize: 10, color: "#1f2937" }}>—</span>
        }
      </div>

      {/* tokens */}
      <div style={{ textAlign: "right", paddingRight: 8 }}>
        {tokens
          ? <span style={{ fontSize: 11, color: "#f59e0b" }}>{tokens}</span>
          : <LoadingDot loading={spans == null} />
        }
      </div>

      {/* cost */}
      <div style={{ textAlign: "right", paddingRight: 8 }}>
        {cost
          ? <span style={{ fontSize: 11, color: "#34d399" }}>{cost}</span>
          : <LoadingDot loading={spans == null} />
        }
      </div>

      {/* duration */}
      <div style={{ textAlign: "right", paddingRight: 8 }}>
        <span style={{ fontSize: 11, color: "#4b5563" }}>
          {latency ?? <LoadingDot loading={spans == null} />}
        </span>
      </div>

      {/* time */}
      <div style={{ textAlign: "right" }}>
        <span style={{ fontSize: 10, color: "#374151" }}>{fmt(t.timestamp)}</span>
      </div>
    </div>
  );
}

function LoadingDot({ loading }) {
  if (!loading) return <span style={{ color: "#1f2937", fontSize: 10 }}>—</span>;
  return (
    <span style={{
      display: "inline-block", width: 4, height: 4, borderRadius: "50%",
      background: "#1f2937", animation: "pulse 1.2s ease infinite",
      verticalAlign: "middle",
    }} />
  );
}

// ── misc ──────────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
      <div style={{
        width: 16, height: 16,
        border: "1.5px solid rgba(255,255,255,0.05)",
        borderTop: "1.5px solid #6366f1",
        borderRadius: "50%", animation: "spin 0.6s linear infinite",
      }} />
    </div>
  );
}

function ErrMsg({ msg }) {
  return (
    <div style={{
      margin: 16, padding: 12, borderRadius: 8,
      background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)",
      color: "#fca5a5", fontSize: 11,
    }}>✕ {msg}</div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [pub, setPub]                 = useState("");
  const [sec, setSec]                 = useState("");
  const [connected, setConnected]     = useState(false);
  const [traces, setTraces]           = useState([]);
  const [loading, setLoading]         = useState(false);
  const [err, setErr]                 = useState(null);
  const [selected, setSelected]       = useState(null);
  const [search, setSearch]           = useState("");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const intervalRef = useRef(null);

  async function connect() {
    setLoading(true); setErr(null);
    try {
      const creds = btoa(`${pub}:${sec}`);
      window._lfPub = pub; window._lfSec = sec;
      const r = await fetch(`${LANGFUSE_BASE}/api/public/traces?limit=50`, {
        headers: { Authorization: `Basic ${creds}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status} — check credentials`);
      setTraces((await r.json()).data || []);
      setConnected(true);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  async function refresh() {
    if (!connected) return;
    try {
      const creds = btoa(`${window._lfPub}:${window._lfSec}`);
      const r = await fetch(`${LANGFUSE_BASE}/api/public/traces?limit=50`, {
        headers: { Authorization: `Basic ${creds}` },
      });
      if (r.ok) setTraces((await r.json()).data || []);
    } catch {}
  }

  useEffect(() => {
    if (autoRefresh && connected) intervalRef.current = setInterval(refresh, 4000);
    else clearInterval(intervalRef.current);
    return () => clearInterval(intervalRef.current);
  }, [autoRefresh, connected]);

  // Attach click handler to traces
  const tracesWithHandler = traces.map(t => ({ ...t, _onSelect: setSelected }));
  const filtered = tracesWithHandler.filter(t =>
    !search || (t.name || t.id).toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Geist+Mono:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #080c12; }
        ::-webkit-scrollbar { width: 3px; height: 3px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.06); border-radius: 2px; }
        @keyframes spin  { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity: 0.2; } 50% { opacity: 0.6; } }
        @keyframes fadeIn    { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; } }
        @keyframes slideDown { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; } }
        input::placeholder { color: #1f2937; }
        input:focus { border-color: rgba(99,102,241,0.4) !important; outline: none; }
        button:hover { opacity: 0.75; }
      `}</style>

      <div style={{
        minHeight: "100vh",
        background: "#080c12",
        color: "#e2e8f0",
        fontFamily: "'Geist Mono', 'SF Mono', monospace",
        display: "flex", flexDirection: "column",
        alignItems: "center",
      }}>
        {/* navbar — full width but content centered */}
        <div style={{
          width: "100%",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          background: "rgba(255,255,255,0.01)",
          flexShrink: 0,
        }}>
          <div style={{
            maxWidth: 900, margin: "0 auto",
            display: "flex", alignItems: "center", gap: 14,
            padding: "12px 24px",
          }}>
            {/* logo */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              <div style={{
                width: 20, height: 20,
                background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                borderRadius: 5, display: "flex", alignItems: "center",
                justifyContent: "center", fontSize: 10,
              }}>◈</div>
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.14em" }}>
                TRACE<span style={{ color: "#6366f1" }}>SCOPE</span>
              </span>
            </div>

            <div style={{ width: 1, height: 14, background: "rgba(255,255,255,0.06)", flexShrink: 0 }} />

            {!connected ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flex: 1 }}>
                <input placeholder="pk-lf-…" value={pub} onChange={e => setPub(e.target.value)} style={inputStyle} />
                <input type="password" placeholder="sk-lf-…" value={sec}
                  onChange={e => setSec(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && connect()}
                  style={{ ...inputStyle, width: 180 }} />
                <button onClick={connect} disabled={loading || !pub || !sec}
                  style={{ ...btnStyle, background: "rgba(99,102,241,0.1)", borderColor: "rgba(99,102,241,0.2)", color: "#818cf8" }}>
                  {loading ? "…" : "connect →"}
                </button>
                {err && <span style={{ fontSize: 10, color: "#f87171" }}>✕ {err}</span>}
              </div>
            ) : (
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: "auto" }}>
                <div style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "3px 8px",
                  background: "rgba(52,211,153,0.06)", border: "1px solid rgba(52,211,153,0.12)", borderRadius: 5,
                }}>
                  <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#34d399", boxShadow: "0 0 5px #34d399" }} />
                  <span style={{ fontSize: 9, color: "#34d399" }}>connected</span>
                </div>
                <button onClick={() => setAutoRefresh(a => !a)} style={{
                  ...btnStyle,
                  ...(autoRefresh ? { background: "rgba(99,102,241,0.1)", borderColor: "rgba(99,102,241,0.2)", color: "#818cf8" } : {}),
                }}>⟳ {autoRefresh ? "live" : "auto"}</button>
                <button onClick={refresh} style={btnStyle}>reload</button>
                <button onClick={() => { setConnected(false); setTraces([]); setSelected(null); }} style={btnStyle}>✕</button>
              </div>
            )}
          </div>
        </div>

        {/* body — centered column */}
        <div style={{ width: "100%", maxWidth: 900, flex: 1, padding: "0 24px" }}>
          {!connected ? (
            <div style={{
              height: "70vh", display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: 14,
              animation: "fadeIn 0.4s ease",
            }}>
              <div style={{
                width: 48, height: 48,
                background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.12)",
                borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 20, color: "#4338ca",
              }}>◈</div>
              <div style={{ textAlign: "center", lineHeight: 2 }}>
                <div style={{ fontSize: 11, color: "#374151" }}>connect to your langfuse instance</div>
                <div style={{ fontSize: 9, color: "#1f2937" }}>{LANGFUSE_BASE}</div>
              </div>
            </div>

          ) : selected ? (
            <div style={{ paddingTop: 0, animation: "fadeIn 0.12s ease" }}>
              <TraceDetail trace={selected} onBack={() => setSelected(null)} />
            </div>

          ) : (
            <div style={{ paddingTop: 16, animation: "fadeIn 0.2s ease" }}>
              {/* search */}
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16 }}>
                <input
                  placeholder="filter traces…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  style={{ ...inputStyle, flex: 1, width: "auto" }}
                />
                <span style={{ fontSize: 9, color: "#1f2937", flexShrink: 0 }}>
                  {filtered.length} trace{filtered.length !== 1 ? "s" : ""}
                </span>
              </div>

              {filtered.length === 0
                ? <div style={{ color: "#1f2937", fontSize: 11, padding: 40, textAlign: "center" }}>no traces found</div>
                : <TraceList traces={filtered} />
              }
            </div>
          )}
        </div>
      </div>
    </>
  );
}

const inputStyle = {
  background: "rgba(255,255,255,0.02)",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: 6, padding: "6px 10px",
  color: "#e2e8f0", fontSize: 11,
  fontFamily: "inherit", outline: "none",
  width: 200, transition: "border-color 0.1s",
};

const btnStyle = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: 6, padding: "5px 10px",
  color: "#4b5563", fontSize: 10,
  cursor: "pointer", fontFamily: "inherit",
};