'use strict';
/* ==========================================================
   LD-1 · audio engine (Web Audio)
   ========================================================== */
const A = {
  ctx:null, bus:{}, voices:new Set(), live:{}, noise:null,
  drumHits:new Array(6).fill(0), lastOHat:null
};

function audioInit(){
  const AC = window.AudioContext || window.webkitAudioContext;
  let ctx; try{ ctx = new AC({latencyHint:0}); }catch(e){ ctx = new AC({latencyHint:'interactive'}); }
  A.ctx = ctx;
  try{ if(navigator.audioSession) navigator.audioSession.type='playback'; }catch(e){}

  // noise buffer
  const nb = ctx.createBuffer(1, ctx.sampleRate*2, ctx.sampleRate), nd = nb.getChannelData(0);
  for(let i=0;i<nd.length;i++) nd[i]=Math.random()*2-1;
  A.noise = nb;

  // ---- master ----
  // master: no DynamicsCompressor here (each adds ~6 ms look-ahead); zero-latency soft clip instead
  const mIn = ctx.createGain();
  const dry = ctx.createGain(), wet = ctx.createGain();
  const sh = ctx.createWaveShaper(); sh.curve = tanhCurve(3.2); sh.oversample='none';
  const sum = ctx.createGain(); sum.gain.value=.72;
  const clip = ctx.createWaveShaper(); clip.curve = softClipCurve(); clip.oversample='none';
  const mOut = ctx.createGain();
  const an = ctx.createAnalyser(); an.fftSize=2048; an.smoothingTimeConstant=.72;
  mIn.connect(dry); mIn.connect(sh); sh.connect(wet);
  dry.connect(sum); wet.connect(sum); sum.connect(clip); clip.connect(mOut); mOut.connect(an); an.connect(ctx.destination);
  const comp=null;
  A.master = {in:mIn, dry, wet, out:mOut, an, comp};

  // ---- delay (ping-pong) ----
  const dIn = ctx.createGain();
  const d1 = ctx.createDelay(2), d2 = ctx.createDelay(2);
  const fb = ctx.createGain(), dlp = ctx.createBiquadFilter(); dlp.type='lowpass'; dlp.frequency.value=3800;
  const dhp = ctx.createBiquadFilter(); dhp.type='highpass'; dhp.frequency.value=180;
  const pL = ctx.createStereoPanner(), pR = ctx.createStereoPanner(); pL.pan.value=-.7; pR.pan.value=.7;
  dIn.connect(dhp); dhp.connect(d1); d1.connect(pL); d1.connect(d2); d2.connect(pR); d2.connect(dlp); dlp.connect(fb); fb.connect(d1);
  pL.connect(mIn); pR.connect(mIn);
  A.delay = {in:dIn, d1, d2, fb};

  // ---- reverb ----
  const rIn = ctx.createGain(), conv = ctx.createConvolver(), rlp = ctx.createBiquadFilter();
  rlp.type='lowpass'; rlp.frequency.value=6500;
  rIn.connect(conv); conv.connect(rlp); rlp.connect(mIn);
  A.rev = {in:rIn, conv, size:-1};

  // ---- track buses ----
  for(const t of TRACKS){
    const i = ctx.createGain(), v = ctx.createGain(), a = ctx.createAnalyser(), ds = ctx.createGain(), rs = ctx.createGain();
    a.fftSize=512;
    let duckG=null;
    if(t==='drum'){
      const c=ctx.createDynamicsCompressor(); c.threshold.value=-14; c.ratio.value=3; c.knee.value=6; c.attack.value=.008; c.release.value=.09;
      const mk=ctx.createGain(); mk.gain.value=1.25;
      i.connect(c); c.connect(mk); mk.connect(v);
    } else { duckG=ctx.createGain(); i.connect(duckG); duckG.connect(v); } v.connect(a); v.connect(mIn); v.connect(ds); ds.connect(dIn); v.connect(rs); rs.connect(rIn);
    A.bus[t] = {in:i, duck:duckG, vol:v, an:a, dly:ds, rev:rs, buf:new Float32Array(512), peak:0};
  }
  // ---- persistent mono bass ----
  buildBassSynth();
  for(const p of ['bass','chord','lead']) A.live[p] = {cut:S.synth[p].cut, res:S.synth[p].res};
  applyMix(); applySynth('bass');
  renderKit();
}

function softClipCurve(){
  const n=2048, c=new Float32Array(n);
  for(let i=0;i<n;i++){ const x=(i/(n-1)*2-1)*1.5; const a=Math.abs(x); c[i]= a<.7 ? x : Math.sign(x)*(.7+.3*Math.tanh((a-.7)/.3)); }
  return c;
}
function tanhCurve(k){
  const n=1024, c=new Float32Array(n), t=Math.tanh(k);
  for(let i=0;i<n;i++){ const x=i/(n-1)*2-1; c[i]=Math.tanh(k*x)/t; }
  return c;
}
function makeIR(sec){
  const ctx=A.ctx, len=Math.floor(ctx.sampleRate*sec), b=ctx.createBuffer(2,len,ctx.sampleRate);
  for(let ch=0;ch<2;ch++){
    const d=b.getChannelData(ch);
    for(let i=0;i<len;i++){ const x=i/len; d[i]=(Math.random()*2-1)*Math.pow(1-x,2.6)*(i<ctx.sampleRate*.012?i/(ctx.sampleRate*.012):1); }
  }
  return b;
}
function stepDur(){ return 60/S.bpm/4; }

/* ---------- mix ---------- */
let _irT=0;
function applyMix(){
  if(!A.ctx) return;
  const now=A.ctx.currentTime, M=S.mix, anySolo=TRACKS.some(t=>M[t].solo);
  for(const t of TRACKS){
    const m=M[t], b=A.bus[t];
    const g = m.mute ? 0 : (anySolo && !m.solo ? 0 : m.vol*m.vol*1.2);
    b.vol.gain.setTargetAtTime(g, now, .02);
    b.dly.gain.setTargetAtTime(m.dly, now, .02);
    b.rev.gain.setTargetAtTime(m.rev*1.2, now, .02);
  }
  const ms=M.master;
  A.master.out.gain.setTargetAtTime(ms.vol*ms.vol*1.1, now, .02);
  A.master.dry.gain.setTargetAtTime(1-ms.drive*.55, now, .02);
  A.master.wet.gain.setTargetAtTime(ms.drive*.7, now, .02);
  A.delay.fb.gain.setTargetAtTime(ms.fb*.85, now, .03);
  const dt = stepDur()*DLY_DIVS[ms.dlyDiv].s;
  A.delay.d1.delayTime.setTargetAtTime(dt, now, .05);
  A.delay.d2.delayTime.setTargetAtTime(dt, now, .05);
  const sz = Math.round(ms.rev*20)/20;
  if(sz!==A.rev.size){
    A.rev.size=sz; clearTimeout(_irT);
    _irT=setTimeout(()=>{ A.rev.conv.buffer = makeIR(.8+sz*4.2); },120);
  }
}

/* ---------- synth voices ---------- */
function liveDetune(part){ return A.live[part].cut*9.5*1200; }
function applyLive(part){
  if(!A.ctx) return;
  const now=A.ctx.currentTime, det=liveDetune(part), q=resQ(A.live[part].res);
  for(const v of A.voices){ if(v.part===part){ v.flt.detune.setTargetAtTime(det,now,.012); v.flt.Q.setTargetAtTime(q,now,.012); } }
  if(part==='bass' && A.bs){ A.bs.f1.detune.setTargetAtTime(det,now,.012); A.bs.f2.detune.setTargetAtTime(det,now,.012); A.bs.f1.Q.setTargetAtTime(q,now,.012); }
}
function applySynth(part){
  if(!A.ctx) return;
  const p=S.synth[part];
  if(!A.live[part]) A.live[part]={cut:p.cut,res:p.res};
  if(part==='bass' && A.bs){
    const b=A.bs, now=A.ctx.currentTime;
    b.o1.type=b.o2.type=WAVES[p.wave];
    b.o1.detune.setTargetAtTime(-p.det*25,now,.02); b.o2.detune.setTargetAtTime(p.det*25,now,.02);
    b.subG.gain.setTargetAtTime(p.sub*.9,now,.02);
    b.drv.curve = tanhCurve(1+p.drive*9);
    b.post.gain.setTargetAtTime(p.level/(1+p.drive*1.6),now,.02);
  }
  for(const v of A.voices){ if(v.part===part && v.lvl){ v.lvl.gain.setTargetAtTime(p.level, A.ctx.currentTime, .02);} }
}

function buildBassSynth(){
  const ctx=A.ctx, b={};
  b.o1=ctx.createOscillator(); b.o2=ctx.createOscillator(); b.sub=ctx.createOscillator(); b.sub.type='sine';
  b.mix=ctx.createGain(); b.mix.gain.value=.45; b.subG=ctx.createGain();
  b.f1=ctx.createBiquadFilter(); b.f2=ctx.createBiquadFilter(); b.f1.type=b.f2.type='lowpass'; b.f2.Q.value=.6;
  b.f1.frequency.value=30; b.f2.frequency.value=30;
  b.drv=ctx.createWaveShaper(); b.drv.oversample='none'; b.vca=ctx.createGain(); b.vca.gain.value=0; b.post=ctx.createGain();
  b.o1.connect(b.mix); b.o2.connect(b.mix); b.sub.connect(b.subG);
  b.mix.connect(b.f1); b.f1.connect(b.f2); b.f2.connect(b.drv); b.drv.connect(b.vca); b.subG.connect(b.vca);
  b.vca.connect(b.post); b.post.connect(A.bus.bass.in);
  const f=mtof(45); [b.o1,b.o2].forEach(o=>o.frequency.value=f); b.sub.frequency.value=f/2;
  b.o1.start(); b.o2.start(); b.sub.start();
  A.bs=b;
}
let bassUntil=0;
function bassNote(t, midi, dur, vel){
  const b=A.bs, p=S.synth.bass, f=mtof(midi);
  const det=liveDetune('bass');
  for(const o of [b.o1,b.o2]){ o.frequency.cancelScheduledValues(t); }
  b.sub.frequency.cancelScheduledValues(t);
  if(p.glide>.01 && t < bassUntil+0.03){
    b.o1.frequency.setTargetAtTime(f,t,p.glide*.12); b.o2.frequency.setTargetAtTime(f,t,p.glide*.12); b.sub.frequency.setTargetAtTime(f/2,t,p.glide*.12);
  } else {
    b.o1.frequency.setValueAtTime(f,t); b.o2.frequency.setValueAtTime(f,t); b.sub.frequency.setValueAtTime(f/2,t);
  }
  const kt=Math.pow(2,(midi-48)/12*.5), base=30*kt, peak=base*Math.pow(2,p.env*7.5*(.6+vel*.4));
  for(const fl of [b.f1,b.f2]){
    fl.frequency.cancelScheduledValues(t);
    fl.frequency.setTargetAtTime(peak,t,.0015);
    fl.frequency.setTargetAtTime(base,t+.006,Math.max(.01,p.d/3));
    fl.detune.setTargetAtTime(det,t,.01);
  }
  const g=b.vca.gain;
  g.cancelScheduledValues(t);
  g.setTargetAtTime(vel,t,Math.max(.0008,p.a/3));
  g.setTargetAtTime(vel*Math.max(p.s,.001),t+p.a,Math.max(.01,p.d/3));
  g.setTargetAtTime(0,t+dur,Math.max(.005,p.r/4));
  bassUntil=t+dur;
  A.bassNote={midi,t,end:t+dur};
}

function makeVoice(part, t, midi, vel, dest){
  const ctx=A.ctx, p=S.synth[part], f=mtof(midi);
  const v={part, midi};
  v.o1=ctx.createOscillator(); v.o2=ctx.createOscillator();
  v.o1.type=v.o2.type=WAVES[p.wave];
  v.o1.frequency.setValueAtTime(f,t); v.o2.frequency.setValueAtTime(f,t);
  v.o1.detune.value=-p.det*28; v.o2.detune.value=p.det*28;
  const pl=ctx.createStereoPanner(), pr=ctx.createStereoPanner();
  const sp = part==='chord' ? .55 : .25; pl.pan.value=-sp*p.det*1.6; pr.pan.value=sp*p.det*1.6;
  v.o1.connect(pl); v.o2.connect(pr);
  v.flt=ctx.createBiquadFilter(); v.flt.type='lowpass'; v.flt.Q.value=resQ(A.live[part].res);
  v.flt.detune.value=liveDetune(part);
  const mix=ctx.createGain(); mix.gain.value=.32;
  pl.connect(mix); pr.connect(mix); mix.connect(v.flt);
  if(p.sub>.01){
    v.sub=ctx.createOscillator(); v.sub.type='sine'; v.sub.frequency.setValueAtTime(f/2,t);
    const sg=ctx.createGain(); sg.gain.value=p.sub*.5; v.sub.connect(sg); sg.connect(v.flt);
  }
  let src=v.flt;
  if(p.drive>.02){ const d=ctx.createWaveShaper(); d.curve=tanhCurve(1+p.drive*7); v.flt.connect(d); src=d; }
  v.vca=ctx.createGain(); v.vca.gain.value=0;
  v.lvl=ctx.createGain(); v.lvl.gain.value=p.level;
  src.connect(v.vca); v.vca.connect(v.lvl); v.lvl.connect(dest||A.bus[part].in);
  const kt=Math.pow(2,(midi-60)/12*.5), base=30*kt, peak=base*Math.pow(2,p.env*7.5);
  v.flt.frequency.setValueAtTime(base,t);
  v.flt.frequency.setTargetAtTime(peak,t,Math.max(.002,p.a/3));
  v.flt.frequency.setTargetAtTime(base*Math.pow(2,p.env*7.5*p.s*.5),t+p.a,Math.max(.02,p.d/3));
  const g=v.vca.gain;
  g.setValueAtTime(0,t);
  g.setTargetAtTime(vel,t,Math.max(.0008,p.a/3));
  g.setTargetAtTime(vel*Math.max(p.s,.0001),t+p.a,Math.max(.01,p.d/3));
  v.o1.start(t); v.o2.start(t); if(v.sub) v.sub.start(t);
  v.end=Infinity;
  v.release=(tOff)=>{
    if(v.end!==Infinity) return;
    tOff=Math.max(tOff, ctx.currentTime);
    const r=Math.max(.01,S.synth[part].r);
    g.cancelScheduledValues(tOff);
    g.setTargetAtTime(0,tOff,r/4);
    const stopT=tOff+r*1.6+.05;
    v.o1.stop(stopT); v.o2.stop(stopT); if(v.sub) v.sub.stop(stopT);
    v.end=stopT;
  };
  v.setPitch=(m,tt,tc)=>{
    v.midi=m; const ff=mtof(m);
    v.o1.frequency.setTargetAtTime(ff,tt,tc); v.o2.frequency.setTargetAtTime(ff,tt,tc);
    if(v.sub) v.sub.frequency.setTargetAtTime(ff/2,tt,tc);
  };
  v.o1.onended=()=>{ A.voices.delete(v); try{v.lvl.disconnect();}catch(e){} };
  A.voices.add(v);
  return v;
}

/* ---------- drums: see drums.js ---------- */
function env(g,t,peak,dec){ g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(peak,t+.001); g.gain.setTargetAtTime(0,t+.002,dec); }

function click(t, accent){
  const ctx=A.ctx, o=ctx.createOscillator(), g=ctx.createGain();
  o.frequency.value=accent?1760:1180; env(g,t,.25,.012); o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t+.1);
}

/* ---------- bounce (record master) ---------- */
const Bounce={rec:null,chunks:[],t0:0};
function bounceToggle(cb){
  if(Bounce.rec){ Bounce.rec.stop(); return; }
  if(!window.MediaRecorder){ cb && cb('error','MediaRecorder unsupported'); return; }
  if(!A.streamDest){ A.streamDest=A.ctx.createMediaStreamDestination(); A.master.out.connect(A.streamDest); }
  let mime='';
  for(const m of ['audio/mp4','audio/webm;codecs=opus','audio/webm']) if(MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)){ mime=m; break; }
  const r=new MediaRecorder(A.streamDest.stream, mime?{mimeType:mime}:undefined);
  Bounce.chunks=[]; Bounce.rec=r; Bounce.t0=performance.now();
  r.ondataavailable=e=>{ if(e.data.size) Bounce.chunks.push(e.data); };
  r.onstop=async()=>{
    const type=r.mimeType||mime||'audio/mp4', ext=type.includes('mp4')?'m4a':'webm';
    const blob=new Blob(Bounce.chunks,{type}); Bounce.rec=null;
    const d=new Date(), name=`LD1_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}.${ext}`;
    const file=new File([blob],name,{type});
    try{
      if(navigator.canShare && navigator.canShare({files:[file]})){ await navigator.share({files:[file],title:name}); cb&&cb('done',name); return; }
    }catch(e){ if(e.name==='AbortError'){ cb&&cb('done',name); return; } }
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click(); a.remove();
    cb&&cb('done',name);
  };
  r.start(250); cb&&cb('start');
}
