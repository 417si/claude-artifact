'use strict';
/* ==========================================================
   LD-1 · drum synthesis (sample-level DSP, pre-rendered)
   Each voice is computed in JS into an AudioBuffer, then
   played back with BufferSource — punchy, consistent, cheap.
   ========================================================== */
const KITS = ['808','909','TECH','LOFI'];
const DK = { bufs:new Array(6).fill(null), peaks:new Array(6).fill(0), timers:{}, ohat:null };

/* RBJ biquad */
function BQ(type, f, q, sr, db=0){
  f=Math.min(f, sr*.47);
  const w=2*Math.PI*f/sr, cs=Math.cos(w), sn=Math.sin(w), al=sn/(2*q), Ag=Math.pow(10,db/40);
  let b0,b1,b2,a0,a1,a2;
  if(type==='lp'){ b0=(1-cs)/2; b1=1-cs; b2=(1-cs)/2; a0=1+al; a1=-2*cs; a2=1-al; }
  else if(type==='hp'){ b0=(1+cs)/2; b1=-(1+cs); b2=(1+cs)/2; a0=1+al; a1=-2*cs; a2=1-al; }
  else if(type==='bp'){ b0=al; b1=0; b2=-al; a0=1+al; a1=-2*cs; a2=1-al; }
  else { b0=1+al*Ag; b1=-2*cs; b2=1-al*Ag; a0=1+al/Ag; a1=-2*cs; a2=1-al/Ag; }
  b0/=a0; b1/=a0; b2/=a0; a1/=a0; a2/=a0;
  let x1=0,x2=0,y1=0,y2=0;
  return x=>{ const y=b0*x+b1*x1+b2*x2-a1*y1-a2*y2; x2=x1; x1=x; y2=y1; y1=y; return y; };
}
function rng(seed){ let a=seed>>>0; return ()=>{ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296*2-1; }; }
const TAU=Math.PI*2;
const sat=(x,k)=>Math.tanh(x*k)/Math.tanh(k);

function rKick(k, st, sr){
  const P=[
    {f0:40+k.tune*26, sw:2.4, swT:.02, tau:.28+k.decay*1.2, hold:.005, drv:1.1+k.tone*2.2, clk:.08+k.tone*.25, tick:0},
    {f0:46+k.tune*30, sw:5.2, swT:.024, tau:.07+k.decay*.28, hold:.014, drv:1.8+k.tone*3, clk:.25+k.tone*.55, tick:.35},
    {f0:42+k.tune*28, sw:7.5, swT:.013, tau:.11+k.decay*.5, hold:.022, drv:4+k.tone*7, clk:.2+k.tone*.5, tick:.2},
    {f0:46+k.tune*28, sw:4.5, swT:.022, tau:.1+k.decay*.36, hold:.012, drv:2.2+k.tone*3, clk:.3+k.tone*.4, tick:.25}
  ][st];
  const len=Math.floor(sr*Math.min(2.4,P.hold+P.tau*6+.05)), o=new Float32Array(len), n=rng(11);
  const cbp=BQ('bp',3800,.7,sr), hp=BQ('hp',22,.7,sr);
  let ph=0;
  for(let i=0;i<len;i++){
    const t=i/sr;
    const f=P.f0*(1+P.sw*Math.exp(-t/P.swT)+.35*Math.exp(-t/.11));
    ph+=TAU*f/sr;
    const att=Math.min(1,t/.0006);
    const amp=att*(t<P.hold?1:Math.exp(-(t-P.hold)/P.tau));
    let x=sat(Math.sin(ph)*amp,P.drv);
    x+=cbp(n())*Math.exp(-t/.0016)*P.clk*2.2;
    x+=Math.sin(TAU*1650*t)*Math.exp(-t/.005)*P.tick*.5;
    o[i]=hp(x);
  }
  if(st===2){ const lp=BQ('lp',4200,.7,sr); for(let i=0;i<len;i++) o[i]=lp(o[i]); }
  return o;
}
function rSnare(k, st, sr){
  const tune=.8+k.tune*.45, d=k.decay, n=rng(23);
  const P=[
    {f:[238,476], tT:.045+d*.06, nT:.05+d*.16, hp:1900, pk:7000, tone:.55, snap:.25},
    {f:[185,330], tT:.035+d*.05, nT:.07+d*.22, hp:700,  pk:4300, tone:.42, snap:.6},
    {f:[200,355], tT:.03+d*.04,  nT:.05+d*.18, hp:900,  pk:5200, tone:.35, snap:.7},
    {f:[190,335], tT:.04+d*.05,  nT:.07+d*.2,  hp:800,  pk:4000, tone:.45, snap:.5}
  ][st];
  const len=Math.floor(sr*Math.min(1.4,P.nT*7+.05)), o=new Float32Array(len);
  const h1=BQ('hp',P.hp,.7,sr), h2=BQ('hp',P.hp*.8,.7,sr), pk=BQ('pk',P.pk,1.1,sr,6), lp=BQ('lp',12000,.7,sr);
  const toneMix=P.tone*(1.3-k.tone);
  let p1=0,p2=0;
  for(let i=0;i<len;i++){
    const t=i/sr, pe=1+.35*Math.exp(-t/.007);
    p1+=TAU*P.f[0]*tune*pe/sr; p2+=TAU*P.f[1]*tune*pe/sr;
    const att=Math.min(1,t/.0005);
    const body=(Math.sin(p1)*.7+Math.sin(p2)*.45)*Math.exp(-t/P.tT)*toneMix;
    const nz=lp(pk(h2(h1(n()))));
    const noise=nz*(Math.exp(-t/P.nT)*(.55+k.tone*.6)+Math.exp(-t/.0018)*P.snap);
    o[i]=sat((body+noise)*att, st===2?2.6:1.4);
  }
  return o;
}
function rClap(k, st, sr){
  const d=k.decay, n=rng(37);
  const sp=[.012,.0095,.008,.01][st]*(1+k.tone*.5);
  const offs=[0,sp,sp*2.05,sp*3.1], last=offs[3], tail=.07+d*.3;
  const len=Math.floor(sr*(last+tail*6+.06)), o=new Float32Array(len);
  const bp=BQ('bp',900+k.tune*1000,1.5,sr), hp=BQ('hp',450,.7,sr), pk=BQ('pk',2600,1,sr,4);
  for(let i=0;i<len;i++){
    const t=i/sr; let e=0;
    for(let j=0;j<3;j++) if(t>=offs[j] && t<offs[j+1]) e=Math.exp(-(t-offs[j])/.0032);
    if(t>=last) e=Math.exp(-(t-last)/tail)*.95;
    o[i]=pk(hp(bp(n())))*e*3.2;
  }
  // small room
  const d1=Math.floor(sr*.017), d2=Math.floor(sr*.029);
  for(let i=len-1;i>=0;i--){ o[i]+= (i>=d1?o[i-d1]*.22:0)+(i>=d2?o[i-d2]*.12:0); }
  for(let i=0;i<len;i++) o[i]=sat(o[i], st===2?2.2:1.2);
  return o;
}
function rHat(k, st, sr, open){
  const d=k.decay, n=rng(open?53:47);
  const sc=.85+k.tune*.45;
  const fr=[205.3,304.4,369.6,522.7,540,800].map(f=>f*sc);
  const mm=[.8,.35,.5,.3][st];
  const tau=open? .07+d*.5 : .008+d*.05;
  const len=Math.floor(sr*Math.min(2,tau*7+.02)), o=new Float32Array(len);
  const bp=BQ('bp',10000,.8,sr), h1=BQ('hp',6200+k.tone*3800,.7,sr), h2=BQ('hp',6200+k.tone*3800,.7,sr), pk=BQ('pk',12000,1,sr,3);
  const ph=new Float64Array(6);
  for(let i=0;i<len;i++){
    const t=i/sr; let m=0;
    for(let j=0;j<6;j++){ ph[j]+=fr[j]/sr; m+= (ph[j]%1)<.5?1:-1; }
    const x=m/6*mm + n()*(1-mm);
    const env=Math.min(1,t/.0004)*Math.exp(-t/tau)*(open? (1+.4*Math.exp(-t/.004)) : 1);
    o[i]=pk(h2(h1(bp(x))))*env*2.4;
  }
  return o;
}
function rPerc(k, st, sr){
  const d=k.decay, n=rng(71), tone=k.tone;
  const rim=tone>=.5, len=Math.floor(sr*(rim? .25+d*.3 : .2+d*1.1)), o=new Float32Array(len);
  const hp=BQ('hp',2800,.7,sr), bp=BQ('bp',1800,2,sr);
  let p1=0,p2=0;
  for(let i=0;i<len;i++){
    const t=i/sr;
    if(rim){
      const f1=(420+k.tune*260), f2=f1*3.55;
      p1+=TAU*f1/sr; p2+=TAU*f2/sr;
      const b=(tone-.5)*2;
      const x=(Math.sin(p1)*.6*Math.exp(-t/(.012+d*.03)) + Math.sin(p2)*(.4+b*.5)*Math.exp(-t/(.006+d*.02)) + bp(hp(n()))*Math.exp(-t/.0025)*1.6);
      o[i]=sat(x,1.6);
    } else {
      const f=(95+k.tune*260)*(1+.6*Math.exp(-t/.025));
      p1+=TAU*f/sr; p2+=TAU*f*1.52/sr;
      const x=(Math.sin(p1)+Math.sin(p2)*.18)*Math.exp(-t/(.07+d*.38))*Math.min(1,t/.0006) + hp(n())*Math.exp(-t/.003)*tone*1.2;
      o[i]=sat(x,1.3);
    }
  }
  return o;
}
function lofi(o, sr){
  const lp=BQ('lp',5200,.7,sr), hold=3, q=48; let h=0;
  for(let i=0;i<o.length;i++){ const x=lp(o[i]); if(i%hold===0) h=Math.round(x*q)/q; o[i]=h; }
  return o;
}
function renderVoice(i){
  if(!A.ctx) return;
  const sr=A.ctx.sampleRate, k=S.kit[i], st=clamp(S.drumKit|0,0,3);
  let o;
  if(i===0) o=rKick(k,st,sr);
  else if(i===1) o=rSnare(k,st,sr);
  else if(i===2) o=rClap(k,st,sr);
  else if(i===3) o=rHat(k,st,sr,false);
  else if(i===4) o=rHat(k,st,sr,true);
  else o=rPerc(k,st,sr);
  if(st===3) lofi(o,sr);
  let pk=0; for(let j=0;j<o.length;j++){ const a=Math.abs(o[j]); if(a>pk) pk=a; }
  const g= pk>0 ? .92/pk : 1;
  for(let j=0;j<o.length;j++) o[j]*=g;
  // short fade-out
  const fo=Math.min(o.length,Math.floor(sr*.004)); for(let j=0;j<fo;j++) o[o.length-1-j]*=j/fo;
  const b=A.ctx.createBuffer(1,o.length,sr);
  b.getChannelData(0).set(o);
  DK.bufs[i]=b; DK.peaks[i]=o;
}
function renderKit(){ for(let i=0;i<6;i++) renderVoice(i); }
function scheduleRender(i){ clearTimeout(DK.timers[i]); DK.timers[i]=setTimeout(()=>renderVoice(i),35); }

const DRUM_GAIN=[1,.85,.75,.55,.5,.65];
function playDrum(i, t, vel){
  const b=DK.bufs[i]; if(!b) return;
  const ctx=A.ctx, src=ctx.createBufferSource(), g=ctx.createGain();
  src.buffer=b; g.gain.value=S.kit[i].level*vel*DRUM_GAIN[i]*1.25;
  src.connect(g); g.connect(A.bus.drum.in); src.start(t);
  A.drumHits[i]=t;
  if(i===4) DK.ohat={g,t};
  else if(i===3 && DK.ohat && DK.ohat.t<t){ DK.ohat.g.gain.setTargetAtTime(0,t,.006); DK.ohat=null; }
  if(i===0) duck(t, vel);
}
function duck(t, vel){
  const amt=S.mix.master.duck*vel; if(amt<.01) return;
  for(const p of ['bass','chord','lead']){
    const g=A.bus[p].duck.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(1-amt,t,.003);
    g.setTargetAtTime(1,t+.045,.09);
  }
}
