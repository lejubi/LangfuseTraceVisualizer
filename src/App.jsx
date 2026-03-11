import { useState, useEffect, useRef } from "react";

const LANGFUSE_BASE = "http://localhost:3000";

const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=Geist+Mono:wght@400;500&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg:           #ffffff;
    --bg-subtle:    #f9fafb;
    --bg-hover:     #f3f4f6;
    --bg-active:    #eff6ff;
    --border:       #e5e7eb;
    --border-strong:#d1d5db;
    --text-1:       #111827;
    --text-2:       #374151;
    --text-3:       #6b7280;
    --text-4:       #9ca3af;
    --text-5:       #d1d5db;
    --accent:       #2563eb;
    --accent-light: #eff6ff;
    --accent-border:#bfdbfe;
    --green:        #16a34a;
    --green-light:  #f0fdf4;
    --green-border: #bbf7d0;
    --amber:        #d97706;
    --amber-light:  #fffbeb;
    --amber-border: #fde68a;
    --blue:         #2563eb;
    --purple:       #7c3aed;
    --red:          #dc2626;
    --red-light:    #fef2f2;
    --font-sans:    'Inter', system-ui, -apple-system, sans-serif;
    --font-mono:    'Geist Mono', 'SF Mono', ui-monospace, monospace;
    --r-sm: 4px; --r-md: 6px; --r-lg: 8px;
    --shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
    --shadow-md: 0 4px 6px -1px rgba(0,0,0,0.07);
  }
  html, body { background: var(--bg); color: var(--text-1); }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: var(--bg-subtle); }
  ::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 3px; }
  @keyframes spin      { to { transform: rotate(360deg); } }
  @keyframes pulse     { 0%,100% { opacity:0.3; } 50% { opacity:0.8; } }
  @keyframes fadeIn    { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:translateY(0); } }
  @keyframes slideDown { from { opacity:0; transform:translateY(-3px); } to { opacity:1; transform:translateY(0); } }
  input::placeholder { color: var(--text-4); }
  input:focus { outline:none; border-color:var(--accent) !important; box-shadow:0 0 0 3px rgba(37,99,235,0.1); }
`;

const PRICING = {
  "claude-opus-4":     { input:15,   output:75   },
  "claude-sonnet-4":   { input:3,    output:15   },
  "claude-haiku-4":    { input:0.8,  output:4    },
  "claude-3-5-sonnet": { input:3,    output:15   },
  "claude-3-5-haiku":  { input:0.8,  output:4    },
  "claude-3-opus":     { input:15,   output:75   },
  "claude-3-sonnet":   { input:3,    output:15   },
  "claude-3-haiku":    { input:0.25, output:1.25 },
  "gpt-4o":            { input:2.5,  output:10   },
  "gpt-4o-mini":       { input:0.15, output:0.6  },
  "gpt-4-turbo":       { input:10,   output:30   },
  "gpt-3.5-turbo":     { input:0.5,  output:1.5  },
  "o1":                { input:15,   output:60   },
  "o1-mini":           { input:3,    output:12   },
  "o3-mini":           { input:1.1,  output:4.4  },
  "o3":                { input:10,   output:40   },
  "gemini-2.0-flash":  { input:0.1,  output:0.4  },
  "gemini-1.5-pro":    { input:1.25, output:5    },
};

const estimateCost = (model, i, o) => {
  if (!model || (i == null && o == null)) return null;
  const key = Object.keys(PRICING).find(k => model.toLowerCase().includes(k));
  if (!key) return null;
  const p = PRICING[key];
  return ((i||0)/1e6)*p.input + ((o||0)/1e6)*p.output;
};
const fmtCost = usd => {
  if (usd == null || usd === 0) return null;
  if (usd < 0.0001) return "<$0.0001";
  if (usd < 0.01)   return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
};
const dur  = ms  => { if (ms==null||ms<0) return "—"; if (ms<1000) return `${Math.round(ms)}ms`; return `${(ms/1000).toFixed(2)}s`; };
const fmt  = iso => { if (!iso) return ""; return new Date(iso).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"}); };
const fmtDate = iso => { if (!iso) return ""; return new Date(iso).toLocaleDateString([],{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}); };
const elapsed = (s,e) => { if (!s||!e) return null; const ms=new Date(e)-new Date(s); return ms<0?null:ms; };

function extractText(val, limit=1200) {
  if (!val) return null;
  if (typeof val==="string") return val.slice(0,limit);
  if (Array.isArray(val)) {
    return val.map(m => {
      if (typeof m==="string") return m;
      if (m?.content) {
        if (typeof m.content==="string") return `[${m.role||"?"}] ${m.content}`;
        if (Array.isArray(m.content)) return `[${m.role||"?"}] `+m.content.map(c=>c.text||"").join("");
      }
      if (m?.tool) return `[tool_call: ${m.tool}] ${JSON.stringify(m.input||{}).slice(0,200)}`;
      return null;
    }).filter(Boolean).join("\n").slice(0,limit);
  }
  if (val?.text) return String(val.text).slice(0,limit);
  if (val?.content) return extractText(val.content,limit);
  return JSON.stringify(val,null,2).slice(0,limit);
}

function classifyNode(node) {
  const t = (node.type??node.observationType??"").toUpperCase();
  const n = node.name??"";
  const sk = node.metadata?.spanKind??"";
  if (t==="GENERATION") return "GENERATION";
  if (sk==="tool"||n.startsWith("tool:")) return "TOOL";
  if (n.startsWith("llm-turn")) return "LLM_TURN";
  if (t==="EVENT") return "EVENT";
  return t||"SPAN";
}

const NODE = {
  GENERATION: { color:"#d97706", bg:"#fffbeb", border:"#fde68a", label:"GEN"  },
  TOOL:       { color:"#16a34a", bg:"#f0fdf4", border:"#bbf7d0", label:"TOOL" },
  LLM_TURN:   { color:"#2563eb", bg:"#eff6ff", border:"#bfdbfe", label:"TURN" },
  EVENT:      { color:"#7c3aed", bg:"#f5f3ff", border:"#ddd6fe", label:"EVT"  },
  SPAN:       { color:"#374151", bg:"#f9fafb", border:"#e5e7eb", label:"SPAN" },
};
const nodeMeta = node => NODE[classifyNode(node)] ?? NODE.SPAN;

function getTokens(node) {
  const u = node.usage??{};
  return {
    inTok:  u.promptTokens??u.input_tokens??u.prompt_tokens??node.promptTokens??node.input_tokens??null,
    outTok: u.completionTokens??u.output_tokens??u.completion_tokens??node.completionTokens??node.output_tokens??null,
  };
}
const getModel = node => node.model??node.metadata?.model??null;
const getCost  = node => node.calculatedTotalCost??node.totalCost??node.cost??estimateCost(getModel(node),...Object.values(getTokens(node)));

async function fetchAllObs(traceId) {
  const creds = btoa(`${window._lfPub}:${window._lfSec}`);
  let all=[], page=1;
  while (true) {
    const r = await fetch(`${LANGFUSE_BASE}/api/public/observations?traceId=${traceId}&limit=100&page=${page}`,{headers:{Authorization:`Basic ${creds}`}});
    const txt = await r.text();
    if (!r.ok) throw new Error(`${r.status}: ${txt.slice(0,200)}`);
    const {data=[]} = JSON.parse(txt);
    all = all.concat(data);
    if (data.length<100) break;
    page++;
  }
  return all;
}

function buildTree(obs) {
  const map={};
  obs.forEach(o=>{map[o.id]={...o,children:[]};});
  const roots=[];
  obs.forEach(o=>{
    if (o.parentObservationId&&map[o.parentObservationId]) map[o.parentObservationId].children.push(map[o.id]);
    else roots.push(map[o.id]);
  });
  const sort=ns=>{ns.sort((a,b)=>new Date(a.startTime)-new Date(b.startTime));ns.forEach(n=>sort(n.children));};
  sort(roots); return roots;
}

// ─── Fixed column widths for the trace detail tree (right-side cols only) ────
// The name cell is flex:1 so it absorbs all leftover space.
// These px widths are shared between the sticky header and every data row.
const TC = { model:118, tokens:126, cost:72, dur:60, bar:126 };

// ─── Primitives ───────────────────────────────────────────────────────────────
function Pill({children, color, bg, border}) {
  return <span style={{
    display:"inline-flex",alignItems:"center",
    fontSize:10,fontFamily:"var(--font-mono)",fontWeight:500,
    padding:"1px 5px",borderRadius:4,lineHeight:"16px",whiteSpace:"nowrap",
    color:color??"var(--text-3)",
    background:bg??"var(--bg-subtle)",
    border:`1px solid ${border??"var(--border)"}`,
  }}>{children}</span>;
}

function Spinner() {
  return <div style={{display:"flex",justifyContent:"center",padding:48}}>
    <div style={{width:16,height:16,border:"2px solid var(--border)",borderTopColor:"var(--accent)",borderRadius:"50%",animation:"spin 0.7s linear infinite"}} />
  </div>;
}
function ErrMsg({msg}) {
  return <div style={{margin:"12px 0",padding:"10px 14px",borderRadius:"var(--r-md)",background:"var(--red-light)",border:"1px solid #fecaca",color:"var(--red)",fontSize:12,fontFamily:"var(--font-mono)"}}>{msg}</div>;
}
function LoadingDot({loading}) {
  if (!loading) return <span style={{color:"var(--text-5)",fontSize:13}}>—</span>;
  return <span style={{display:"inline-block",width:5,height:5,borderRadius:"50%",background:"var(--text-4)",animation:"pulse 1.2s ease infinite",verticalAlign:"middle"}} />;
}

function Btn({children,onClick,disabled,variant="default",style:sx}) {
  const [h,setH]=useState(false);
  const base={display:"inline-flex",alignItems:"center",gap:4,fontSize:12,fontFamily:"var(--font-sans)",fontWeight:500,padding:"5px 12px",borderRadius:"var(--r-md)",cursor:disabled?"not-allowed":"pointer",opacity:disabled?0.5:1,border:"1px solid",whiteSpace:"nowrap"};
  const v={
    default:{background:h?"var(--bg-hover)":"var(--bg)",borderColor:"var(--border-strong)",color:"var(--text-2)",boxShadow:"var(--shadow-sm)"},
    primary:{background:h?"#1d4ed8":"var(--accent)",borderColor:h?"#1d4ed8":"var(--accent)",color:"#fff",boxShadow:"var(--shadow-sm)"},
    active:{background:"var(--accent-light)",borderColor:"var(--accent-border)",color:"var(--accent)"},
  };
  return <button onClick={onClick} disabled={disabled} onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)} style={{...base,...v[variant],...sx}}>{children}</button>;
}

// ─── IOPanel ──────────────────────────────────────────────────────────────────
function IOPanel({node,meta}) {
  const [tab,setTab]=useState("output");
  const inputText=extractText(node.input), outputText=extractText(node.output);
  const {inTok,outTok}=getTokens(node);
  const cost=getCost(node), model=getModel(node), ms=elapsed(node.startTime,node.endTime);
  const metaRows=[
    ["id",node.id],["name",node.name],["type",classifyNode(node)],["model",model],
    ["start",fmt(node.startTime)],["end",fmt(node.endTime)],["duration",dur(ms)],
    ["in tokens",inTok?.toLocaleString()],["out tokens",outTok?.toLocaleString()],
    ["cost",fmtCost(cost)],["status",node.metadata?.finish??node.statusMessage],
    ["provider",node.metadata?.provider],
  ].filter(([,v])=>v!=null);
  const tabs=[{id:"output",label:"Output",show:!!outputText},{id:"input",label:"Input",show:!!inputText},{id:"meta",label:"Metadata",show:true}];
  return (
    <div style={{margin:"4px 0 6px",background:"var(--bg)",border:"1px solid var(--border)",borderRadius:"var(--r-lg)",overflow:"hidden",boxShadow:"var(--shadow-sm)"}}>
      <div style={{display:"flex",alignItems:"center",borderBottom:"1px solid var(--border)",background:"var(--bg-subtle)",padding:"0 8px"}}>
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{
            padding:"7px 12px",fontSize:12,fontFamily:"var(--font-sans)",fontWeight:tab===t.id?500:400,
            cursor:"pointer",background:"transparent",color:tab===t.id?"var(--text-1)":"var(--text-3)",
            border:"none",borderBottom:tab===t.id?`2px solid ${meta.color}`:"2px solid transparent",
            marginBottom:-1,opacity:t.show?1:0.4,
          }}>{t.label}</button>
        ))}
        <div style={{marginLeft:"auto",display:"flex",gap:8,paddingRight:8,alignItems:"center"}}>
          {model&&<Pill color={NODE.GENERATION.color} bg={NODE.GENERATION.bg} border={NODE.GENERATION.border}>{model.replace(/-\d{4}-\d{2}-\d{2}/,"")}</Pill>}
          {inTok!=null&&<span style={{fontSize:11,fontFamily:"var(--font-mono)",color:"var(--text-3)"}}><span style={{color:"#2563eb"}}>{inTok.toLocaleString()}</span><span style={{color:"var(--text-4)",margin:"0 3px"}}>/</span><span style={{color:"#16a34a"}}>{(outTok||0).toLocaleString()}</span></span>}
          {cost!=null&&<span style={{fontSize:11,fontFamily:"var(--font-mono)",color:"var(--green)",fontWeight:500}}>{fmtCost(cost)}</span>}
          {ms!=null&&<span style={{fontSize:11,fontFamily:"var(--font-mono)",color:"var(--text-3)"}}>{dur(ms)}</span>}
        </div>
      </div>
      <div style={{padding:"12px 16px",maxHeight:260,overflowY:"auto"}}>
        {tab==="output"&&(outputText?<pre style={{color:"#15803d",whiteSpace:"pre-wrap",wordBreak:"break-word",margin:0,lineHeight:1.65,fontSize:12,fontFamily:"var(--font-mono)"}}>{outputText}</pre>:<span style={{color:"var(--text-4)",fontSize:12}}>No output captured</span>)}
        {tab==="input"&&(inputText?<pre style={{color:"#1d4ed8",whiteSpace:"pre-wrap",wordBreak:"break-word",margin:0,lineHeight:1.65,fontSize:12,fontFamily:"var(--font-mono)"}}>{inputText}</pre>:<span style={{color:"var(--text-4)",fontSize:12}}>No input captured</span>)}
        {tab==="meta"&&<div style={{display:"grid",gridTemplateColumns:"110px 1fr",rowGap:5,columnGap:16}}>{metaRows.map(([k,v])=><><span key={k+"-k"} style={{fontSize:11,color:"var(--text-3)",fontFamily:"var(--font-mono)"}}>{k}</span><span key={k+"-v"} style={{fontSize:11,color:"var(--text-2)",wordBreak:"break-all",fontFamily:"var(--font-mono)"}}>{v}</span></>)}</div>}
      </div>
    </div>
  );
}

// ─── TraceNode ────────────────────────────────────────────────────────────────
function TraceNode({node,depth,traceStart,totalDur,isLast}) {
  const [open,setOpen]=useState(depth<3);
  const [expanded,setExpanded]=useState(false);
  const [hover,setHover]=useState(false);
  const ms=elapsed(node.startTime,node.endTime);
  const meta=nodeMeta(node);
  const hasKids=node.children?.length>0;
  const {inTok,outTok}=getTokens(node);
  const cost=getCost(node);
  const model=getModel(node);
  const tStart=traceStart?(new Date(node.startTime)-new Date(traceStart)):0;
  const barLeft=totalDur>0?Math.min((tStart/totalDur)*100,99):0;
  const barWidth=totalDur>0&&ms?Math.max((ms/totalDur)*100,1):1;
  const pad=12+depth*16;

  return (
    <div>
      <div
        onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
        onClick={()=>setExpanded(e=>!e)}
        style={{display:"flex",alignItems:"center",borderBottom:"1px solid var(--border)",background:expanded?"var(--accent-light)":hover?"var(--bg-hover)":"var(--bg)",cursor:"pointer",minHeight:36,transition:"background 0.08s"}}
      >
        {/* Name cell */}
        <div style={{flex:1,minWidth:0,display:"flex",alignItems:"center",paddingLeft:pad,paddingRight:8,gap:6,position:"relative"}}>
          {depth>0&&<>
            <div style={{position:"absolute",left:pad-10,top:0,bottom:isLast?"50%":0,width:1,background:"var(--border)",pointerEvents:"none"}} />
            <div style={{position:"absolute",left:pad-10,top:"50%",width:8,height:1,background:"var(--border)",pointerEvents:"none"}} />
          </>}
          <span
            onClick={e=>{e.stopPropagation();setOpen(o=>!o);}}
            style={{width:14,height:14,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",color:hasKids?"var(--text-3)":"transparent",cursor:hasKids?"pointer":"default",fontSize:9,userSelect:"none",borderRadius:3,background:hasKids&&hover?"var(--border)":"transparent"}}
          >{hasKids?(open?"▾":"▸"):""}</span>
          <Pill color={meta.color} bg={meta.bg} border={meta.border}>{meta.label}</Pill>
          <span style={{fontSize:12,fontFamily:"var(--font-sans)",color:expanded?"var(--accent)":"var(--text-1)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontWeight:expanded?500:400}}>
            {node.name||node.id}
          </span>
        </div>

        {/* Model */}
        <div style={{width:TC.model,flexShrink:0,display:"flex",justifyContent:"flex-end",paddingRight:12}}>
          {model?<Pill>{model.replace("claude-","c-").replace("gpt-","").replace(/-\d{4}-\d{2}-\d{2}/,"")}</Pill>:<span style={{fontSize:12,color:"var(--text-5)"}}>—</span>}
        </div>

        {/* Tokens */}
        <div style={{width:TC.tokens,flexShrink:0,textAlign:"right",paddingRight:12}}>
          {inTok!=null
            ?<span style={{fontSize:11,fontFamily:"var(--font-mono)",color:"var(--text-2)"}}><span style={{color:"#2563eb"}}>{inTok.toLocaleString()}</span><span style={{color:"var(--text-4)",margin:"0 2px"}}>·</span><span style={{color:"#16a34a"}}>{(outTok||0).toLocaleString()}</span></span>
            :<span style={{fontSize:12,color:"var(--text-5)"}}>—</span>
          }
        </div>

        {/* Cost */}
        <div style={{width:TC.cost,flexShrink:0,textAlign:"right",paddingRight:12}}>
          {cost!=null?<span style={{fontSize:11,fontFamily:"var(--font-mono)",color:"var(--green)",fontWeight:500}}>{fmtCost(cost)}</span>:<span style={{fontSize:12,color:"var(--text-5)"}}>—</span>}
        </div>

        {/* Dur */}
        <div style={{width:TC.dur,flexShrink:0,textAlign:"right",paddingRight:12}}>
          <span style={{fontSize:11,fontFamily:"var(--font-mono)",color:"var(--text-3)"}}>{dur(ms)}</span>
        </div>

        {/* Bar */}
        <div style={{width:TC.bar,flexShrink:0,paddingRight:16}}>
          <div style={{height:3,background:"var(--border)",borderRadius:2,position:"relative",overflow:"hidden"}}>
            <div style={{position:"absolute",left:`${barLeft}%`,width:`${barWidth}%`,height:"100%",background:meta.color,borderRadius:2,opacity:expanded?1:0.65}} />
          </div>
        </div>
      </div>

      {expanded&&(
        <div style={{paddingLeft:pad+20,paddingRight:16,paddingTop:4,paddingBottom:4,background:"var(--bg-subtle)",borderBottom:"1px solid var(--border)",animation:"slideDown 0.1s ease"}}>
          <IOPanel node={node} meta={meta} />
        </div>
      )}

      {open&&hasKids&&node.children.map((child,i)=>(
        <TraceNode key={child.id} node={child} depth={depth+1} traceStart={traceStart} totalDur={totalDur} isLast={i===node.children.length-1} />
      ))}
    </div>
  );
}

// ─── TraceDetail ──────────────────────────────────────────────────────────────
function TraceDetail({trace,onBack}) {
  const [obs,setObs]=useState(null);
  const [loading,setLoading]=useState(true);
  const [err,setErr]=useState(null);
  useEffect(()=>{
    (async()=>{try{setObs(await fetchAllObs(trace.id));}catch(e){setErr(e.message);}finally{setLoading(false);}})();
  },[trace.id]);

  const tree=obs?buildTree(obs):[];
  const lastEnd=obs?.reduce((mx,o)=>(!o.endTime?mx:o.endTime>mx?o.endTime:mx),trace.timestamp);
  const totalDur=elapsed(trace.timestamp,lastEnd);
  const totalIn=obs?.reduce((s,o)=>s+(getTokens(o).inTok||0),0)||null;
  const totalOut=obs?.reduce((s,o)=>s+(getTokens(o).outTok||0),0)||null;
  const totalCost=obs?.reduce((s,o)=>s+(getCost(o)||0),0)||null;
  const gens=obs?.filter(o=>classifyNode(o)==="GENERATION").length??0;
  const tools=obs?.filter(o=>classifyNode(o)==="TOOL").length??0;
  const models=obs?[...new Set(obs.map(getModel).filter(Boolean))]:[];
  const stats=[
    {l:"Duration",v:dur(totalDur)},
    {l:"Observations",v:obs?.length},
    {l:"LLM calls",v:gens||null},
    {l:"Tool calls",v:tools||null},
    ...(totalIn?[{l:"Input tok",v:totalIn.toLocaleString()}]:[]),
    ...(totalOut?[{l:"Output tok",v:totalOut.toLocaleString()}]:[]),
    ...(totalCost?[{l:"Total cost",v:fmtCost(totalCost),green:true}]:[]),
  ].filter(s=>s.v!=null);

  return (
    <div>
      <div style={{padding:"16px 0",borderBottom:"1px solid var(--border)"}}>
        <button onClick={onBack} style={{background:"none",border:"none",cursor:"pointer",fontSize:12,color:"var(--text-3)",fontFamily:"var(--font-sans)",display:"flex",alignItems:"center",gap:4,marginBottom:12,padding:0}}
          onMouseEnter={e=>e.currentTarget.style.color="var(--text-1)"}
          onMouseLeave={e=>e.currentTarget.style.color="var(--text-3)"}
        >← Traces</button>
        <div style={{display:"flex",alignItems:"flex-start",gap:16,flexWrap:"wrap"}}>
          <div style={{flex:1,minWidth:0}}>
            <h1 style={{fontSize:18,fontWeight:600,color:"var(--text-1)",fontFamily:"var(--font-sans)",letterSpacing:"-0.01em"}}>{trace.name||trace.id}</h1>
            <div style={{display:"flex",gap:10,marginTop:4,alignItems:"center",flexWrap:"wrap"}}>
              <span style={{fontSize:11,color:"var(--text-3)",fontFamily:"var(--font-mono)"}}>{fmtDate(trace.timestamp)}</span>
              <span style={{fontSize:11,color:"var(--text-4)",fontFamily:"var(--font-mono)"}}>{trace.id}</span>
              {models.map(m=><Pill key={m} color={NODE.GENERATION.color} bg={NODE.GENERATION.bg} border={NODE.GENERATION.border}>{m}</Pill>)}
            </div>
          </div>
          {obs&&<div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {stats.map(s=>(
              <div key={s.l} style={{padding:"8px 14px",borderRadius:"var(--r-md)",textAlign:"center",background:"var(--bg-subtle)",border:"1px solid var(--border)",boxShadow:"var(--shadow-sm)"}}>
                <div style={{fontSize:15,fontWeight:600,fontFamily:"var(--font-mono)",color:s.green?"var(--green)":"var(--text-1)"}}>{s.v}</div>
                <div style={{fontSize:10,color:"var(--text-3)",marginTop:2,fontFamily:"var(--font-sans)"}}>{s.l}</div>
              </div>
            ))}
          </div>}
        </div>
      </div>

      {/* Table */}
      <div style={{border:"1px solid var(--border)",borderRadius:"var(--r-lg)",overflow:"hidden",marginTop:16,boxShadow:"var(--shadow-sm)"}}>
        {/* Header — identical flex layout to rows */}
        <div style={{display:"flex",alignItems:"center",background:"var(--bg-subtle)",borderBottom:"1px solid var(--border)",minHeight:34}}>
          <div style={{flex:1,paddingLeft:12,paddingRight:8}}>
            <span style={{fontSize:11,fontWeight:500,color:"var(--text-3)",fontFamily:"var(--font-sans)"}}>Name</span>
          </div>
          <div style={{width:TC.model, flexShrink:0,textAlign:"right",paddingRight:12}}><span style={{fontSize:11,fontWeight:500,color:"var(--text-3)",fontFamily:"var(--font-sans)"}}>Model</span></div>
          <div style={{width:TC.tokens,flexShrink:0,textAlign:"right",paddingRight:12}}><span style={{fontSize:11,fontWeight:500,color:"var(--text-3)",fontFamily:"var(--font-sans)"}}>Input · Output</span></div>
          <div style={{width:TC.cost,  flexShrink:0,textAlign:"right",paddingRight:12}}><span style={{fontSize:11,fontWeight:500,color:"var(--text-3)",fontFamily:"var(--font-sans)"}}>Cost</span></div>
          <div style={{width:TC.dur,   flexShrink:0,textAlign:"right",paddingRight:12}}><span style={{fontSize:11,fontWeight:500,color:"var(--text-3)",fontFamily:"var(--font-sans)"}}>Dur</span></div>
          <div style={{width:TC.bar,   flexShrink:0,paddingRight:16}}><span style={{fontSize:11,fontWeight:500,color:"var(--text-3)",fontFamily:"var(--font-sans)"}}>Timeline</span></div>
        </div>
        <div>
          {loading&&<Spinner />}
          {err&&<div style={{padding:16}}><ErrMsg msg={err} /></div>}
          {!loading&&!err&&tree.length===0&&<div style={{color:"var(--text-4)",fontSize:13,padding:40,textAlign:"center"}}>No observations found</div>}
          {tree.map((node,i)=><TraceNode key={node.id} node={node} depth={0} traceStart={trace.timestamp} totalDur={totalDur} isLast={i===tree.length-1} />)}
        </div>
      </div>

      <div style={{display:"flex",gap:14,padding:"12px 0",flexWrap:"wrap",alignItems:"center"}}>
        {Object.entries(NODE).map(([k,v])=>(
          <div key={k} style={{display:"flex",alignItems:"center",gap:5}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:v.color}} />
            <span style={{fontSize:11,color:"var(--text-3)",fontFamily:"var(--font-sans)"}}>{v.label}</span>
          </div>
        ))}
        <span style={{marginLeft:"auto",fontSize:11,color:"var(--text-4)"}}>Click a row to expand I/O</span>
      </div>
    </div>
  );
}

// ─── TraceList ────────────────────────────────────────────────────────────────
const LC = { tokens:130, cost:82, latency:72, time:88 };
const LT = `1fr 142px ${LC.tokens}px ${LC.cost}px ${LC.latency}px ${LC.time}px`;

function TraceList({traces,onSelect}) {
  const [enriched,setEnriched]=useState({});
  useEffect(()=>{
    traces.forEach(async t=>{
      if (enriched[t.id]) return;
      try {
        const obs=await fetchAllObs(t.id);
        const inTok=obs.reduce((s,o)=>s+(getTokens(o).inTok||0),0);
        const outTok=obs.reduce((s,o)=>s+(getTokens(o).outTok||0),0);
        const cost=obs.reduce((s,o)=>s+(getCost(o)||0),0);
        const models=[...new Set(obs.map(getModel).filter(Boolean))];
        const lastEnd=obs.reduce((mx,o)=>(!o.endTime?mx:o.endTime>mx?o.endTime:mx),t.timestamp);
        const latency=elapsed(t.timestamp,lastEnd);
        const genCount=obs.filter(o=>classifyNode(o)==="GENERATION").length;
        const toolCount=obs.filter(o=>classifyNode(o)==="TOOL").length;
        setEnriched(prev=>({...prev,[t.id]:{inTok:inTok||null,outTok:outTok||null,cost:cost||null,models,latency,spans:obs.length,genCount,toolCount}}));
      } catch {}
    });
  },[traces]);

  const hCell={fontSize:11,fontWeight:500,color:"var(--text-3)",fontFamily:"var(--font-sans)"};
  return (
    <div style={{border:"1px solid var(--border)",borderRadius:"var(--r-lg)",overflow:"hidden",boxShadow:"var(--shadow-sm)"}}>
      <div style={{display:"grid",gridTemplateColumns:LT,padding:"0 16px",minHeight:34,alignItems:"center",background:"var(--bg-subtle)",borderBottom:"1px solid var(--border)"}}>
        <span style={hCell}>Name</span>
        <span style={{...hCell,textAlign:"right"}}>Model</span>
        <span style={{...hCell,textAlign:"right"}}>Tokens</span>
        <span style={{...hCell,textAlign:"right"}}>Cost</span>
        <span style={{...hCell,textAlign:"right"}}>Latency</span>
        <span style={{...hCell,textAlign:"right"}}>Time</span>
      </div>
      {traces.map((t,idx)=>{
        const e=enriched[t.id];
        const model=e?.models?.[0]??null;
        const totTok=e?((e.inTok||0)+(e.outTok||0)):null;
        return <TraceRow key={t.id} t={t} idx={idx} e={e} model={model} totTok={totTok} onSelect={onSelect} />;
      })}
    </div>
  );
}

function TraceRow({t,idx,e,model,totTok,onSelect}) {
  const [hover,setHover]=useState(false);
  const cost=e?.cost?fmtCost(e.cost):null;
  const latency=e?.latency?dur(e.latency):null;
  const tokens=totTok?totTok.toLocaleString():null;
  return (
    <div onClick={()=>onSelect(t)} onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
      style={{display:"grid",gridTemplateColumns:LT,padding:"0 16px",minHeight:44,alignItems:"center",background:hover?"var(--bg-hover)":"var(--bg)",borderBottom:"1px solid var(--border)",cursor:"pointer",transition:"background 0.08s",animation:`fadeIn 0.2s ease ${idx*0.012}s both`}}>
      <div style={{minWidth:0}}>
        <div style={{fontSize:13,fontWeight:500,fontFamily:"var(--font-sans)",color:hover?"var(--accent)":"var(--text-1)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",transition:"color 0.08s",display:"flex",alignItems:"center",gap:6}}>
          <span style={{width:6,height:6,borderRadius:"50%",background:"var(--accent)",flexShrink:0,opacity:0.7}} />
          {t.name||t.id}
        </div>
        <div style={{fontSize:10,color:"var(--text-4)",fontFamily:"var(--font-mono)",marginTop:2,paddingLeft:12,display:"flex",gap:8}}>
          <span>{t.id.slice(0,20)}…</span>
          {e?.spans!=null&&<span>{e.spans} spans</span>}
          {e?.genCount>0&&<span style={{color:NODE.GENERATION.color}}>{e.genCount} gen</span>}
          {e?.toolCount>0&&<span style={{color:NODE.TOOL.color}}>{e.toolCount} tools</span>}
        </div>
      </div>
      <div style={{textAlign:"right"}}>{model?<Pill>{model.replace("claude-","c-").replace("gpt-","").replace(/-\d{4}-\d{2}-\d{2}/,"")}</Pill>:<span style={{fontSize:12,color:"var(--text-5)"}}>—</span>}</div>
      <div style={{textAlign:"right"}}>{tokens?<span style={{fontSize:12,fontFamily:"var(--font-mono)",color:"var(--amber)"}}>{tokens}</span>:<LoadingDot loading={e?.spans==null} />}</div>
      <div style={{textAlign:"right"}}>{cost?<span style={{fontSize:12,fontFamily:"var(--font-mono)",color:"var(--green)",fontWeight:500}}>{cost}</span>:<LoadingDot loading={e?.spans==null} />}</div>
      <div style={{textAlign:"right"}}>{latency?<span style={{fontSize:12,fontFamily:"var(--font-mono)",color:"var(--text-2)"}}>{latency}</span>:<LoadingDot loading={e?.spans==null} />}</div>
      <div style={{textAlign:"right"}}><span style={{fontSize:11,fontFamily:"var(--font-mono)",color:"var(--text-3)"}}>{fmt(t.timestamp)}</span></div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
const IS = {background:"var(--bg)",border:"1px solid var(--border-strong)",borderRadius:"var(--r-md)",padding:"6px 10px",color:"var(--text-1)",fontSize:13,fontFamily:"var(--font-sans)",boxShadow:"var(--shadow-sm)",width:210};

export default function App() {
  const [pub,setPub]=useState("");
  const [sec,setSec]=useState("");
  const [connected,setConnected]=useState(false);
  const [traces,setTraces]=useState([]);
  const [loading,setLoading]=useState(false);
  const [err,setErr]=useState(null);
  const [selected,setSelected]=useState(null);
  const [search,setSearch]=useState("");
  const [autoRefresh,setAutoRefresh]=useState(false);
  const iRef=useRef(null);

  async function connect() {
    setLoading(true); setErr(null);
    try {
      const creds=btoa(`${pub}:${sec}`);
      window._lfPub=pub; window._lfSec=sec;
      const r=await fetch(`${LANGFUSE_BASE}/api/public/traces?limit=50`,{headers:{Authorization:`Basic ${creds}`}});
      if (!r.ok) throw new Error(`HTTP ${r.status} — check credentials`);
      setTraces((await r.json()).data||[]);
      setConnected(true);
    } catch(e){setErr(e.message);}
    finally{setLoading(false);}
  }

  async function refresh() {
    if (!connected) return;
    try {
      const creds=btoa(`${window._lfPub}:${window._lfSec}`);
      const r=await fetch(`${LANGFUSE_BASE}/api/public/traces?limit=50`,{headers:{Authorization:`Basic ${creds}`}});
      if (r.ok) setTraces((await r.json()).data||[]);
    } catch {}
  }

  useEffect(()=>{
    if (autoRefresh&&connected) iRef.current=setInterval(refresh,4000);
    else clearInterval(iRef.current);
    return ()=>clearInterval(iRef.current);
  },[autoRefresh,connected]);

  const filtered=traces.filter(t=>!search||(t.name||t.id).toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <style>{GLOBAL_CSS}</style>
      <div style={{minHeight:"100vh",background:"var(--bg)",color:"var(--text-1)",fontFamily:"var(--font-sans)",display:"flex",flexDirection:"column"}}>

        {/* Navbar */}
        <header style={{borderBottom:"1px solid var(--border)",background:"var(--bg)",position:"sticky",top:0,zIndex:10,boxShadow:"0 1px 0 var(--border)"}}>
          <div style={{maxWidth:1140,margin:"0 auto",display:"flex",alignItems:"center",gap:12,padding:"0 24px",height:52}}>
            <div style={{display:"flex",alignItems:"center",gap:7,flexShrink:0}}>
              <div style={{width:24,height:24,background:"var(--text-1)",borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,color:"var(--bg)",fontWeight:700}}>T</div>
              <span style={{fontSize:14,fontWeight:600,color:"var(--text-1)",letterSpacing:"-0.01em"}}>tracescope</span>
            </div>
            <div style={{width:1,height:18,background:"var(--border)",flexShrink:0,margin:"0 4px"}} />
            {!connected?(
              <div style={{display:"flex",gap:8,alignItems:"center",flex:1}}>
                <input placeholder="pk-lf-…" value={pub} onChange={e=>setPub(e.target.value)} style={IS} />
                <input type="password" placeholder="sk-lf-…" value={sec} onChange={e=>setSec(e.target.value)} onKeyDown={e=>e.key==="Enter"&&connect()} style={{...IS,width:185}} />
                <Btn onClick={connect} disabled={loading||!pub||!sec} variant="primary">{loading?"Connecting…":"Connect"}</Btn>
                {err&&<span style={{fontSize:11,color:"var(--red)",fontFamily:"var(--font-mono)"}}>{err}</span>}
              </div>
            ):(
              <div style={{display:"flex",gap:8,alignItems:"center",marginLeft:"auto"}}>
                <div style={{display:"flex",alignItems:"center",gap:5,padding:"4px 10px",background:"var(--green-light)",border:"1px solid var(--green-border)",borderRadius:"var(--r-md)"}}>
                  <div style={{width:5,height:5,borderRadius:"50%",background:"var(--green)",boxShadow:"0 0 4px var(--green)"}} />
                  <span style={{fontSize:11,color:"var(--green)",fontFamily:"var(--font-sans)",fontWeight:500}}>Connected</span>
                </div>
                <Btn onClick={()=>setAutoRefresh(a=>!a)} variant={autoRefresh?"active":"default"}>{autoRefresh?"● Live":"Auto-refresh"}</Btn>
                <Btn onClick={refresh}>Refresh</Btn>
                <Btn onClick={()=>{setConnected(false);setTraces([]);setSelected(null);}}>Disconnect</Btn>
              </div>
            )}
          </div>
        </header>

        {/* Body */}
        <main style={{flex:1,maxWidth:1140,width:"100%",margin:"0 auto",padding:"24px"}}>
          {!connected?(
            <div style={{height:"65vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:14,animation:"fadeIn 0.3s ease"}}>
              <div style={{width:48,height:48,background:"var(--bg-subtle)",border:"1px solid var(--border)",borderRadius:12,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,fontWeight:700,color:"var(--text-3)"}}>T</div>
              <div style={{textAlign:"center"}}>
                <p style={{fontSize:15,fontWeight:500,color:"var(--text-1)",marginBottom:4}}>Connect to Langfuse</p>
                <p style={{fontSize:12,color:"var(--text-3)",fontFamily:"var(--font-mono)"}}>{LANGFUSE_BASE}</p>
              </div>
            </div>
          ):selected?(
            <div style={{animation:"fadeIn 0.12s ease"}}><TraceDetail trace={selected} onBack={()=>setSelected(null)} /></div>
          ):(
            <div style={{animation:"fadeIn 0.15s ease"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
                <h1 style={{fontSize:20,fontWeight:600,color:"var(--text-1)",letterSpacing:"-0.01em"}}>Traces</h1>
                <span style={{fontSize:12,color:"var(--text-3)"}}>{filtered.length} trace{filtered.length!==1?"s":""}</span>
              </div>
              <div style={{marginBottom:12}}>
                <input placeholder="Search by name or ID…" value={search} onChange={e=>setSearch(e.target.value)} style={{...IS,width:"100%",maxWidth:360}} />
              </div>
              {filtered.length===0
                ?<div style={{color:"var(--text-4)",fontSize:13,padding:48,textAlign:"center"}}>No traces found</div>
                :<TraceList traces={filtered} onSelect={setSelected} />
              }
            </div>
          )}
        </main>
      </div>
    </>
  );
}