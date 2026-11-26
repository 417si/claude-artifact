'use strict';
/* ==========================================================
   LD-1 · UI components and pages
   ========================================================== */
const UI = {
  tab:'drum', pages:{}, knobs:[], ghosts:new Map(), flash:new Array(6).fill(-1),
  selDrum:0, selSlot:0, acc:false, sub:{bass:'seq',chord:'seq',lead:'play'},
  xyTouch:{}, leadTouches:new Map(), leadPitch:null, chordNotes:[], chordEnd:0, chordT:0,
  bassMidi:null, bassT:0, bassEnd:0, leadOnT:0, leadOffT:0, scratch:null, clip:null
};
const $ = s=>document.querySelector(s);
function h(tag, cls, html){ const e=document.createElement(tag); if(cls) e.className=cls; if(html!==undefined) e.innerHTML=html; return e; }
function fitCanvas(cv){
  const r=cv.getBoundingClientRect(), d=Math.min(window.devicePixelRatio||1,3);
  const w=Math.max(1,Math.round(r.width*d)), hh=Math.max(1,Math.round(r.height*d));
  if(cv.width!==w||cv.height!==hh){ cv.width=w; cv.height=hh; }
  const c=cv.getContext('2d'); c.setTransform(d,0,0,d,0,0);
  return {c, w:r.width, h:r.height};
}
let _toastT=0;
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(_toastT); _toastT=setTimeout(()=>t.classList.remove('show'),1300); }
const css = n=> getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const COL = {};
function pad2(n){ return String(n).padStart(2,'0'); }
function fmtMs(s){ return s<1 ? Math.round(s*1000)+'MS' : s.toFixed(2)+'S'; }
function fmtHz(f){ return f>=1000 ? (f/1000).toFixed(f>=10000?1:2)+'K' : Math.round(f)+'HZ'; }
function tap(el, fn){ el.addEventListener('pointerdown',e=>{ e.preventDefault(); fn(e); }); return el; }

/* ---------- components ---------- */
function arc(cx,cy,r,a0,a1){
  const p=a=>[cx+Math.sin(a*Math.PI/180)*r, cy-Math.cos(a*Math.PI/180)*r];
  const [x0,y0]=p(a0),[x1,y1]=p(a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${(a1-a0)>180?1:0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
function Knob(parent, o){
  const el=h('div','knob');
  el.innerHTML='<svg viewBox="0 0 40 40"><circle class="kb" cx="20" cy="20" r="12.5"/><path class="kt"/><path class="kv"/><line class="kp" x1="20" y1="20" x2="20" y2="11"/></svg><div class="kl"></div>';
  parent.appendChild(el);
  const kt=el.querySelector('.kt'), kv=el.querySelector('.kv'), kp=el.querySelector('.kp'), kl=el.querySelector('.kl');
  const min=o.min??0, max=o.max??1;
  kt.setAttribute('d', arc(20,20,17,-135,135));
  let drag=false, sy=0, sv=0, lastDown=0;
  function draw(){
    const v=o.get(), n=clamp((v-min)/(max-min),0,1), ang=-135+n*270;
    kv.setAttribute('d', n>.004 ? arc(20,20,17,-135,ang) : 'M0 0');
    const r=ang*Math.PI/180; kp.setAttribute('x2',(20+Math.sin(r)*9).toFixed(2)); kp.setAttribute('y2',(20-Math.cos(r)*9).toFixed(2));
    kl.textContent = drag ? (o.fmt?o.fmt(v):Math.round(n*100)) : o.label;
  }
  el.addEventListener('pointerdown',e=>{
    e.preventDefault();
    const now=performance.now();
    if(now-lastDown<300 && o.def!==undefined){ o.set(o.def); lastDown=0; draw(); markDirty(); return; }
    lastDown=now; drag=true; el.classList.add('drag'); el.setPointerCapture(e.pointerId); sy=e.clientY; sv=o.get(); draw();
  });
  el.addEventListener('pointermove',e=>{
    if(!drag) return;
    let v=clamp(sv+(sy-e.clientY)/170*(max-min),min,max);
    if(o.step) v=Math.round(v/o.step)*o.step;
    o.set(v); draw();
  });
  const up=()=>{ if(!drag) return; drag=false; el.classList.remove('drag'); draw(); markDirty(); o.end&&o.end(); };
  el.addEventListener('pointerup',up); el.addEventListener('pointercancel',up);
  const k={el,draw}; UI.knobs.push(k); draw(); return k;
}
function Seg(parent, opts, get, set, cls){
  const el=h('div','seg'+(cls?' '+cls:''));
  const bs=opts.map((o,i)=>{ const b=h('button','',o); tap(b,()=>{ set(i); upd(); markDirty(); }); el.appendChild(b); return b; });
  function upd(){ const v=get(); bs.forEach((b,i)=>b.classList.toggle('on',i===v)); }
  parent.appendChild(el); upd(); return {el,upd};
}
function Btn(parent, label, cls, fn){ const b=h('button','btn'+(cls?' '+cls:''),label); tap(b,fn); parent.appendChild(b); return b; }
function ConfirmBtn(parent, label, fn){
  let armed=0; const b=Btn(parent,label,'',()=>{
    if(armed && performance.now()-armed<1600){ armed=0; b.textContent=label; b.classList.remove('red','on'); fn(); }
    else { armed=performance.now(); b.textContent='SURE?'; b.classList.add('red','on'); setTimeout(()=>{ if(armed){ armed=0; b.textContent=label; b.classList.remove('red','on'); } },1600); }
  });
  return b;
}
const WAVE_SVG=[
  '<svg viewBox="0 0 22 12"><path d="M1 11L11 1V11L21 1"/></svg>',
  '<svg viewBox="0 0 22 12"><path d="M1 11V1H11V11H21V1"/></svg>',
  '<svg viewBox="0 0 22 12"><path d="M1 11L6 1L11 11L16 1L21 11"/></svg>',
  '<svg viewBox="0 0 22 12"><path d="M1 6C3 -1 5 -1 6 6S9 13 11 6S14 -1 16 6S19 13 21 6"/></svg>'
];
function Waves(parent, part){
  const el=h('div','waves');
  const bs=WAVE_SVG.map((s,i)=>{ const b=h('button','',s); tap(b,()=>{ S.synth[part].wave=i; applySynth(part); upd(); markDirty(); audition(part); }); el.appendChild(b); return b; });
  function upd(){ bs.forEach((b,i)=>b.classList.toggle('on',S.synth[part].wave===i)); }
  parent.appendChild(el); upd(); return {el,upd};
}
function gridPaint(gridEl, onCell){
  let active=false, last='';
  gridEl.addEventListener('pointerdown',e=>{
    const c=e.target.closest('[data-s]'); if(!c) return;
    e.preventDefault(); active=true; gridEl.setPointerCapture(e.pointerId);
    last=c.dataset.r+':'+c.dataset.s; onCell(+c.dataset.r,+c.dataset.s,'start');
  });
  gridEl.addEventListener('pointermove',e=>{
    if(!active) return;
    const el=document.elementFromPoint(e.clientX,e.clientY), c=el&&el.closest&&el.closest('[data-s]');
    if(!c||!gridEl.contains(c)) return;
    const k=c.dataset.r+':'+c.dataset.s; if(k===last) return; last=k; onCell(+c.dataset.r,+c.dataset.s,'move');
  });
  const end=()=>{ if(active){ active=false; markDirty(); } };
  gridEl.addEventListener('pointerup',end); gridEl.addEventListener('pointercancel',end);
}
function PH(){ let prev=-1, cols=null; return { set(c, col){ cols=c; if(col===prev) return; if(prev>=0&&cols[prev]) cols[prev].forEach(e=>e.classList.remove('ph')); if(col>=0&&cols[col]) cols[col].forEach(e=>e.classList.add('ph')); prev=col; }, reset(){ prev=-1; } }; }
function now(){ return A.ctx ? A.ctx.currentTime : 0; }

function audition(part){
  if(!A.ctx || Seq.playing) return;
  const t=now()+.01;
  if(part==='bass'){ bassNote(t, degMidi(0,36)+S.synth.bass.oct*12, .3, .85); UI.bassMidi=degMidi(0,36); UI.bassT=t; UI.bassEnd=t+.3; }
  else if(part==='chord'){ auditionChord(cur().chords[UI.selSlot]); }
  else { const v=makeVoice('lead',t,leadRoot()+12+S.synth.lead.oct*12,.55); v.release(t+.35); UI.leadOnT=t; UI.leadOffT=t+.35; }
}
function auditionChord(ch){
  if(!A.ctx) return;
  const sc=cur(), t=now()+.01, vo=sceneVoicings(sc)[UI.selSlot] || chordRaw(ch), p=S.synth.chord;
  for(const m of vo){ const v=makeVoice('chord',t,m+p.oct*12,.5); v.release(t+.7); }
  UI.chordNotes=vo.map(m=>m+p.oct*12); UI.chordT=t; UI.chordEnd=t+.7;
}

/* keyboard canvas */
function drawKeys(cv, lo, hi, lit, outline, color){
  const {c,w,h:hh}=fitCanvas(cv);
  c.clearRect(0,0,w,hh);
  const whites=[]; for(let m=lo;m<=hi;m++) if(![1,3,6,8,10].includes(mod(m,12))) whites.push(m);
  const ww=w/whites.length;
  whites.forEach((m,i)=>{
    const on=lit.has(m), ol=outline&&outline.has(m);
    c.fillStyle = on? color : (inScale(m)?'#1d1d1d':'#141414');
    c.fillRect(i*ww+.5,0,ww-1,hh);
    if(ol && !on){ c.strokeStyle=color; c.lineWidth=1; c.strokeRect(i*ww+1,1,ww-2,hh-2); }
    if(mod(m,12)===mod(S.key,12)){ c.fillStyle=on?'#000':'#ff3b1f'; c.fillRect(i*ww+ww/2-1.5,hh-6,3,3); }
  });
  let wi=0;
  for(let m=lo;m<=hi;m++){
    const pc=mod(m,12), blk=[1,3,6,8,10].includes(pc);
    if(!blk){ wi++; continue; }
    const x=wi*ww-ww*.3, on=lit.has(m), ol=outline&&outline.has(m);
    c.fillStyle= on? color : '#060606'; c.fillRect(x,0,ww*.6,hh*.58);
    c.strokeStyle= ol&&!on ? color : '#2a2a2a'; c.lineWidth=1; c.strokeRect(x+.5,.5,ww*.6-1,hh*.58-1);
  }
}

/* ---------- XY filter pad ---------- */
function XYPad(parent, part, compact){
  const p=()=>S.synth[part];
  const xy=h('canvas','cv xy'+(compact?' xys':'')); parent.appendChild(xy);
  let xyId=null;
  const xyset=(e,phase)=>{
    const r=xy.getBoundingClientRect();
    const x=clamp((e.clientX-r.left)/r.width,0,1), y=clamp(1-(e.clientY-r.top)/r.height,0,1);
    p().cut=x; p().res=y; A.live[part]={cut:x,res:y}; applyLive(part);
    recMotion(part,x,y,phase);
  };
  xy.addEventListener('pointerdown',e=>{ e.preventDefault(); if(xyId!==null) return; xyId=e.pointerId; xy.setPointerCapture(e.pointerId); UI.xyTouch[part]=true; xyset(e,'start'); });
  xy.addEventListener('pointermove',e=>{ if(e.pointerId===xyId) xyset(e,'move'); });
  const xyup=e=>{ if(e.pointerId!==xyId) return; xyset(e,'end'); xyId=null; UI.xyTouch[part]=false; markDirty(); };
  xy.addEventListener('pointerup',xyup); xy.addEventListener('pointercancel',xyup);

  const freqs=new Float32Array(90), mag=new Float32Array(90), ph=new Float32Array(90);
  for(let i=0;i<90;i++) freqs[i]=cutHz(i/89);
  function frame(){
    const P=p(), L=A.live[part]||{cut:P.cut,res:P.res}, col=COL[part];
      const {c,w,h:hh}=fitCanvas(xy);
      c.clearRect(0,0,w,hh);
      c.fillStyle='#202020';
      for(let x=8;x<w;x+=16) for(let y=8;y<hh;y+=16) c.fillRect(x,y,1.2,1.2);
      c.strokeStyle='#1c1c1c'; c.lineWidth=1;
      for(let i=1;i<4;i++){ c.beginPath(); c.moveTo(w*i/4,0); c.lineTo(w*i/4,hh); c.stroke(); }
      if(A.ctx){
        if(!UI.scratch){ UI.scratch=A.ctx.createBiquadFilter(); UI.scratch.type='lowpass'; }
        UI.scratch.frequency.value=cutHz(L.cut); UI.scratch.Q.value=resQ(L.res);
        UI.scratch.getFrequencyResponse(freqs,mag,ph);
        c.beginPath();
        for(let i=0;i<90;i++){ const db=20*Math.log10(Math.max(mag[i],1e-5)); const x=i/89*w, y=clamp(hh*(.5-db/56),0,hh); i?c.lineTo(x,y):c.moveTo(x,y); }
        c.strokeStyle=col; c.globalAlpha=.9; c.lineWidth=1.5; c.stroke();
        c.lineTo(w,hh); c.lineTo(0,hh); c.closePath(); c.globalAlpha=.08; c.fillStyle=col; c.fill(); c.globalAlpha=1;
      }
      const m=cur().motion[part];
      if(m.length>1){
        c.beginPath(); m.forEach((pt,i)=>{ const x=pt.x*w, y=(1-pt.y)*hh; i?c.lineTo(x,y):c.moveTo(x,y); });
        c.strokeStyle='rgba(255,255,255,.22)'; c.setLineDash([2,3]); c.lineWidth=1; c.stroke(); c.setLineDash([]);
      }
      const x=L.cut*w, y=(1-L.res)*hh;
      c.strokeStyle='rgba(255,255,255,.35)'; c.lineWidth=1;
      c.beginPath(); c.moveTo(x,0); c.lineTo(x,hh); c.moveTo(0,y); c.lineTo(w,y); c.stroke();
      c.beginPath(); c.arc(x,y,UI.xyTouch[part]?16:9,0,Math.PI*2); c.strokeStyle=col; c.lineWidth=2; c.stroke();
      c.fillStyle=col; c.fillRect(x-2,y-2,4,4);
      if(Math.abs(L.cut-P.cut)>.002||Math.abs(L.res-P.res)>.002){ c.strokeStyle='#555'; c.lineWidth=1; c.strokeRect(P.cut*w-4,(1-P.res)*hh-4,8,8); }
      c.font='500 9px "IBM Plex Mono",monospace'; c.fillStyle='#8a8a8a';
      c.fillText((compact?part.toUpperCase()+' FILTER · ':'')+'CUT '+fmtHz(cutHz(L.cut)),6,13); c.fillText('Q '+resQ(L.res).toFixed(1)+(compact&&m.length?' · MOTION '+m.length+'PT':''),6,25);
      if(compact && Rec.on){ c.fillStyle='#ff3b1f'; c.fillText('● REC',w-40,13); }
      if(Rec.on && !compact){ c.fillStyle='#ff3b1f'; c.fillText(UI.xyTouch[part]&&Seq.playing?'● WRITING MOTION':'● REC ARMED · TOUCH TO WRITE',w-(UI.xyTouch[part]&&Seq.playing?110:168),13); }
      }
  return {frame, el:xy};
}

/* ---------- synth sound editor ---------- */
function synthEditor(part, root){
  const p=()=>S.synth[part];
  const top=h('div','row sb'); root.appendChild(top);
  const wv=Waves(top, part);
  const ro=h('div','readout'); top.appendChild(ro);
  const xyRow=h('div','row sb');
  const xyl=h('div','ttl','<span>FILTER XY</span><b>CUT → / RES ↑</b>'); xyRow.appendChild(xyl);
  const mb=h('div','row'); xyRow.appendChild(mb);
  const mInfo=h('span','lbl',''); mb.appendChild(mInfo);
  ConfirmBtn(mb,'CLR MOTION',()=>{ cur().motion[part]=[]; markDirty(); toast('MOTION CLEARED'); });
  root.appendChild(xyRow);
  const XY=XYPad(root,part);
  const ad=h('canvas','cv adsr'); root.appendChild(ad);
  const kn=h('div','knobs'); root.appendChild(kn);
  const K=(label,key,o={})=>Knob(kn,Object.assign({label,get:()=>p()[key],set:v=>{p()[key]=v; applySynth(part);},def:demoProject().synth[part][key]},o));
  K('DETUNE','det',{fmt:v=>Math.round(v*28)+'C'});
  K('SUB','sub');
  K('ENV','env');
  K('DRIVE','drive');
  if(part!=='chord') K('GLIDE','glide',{fmt:v=>Math.round(v*120)+'MS'});
  if(part!=='lead') K('GATE','gate',{min:.05,max:1});
  K('LEVEL','level');

  // ADSR interaction
  const geo=(w,hh)=>{
    const P=p(), sA=w*.27, sD=w*.27, sus=w*.16, sR=w*.24, yT=10, yB=hh-12;
    const xA=6+Math.sqrt(P.a/2)*sA, xD=xA+Math.sqrt(P.d/3)*sD, xS=xD+sus, xR=xS+Math.sqrt(P.r/4)*sR;
    return {sA,sD,sus,sR,yT,yB,xA,xD,xS,xR,yS:yB-P.s*(yB-yT)};
  };
  let adH=null;
  ad.addEventListener('pointerdown',e=>{
    e.preventDefault(); const r=ad.getBoundingClientRect(), x=e.clientX-r.left, y=e.clientY-r.top, g=geo(r.width,r.height);
    const hs=[['a',g.xA,g.yT],['d',g.xD,g.yS],['r',g.xR,g.yB]];
    let best=null,bd=1e9; for(const hd of hs){ const d=Math.hypot(hd[1]-x,(hd[2]-y)*.5); if(d<bd){bd=d;best=hd[0];} }
    adH=best; ad.setPointerCapture(e.pointerId); adMove(e);
  });
  const adMove=e=>{
    if(!adH) return; const r=ad.getBoundingClientRect(), x=e.clientX-r.left, y=e.clientY-r.top, g=geo(r.width,r.height), P=p();
    if(adH==='a') P.a=Math.max(.001,2*Math.pow(clamp((x-6)/g.sA,0,1),2));
    if(adH==='d'){ P.d=Math.max(.01,3*Math.pow(clamp((x-g.xA)/g.sD,0,1),2)); P.s=clamp((g.yB-y)/(g.yB-g.yT),0,1); }
    if(adH==='r') P.r=Math.max(.01,4*Math.pow(clamp((x-g.xS)/g.sR,0,1),2));
  };
  ad.addEventListener('pointermove',adMove);
  const adUp=()=>{ if(adH){ adH=null; markDirty(); } };
  ad.addEventListener('pointerup',adUp); ad.addEventListener('pointercancel',adUp);

  function envState(t){
    let on,off;
    if(part==='bass'){ if(!A.bassNote) return null; on=A.bassNote.t; off=A.bassNote.end; }
    else if(part==='chord'){ on=UI.chordT; off=UI.chordEnd; }
    else { on=UI.leadOnT; off=UI.leadOffT; }
    if(!on || t<on) return null;
    return {on,off};
  }
  function frame(){
    const P=p(), L=A.live[part]||{cut:P.cut,res:P.res}, col=COL[part];
    XY.frame();
    { const m=cur().motion[part]; ro.textContent=fmtHz(cutHz(L.cut))+' · Q'+resQ(L.res).toFixed(1); mInfo.textContent = m.length? ('MOTION '+m.length+'PT') : 'NO MOTION'; }
    // ADSR
    {
      const {c,w,h:hh}=fitCanvas(ad), g=geo(w,hh);
      c.clearRect(0,0,w,hh);
      c.strokeStyle='#1d1d1d'; c.lineWidth=1; c.beginPath(); c.moveTo(0,g.yB+.5); c.lineTo(w,g.yB+.5); c.stroke();
      c.beginPath(); c.moveTo(6,g.yB); c.lineTo(g.xA,g.yT); c.lineTo(g.xD,g.yS); c.lineTo(g.xS,g.yS); c.lineTo(g.xR,g.yB);
      c.strokeStyle=col; c.lineWidth=1.6; c.stroke();
      c.lineTo(6,g.yB); c.globalAlpha=.07; c.fillStyle=col; c.fill(); c.globalAlpha=1;
      c.fillStyle='#ededed';
      for(const [x,y] of [[g.xA,g.yT],[g.xD,g.yS],[g.xR,g.yB]]){ c.fillRect(x-3.5,y-3.5,7,7); }
      c.fillStyle='#0d0d0d'; for(const [x,y] of [[g.xA,g.yT],[g.xD,g.yS],[g.xR,g.yB]]) c.fillRect(x-1.5,y-1.5,3,3);
      c.font='500 8.5px "IBM Plex Mono",monospace'; c.fillStyle='#7a7a7a';
      c.fillText(`A ${fmtMs(P.a)}  D ${fmtMs(P.d)}  S ${Math.round(P.s*100)}%  R ${fmtMs(P.r)}`,8,hh-2);
      c.fillText('AMP/FLT ENV',w-70,hh-2);
      // live phase dot
      if(A.ctx){
        const t=heardTime(), st=envState(t);
        if(st){
          let x,y; const e=t-st.on;
          if(t<st.off){
            if(e<P.a){ const f=e/P.a; x=6+(g.xA-6)*f; y=g.yB-(g.yB-g.yT)*f; }
            else { const f=1-Math.exp(-(e-P.a)/Math.max(.01,P.d/3)); x=g.xA+(g.xD-g.xA)*Math.min(1,(e-P.a)/Math.max(P.d,.01)); y=g.yT+(g.yS-g.yT)*f; if(e>P.a+P.d) x=g.xD+Math.min(g.sus,(e-P.a-P.d)*40); }
          } else {
            const f=(t-st.off)/Math.max(.01,P.r); if(f>1.2) { x=null; } else { x=g.xS+(g.xR-g.xS)*Math.min(1,f); y=g.yS+(g.yB-g.yS)*Math.min(1,f); }
          }
          if(x!=null){ c.fillStyle='#ff3b1f'; c.beginPath(); c.arc(x,y,3.5,0,Math.PI*2); c.fill(); }
        }
      }
    }
  }
  return {frame, upd(){ wv.upd(); }};
}

/* ---------- pages ---------- */
function makePage(id){
  const el=h('div','page'); el.dataset.tr=id; $('#panel').appendChild(el); return el;
}
function subTabs(parent, part, opts){
  const el=h('div','subt');
  const bs=opts.map(([k,l])=>{ const b=h('button','',l); tap(b,()=>{ UI.sub[part]=k; upd(); }); el.appendChild(b); return b; });
  function upd(){ bs.forEach((b,i)=>b.classList.toggle('on',opts[i][0]===UI.sub[part])); UI.pages[part]&&UI.pages[part].showSub(); }
  parent.appendChild(el); setTimeout(upd); return {el,upd};
}

/* DRUM */
function buildDrum(){
  const el=makePage('drum');
  const top=h('div','row sb'); el.appendChild(top);
  const ttl=h('div','ttl'); top.appendChild(ttl);
  const ksg=Seg(top,KITS,()=>S.drumKit,i=>{ S.drumKit=i; renderKit(); if(A.ctx&&!Seq.playing){ const t=now(); playDrum(0,t,1); playDrum(3,t+.15,.8); playDrum(1,t+.3,1); } },'c');
  const vr=h('div','row'); vr.style.alignItems='stretch'; el.appendChild(vr);
  const wv=h('canvas','cv'); wv.style.cssText='flex:1;height:56px;min-width:0'; vr.appendChild(wv);
  const kn=h('div','knobs'); kn.style.cssText='grid-template-columns:repeat(4,46px)'; vr.appendChild(kn);
  const preview=()=>{ if(A.ctx&&!Seq.playing){ setTimeout(()=>playDrum(UI.selDrum,now(),.95),45); } };
  const kp=(lbl,key,fmt)=>Knob(kn,{label:lbl,get:()=>S.kit[UI.selDrum][key],set:v=>{S.kit[UI.selDrum][key]=v; if(key!=='level') scheduleRender(UI.selDrum);},end:preview,def:.5,fmt});
  const ks=[kp('TUNE','tune'),kp('DECAY','decay'),kp('TONE','tone',v=>UI.selDrum===5?(v<.5?'TOM':'RIM'):Math.round(v*100)),kp('LEVEL','level')];
  const grid=h('div','grid'); grid.style.gridTemplateColumns='44px repeat(16,1fr)'; grid.style.gridAutoRows='minmax(20px,26px)'; el.appendChild(grid);
  const cells=DRUMS.map(()=>[]), lbls=[], cols=Array.from({length:16},()=>[]);
  DRUMS.forEach((n,r)=>{
    const l=h('div','glbl',`<span>${n}</span><i class="h"></i>`); tap(l,()=>{ selVoice(r); if(A.ctx) playDrum(r,now(),.9); });
    grid.appendChild(l); lbls.push(l);
    for(let s=0;s<16;s++){ const c=h('div','cellb'+((s>>2)%2?' g':'')); c.dataset.r=r; c.dataset.s=s; grid.appendChild(c); cells[r].push(c); cols[s].push(c); }
  });
  let mode='draw';
  gridPaint(grid,(r,s,ph)=>{
    const row=cur().drum[r];
    if(ph==='start'){ selVoice(r); mode = UI.acc ? (row[s]===2?'acc0':'acc1') : (row[s]?'erase':'draw'); }
    if(mode==='draw'){ if(!row[s]){ row[s]=1; if(A.ctx&&!Seq.playing) playDrum(r,now(),.72);} }
    else if(mode==='erase') row[s]=0;
    else if(mode==='acc1') row[s]=2; else row[s]= row[s]?1:0;
    paintCell(r,s);
  });
  const tb=h('div','row'); el.appendChild(tb);
  const bAcc=Btn(tb,'ACCENT','acc',()=>{ UI.acc=!UI.acc; bAcc.classList.toggle('on',UI.acc); });
  tb.appendChild(h('span','lbl','TAP=ON/OFF · DRAG=PAINT'));
  tb.appendChild(h('div','grow'));
  Btn(tb,'CLR ROW','',()=>{ cur().drum[UI.selDrum].fill(0); refresh(); markDirty(); });
  ConfirmBtn(tb,'CLR ALL',()=>{ cur().drum.forEach(r=>r.fill(0)); refresh(); markDirty(); });
  const pads=h('div','pads'); el.appendChild(pads);
  const padEls=DRUMS.map((n,r)=>{
    const p=h('div','pad',`<div class="fl"></div><div><div class="pn">${n}</div><div class="pi">${pad2(r+1)} · PAD</div></div><div class="mini">${'<i></i>'.repeat(16)}</div>`);
    p.addEventListener('pointerdown',e=>{
      e.preventDefault(); if(!A.ctx) return;
      playDrum(r,now(),.95); UI.flash[r]=now(); selVoice(r);
      if(recDrum(r)) refresh();
    });
    pads.appendChild(p); return {p, fl:p.querySelector('.fl'), mini:[...p.querySelectorAll('.mini i')]};
  });
  function paintCell(r,s){ const v=cur().drum[r][s]; cells[r][s].classList.toggle('on',v>0); cells[r][s].classList.toggle('acc',v===2); }
  function selVoice(r){ UI.selDrum=r; ks.forEach(k=>k.draw()); lbls.forEach((l,i)=>l.classList.toggle('sel',i===r)); padEls.forEach((p,i)=>p.p.classList.toggle('sel',i===r)); ttl.innerHTML=`<span class="dot"></span><span>01 DRUM</span><b>${pad2(r+1)} ${DRUMS[r]}</b>`; }
  function refresh(){
    const sc=cur(); ksg.upd();
    for(let r=0;r<6;r++) for(let s=0;s<16;s++) paintCell(r,s);
    padEls.forEach((p,r)=>p.mini.forEach((m,s)=>m.classList.toggle('on',sc.drum[r][s]>0)));
  }
  const ph=PH(); let pm=-1;
  function drawWave(t){
    const {c,w,h:hh}=fitCanvas(wv), d=DK.peaks[UI.selDrum];
    c.clearRect(0,0,w,hh);
    c.fillStyle='#1a1a1a'; c.fillRect(0,hh/2,w,1);
    if(!d) return;
    const sr=A.ctx?A.ctx.sampleRate:44100, dur=d.length/sr, span=Math.max(dur,.25), cols=Math.floor(w/2);
    for(let x=0;x<cols;x++){
      const a=Math.floor(x/cols*span*sr), b=Math.min(d.length,Math.floor((x+1)/cols*span*sr));
      let mx=0; for(let j=a;j<b;j++){ const v=Math.abs(d[j]); if(v>mx) mx=v; }
      const hgt=Math.max(1,mx*(hh/2-4));
      c.fillStyle='#d8d8d8'; c.fillRect(x*2,hh/2-hgt,1.2,hgt*2);
    }
    const age=t-UI.flash[UI.selDrum];
    if(UI.flash[UI.selDrum]>=0 && age>=0 && age<span){ c.fillStyle='#ff3b1f'; c.fillRect(age/span*w,0,1.5,hh); }
    c.font='500 8px "IBM Plex Mono",monospace'; c.fillStyle='#7a7a7a';
    c.fillText(KITS[S.drumKit]+' · '+DRUMS[UI.selDrum]+' · '+Math.round(dur*1000)+'MS',5,10);
  }
  function frame(t,np){
    drawWave(t);
    ph.set(cols, np? np.step%16 : -1);
    const st=np?np.step%16:-1;
    padEls.forEach((p,r)=>{
      const age=t-UI.flash[r], o= UI.flash[r]>=0 && age>=0 && age<.18 ? (1-age/.18)*.55 : 0;
      p.fl.style.opacity=o.toFixed(3);
      lbls[r].lastChild.classList.toggle('hit',o>.05);
      if(st!==pm){ if(pm>=0) p.mini[pm].classList.remove('ph'); if(st>=0) p.mini[st].classList.add('ph'); }
    });
    pm=st;
  }
  selVoice(0);
  return {el,refresh,frame};
}

/* BASS */
function buildBass(){
  const el=makePage('bass');
  const top=h('div','row sb'); el.appendChild(top);
  top.appendChild(h('div','ttl','<span class="dot"></span><span>02</span><b>BASS · MONO</b>'));
  const st=subTabs(top,'bass',[['seq','SEQ'],['sound','SOUND']]);
  const seq=h('div',''); seq.style.cssText='display:flex;flex-direction:column;gap:8px;flex:1;min-height:0'; el.appendChild(seq);
  const snd=h('div',''); snd.style.cssText='display:flex;flex-direction:column;gap:8px;flex:1'; el.appendChild(snd);
  const tb=h('div','row'); seq.appendChild(tb);
  const bF=Btn(tb,'FOLLOW CHORD','acc',()=>{ cur().bassFollow=cur().bassFollow?0:1; bF.classList.toggle('on',!!cur().bassFollow); markDirty(); });
  tb.appendChild(h('span','lbl','OCT'));
  const so=Seg(tb,['-1','0','+1'],()=>S.synth.bass.oct+1,i=>{ S.synth.bass.oct=i-1; });
  tb.appendChild(h('div','grow'));
  ConfirmBtn(tb,'CLR',()=>{ cur().bass.fill(null); refresh(); markDirty(); });
  const grid=h('div','grid'); grid.style.gridTemplateColumns='22px repeat(16,1fr)'; grid.style.gridAutoRows='minmax(18px,24px)'; seq.appendChild(grid);
  const cells=BASS_ROWS.map(()=>[]), cols=Array.from({length:16},()=>[]);
  BASS_ROWS.forEach((v,r)=>{
    grid.appendChild(h('div','glbl',`<span>${BASS_ROW_LBL[r]}</span>`));
    for(let s=0;s<16;s++){ const c=h('div','cellb'+((s>>2)%2?' g':'')); c.dataset.r=r; c.dataset.s=s; grid.appendChild(c); cells[r].push(c); cols[s].push(c); }
  });
  let mode='draw';
  gridPaint(grid,(r,s,ph)=>{
    const b=cur().bass, val=BASS_ROWS[r];
    if(ph==='start') mode = b[s]===val ? 'erase' : 'draw';
    if(mode==='draw'){
      if(b[s]!==val){ b[s]=val; if(A.ctx&&!Seq.playing){ const sc=cur(); const m=degMidi((sc.bassFollow?sc.chords[0].d:0)+val,36)+S.synth.bass.oct*12; const t=now(); bassNote(t,m,.22,.85); UI.bassMidi=m; UI.bassT=t; UI.bassEnd=t+.22; } }
    } else b[s]=null;
    paintCol(s);
  });
  seq.appendChild(h('div','lbl','CHORD CONTEXT · ROOT FOLLOWS PROGRESSION'));
  const ctxRow=h('div','slots'); seq.appendChild(ctxRow);
  const kb=h('canvas','cv kbd'); seq.appendChild(kb);
  const bxy=XYPad(seq,'bass',true);
  const ed=synthEditor('bass',snd);
  function paintCol(s){ const v=cur().bass[s]; for(let r=0;r<BASS_ROWS.length;r++) cells[r][s].classList.toggle('on',v===BASS_ROWS[r]); }
  let ctxEls=[];
  function refresh(){
    for(let s=0;s<16;s++) paintCol(s);
    bF.classList.toggle('on',!!cur().bassFollow); so.upd();
    const sc=cur(); ctxRow.innerHTML=''; ctxRow.style.gridTemplateColumns=`repeat(${sc.bars},1fr)`;
    ctxEls=[];
    for(let b=0;b<sc.bars;b++){ const d=h('div','slot',`<span class="bn">${b+1}</span><span class="rn" style="font-size:13px">${chordName(sc.chords[b])}</span>`); ctxRow.appendChild(d); ctxEls.push(d); }
    ed.upd();
  }
  const ph=PH();
  function showSub(){ seq.style.display=UI.sub.bass==='seq'?'flex':'none'; snd.style.display=UI.sub.bass==='sound'?'flex':'none'; }
  function frame(t,np){
    if(UI.sub.bass==='seq'){
      ph.set(cols, np? np.step%16 : -1);
      const bar=np?Math.floor(np.step/16):-1; ctxEls.forEach((e,i)=>e.classList.toggle('pl',i===bar));
      const lit=new Set(); if(UI.bassMidi!=null && t>=UI.bassT && t<UI.bassEnd) lit.add(UI.bassMidi);
      drawKeys(kb,24,59,lit,null,COL.bass);
      bxy.frame();
    } else ed.frame();
  }
  return {el,refresh,frame,showSub};
}

/* CHORD */
function buildChord(){
  const el=makePage('chord');
  const top=h('div','row sb'); el.appendChild(top);
  top.appendChild(h('div','ttl','<span class="dot"></span><span>03</span><b>CHORD · POLY</b>'));
  subTabs(top,'chord',[['seq','SEQ'],['sound','SOUND']]);
  const seq=h('div',''); seq.style.cssText='display:flex;flex-direction:column;gap:8px;flex:1;min-height:0'; el.appendChild(seq);
  const snd=h('div',''); snd.style.cssText='display:flex;flex-direction:column;gap:8px;flex:1'; el.appendChild(snd);
  seq.appendChild(h('div','lbl','PROGRESSION · TAP BAR, THEN DEGREE'));
  const slots=h('div','slots'); seq.appendChild(slots);
  const degs=h('div','degs'); seq.appendChild(degs);
  const degEls=ROMAN.map((r,d)=>{ const b=h('div','deg'); tap(b,()=>{ const sc=cur(); const ch=sc.chords[UI.selSlot]; ch.d=d; auditionChord(ch); UI.selSlot=(UI.selSlot+1)%sc.bars; markDirty(); refresh(); }); degs.appendChild(b); return b; });
  const tr=h('div','row sb'); seq.appendChild(tr);
  const ts=Seg(tr,CHORD_TYPES,()=>cur().chords[UI.selSlot].t,i=>{ cur().chords[UI.selSlot].t=i; auditionChord(cur().chords[UI.selSlot]); refresh(); },'c');
  const oc=Seg(tr,['-1','0','+1'],()=>S.synth.chord.oct+1,i=>{ S.synth.chord.oct=i-1; });
  const rr=h('div','row sb'); seq.appendChild(rr);
  rr.appendChild(h('div','lbl','RHYTHM · 16 STEPS / BAR'));
  const pr=h('div','row'); rr.appendChild(pr);
  const PRESETS={PAD:'x...............',HALF:'x.......x.......','4TH':'x...x...x...x...',OFF:'..x...x...x...x.',SYNC:'x..x..x...x..x..'};
  for(const k in PRESETS) Btn(pr,k,'',()=>{ cur().rhythm=P(PRESETS[k]); refresh(); markDirty(); });
  const grid=h('div','grid'); grid.style.gridTemplateColumns='repeat(16,1fr)'; grid.style.gridAutoRows='26px'; seq.appendChild(grid);
  const rc=[], cols=[];
  for(let s=0;s<16;s++){ const c=h('div','cellb'+((s>>2)%2?' g':'')); c.dataset.r=0; c.dataset.s=s; grid.appendChild(c); rc.push(c); cols.push([c]); }
  let mode=1;
  gridPaint(grid,(r,s,ph)=>{ const R=cur().rhythm; if(ph==='start') mode=R[s]?0:1; R[s]=mode; rc[s].classList.toggle('on',!!mode); });
  const kb=h('canvas','cv kbd'); seq.appendChild(kb);
  const voice=h('div','lbl',''); seq.appendChild(voice);
  const cxy=XYPad(seq,'chord',true);
  const ed=synthEditor('chord',snd);
  let slotEls=[];
  function refresh(){
    const sc=cur(); if(UI.selSlot>=sc.bars) UI.selSlot=0;
    slots.innerHTML=''; slots.style.gridTemplateColumns=`repeat(${sc.bars},1fr)`; slotEls=[];
    for(let b=0;b<sc.bars;b++){
      const ch=sc.chords[b];
      const d=h('div','slot'+(b===UI.selSlot?' sel':''),`<span class="bn">${b+1}</span><span class="rn">${romanOf(ch)}</span><span class="cn">${chordName(ch)}</span>`);
      tap(d,()=>{ UI.selSlot=b; auditionChord(sc.chords[b]); refresh(); });
      slots.appendChild(d); slotEls.push(d);
    }
    const sel=sc.chords[UI.selSlot];
    degEls.forEach((e,d)=>{ const ch={d,t:sel.t}; e.innerHTML=`<span class="rn">${romanOf(ch)}</span><span class="cn">${chordName(ch)}</span>`; e.classList.toggle('on',d===sel.d); });
    ts.upd(); oc.upd();
    sc.rhythm.forEach((v,s)=>rc[s].classList.toggle('on',!!v));
    const vo=sceneVoicings(sc)[UI.selSlot]||[];
    voice.textContent='VOICING BAR '+(UI.selSlot+1)+' · '+vo.map(m=>noteName(m+S.synth.chord.oct*12)).join(' ');
    ed.upd();
  }
  const ph=PH();
  function showSub(){ seq.style.display=UI.sub.chord==='seq'?'flex':'none'; snd.style.display=UI.sub.chord==='sound'?'flex':'none'; }
  function frame(t,np){
    if(UI.sub.chord==='seq'){
      ph.set(cols, np? np.step%16 : -1);
      const bar=np?Math.floor(np.step/16):-1; slotEls.forEach((e,i)=>e.classList.toggle('pl',i===bar));
      const lit=new Set(t>=UI.chordT && t<UI.chordEnd ? UI.chordNotes : []);
      const vo=sceneVoicings(cur())[UI.selSlot]||[];
      drawKeys(kb,43,84,lit,new Set(vo.map(m=>m+S.synth.chord.oct*12)),COL.chord);
      cxy.frame();
    } else ed.frame();
  }
  return {el,refresh,frame,showSub};
}
function romanOf(ch){
  const third=degSemi(ch.d+2)-degSemi(ch.d), fifth=degSemi(ch.d+4)-degSemi(ch.d);
  let r=ROMAN[ch.d];
  if(CHORD_TYPES[ch.t]==='POW'||CHORD_TYPES[ch.t].startsWith('SUS')) return r;
  if(third===3) r=r.toLowerCase();
  if(fifth===6) r+='°';
  return r;
}

/* LEAD — horizontal slide keys: left low → right high */
const LROWS=3;
function leadRoot(){ return 48 + S.key; }
function leadSet(){
  const m=S.synth.lead.mode|0;
  if(m===2) return [0,1,2,3,4,5,6,7,8,9,10,11];
  if(m===1) return scaleArr()[2]===3 ? [0,3,5,7,10] : [0,2,4,7,9];
  return scaleArr();
}
function leadKeysPerRow(){ const N=leadSet().length; return (S.synth.lead.mode|0)===2 ? 13 : N+3; }
function leadPitchAt(idx){ const set=leadSet(), N=set.length; return leadRoot()+12*Math.floor(idx/N)+set[mod(idx,N)]; }
function magnet(f){ if(f<.12) return 0; if(f>.88) return 1; const x=(f-.12)/.76; return x*x*(3-2*x); }
function leadPitchCont(u){ const i=Math.floor(u), f=u-i, a=leadPitchAt(i), b=leadPitchAt(i+1); return a+(b-a)*magnet(f); }
const CHOKE_DEAD=28, KEY_HYST=.62;

function buildLead(){
  const el=makePage('lead');
  const top=h('div','row sb'); el.appendChild(top);
  top.appendChild(h('div','ttl','<span class="dot"></span><span>04</span><b>LEAD · SLIDE KEYS</b>'));
  subTabs(top,'lead',[['play','PLAY'],['sound','SOUND']]);
  const play=h('div',''); play.style.cssText='display:flex;flex-direction:column;gap:6px;flex:1;min-height:0'; el.appendChild(play);
  const snd=h('div',''); snd.style.cssText='display:flex;flex-direction:column;gap:8px;flex:1'; el.appendChild(snd);
  const tb=h('div','row'); play.appendChild(tb);
  const md=Seg(tb,['SCALE','PENTA','CHROM'],()=>S.synth.lead.mode|0,i=>{ S.synth.lead.mode=i; },'c');
  const oc=Seg(tb,['-1','0','+1'],()=>S.synth.lead.oct+1,i=>{ S.synth.lead.oct=i-1; });
  const BR=[1,2,3,5,7,12];
  const bb=Btn(tb,'','',()=>{ const i=BR.indexOf(S.synth.lead.bend); S.synth.lead.bend=BR[(i+1)%BR.length]; bb.textContent='CHOKE +'+S.synth.lead.bend; markDirty(); });
  const tb2=h('div','row sb'); play.appendChild(tb2);
  const tinfo=h('div','lbl','TAKES'); tb2.appendChild(tinfo);
  const tb3=h('div','row'); tb2.appendChild(tb3);
  Btn(tb3,'UNDO TAKE','',()=>{ const sc=cur(); if(!sc.lead.length) return; const mx=Math.max(...sc.lead.map(e=>e.take)); sc.lead=sc.lead.filter(e=>e.take!==mx); killPb(); markDirty(); toast('TAKE '+mx+' REMOVED'); });
  ConfirmBtn(tb3,'CLR',()=>{ cur().lead=[]; killPb(); markDirty(); toast('LEAD CLEARED'); });
  const take=h('canvas','cv take'); play.appendChild(take);
  const fb=h('canvas','cv fret'); play.appendChild(fb);
  play.appendChild(h('div','lbl','タップ＝キーに吸着 · 横＝スライド · 縦に大きく＝チョーキング'));
  const ed=synthEditor('lead',snd);
  function killPb(){ const t=now(); for(const v of Seq.pb.values()) v.release(t); Seq.pb.clear(); UI.ghosts.clear(); }

  // ---- touch ----
  let uidc=0;
  let gcache=null;
  const geom=()=>gcache;
  const mkGeom=()=>{ const r=fb.getBoundingClientRect(), K=leadKeysPerRow(); gcache={r, K, kw:r.width/K, rh:r.height/LROWS, N:leadSet().length}; return gcache; };
  const calc=(T,e,g)=>{
    const x=e.clientX-g.r.left, y=e.clientY-g.r.top;
    let u=T.k0+(x-T.x0)/g.kw;
    const lo=T.row*g.N, hi=T.row*g.N+g.K-1; u=clamp(u,lo-.49,hi+.49);
    // horizontal: always a key of the scale; move to the neighbour only once clearly over it
    if(T.key===undefined) T.key=T.k0;
    if(Math.abs(u-T.key)>KEY_HYST) T.key=clamp(Math.round(u),lo,hi);
    const slide=leadPitchAt(T.key);
    // vertical: nothing at all inside the dead zone, then a smooth choke
    const dy=Math.abs(y-T.y0), c=clamp((dy-CHOKE_DEAD)/(g.rh*.5),0,1);
    const choke= c>0 ? c*c*(3-2*c)*S.synth.lead.bend : 0;
    T.u=u; T.choke=choke; T.cx=x; T.cy=y; T.slide=slide;
    T.x=clamp(x/g.r.width,0,1); T.y=clamp(1-y/g.r.height,0,1);
    return slide+choke;
  };
  fb.addEventListener('pointerdown',e=>{
    e.preventDefault(); if(!A.ctx) return;
    fb.setPointerCapture(e.pointerId);
    const g=mkGeom(), x=e.clientX-g.r.left, y=e.clientY-g.r.top;
    const row=clamp(LROWS-1-Math.floor(y/g.rh),0,LROWS-1);
    const j=clamp(Math.floor(x/g.kw),0,g.K-1);
    const T={row, k0:row*g.N+j, key:row*g.N+j, lastKey:row*g.N+j, x0:x, y0:y, uid:++uidc};
    const p=calc(T,e,g);
    T.p=p; T.v=makeVoice('lead',now(),p+S.synth.lead.oct*12,.6);
    UI.leadTouches.set(e.pointerId,T); UI.leadOnT=now(); UI.leadOffT=Infinity;
    recLead('on',T.uid,p,T.row,T.x,T.y);
  });
  fb.addEventListener('pointermove',e=>{
    const T=UI.leadTouches.get(e.pointerId); if(!T) return;
    const g=geom()||mkGeom(), p=calc(T,e,g);
    if(Math.abs(p-T.p)<.0005) return;
    const keyMove = T.lastKey!==T.key; T.lastKey=T.key;
    const tc = keyMove ? .003+S.synth.lead.glide*.12 : .004;
    T.p=p; T.v.setPitch(p+S.synth.lead.oct*12, A.ctx.currentTime, tc);
    recLead('mv',T.uid,p,T.row,T.x,T.y);
  });
  const up=e=>{
    const T=UI.leadTouches.get(e.pointerId); if(!T) return;
    T.v.release(now()); UI.leadTouches.delete(e.pointerId);
    if(!UI.leadTouches.size) UI.leadOffT=now();
    recLead('off',T.uid,T.p,T.row,T.x,T.y);
  };
  fb.addEventListener('pointerup',up); fb.addEventListener('pointercancel',up);

  // ---- draw ----
  const bg=document.createElement('canvas'); let bgKey='', lastDirty=true;
  function drawBg(w,hh,dpr,chordPc){
    bg.width=Math.round(w*dpr); bg.height=Math.round(hh*dpr);
    const c=bg.getContext('2d'); c.setTransform(dpr,0,0,dpr,0,0);
    const set=leadSet(), N=set.length, K=leadKeysPerRow(), kw=w/K, rh=hh/LROWS, col=COL.lead, mode=S.synth.lead.mode|0;
    c.textAlign='center'; c.textBaseline='middle';
    for(let r=0;r<LROWS;r++){
      const y0=hh-(r+1)*rh;
      for(let j=0;j<K;j++){
        const idx=r*N+j, m=leadPitchAt(idx), pc=mod(m,12), isRoot=mod(m-S.key,12)===0, inS=inScale(m), isCh=chordPc.has(pc);
        const x=j*kw;
        c.fillStyle = (mode===2 && !inS) ? '#0c0c0c' : (j%2?'#141414':'#171717');
        c.fillRect(x+1,y0+1,kw-2,rh-2);
        if(isCh){ c.fillStyle=col; c.globalAlpha=.85; c.fillRect(x+4,y0+rh-6,kw-8,2); c.globalAlpha=1; }
        if(isRoot){ c.fillStyle='#ff3b1f'; c.fillRect(x+4,y0+5,5,5); }
        c.font=(kw>30?'900 17px':'900 13px')+' Doto,"IBM Plex Mono",monospace';
        c.fillStyle= isCh ? '#ededed' : (inS? '#8a8a8a':'#3a3a3a');
        c.fillText(NOTE_NAMES[pc].replace('#','♯')+(isRoot?(Math.floor(m/12)-1):''), x+kw/2, y0+rh*.42);
        c.font='500 7.5px "IBM Plex Mono",monospace'; c.fillStyle='#555';
        const deg=scaleArr().indexOf(mod(m-S.key,12));
        c.fillText(deg>=0?String(deg+1):'·', x+kw/2, y0+rh*.42+16);
      }
      c.fillStyle='#2e2e2e'; c.fillRect(0,y0,w,1);
    }
  }
  function drawSurface(t,np){
    const sc=cur(), bar=np?Math.floor(np.step/16):UI.selSlot;
    const vo=sceneVoicings(sc)[Math.min(bar,sc.bars-1)]||[], chordPc=new Set(vo.map(m=>mod(m,12)));
    const w=fb.clientWidth, hh=fb.clientHeight, dpr=Math.min(window.devicePixelRatio||1,3);
    const key=[w,hh,dpr,S.key,S.scale,S.synth.lead.mode,[...chordPc].sort().join('.')].join('|');
    const active=UI.leadTouches.size>0 || UI.ghosts.size>0;
    if(key===bgKey && !active && !lastDirty) return;     // nothing moves: skip the frame
    if(key!==bgKey){ drawBg(w,hh,dpr,chordPc); bgKey=key; }
    lastDirty=active;
    const {c}=fitCanvas(fb), set=leadSet(), N=set.length, K=leadKeysPerRow(), kw=w/K, rh=hh/LROWS, col=COL.lead;
    c.setTransform(1,0,0,1,0,0); c.clearRect(0,0,fb.width,fb.height); c.drawImage(bg,0,0); c.setTransform(dpr,0,0,dpr,0,0);
    // sounding keys
    c.fillStyle='rgba(255,210,26,.16)';
    for(const T of UI.leadTouches.values()){ const idx=T.key, r=T.row, j=idx-r*N; if(j>=0&&j<K) c.fillRect(j*kw+1,hh-(r+1)*rh+1,kw-2,rh-2); }
    // ghosts (recorded playback)
    for(const g of UI.ghosts.values()){
      const x=g.x*w, y=(1-g.y)*hh;
      c.strokeStyle=col; c.globalAlpha=.6; c.lineWidth=1.5; c.beginPath(); c.arc(x,y,13,0,Math.PI*2); c.stroke();
      c.globalAlpha=.2; c.fillStyle=col; c.fill(); c.globalAlpha=1;
    }
    c.textAlign='center'; c.textBaseline='middle';
    for(const T of UI.leadTouches.values()){
      const rowY=hh-(T.row+1)*rh;
      c.fillStyle='rgba(255,210,26,.06)'; c.fillRect(0,Math.max(rowY,T.y0-CHOKE_DEAD),w,CHOKE_DEAD*2);
      c.strokeStyle=col; c.lineWidth=2; c.beginPath(); c.moveTo(T.x0,T.y0); c.lineTo(T.cx,T.y0); c.stroke();
      if(T.choke>0){ c.setLineDash([3,3]); c.beginPath(); c.moveTo(T.cx,T.y0); c.lineTo(T.cx,T.cy); c.stroke(); c.setLineDash([]); }
      c.fillStyle=col; c.globalAlpha=.18; c.beginPath(); c.arc(T.cx,T.cy,26,0,Math.PI*2); c.fill();
      c.globalAlpha=1; c.beginPath(); c.arc(T.cx,T.cy,17,0,Math.PI*2); c.fill();
      c.fillStyle='#000'; c.font='600 9px "IBM Plex Mono",monospace';
      c.fillText(noteName(T.p+S.synth.lead.oct*12), T.cx, T.cy);
      c.fillStyle=col; c.font='500 8.5px "IBM Plex Mono",monospace';
      const cents=Math.round((T.p-Math.round(T.p))*100);
      c.fillText(T.choke>0.02 ? ('CHOKE +'+T.choke.toFixed(2)) : ((cents>=0?'+':'')+cents+'¢'), T.cx, T.cy-28);
    }
    c.textAlign='left'; c.textBaseline='alphabetic';
  }
  let tkCache={key:'',segs:[]};
  function drawTake(t,np){
    const {c,w,h:hh}=fitCanvas(take), sc=cur(), total=sc.bars*16, lo=leadRoot()-2, hi=leadRoot()+12*LROWS+6;
    c.clearRect(0,0,w,hh);
    for(let b=0;b<sc.bars;b++){ const x=b/sc.bars*w; c.fillStyle= b%2?'#0f0f0f':'#121212'; c.fillRect(x,0,w/sc.bars,hh); c.fillStyle='#262626'; c.fillRect(x,0,1,hh); c.fillStyle='#555'; c.font='500 7.5px "IBM Plex Mono",monospace'; c.fillText(b+1,x+3,9); }
    const key=sc.lead.length+':'+S.scene+':'+(sc.lead.length?sc.lead[sc.lead.length-1].t:0);
    if(key!==tkCache.key){
      const byId=new Map(), segs=[];
      for(const e of sc.lead){ if(!byId.has(e.id)) byId.set(e.id,[]); byId.get(e.id).push(e); }
      for(const list of byId.values()){
        const oi=list.findIndex(e=>e.k==='on'); if(oi<0) continue;
        const chrono=list.slice(oi).concat(list.slice(0,oi));
        let seg=[], lp=chrono[0].p, lt=-1;
        for(const e of chrono){
          if(e.t<lt){ seg.push([total,lp]); segs.push(seg); seg=[[0,lp]]; }
          if(e.p!==undefined) lp=e.p;
          seg.push([e.t,lp]); lt=e.t;
          if(e.k==='off') break;
        }
        segs.push(seg);
      }
      tkCache={key,segs};
    }
    c.strokeStyle=COL.lead; c.lineWidth=1.6;
    const Y=p=>hh-2-(p-lo)/(hi-lo)*(hh-4);
    for(const seg of tkCache.segs){
      c.beginPath(); seg.forEach(([tt,p],i)=>{ const x=tt/total*w, y=Y(p); i?c.lineTo(x,y):c.moveTo(x,y); });
      if(seg.length===1){ const x=seg[0][0]/total*w; c.lineTo(x+2,Y(seg[0][1])); }
      c.stroke();
    }
    if(np){ const x=np.pos/total*w; c.fillStyle=Rec.on?'#ff3b1f':'#ededed'; c.fillRect(x-.5,0,1.5,hh); }
    const takes=new Set(sc.lead.map(e=>e.take)).size;
    tinfo.textContent=`TAKES ${pad2(takes)} · EVENTS ${sc.lead.length} · ${Rec.on?(Seq.playing?'● OVERDUB':'● ARMED'):'PLAYBACK'}`;
  }
  function refresh(){ md.upd(); oc.upd(); bb.textContent='CHOKE +'+S.synth.lead.bend; ed.upd(); tkCache.key=''; bgKey=''; gcache=null; }
  function showSub(){ play.style.display=UI.sub.lead==='play'?'flex':'none'; snd.style.display=UI.sub.lead==='sound'?'flex':'none'; }
  function frame(t,np){ if(UI.sub.lead==='play'){ drawSurface(t,np); drawTake(t,np); } else ed.frame(); }
  return {el,refresh,frame,showSub};
}

/* MIX */
function buildMix(){
  const el=makePage('mix');
  el.appendChild(h('div','ttl','<span>05</span><b>MIXER</b>'));
  const mx=h('div','mixer'); el.appendChild(mx);
  const strips=TRACKS.map(t=>{
    const s=h('div','strip'); s.dataset.tr=t; mx.appendChild(s);
    s.appendChild(h('div','nm',`<i></i>${TRACK_LABEL[t]}`));
    const f=h('div','fader','<div class="tr"><i></i><b></b></div><canvas></canvas>'); s.appendChild(f);
    const val=h('div','val','0'); s.appendChild(val);
    const ms=h('div','ms'); s.appendChild(ms);
    const bM=Btn(ms,'M','',()=>{ S.mix[t].mute^=1; applyMix(); upd(); markDirty(); });
    const bS=Btn(ms,'S','',()=>{ S.mix[t].solo^=1; applyMix(); upd(); markDirty(); });
    const kn=h('div','knobs'); kn.style.gridTemplateColumns='1fr 1fr'; kn.style.width='100%'; s.appendChild(kn);
    Knob(kn,{label:'DLY',get:()=>S.mix[t].dly,set:v=>{S.mix[t].dly=v;applyMix();},def:0});
    Knob(kn,{label:'REV',get:()=>S.mix[t].rev,set:v=>{S.mix[t].rev=v;applyMix();},def:0});
    const tr=f.querySelector('.tr'), fi=tr.querySelector('i'), fk=tr.querySelector('b'), cv=f.querySelector('canvas');
    let drag=false, sy=0, sv=0;
    tr.addEventListener('pointerdown',e=>{ e.preventDefault(); drag=true; tr.setPointerCapture(e.pointerId); sy=e.clientY; sv=S.mix[t].vol; });
    tr.addEventListener('pointermove',e=>{ if(!drag) return; S.mix[t].vol=clamp(sv+(sy-e.clientY)/tr.clientHeight,0,1); applyMix(); upd(); });
    tr.addEventListener('pointerup',()=>{ drag=false; markDirty(); }); tr.addEventListener('pointercancel',()=>{ drag=false; });
    function upd(){
      const v=S.mix[t].vol; fi.style.height=(v*100)+'%'; fk.style.bottom=(v*100)+'%';
      const g=v*v*1.2; val.textContent= g<.001?'-∞':(20*Math.log10(g)).toFixed(1);
      bM.classList.toggle('on',!!S.mix[t].mute); bS.classList.toggle('on',!!S.mix[t].solo); bS.classList.toggle('red',!!S.mix[t].solo);
    }
    upd();
    return {t,cv,upd};
  });
  const box=h('div','box'); el.appendChild(box);
  box.appendChild(h('div','ttl','<b>MASTER / FX</b>'));
  const dr=h('div','row sb'); box.appendChild(dr);
  dr.appendChild(h('span','lbl','DELAY TIME'));
  Seg(dr,DLY_DIVS.map(d=>d.l),()=>S.mix.master.dlyDiv,i=>{ S.mix.master.dlyDiv=i; applyMix(); });
  const kn=h('div','knobs'); box.appendChild(kn);
  const M=S.mix.master;
  Knob(kn,{label:'FEEDBK',get:()=>S.mix.master.fb,set:v=>{S.mix.master.fb=v;applyMix();},def:.38});
  Knob(kn,{label:'REV SIZE',get:()=>S.mix.master.rev,set:v=>{S.mix.master.rev=v;applyMix();},def:.55});
  Knob(kn,{label:'DRIVE',get:()=>S.mix.master.drive,set:v=>{S.mix.master.drive=v;applyMix();},def:.15});
  Knob(kn,{label:'DUCK',get:()=>S.mix.master.duck,set:v=>{S.mix.master.duck=v;},def:.3});
  Knob(kn,{label:'MASTER',get:()=>S.mix.master.vol,set:v=>{S.mix.master.vol=v;applyMix();},def:.85});
  const gr=h('div','lbl',''); box.appendChild(gr);
  function refresh(){ strips.forEach(s=>s.upd()); UI.knobs.forEach(k=>k.draw()); }
  function frame(){
    for(const s of strips){
      const b=A.bus[s.t]; if(!b) continue;
      b.an.getFloatTimeDomainData(b.buf); let pk=0; for(let i=0;i<b.buf.length;i++){ const a=Math.abs(b.buf[i]); if(a>pk) pk=a; }
      b.peak=Math.max(pk,b.peak*.92);
      const {c,w,h:hh}=fitCanvas(s.cv); c.clearRect(0,0,w,hh);
      const db=20*Math.log10(Math.max(b.peak,1e-5)), n=clamp((db+48)/48,0,1), seg=Math.floor(hh/4);
      for(let i=0;i<seg;i++){ const yy=hh-(i+1)*4; const lv=i/seg; c.fillStyle = lv<n ? (lv>.9?'#ff3b1f':lv>.75?'#ffd21a':'#ededed') : '#1a1a1a'; c.fillRect(0,yy,w,3); }
    }
    if(A.ctx) gr.textContent='SOFT CLIP · OUT LAT '+Math.round(((A.ctx.baseLatency||0)+(A.ctx.outputLatency||0))*1000)+'MS · DLY '+Math.round(stepDur()*DLY_DIVS[S.mix.master.dlyDiv].s*1000)+'MS';
  }
  return {el,refresh,frame};
}

/* SONG */
function buildSong(){
  const el=makePage('song');
  el.appendChild(h('div','ttl','<span>06</span><b>PROJECT / SONG</b>'));
  // tempo
  const b1=h('div','box'); el.appendChild(b1);
  const r1=h('div','row sb'); b1.appendChild(r1);
  const bpm=h('div','bigbpm','120'); r1.appendChild(bpm);
  const bc=h('div','row'); r1.appendChild(bc);
  Btn(bc,'−','sq',()=>setBpm(S.bpm-1)); Btn(bc,'+','sq',()=>setBpm(S.bpm+1));
  let taps=[];
  Btn(bc,'TAP','',()=>{ const t=performance.now(); taps=taps.filter(x=>t-x<2500); taps.push(t); if(taps.length>=3){ const d=(taps[taps.length-1]-taps[0])/(taps.length-1); setBpm(Math.round(60000/d)); } });
  const sk=h('div','knobs'); sk.style.width='54px'; r1.appendChild(sk);
  Knob(sk,{label:'SWING',get:()=>S.swing,set:v=>{S.swing=v;},max:.5,def:0,fmt:v=>Math.round(50+v*33)+'%'});
  dragNum(bpm,()=>S.bpm,v=>setBpm(v),3);
  // key
  const b2=h('div','box'); el.appendChild(b2);
  b2.appendChild(h('div','lbl','KEY'));
  const keys=h('div','keys'); b2.appendChild(keys);
  const kEls=NOTE_NAMES.map((n,i)=>{ const b=h('button',[1,3,6,8,10].includes(i)?'bk':'',n); tap(b,()=>{ S.key=i; markDirty(); refreshAll(); }); keys.appendChild(b); return b; });
  const sr=h('div','row sb'); b2.appendChild(sr); sr.appendChild(h('span','lbl','SCALE'));
  const SC=Object.keys(SCALES);
  const ss=Seg(sr,SC,()=>SC.indexOf(S.scale),i=>{ S.scale=SC[i]; refreshAll(); });
  // scene
  const b3=h('div','box'); el.appendChild(b3);
  const r3=h('div','row sb'); b3.appendChild(r3);
  const sl=h('span','lbl',''); r3.appendChild(sl);
  const LEN=[1,2,4,8];
  const ls=Seg(r3,LEN.map(x=>x+' BAR'),()=>LEN.indexOf(cur().bars),i=>{ cur().bars=LEN[i]; refreshAll(); });
  const r4=h('div','row'); b3.appendChild(r4);
  Btn(r4,'COPY','',()=>{ UI.clip=JSON.parse(JSON.stringify(cur())); toast('SCENE '+SCENE_NAMES[S.scene]+' COPIED'); });
  Btn(r4,'PASTE','',()=>{ if(!UI.clip) return toast('CLIPBOARD EMPTY'); S.scenes[S.scene]=JSON.parse(JSON.stringify(UI.clip)); markDirty(); refreshAll(); toast('PASTED TO '+SCENE_NAMES[S.scene]); });
  r4.appendChild(h('div','grow'));
  ConfirmBtn(r4,'CLEAR SCENE',()=>{ S.scenes[S.scene]=emptyScene(cur().bars); markDirty(); refreshAll(); });
  // song chain
  const b4=h('div','box'); el.appendChild(b4);
  const r5=h('div','row sb'); b4.appendChild(r5);
  r5.appendChild(h('span','lbl','SONG CHAIN · TAP SLOT TO CYCLE'));
  const bc2=Btn(r5,'CHAIN','red',()=>{ S.chain=!S.chain; if(S.chain && Seq.playing){ Seq.songPos=Math.max(0,S.song.findIndex(x=>x===Seq.playScene)); } upd(); markDirty(); });
  const songs=h('div','songs'); b4.appendChild(songs);
  const sEls=S.song.map((v,i)=>{ const b=h('div','sslot'); tap(b,()=>{ S.song[i]= S.song[i]>=3 ? -1 : S.song[i]+1; upd(); markDirty(); }); songs.appendChild(b); return b; });
  // bounce & project
  const b5=h('div','box'); el.appendChild(b5);
  const r6=h('div','row sb'); b5.appendChild(r6);
  const bb=Btn(r6,'● BOUNCE','red',()=>{
    if(!A.ctx) return;
    const starting=!Bounce.rec;
    bounceToggle((st,msg)=>{ if(st==='start') toast('RECORDING OUTPUT'); else if(st==='done') toast('SAVED '+msg); else toast(msg); });
    if(starting && Bounce.rec && !Seq.playing) seqStart();
  });
  const bInfo=h('span','lbl','RECORD MASTER → M4A'); r6.appendChild(bInfo);
  const r7=h('div','row'); b5.appendChild(r7);
  ConfirmBtn(r7,'LOAD DEMO',()=>{ seqStop(); S=demoProject(); afterLoad(); toast('DEMO LOADED'); });
  ConfirmBtn(r7,'NEW EMPTY',()=>{ seqStop(); const d=demoProject(); d.scenes=[emptyScene(4),emptyScene(4),emptyScene(4),emptyScene(4)]; S=d; afterLoad(); toast('NEW PROJECT'); });
  r7.appendChild(h('div','grow'));
  b5.appendChild(h('div','lbl','AUTO-SAVED TO THIS DEVICE · v1.0'));
  function upd(){
    bpm.textContent=S.bpm;
    kEls.forEach((b,i)=>b.classList.toggle('on',i===S.key)); ss.upd(); ls.upd();
    sl.textContent='SCENE '+SCENE_NAMES[S.scene]+' LENGTH';
    bc2.classList.toggle('on',!!S.chain);
    sEls.forEach((b,i)=>{ const v=S.song[i]; b.innerHTML=`<small>${i+1}</small>${v>=0?SCENE_NAMES[v]:'·'}`; b.classList.toggle('emp',v<0); });
  }
  function frame(t,np){
    bpm.textContent=S.bpm;
    sEls.forEach((b,i)=>b.classList.toggle('pl', !!(S.chain && np && np.songPos===i)));
    bb.classList.toggle('on',!!Bounce.rec);
    if(Bounce.rec){ const s=(performance.now()-Bounce.t0)/1000; bInfo.textContent='● '+Math.floor(s/60)+':'+pad2(Math.floor(s%60))+' TAP TO STOP'; }
    else bInfo.textContent='RECORD MASTER → AUDIO FILE';
  }
  return {el,refresh:upd,frame};
}
function setBpm(v){ S.bpm=clamp(Math.round(v),40,220); applyMix(); markDirty(); }
function dragNum(el,get,set,pxPer){
  let d=false, sy=0, sv=0;
  el.addEventListener('pointerdown',e=>{ e.preventDefault(); d=true; el.setPointerCapture(e.pointerId); sy=e.clientY; sv=get(); el.classList.add('drag'); });
  el.addEventListener('pointermove',e=>{ if(d) set(sv+(sy-e.clientY)/pxPer); });
  const up=()=>{ d=false; el.classList.remove('drag'); };
  el.addEventListener('pointerup',up); el.addEventListener('pointercancel',up);
}

/* ---------- tabs / transport ---------- */
const TABS=[['drum','01','DRUM'],['bass','02','BASS'],['chord','03','CHORD'],['lead','04','LEAD'],['mix','05','MIX'],['song','06','SONG']];
function buildChrome(){
  const tabs=$('#tabs');
  UI.tabEls={};
  for(const [id,n,l] of TABS){
    const b=h('button','',`<span class="n">${n}</span><span>${l}</span><i class="act"></i>`); b.dataset.tr=id;
    tap(b,()=>showTab(id)); tabs.appendChild(b); UI.tabEls[id]=b;
  }
  const leds=$('#leds'); UI.ledEls=[]; for(let i=0;i<16;i++){ const d=h('i'); leds.appendChild(d); UI.ledEls.push(d); }
  const sc=$('#scenes'); UI.scnEls=SCENE_NAMES.map((n,i)=>{
    const b=h('div','scn',`<i class="ct"></i>${n}<span class="bl"></span>`);
    tap(b,()=>selectScene(i)); sc.appendChild(b); return b;
  });
  tap($('#bPlay'),()=>{ if(!A.ctx) return; Seq.playing?seqStop():seqStart(); });
  tap($('#bRec'),()=>{ recToggle(); });
  tap($('#bMet'),()=>{ S.metro=!S.metro; markDirty(); });
  dragNum($('#bpmBox'),()=>S.bpm,v=>setBpm(v),3);
}
function selectScene(i){
  if(Seq.playing){
    if(S.chain){ S.chain=false; markDirty(); }
    Seq.queued = (i===Seq.playScene) ? null : i;
  } else {
    S.scene=i; Seq.playScene=i; markDirty(); refreshAll();
  }
}
function showTab(id){
  UI.tab=id;
  for(const k in UI.pages) UI.pages[k].el.classList.toggle('show',k===id);
  for(const k in UI.tabEls) UI.tabEls[k].classList.toggle('sel',k===id);
  const pg=UI.pages[id]; pg.refresh(); if(pg.showSub) pg.showSub();
}
function buildPages(){
  UI.pages.drum=buildDrum(); UI.pages.bass=buildBass(); UI.pages.chord=buildChord();
  UI.pages.lead=buildLead(); UI.pages.mix=buildMix(); UI.pages.song=buildSong();
}
function refreshAll(){
  for(const k in UI.pages) UI.pages[k].refresh();
  UI.knobs.forEach(k=>k.draw());
  for(const k of ['bass','chord','lead']){ if(UI.pages[k].showSub) UI.pages[k].showSub(); }
}
function afterLoad(){
  UI.selSlot=0; if(A.ctx) renderKit();
  if(A.ctx){ for(const p of ['bass','chord','lead']){ A.live[p]={cut:S.synth[p].cut,res:S.synth[p].res}; applySynth(p); applyLive(p); } applyMix(); }
  markDirty(); refreshAll();
}
