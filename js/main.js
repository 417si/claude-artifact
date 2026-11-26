'use strict';
/* ==========================================================
   LD-1 · boot + realtime loop
   ========================================================== */
loadProject();
for(const t of ['drum','bass','chord','lead']) COL[t]=css('--c-'+t);
buildChrome();
buildPages();
showTab('drum');

const H = {
  sr:$('#hSr'), lat:$('#hLat'), vox:$('#hVox'), jit:$('#hJit'), clock:$('#hClock'), rec:$('#hRec'),
  bpm:$('#hBpm'), pos:$('#hPos'), key:$('#hKey'), chord:$('#hChord'), chordN:$('#hChordN'),
  note:$('#hNote'), hz:$('#hHz'), tun:$('#hTun'), pk:$('#hPk'), pkBar:$('#hPkBar'),
  scope:$('#scope'), bars:$('#bars'), scene:$('#hScene'), play:$('#bPlay'), recB:$('#bRec'), met:$('#bMet')
};
let tdBuf=null, fqBuf=null, peakHold=0, fps=60, lastFrame=performance.now();

function silentUnlock(){
  if(navigator.audioSession) return;
  try{
    const sr=8000, n=800, buf=new ArrayBuffer(44+n*2), v=new DataView(buf);
    const ws=(o,s)=>{ for(let i=0;i<s.length;i++) v.setUint8(o+i,s.charCodeAt(i)); };
    ws(0,'RIFF'); v.setUint32(4,36+n*2,true); ws(8,'WAVE'); ws(12,'fmt '); v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true);
    v.setUint32(24,sr,true); v.setUint32(28,sr*2,true); v.setUint16(32,2,true); v.setUint16(34,16,true); ws(36,'data'); v.setUint32(40,n*2,true);
    const a=new Audio(URL.createObjectURL(new Blob([buf],{type:'audio/wav'}))); a.loop=true; a.setAttribute('playsinline',''); a.volume=.01; a.play().catch(()=>{});
  }catch(e){}
}

function powerOn(){
  if(A.ctx) return;
  silentUnlock();
  audioInit();
  for(const p of ['bass','chord','lead']){ applySynth(p); applyLive(p); }
  A.ctx.resume();
  $('#boot').classList.add('off');
  H.sr.textContent=(A.ctx.sampleRate/1000).toFixed(1)+'K';
  refreshAll();
}
$('#boot').addEventListener('pointerdown',e=>{ e.preventDefault(); powerOn(); });
document.addEventListener('pointerdown',()=>{ if(A.ctx && A.ctx.state!=='running') A.ctx.resume(); },true);
document.addEventListener('visibilitychange',()=>{ if(!document.hidden && A.ctx && A.ctx.state!=='running') A.ctx.resume(); });
document.addEventListener('gesturestart',e=>e.preventDefault());
document.addEventListener('contextmenu',e=>e.preventDefault());
window.addEventListener('resize',()=>{ UI.pages[UI.tab].refresh(); });

/* visual queue: things scheduled ahead that should light up when heard */
function processVQ(t){
  if(!Seq.vq.length) return;
  const keep=[];
  for(const q of Seq.vq){
    if(q.time>t){ keep.push(q); continue; }
    if(q.k==='drum'){ UI.flash[q.r]=q.time; }
    else if(q.k==='bass'){ UI.bassMidi=q.midi; UI.bassT=q.time; UI.bassEnd=A.bassNote?A.bassNote.end:q.time+.2; }
    else if(q.k==='chord'){ UI.chordNotes=q.notes; UI.chordT=q.time; UI.chordEnd=q.end; }
    else if(q.k==='lead'){
      const e=q.e;
      if(e.k==='off') UI.ghosts.delete(e.id);
      else UI.ghosts.set(e.id,{x:e.x,y:e.y,p:e.p,s:e.s});
    }
  }
  Seq.vq=keep;
}

/* drum flash: derive from scheduled hits */
function drumFlash(t){
  for(let r=0;r<6;r++){ const h=A.drumHits[r]; if(h<=t && h>UI.flash[r]) UI.flash[r]=h; }
}

/* apply recorded XY motion */
const lastApplied={};
function applyMotion(np){
  for(const part of ['bass','chord','lead']){
    if(UI.xyTouch[part]) continue;
    const base=S.synth[part];
    let tx=base.cut, ty=base.res;
    if(np){
      const m=S.scenes[np.scene].motion[part];
      const v=motionAt(m,np.pos,np.total);
      if(v){ tx=v.x; ty=v.y; }
    }
    const L=A.live[part];
    if(Math.abs(L.cut-tx)>.001 || Math.abs(L.res-ty)>.001){ A.live[part]={cut:tx,res:ty}; applyLive(part); }
  }
}

function drawScope(){
  const {c,w,h}=fitCanvas(H.scope), an=A.master.an;
  if(!tdBuf){ tdBuf=new Float32Array(an.fftSize); fqBuf=new Uint8Array(an.frequencyBinCount); }
  an.getFloatTimeDomainData(tdBuf); an.getByteFrequencyData(fqBuf);
  c.clearRect(0,0,w,h);
  const sw=w*.56;
  c.fillStyle='#1a1a1a'; for(let x=0;x<sw;x+=sw/8) c.fillRect(x,0,1,h); c.fillRect(0,h/2,sw,1);
  // trigger on rising zero crossing
  let st=0; for(let i=1;i<tdBuf.length/2;i++){ if(tdBuf[i-1]<0 && tdBuf[i]>=0){ st=i; break; } }
  const N=640;
  c.beginPath();
  let pk=0;
  for(let i=0;i<tdBuf.length;i++){ const a=Math.abs(tdBuf[i]); if(a>pk) pk=a; }
  for(let i=0;i<N;i++){ const v=tdBuf[st+i]||0; const x=i/N*sw, y=h/2-v*h*.46; i?c.lineTo(x,y):c.moveTo(x,y); }
  c.strokeStyle='#ededed'; c.lineWidth=1.2; c.stroke();
  // dot-matrix spectrum
  const bands=24, bx=sw+8, bw=(w-bx)/bands, rows=Math.floor(h/4), sr=A.ctx.sampleRate, bins=fqBuf.length;
  for(let b=0;b<bands;b++){
    const f0=40*Math.pow(16000/40,b/bands), f1=40*Math.pow(16000/40,(b+1)/bands);
    const i0=Math.floor(f0/(sr/2)*bins), i1=Math.max(i0+1,Math.floor(f1/(sr/2)*bins));
    let m=0; for(let i=i0;i<i1&&i<bins;i++) m=Math.max(m,fqBuf[i]);
    const lv=Math.round(m/255*rows);
    for(let r=0;r<rows;r++){
      c.fillStyle = r<lv ? (r>=rows-2?'#ff3b1f':'#ededed') : '#191919';
      c.fillRect(bx+b*bw+.5, h-(r+1)*4+1, Math.max(1,bw-1.5), 2.4);
    }
  }
  peakHold=Math.max(pk,peakHold*.94);
  const db=20*Math.log10(Math.max(peakHold,1e-6));
  H.pk.textContent= db<-60?'-∞':db.toFixed(1);
  H.pkBar.style.width=clamp((db+48)/48*100,0,100)+'%';
  H.pkBar.style.background= db>-1 ? '#ff3b1f' : '#ededed';
}

let lastStepUI=-2, lastSceneUI=-1, clockT=0;
function frame(){
  requestAnimationFrame(frame);
  const pn=performance.now(); fps=fps*.92+(1000/Math.max(1,pn-lastFrame))*.08; lastFrame=pn;
  H.bpm.textContent=S.bpm;
  H.rec.classList.toggle('on',Rec.on);
  H.play.classList.toggle('on',Seq.playing);
  H.recB.classList.toggle('on',Rec.on);
  H.met.classList.toggle('on',!!S.metro);
  if(pn-clockT>1000){ clockT=pn; const d=new Date(); H.clock.textContent=pad2(d.getHours())+':'+pad2(d.getMinutes()); }
  if(!A.ctx) return;
  const t=heardTime();
  const np = Seq.playing ? nowPos() : null;

  // follow playing scene
  if(np && np.scene!==S.scene){ S.scene=np.scene; refreshAll(); }
  processVQ(t); applyMotion(np);

  // header
  H.lat.textContent='LAT '+Math.round(((A.ctx.baseLatency||0)+(A.ctx.outputLatency||0))*1000)+'MS';
  let vox=0; for(const v of A.voices) if(v.end===Infinity || v.end>A.ctx.currentTime) vox++;
  if(A.bassNote && t<A.bassNote.end) vox++;
  H.vox.textContent='VOX '+pad2(vox);
  H.jit.textContent=Seq.playing?('JIT '+Seq.jitter.toFixed(1)):('FPS '+Math.round(fps));
  const sc=cur();
  if(np){
    const bar=Math.floor(np.step/16), beat=Math.floor((np.step%16)/4), st=np.step%4;
    H.pos.textContent=pad2(bar+1)+'.'+(beat+1)+'.'+(st+1);
  } else H.pos.textContent='--.-.-';
  H.key.textContent=NOTE_NAMES[S.key]+' '+S.scale+' · '+sc.bars+'BAR';
  const bar=np?Math.floor(np.step/16):UI.selSlot;
  const ch=sc.chords[Math.min(bar,sc.bars-1)];
  H.chord.textContent=chordName(ch);
  const vo=sceneVoicings(sc)[Math.min(bar,sc.bars-1)]||[];
  H.chordN.textContent=vo.map(m=>NOTE_NAMES[mod(m,12)]).join(' ');
  // lead readout
  let lp=null;
  for(const T of UI.leadTouches.values()) lp=T.p;
  if(lp===null){ for(const g of UI.ghosts.values()) lp=g.p; }
  if(lp!==null){
    const m=lp+S.synth.lead.oct*12, r=Math.round(m), cents=(m-r)*100;
    H.note.textContent=noteName(m)+(cents>=0?' +':' ')+Math.round(cents);
    H.hz.textContent=Math.round(mtof(m))+'HZ';
    H.tun.style.left=(50+cents)+'%';
  } else { H.note.textContent='—'; H.hz.textContent='---HZ'; H.tun.style.left='50%'; }
  // leds
  const s16=np?np.step%16:-1;
  if(s16!==lastStepUI || lastSceneUI!==S.scene){
    for(let i=0;i<16;i++){
      const on=sc.drum.some(r=>r[i]) || sc.bass[i]!==null || sc.rhythm[i];
      UI.ledEls[i].className = i===s16 ? 'pl' : (on?'on':'');
    }
    let bh=''; for(let b=0;b<sc.bars;b++) bh+=`<i class="${np&&Math.floor(np.step/16)===b?'pl':'on'}"></i>`;
    H.bars.innerHTML=bh;
    lastStepUI=s16; lastSceneUI=S.scene;
  }
  H.scene.textContent = S.chain&&np ? ('SONG '+(np.songPos+1)+'/'+S.song.filter(x=>x>=0).length) : ('SCN '+SCENE_NAMES[S.scene]+(Seq.queued!==null?'→'+SCENE_NAMES[Seq.queued]:''));
  // scenes
  UI.scnEls.forEach((b,i)=>{
    b.classList.toggle('on',i===S.scene);
    b.classList.toggle('q',Seq.queued===i);
    b.firstChild.classList.toggle('has',sceneHasContent(S.scenes[i]));
    b.lastChild.textContent=S.scenes[i].bars+'B';
  });
  // tab activity
  const act={drum:UI.flash.some(f=>f>=0&&t-f<.09), bass:A.bassNote&&t>=A.bassNote.t&&t<A.bassNote.end, chord:t>=UI.chordT&&t<UI.chordEnd, lead:UI.leadTouches.size>0||UI.ghosts.size>0};
  for(const k in act) UI.tabEls[k].querySelector('.act').classList.toggle('on',!!act[k]);

  drawScope();
  const pg=UI.pages[UI.tab]; if(pg.frame) pg.frame(t,np);
}
requestAnimationFrame(frame);

if('serviceWorker' in navigator){ window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{})); }
