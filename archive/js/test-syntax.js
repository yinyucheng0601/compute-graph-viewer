console.log('Checking syntax...')
import { useState, useMemo, useEffect, useCallback } from "react";

const CORE = [
  "#26B0E5","#44DFC7","#6DD401","#8E58FA",
  "#A6B500","#E03995","#F7B501","#FA6401",
];

// ─── Color Math ───────────────────────────────────────────────────────────────
function hexToRgb(hex){const h=hex.replace("#","");return{r:parseInt(h.slice(0,2),16),g:parseInt(h.slice(2,4),16),b:parseInt(h.slice(4,6),16)};}
function rgbToHsl({r,g,b}){r/=255;g/=255;b/=255;const max=Math.max(r,g,b),min=Math.min(r,g,b);let h=0,s=0,l=(max+min)/2;if(max!==min){const d=max-min;s=l>0.5?d/(2-max-min):d/(max+min);switch(max){case r:h=((g-b)/d+(g<b?6:0))/6;break;case g:h=((b-r)/d+2)/6;break;case b:h=((r-g)/d+4)/6;break;}}return{h:h*360,s:s*100,l:l*100};}
function hslToHex({h,s,l}){h/=360;s/=100;l/=100;const q=l<0.5?l*(1+s):l+s-l*s,p=2*l-q;const v=n=>{let t=n;if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p;};return"#"+[v(h+1/3),v(h),v(h-1/3)].map(x=>Math.round(x*255).toString(16).padStart(2,"0")).join("").toUpperCase();}
function hexToHsl(hex){return rgbToHsl(hexToRgb(hex));}
function luminance(hex){const{r,g,b}=hexToRgb(hex);const f=c=>{c/=255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4);};return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b);}
function fg(hex){return luminance(hex)>0.35?"#111":"#fff";}

// ─── Expand Palette ───────────────────────────────────────────────────────────
function expandPalette(baseHexes, targetCount, lightMode=false){
  if(targetCount<=baseHexes.length) return baseHexes.slice(0,targetCount);
  let pal=baseHexes.map(h=>({hex:h,...hexToHsl(h)}));
  while(pal.length<targetCount){
    pal.sort((a,b)=>a.h-b.h);
    const gaps=pal.map((c,i)=>{const nx=pal[(i+1)%pal.length];const g=i===pal.length-1?(360-c.h)+nx.h:nx.h-c.h;return{g,c,nx};});
    const best=gaps.reduce((a,b)=>b.g>a.g?b:a);
    const newH=(best.c.h+best.g/2)%360;
    const avgS=(best.c.s+best.nx.s)/2,avgL=(best.c.l+best.nx.l)/2;
    const vari=((pal.length-baseHexes.length)%3)-1;
    const newS=Math.min(95,Math.max(55,avgS+vari*5+(lightMode?-14:0)));
    const newL=Math.min(lightMode?90:72,Math.max(lightMode?80:42,avgL+vari*2+(lightMode?35:0)));
    pal.push({hex:hslToHex({h:newH,s:newS,l:newL}),h:newH,s:newS,l:newL});
  }
  pal.sort((a,b)=>a.h-b.h);
  return pal.map(p=>p.hex);
}

// ─── Compute one algorithm step ───────────────────────────────────────────────
function analyzeStep(hexes, lightMode){
  const sorted=hexes.map(h=>({hex:h,...hexToHsl(h)})).sort((a,b)=>a.h-b.h);
  const gaps=sorted.map((c,i)=>{
    const nx=sorted[(i+1)%sorted.length];
    const gapDeg=i===sorted.length-1?(360-c.h)+nx.h:nx.h-c.h;
    const midH=(c.h+gapDeg/2)%360;
    return{from:c,to:nx,gapDeg,midH};
  });
  const largest=gaps.reduce((a,b)=>b.gapDeg>a.gapDeg?b:a);
  const vari=((hexes.length-CORE.length)%3)-1;
  const avgS=(largest.from.s+largest.to.s)/2,avgL=(largest.from.l+largest.to.l)/2;
  const nextS=Math.min(95,Math.max(55,avgS+vari*5+(lightMode?-14:0)));
  const nextL=Math.min(lightMode?90:72,Math.max(lightMode?80:42,avgL+vari*2+(lightMode?35:0)));
  const nextHex=hslToHex({h:largest.midH,s:nextS,l:nextL});
  return{sorted,gaps,largest,nextHex};
}

// ─── Theme ────────────────────────────────────────────────────────────────────
const DARK ={bg:"#1e1e1e",surface:"#252525",surface2:"#2f2f2f",border:"#3a3a3a",text:"#e8e8e8",textMid:"#888",textDim:"#4a4a4a",accent:"#26B0E5"};
const LIGHT={bg:"#efefef",surface:"#ffffff",surface2:"#e8e8e8",border:"#d0d0d0",text:"#1a1a1a",textMid:"#666",textDim:"#bbb",accent:"#26B0E5"};

// ─── SVG helpers ──────────────────────────────────────────────────────────────
const SZ=500, CX=250, CY=250;
const Ro=208, Ri=188; // hue ring outer/inner radius
const Rd=178;          // dot radius
const Ra=135;          // gap arc radius
const Rl=108;          // label radius

function hp(h,r){
  const a=(h-90)*Math.PI/180;
  return[CX+r*Math.cos(a), CY+r*Math.sin(a)];
}

function arcD(h1,h2,gapDeg,r){
  const[x1,y1]=hp(h1,r);
  const[x2,y2]=hp(h2,r);
  return`M${x1} ${y1} A${r} ${r} 0 ${gapDeg>180?1:0} 1 ${x2} ${y2}`;
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App(){
  const[count,setCount]=useState(8);
  const[dark,setDark]=useState(true);
  const[playing,setPlaying]=useState(false);
  const[copied,setCopied]=useState(null);
  const T=dark?DARK:LIGHT;
  const lm=!dark;

  const palette=useMemo(()=>expandPalette(CORE,count,lm),[count,lm]);
  const{sorted,gaps,largest,nextHex}=useMemo(()=>analyzeStep(palette,lm),[palette,lm]);

  // auto-play
  useEffect(()=>{
    if(!playing||count>=48){setPlaying(false);return;}
    const t=setTimeout(()=>setCount(c=>c+1),950);
    return()=>clearTimeout(t);
  },[playing,count]);

  const addOne=useCallback(()=>setCount(c=>Math.min(48,c+1)),[]);
  const removeOne=useCallback(()=>setCount(c=>Math.max(8,c-1)),[]);
  const reset=useCallback(()=>{setCount(8);setPlaying(false);},[]);

  const copyHex=useCallback((hex)=>{
    navigator.clipboard?.writeText(hex).catch(()=>{});
    setCopied(hex);setTimeout(()=>setCopied(null),1200);
  },[]);

  // largest gap boundary check
  const isLargestBoundary=hex=>hex===largest.from.hex||hex===largest.to.hex;

  return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.text,fontFamily:"'Outfit','Segoe UI',sans-serif",padding:"20px 16px",transition:"background 0.25s,color 0.25s"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box;}
        @keyframes gpulse{0%,100%{opacity:0.35;transform:scale(1)}50%{opacity:0.8;transform:scale(1.1)}}
        @keyframes glow-ring{0%,100%{opacity:0.2}50%{opacity:0.55}}
        ::-webkit-scrollbar{width:5px;height:5px;} ::-webkit-scrollbar-track{background:${T.bg};} ::-webkit-scrollbar-thumb{background:${T.surface2};border-radius:3px;}
        .swatch{transition:transform 0.1s,box-shadow 0.12s;cursor:pointer;}
        .swatch:hover{transform:translateY(-3px)!important;}
      `}</style>

      <div style={{maxWidth:580,margin:"0 auto"}}>

        {/* ── Header ── */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16,gap:10,flexWrap:"wrap"}}>
          <div>
            <h1 style={{margin:0,fontSize:20,fontWeight:700,letterSpacing:"-0.02em"}}>色相间隔二分法</h1>
            <p style={{margin:"3px 0 0",fontSize:12,color:T.textMid}}>
              每步找最大色相间隔 → 在中点插入新颜色 · {count} 色
            </p>
          </div>
          {/* Mode toggle */}
          <button onClick={()=>setDark(d=>!d)} style={{
            display:"flex",alignItems:"center",gap:7,background:T.surface2,
            border:`1px solid ${T.border}`,borderRadius:24,padding:"5px 13px 5px 7px",
            cursor:"pointer",color:T.textMid,fontSize:12,fontFamily:"inherit",flexShrink:0,
          }}>
            <div style={{width:34,height:19,borderRadius:10,background:dark?"#383838":"#ddd",
              position:"relative",border:`1px solid ${T.border}`}}>
              <div style={{position:"absolute",top:2,left:dark?16:2,width:13,height:13,
                borderRadius:"50%",background:dark?"#aaa":"#fff",
                boxShadow:"0 1px 3px rgba(0,0,0,0.3)",
                transition:"left 0.2s cubic-bezier(.4,0,.2,1)",
                display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,
              }}>{dark?"🌙":"☀️"}</div>
            </div>
            {dark?"Dark":"Light"}
          </button>
        </div>

        {/* ── Algorithm Visualization ── */}
        <div style={{background:T.surface,borderRadius:18,border:`1px solid ${T.border}`,overflow:"hidden",marginBottom:12}}>
          <svg width="100%" viewBox={`0 0 ${SZ} ${SZ}`} style={{display:"block"}}>
            <defs>
              <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="5" result="blur"/>
                <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
              <filter id="glow2" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="3" result="blur"/>
                <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
              <radialGradient id="bggrad" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor={dark?"#2a2a2a":"#f8f8f8"}/>
                <stop offset="100%" stopColor={T.bg}/>
              </radialGradient>
            </defs>

            {/* Background */}
            <circle cx={CX} cy={CY} r={SZ/2} fill="url(#bggrad)"/>

            {/* ── Degree tick marks ── */}
            {[0,30,60,90,120,150,180,210,240,270,300,330].map(deg=>{
              const a=(deg-90)*Math.PI/180;
              const [x1,y1]=[CX+(Ro+3)*Math.cos(a),CY+(Ro+3)*Math.sin(a)];
              const [x2,y2]=[CX+(Ro+14)*Math.cos(a),CY+(Ro+14)*Math.sin(a)];
              const [xt,yt]=[CX+(Ro+25)*Math.cos(a),CY+(Ro+25)*Math.sin(a)];
              return <g key={deg}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={T.textDim} strokeWidth={1.2}/>
                <text x={xt} y={yt} textAnchor="middle" dominantBaseline="middle"
                  fill={T.textDim} fontSize={9} fontFamily="'JetBrains Mono',monospace">{deg}°</text>
              </g>;
            })}

            {/* ── Hue ring (rainbow wedges) ── */}
            {Array.from({length:360},(_,deg)=>{
              const a1=(deg-0.7-90)*Math.PI/180, a2=(deg+0.7-90)*Math.PI/180;
              const pts=`${CX+Ri*Math.cos(a1)} ${CY+Ri*Math.sin(a1)} ${CX+Ro*Math.cos(a1)} ${CY+Ro*Math.sin(a1)} ${CX+Ro*Math.cos(a2)} ${CY+Ro*Math.sin(a2)} ${CX+Ri*Math.cos(a2)} ${CY+Ri*Math.sin(a2)}`;
              return <polygon key={deg} points={pts} fill={`hsl(${deg},82%,56%)`}/>;
            })}

            {/* ── Ring inner shadow (to separate ring from interior) ── */}
            <circle cx={CX} cy={CY} r={Ri} fill={dark?"#1e1e1e":"#efefef"} opacity={0.55}/>

            {/* ── Radial spokes from ring to dots ── */}
            {sorted.map((c,i)=>{
              const[x1,y1]=hp(c.h,Rd+2);
              const[x2,y2]=hp(c.h,Ri-2);
              return<line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={c.hex} strokeWidth={1.5} opacity={0.3}/>;
            })}

            {/* ── All gap arcs (non-largest) ── */}
            {gaps.map((gap,i)=>{
              if(gap===largest) return null;
              const midH=(gap.from.h+gap.gapDeg/2)%360;
              return <g key={i}>
                <path d={arcD(gap.from.h,gap.to.h,gap.gapDeg,Ra)}
                  stroke={`hsl(${midH},65%,58%)`} strokeWidth={2.5}
                  strokeOpacity={dark?0.28:0.38} fill="none" strokeLinecap="round"/>
                {/* gap size label – only if gap is large enough to show */}
                {gap.gapDeg>=18&&(()=>{
                  const[lx,ly]=hp(gap.midH,Rl-4);
                  return<text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
                    fill={dark?"rgba(255,255,255,0.3)":"rgba(0,0,0,0.3)"}
                    fontSize={9} fontFamily="'JetBrains Mono',monospace">
                    {Math.round(gap.gapDeg)}°
                  </text>;
                })()}
              </g>;
            })}

            {/* ── Largest gap arc ── */}
            {/* Glow copy */}
            <path d={arcD(largest.from.h,largest.to.h,largest.gapDeg,Ra)}
              stroke="#FFCC00" strokeWidth={10} strokeOpacity={0.18}
              fill="none" strokeLinecap="round"/>
            {/* Main stroke */}
            <path d={arcD(largest.from.h,largest.to.h,largest.gapDeg,Ra)}
              stroke="#FFCC00" strokeWidth={3.5} strokeOpacity={0.95}
              fill="none" strokeLinecap="round" filter="url(#glow)"/>
            {/* Dashed half-lines showing the bisection */}
            {(()=>{
              const[mx,my]=hp(largest.midH,Ra);
              const[fx,fy]=hp(largest.from.h,Ra);
              const[tx,ty]=hp(largest.to.h,Ra);
              return<>
                <line x1={fx} y1={fy} x2={mx} y2={my}
                  stroke="#FFCC00" strokeWidth={1} strokeOpacity={0.45} strokeDasharray="4 3"/>
                <line x1={tx} y1={ty} x2={mx} y2={my}
                  stroke="#FFCC00" strokeWidth={1} strokeOpacity={0.45} strokeDasharray="4 3"/>
                {/* midpoint cross */}
                <line x1={mx-5} y1={my} x2={mx+5} y2={my}
                  stroke="#FFCC00" strokeWidth={1.5} strokeOpacity={0.7}/>
                <line x1={mx} y1={my-5} x2={mx} y2={my+5}
                  stroke="#FFCC00" strokeWidth={1.5} strokeOpacity={0.7}/>
              </>;
            })()}

            {/* Largest gap size label */}
            {(()=>{
              const[lx,ly]=hp(largest.midH,Rl-4);
              return<>
                <text x={lx} y={ly-7} textAnchor="middle" dominantBaseline="middle"
                  fill="#FFCC00" fontSize={14} fontWeight={700}
                  fontFamily="'JetBrains Mono',monospace" filter="url(#glow)">
                  {Math.round(largest.gapDeg)}°
                </text>
                <text x={lx} y={ly+9} textAnchor="middle" dominantBaseline="middle"
                  fill="#FFCC00" fontSize={8} opacity={0.75} fontFamily="inherit">
                  MAX GAP
                </text>
              </>;
            })()}

            {/* ── Existing color dots ── */}
            {sorted.map((c,i)=>{
              const[x,y]=hp(c.h,Rd);
              const isBound=isLargestBoundary(c.hex);
              return<g key={i}>
                {/* boundary highlight ring */}
                {isBound&&<circle cx={x} cy={y} r={16} fill="none"
                  stroke="#FFCC00" strokeWidth={1.5} strokeOpacity={0.55}/>}
                {/* dot shadow/glow */}
                <circle cx={x} cy={y} r={11}
                  fill={c.hex} opacity={0.35} style={{filter:`blur(4px)`}}/>
                {/* dot body */}
                <circle cx={x} cy={y} r={9}
                  fill={c.hex}
                  stroke={dark?"rgba(255,255,255,0.75)":"rgba(0,0,0,0.2)"}
                  strokeWidth={2}
                  filter={isBound?"url(#glow2)":undefined}/>
                {/* hue label on dot for core colors */}
                <title>{c.hex} H:{Math.round(c.h)}°</title>
              </g>;
            })}

            {/* ── Ghost dot: next color insertion ── */}
            {count<48&&(()=>{
              const[x,y]=hp(largest.midH,Rd);
              return<g style={{animation:"gpulse 2s ease-in-out infinite"}}>
                {/* outer pulsing ring */}
                <circle cx={x} cy={y} r={20} fill="none"
                  stroke="#FFCC00" strokeWidth={1.5} strokeOpacity={0.4}
                  style={{animation:"glow-ring 2s ease-in-out infinite"}}/>
                {/* dot */}
                <circle cx={x} cy={y} r={9}
                  fill={nextHex}
                  stroke="#FFCC00" strokeWidth={2.5}
                  strokeDasharray="5 2.5"
                  opacity={0.85}/>
                {/* + symbol */}
                <text x={x} y={y} textAnchor="middle" dominantBaseline="middle"
                  fill="#FFCC00" fontSize={11} fontWeight={700} pointerEvents="none"
                  style={{userSelect:"none"}}>+</text>
              </g>;
            })()}

            {/* ── Center info panel ── */}
            <circle cx={CX} cy={CY} r={85}
              fill={T.surface} fillOpacity={dark?0.94:0.97}
              stroke={T.border} strokeWidth={1}/>
            {/* Step indicator */}
            <text x={CX} y={CY-46} textAnchor="middle"
              fill={T.textDim} fontSize={9} fontFamily="'JetBrains Mono',monospace"
              letterSpacing="1">STEP {count - 8 + 1}</text>
            {/* Max gap value */}
            <text x={CX} y={CY-22} textAnchor="middle"
              fill={T.textMid} fontSize={10}>最大间隔</text>
            <text x={CX} y={CY+8} textAnchor="middle"
              fill="#FFCC00" fontSize={30} fontWeight={700}
              fontFamily="'JetBrains Mono',monospace"
              filter="url(#glow2)">
              {Math.round(largest.gapDeg)}°
            </text>
            {/* next color swatch in center */}
            {count<48&&<>
              <rect x={CX-28} y={CY+18} width={56} height={20} rx={6}
                fill={nextHex} opacity={0.9}/>
              <text x={CX} y={CY+28} textAnchor="middle" dominantBaseline="middle"
                fill={fg(nextHex)} fontSize={8} fontFamily="'JetBrains Mono',monospace">
                {nextHex.replace("#","")}
              </text>
              <text x={CX} y={CY+48} textAnchor="middle"
                fill={T.textDim} fontSize={9}>↑ 下一个插入</text>
            </>}
            {/* color count */}
            <text x={CX} y={CY+68} textAnchor="middle"
              fill={T.textDim} fontSize={9} fontFamily="'JetBrains Mono',monospace">
              {count} / 48
            </text>
          </svg>
        </div>

        {/* ── Info Cards ── */}
        <div style={{display:"grid",gridTemplateColumns:"1fr auto 1fr",gap:8,marginBottom:12,alignItems:"center"}}>
          {/* From */}
          <div style={{background:T.surface,borderRadius:12,padding:"10px 12px",border:`1px solid ${T.border}`}}>
            <div style={{fontSize:9,color:T.textMid,marginBottom:5,textTransform:"uppercase",letterSpacing:"0.06em"}}>左边界</div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <div style={{width:28,height:28,borderRadius:7,background:largest.from.hex,
                boxShadow:`0 0 8px ${largest.from.hex}66`,border:"2px solid rgba(255,204,0,0.5)",flexShrink:0}}/>
              <div>
                <div style={{fontSize:10,fontFamily:"'JetBrains Mono',monospace",color:T.text,letterSpacing:"0.04em"}}>
                  {largest.from.hex.replace("#","")}
                </div>
                <div style={{fontSize:9,color:T.textDim}}>H: {Math.round(largest.from.h)}°</div>
              </div>
            </div>
          </div>
          {/* Arrow + gap */}
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
            <div style={{fontSize:11,color:"#FFCC00",fontWeight:700,fontFamily:"'JetBrains Mono',monospace"}}>
              {Math.round(largest.gapDeg)}°
            </div>
            <div style={{fontSize:16,color:T.textDim}}>→</div>
            <div style={{width:6,height:6,borderRadius:"50%",background:nextHex,
              border:"1.5px solid #FFCC00"}}/>
          </div>
          {/* To */}
          <div style={{background:T.surface,borderRadius:12,padding:"10px 12px",border:`1px solid ${T.border}`}}>
            <div style={{fontSize:9,color:T.textMid,marginBottom:5,textTransform:"uppercase",letterSpacing:"0.06em"}}>右边界</div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <div style={{width:28,height:28,borderRadius:7,background:largest.to.hex,
                boxShadow:`0 0 8px ${largest.to.hex}66`,border:"2px solid rgba(255,204,0,0.5)",flexShrink:0}}/>
              <div>
                <div style={{fontSize:10,fontFamily:"'JetBrains Mono',monospace",color:T.text,letterSpacing:"0.04em"}}>
                  {largest.to.hex.replace("#","")}
                </div>
                <div style={{fontSize:9,color:T.textDim}}>H: {Math.round(largest.to.h)}°</div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Controls ── */}
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,flexWrap:"wrap"}}>
          <button onClick={reset} title="重置为8色"
            style={{background:T.surface2,border:`1px solid ${T.border}`,borderRadius:8,
            padding:"7px 11px",cursor:"pointer",color:T.textMid,fontSize:13,fontFamily:"inherit"}}>
            ⏮
          </button>
          <button onClick={removeOne} disabled={count<=8}
            style={{background:T.surface2,border:`1px solid ${T.border}`,borderRadius:8,
            padding:"7px 13px",cursor:count<=8?"not-allowed":"pointer",
            color:T.text,fontSize:13,fontFamily:"inherit",opacity:count<=8?0.35:1}}>
            ← 撤销
          </button>
          <button onClick={addOne} disabled={count>=48}
            style={{background:"#FFCC00",border:"none",borderRadius:8,
            padding:"7px 20px",cursor:count>=48?"not-allowed":"pointer",
            color:"#1a1a1a",fontSize:13,fontWeight:700,fontFamily:"inherit",
            opacity:count>=48?0.4:1,
            boxShadow:count<48?"0 2px 12px rgba(255,204,0,0.4)":"none"}}>
            插入 +
          </button>
          <button onClick={()=>setPlaying(p=>!p)}
            style={{background:playing?"#E03995":T.surface,
            border:`1px solid ${playing?"#E03995":T.border}`,borderRadius:8,
            padding:"7px 14px",cursor:"pointer",
            color:playing?"#fff":T.textMid,fontSize:12,fontFamily:"inherit",
            transition:"all 0.15s"}}>
            {playing?"⏸ 暂停":"▶ 自动播放"}
          </button>
          {/* slider */}
          <div style={{flex:1,minWidth:80,display:"flex",alignItems:"center",gap:6}}>
            <input type="range" min={8} max={48} value={count}
              onChange={e=>setCount(+e.target.value)}
              style={{flex:1,accentColor:"#FFCC00",height:4,cursor:"pointer"}}/>
          </div>
          <span style={{fontSize:11,color:T.textMid,fontFamily:"'JetBrains Mono',monospace",flexShrink:0}}>
            {count}/48
          </span>
        </div>

        {/* ── Palette strip ── */}
        <div style={{background:T.surface,borderRadius:14,padding:"12px 14px",border:`1px solid ${T.border}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <span style={{fontSize:10,color:T.textMid,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.07em"}}>
              当前色板 · {count} 色
            </span>
            <span style={{fontSize:10,color:T.textDim}}>点击复制</span>
          </div>
          <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
            {palette.map((hex,i)=>{
              const isNewest=i===palette.length-1&&count>8;
              const isCopied=copied===hex;
              const isCoreBound=isLargestBoundary(hex);
              return<div key={hex+i} className="swatch"
                onClick={()=>copyHex(hex)}
                title={`${hex}  H:${Math.round(hexToHsl(hex).h)}°`}
                style={{
                  width:36,height:36,borderRadius:8,background:hex,
                  border:isNewest?"2px solid #FFCC00":isCoreBound?"2px solid rgba(255,204,0,0.45)":`1px solid rgba(0,0,0,0.1)`,
                  boxShadow:`0 2px 6px ${hex}44`,
                  position:"relative",
                  display:"flex",alignItems:"center",justifyContent:"center",
                  flexShrink:0,
                }}>
                {isCopied&&<span style={{fontSize:9,fontWeight:700,color:fg(hex),pointerEvents:"none"}}>✓</span>}
              </div>;
            })}
          </div>
          <div style={{display:"flex",gap:14,marginTop:10,fontSize:11,color:T.textDim,flexWrap:"wrap"}}>
            <span style={{display:"flex",alignItems:"center",gap:5}}>
              <span style={{width:10,height:10,background:T.surface2,border:"1.5px solid rgba(255,204,0,0.45)",borderRadius:2,display:"inline-block"}}/>
              当前最大间隔边界
            </span>
            <span style={{display:"flex",alignItems:"center",gap:5}}>
              <span style={{width:10,height:10,background:T.surface2,border:"1.5px solid #FFCC00",borderRadius:2,display:"inline-block"}}/>
              最新插入
            </span>
          </div>
        </div>

      </div>
    </div>
  );
}
