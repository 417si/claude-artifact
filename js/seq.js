'use strict';
/* ==========================================================
   LD-1 · sequencer, scheduler, recording
   ========================================================== */
const Seq = {
  playing:false, nextTime:0, pos:0, abs:0, playScene:0, queued:null, songPos:0,
  timeline:[], vq:[], timer:0, pb:new Map(), skip:new Set(), lastAbs:-1, jitter:0, lastTick:0
};
const Rec = { on:false, take:0, live:new Map() };

function seqStart(){
  if(Seq.playing) return;
  const ctx=A.ctx;
  Seq.playing=true; Seq.pos=0; Seq.abs=0; Seq.lastAbs=-1; Seq.timeline.length=0; Seq.vq.length=0; Seq.skip.clear();
  if(S.chain){
    Seq.songPos = S.song.findIndex(x=>x>=0);
    if(Seq.songPos<0){ S.chain=false; Seq.songPos=0; }
    else S.scene = S.song[Seq.songPos];
  }
  Seq.playScene=S.scene; Seq.queued=null;
  Seq.nextTime=ctx.currentTime+.08;
  Seq.lastTick=performance.now();
  Seq.timer=setInterval(seqTick,20);
  seqTick();
  if(Rec.on) Rec.take = ++cur().take;
}
function seqStop(){
  if(!Seq.playing) return;
  closeLiveRec();
  Seq.playing=false; clearInterval(Seq.timer);
  const now=A.ctx.currentTime;
  for(const v of Seq.pb.values()) v.release(now);
  Seq.pb.clear();
  for(const v of A.voices) if(v.pb || v.part==='chord') v.release(now);
  A.bs.vca.gain.cancelScheduledValues(now); A.bs.vca.gain.setTargetAtTime(0,now,.02);
  Seq.timeline.length=0; Seq.vq.length=0;
  Seq.queued=null;
  UI.ghosts.clear();
}

function seqTick(){
  const nowP=performance.now(); Seq.jitter=Seq.jitter*.9+Math.abs(nowP-Seq.lastTick-20)*.1; Seq.lastTick=nowP;
  const ctx=A.ctx, ahead=.14;
  while(Seq.nextTime < ctx.currentTime + ahead){
    scheduleStep(Seq.pos, Seq.nextTime);
    advance();
  }
  // trim timeline
  const old=ctx.currentTime-1.5;
  while(Seq.timeline.length>2 && Seq.timeline[1].time<old) Seq.timeline.shift();
}

function advance(){
  const sc=S.scenes[Seq.playScene], total=sc.bars*16;
  Seq.nextTime += stepDur();
  Seq.abs++; Seq.pos++;
  if(Seq.pos>=total){
    Seq.pos=0;
    let next=Seq.playScene;
    if(Seq.queued!==null){ next=Seq.queued; Seq.queued=null; }
    else if(S.chain){
      for(let i=1;i<=S.song.length;i++){ const j=(Seq.songPos+i)%S.song.length; if(S.song[j]>=0){ Seq.songPos=j; break; } }
      next=S.song[Seq.songPos];
    }
    if(next!==Seq.playScene){
      const t=Seq.nextTime;
      for(const v of Seq.pb.values()) v.release(t);
      Seq.pb.clear();
      Seq.playScene=next;
    }
  }
}

function scheduleStep(pos, t){
  const sc=S.scenes[Seq.playScene], dur=stepDur(), s16=pos%16;
  const sw = (pos%2===1) ? S.swing*dur*.66 : 0, tt=t+sw;
  Seq.timeline.push({time:t, dur, pos, abs:Seq.abs, scene:Seq.playScene, songPos:Seq.songPos, bars:sc.bars});
  Seq.lastAbs=Seq.abs;
  if(S.metro && s16%4===0) click(t, s16===0);

  // drums
  for(let r=0;r<6;r++){
    const v=sc.drum[r][s16];
    if(v){
      const key=Seq.abs+':'+r;
      if(Seq.skip.has(key)){ Seq.skip.delete(key); continue; }
      playDrum(r, tt, v===2?1:.72);
      Seq.vq.push({time:tt, k:'drum', r});
    }
  }
  // bass
  const bar=Math.floor(pos/16), ch=sc.chords[bar]||{d:0,t:0};
  const bv=sc.bass[s16];
  if(bv!==null && bv!==undefined){
    const p=S.synth.bass;
    let len=1; while(len<16 && (sc.bass[(s16+len)%16]===null) && s16+len<16) len++;
    const deg=(sc.bassFollow?ch.d:0)+bv;
    const midi=degMidi(deg,36)+p.oct*12;
    bassNote(tt, midi, Math.max(.02, len*dur*p.gate*1.4), .85);
    Seq.vq.push({time:tt, k:'bass', midi});
  }
  // chords
  if(sc.rhythm[s16]){
    let len=1; while(s16+len<16 && !sc.rhythm[s16+len]) len++;
    const p=S.synth.chord, vo=sceneVoicings(sc)[bar] || chordRaw(ch);
    const gate=len*dur*p.gate;
    for(const m of vo){
      const v=makeVoice('chord', tt, m+p.oct*12, .5);
      v.release(tt+gate);
    }
    Seq.vq.push({time:tt, k:'chord', notes:vo.map(m=>m+p.oct*12), end:tt+gate});
  }
  // lead events in [pos,pos+1)
  const ev=sc.lead;
  if(ev.length){
    let i=lowerBound(ev,pos);
    for(;i<ev.length && ev[i].t<pos+1;i++){
      const e=ev[i], et=t+(e.t-pos)*dur;
      leadPlayback(e, et);
    }
  }
}

function lowerBound(arr,t){ let lo=0,hi=arr.length; while(lo<hi){ const m=(lo+hi)>>1; if(arr[m].t<t) lo=m+1; else hi=m; } return lo; }

function leadPlayback(e, t){
  const key=e.id, p=S.synth.lead;
  if(e.k==='on'){
    const old=Seq.pb.get(key); if(old) old.release(t);
    const v=makeVoice('lead', t, e.p+p.oct*12, .55); v.pb=true; Seq.pb.set(key,v);
  } else if(e.k==='mv'){
    const v=Seq.pb.get(key); if(v) v.setPitch(e.p+p.oct*12, t, .008);
  } else {
    const v=Seq.pb.get(key); if(v){ v.release(t); Seq.pb.delete(key); }
  }
  Seq.vq.push({time:t, k:'lead', e});
}

/* playhead as heard */
function heardTime(){ return A.ctx.currentTime - (A.ctx.outputLatency||0); }
function nowPos(){
  const tl=Seq.timeline; if(!tl.length) return null;
  const t=heardTime();
  let e=tl[0];
  for(let i=tl.length-1;i>=0;i--){ if(tl[i].time<=t){ e=tl[i]; break; } }
  const frac=clamp((t-e.time)/e.dur,0,.9999);
  return {scene:e.scene, pos:e.pos+frac, step:e.pos, abs:e.abs, frac, bars:e.bars, songPos:e.songPos, total:e.bars*16};
}

/* ---------- recording ---------- */
function recToggle(){
  Rec.on=!Rec.on;
  if(Rec.on){ if(Seq.playing) Rec.take = ++S.scenes[Seq.playScene].take; }
  else closeLiveRec();
}
function closeLiveRec(){
  const np=Seq.playing?nowPos():null;
  for(const [id,info] of Rec.live){
    if(np) insertEvent(S.scenes[info.scene].lead,{t:np.pos,k:'off',id,take:info.take});
  }
  Rec.live.clear();
  markDirty();
}
function insertEvent(arr, e){
  const i=lowerBound(arr, e.t+1e-9);
  arr.splice(i,0,e);
}
function recLead(kind, uid, pitch, s, x, y){
  if(!(Rec.on && Seq.playing)) return;
  const np=nowPos(); if(!np) return;
  const sc=S.scenes[np.scene];
  if(kind==='on'){
    const id='r'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
    Rec.live.set(uid,{id,scene:np.scene,take:Rec.take,lt:0,lp:pitch});
    insertEvent(sc.lead,{t:np.pos,k:'on',id,p:+pitch.toFixed(3),s,x:+x.toFixed(3),y:+y.toFixed(3),take:Rec.take});
  } else {
    const info=Rec.live.get(uid); if(!info) return;
    const scn=S.scenes[info.scene];
    if(kind==='mv'){
      const now=performance.now();
      if(now-info.lt<14 && Math.abs(pitch-info.lp)<.04) return;
      info.lt=now; info.lp=pitch;
      insertEvent(scn.lead,{t:np.pos,k:'mv',id:info.id,p:+pitch.toFixed(3),s,x:+x.toFixed(3),y:+y.toFixed(3),take:info.take});
    } else {
      insertEvent(scn.lead,{t:np.pos,k:'off',id:info.id,take:info.take});
      Rec.live.delete(uid); markDirty();
    }
  }
}
function recDrum(r){
  if(!(Rec.on && Seq.playing)) return false;
  const np=nowPos(); if(!np) return false;
  const sc=S.scenes[np.scene];
  let q=Math.round(np.pos);
  const ahead = q>np.step;
  const s16=q%16;
  if(!sc.drum[r][s16]) sc.drum[r][s16]=1;
  if(ahead && np.abs+1>Seq.lastAbs) Seq.skip.add((np.abs+1)+':'+r);
  markDirty();
  return true;
}
/* motion (XY) recording: overwrite region swept */
const MotRec={};
function recMotion(part, x, y, phase){
  if(!(Rec.on && Seq.playing)) return;
  const np=nowPos(); if(!np) return;
  const m=S.scenes[np.scene].motion[part], t=np.pos, total=np.total;
  const st=MotRec[part];
  if(phase==='start' || !st){ MotRec[part]={last:t}; }
  else {
    const a=st.last, b=t;
    for(let i=m.length-1;i>=0;i--){
      const mt=m[i].t;
      const inside = a<=b ? (mt>a && mt<=b) : (mt>a || mt<=b);
      if(inside) m.splice(i,1);
    }
    st.last=t;
  }
  const i=lowerBound(m,t); m.splice(i,0,{t:+t.toFixed(3),x:+x.toFixed(3),y:+y.toFixed(3)});
  if(phase==='end'){ delete MotRec[part]; markDirty(); }
}
function motionAt(m, t, total){
  if(!m.length) return null;
  if(m.length===1) return m[0];
  let i=lowerBound(m,t);
  const b=m[i%m.length], a=m[(i-1+m.length)%m.length];
  let ta=a.t, tb=b.t;
  if(i===0){ ta-=total; } else if(i===m.length){ tb+=total; }
  const span=tb-ta; const f= span>0 ? clamp((t-ta)/span,0,1) : 0;
  return {x:a.x+(b.x-a.x)*f, y:a.y+(b.y-a.y)*f};
}
