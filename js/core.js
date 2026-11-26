'use strict';
/* ==========================================================
   LD-1 · core : theory, state, persistence
   ========================================================== */
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const SCALES = {
  MAJ:[0,2,4,5,7,9,11], MIN:[0,2,3,5,7,8,10], DOR:[0,2,3,5,7,9,10],
  MIX:[0,2,4,5,7,9,10], LYD:[0,2,4,6,7,9,11], PHR:[0,1,3,5,7,8,10], HMN:[0,2,3,5,7,8,11]
};
const ROMAN = ['I','II','III','IV','V','VI','VII'];
const CHORD_TYPES = ['TRI','7TH','SUS2','SUS4','ADD9','POW'];
const DRUMS = ['KICK','SNARE','CLAP','C.HAT','O.HAT','PERC'];
const TRACKS = ['drum','bass','chord','lead'];
const TRACK_LABEL = {drum:'DRM',bass:'BAS',chord:'CHD',lead:'LED'};
const WAVES = ['sawtooth','square','triangle','sine'];
const BASS_ROWS = [7,6,5,4,3,2,1,0,-7];           // diatonic offsets, top → bottom
const BASS_ROW_LBL = ['8','7','6','5','4','3','2','R','R-'];
const DLY_DIVS = [{l:'1/16',s:1},{l:'1/8',s:2},{l:'3/16',s:3},{l:'1/4',s:4}];
const SCENE_NAMES = ['A','B','C','D'];
const STORE_KEY = 'ld1.project.v1';

const clamp = (v,a,b)=> v<a?a:(v>b?b:v);
const mtof = m => 440*Math.pow(2,(m-69)/12);
const mod = (n,m)=> ((n%m)+m)%m;
const cutHz = c => 30*Math.pow(2, c*9.5);
const resQ = r => 0.5 + r*r*22;
function noteName(m){ const r=Math.round(m); return NOTE_NAMES[mod(r,12)] + (Math.floor(r/12)-1); }

function scaleArr(){ return SCALES[S.scale] || SCALES.MIN; }
function degSemi(deg){ const sc=scaleArr(); return Math.floor(deg/7)*12 + sc[mod(deg,7)]; }
function degMidi(deg, base){ return base + S.key + degSemi(deg); }
function inScale(midi){ return scaleArr().includes(mod(midi - S.key,12)); }

function chordDegs(t){
  switch(CHORD_TYPES[t]){
    case '7TH': return [0,2,4,6];
    case 'SUS2': return [0,1,4];
    case 'SUS4': return [0,3,4];
    case 'ADD9': return [0,2,4,8];
    case 'POW': return [0,4,7];
    default: return [0,2,4];
  }
}
function chordRaw(ch){ return chordDegs(ch.t).map(x=>degMidi(ch.d+x,48)); }
function chordName(ch){
  if(!ch) return '—';
  const rootSemi = degSemi(ch.d), rootPc = mod(S.key+rootSemi,12), n = NOTE_NAMES[rootPc];
  const ivs = chordDegs(ch.t).map(x=>mod(degSemi(ch.d+x)-rootSemi,12));
  const has = i=> ivs.includes(i), t = CHORD_TYPES[ch.t];
  if(t==='POW') return n+'5';
  if(t==='SUS2') return n+'sus2';
  if(t==='SUS4') return n+'sus4';
  const q = has(4) ? (has(8)&&!has(7)?'aug':'') : (has(6)&&!has(7)?'dim':'m');
  if(t==='7TH'){
    if(q==='dim') return n+(has(10)?'m7b5':'dim7');
    if(has(11)) return n+(q==='m'?'mM7':'maj7');
    return n+q+'7';
  }
  if(t==='ADD9') return n+q+'add9';
  return n+q;
}
/* voice-led voicings for every bar of a scene */
function sceneVoicings(sc){
  const out=[]; let prev=null; const center=62;
  for(let b=0;b<sc.bars;b++){
    const raw=chordRaw(sc.chords[b]||{d:0,t:0}).sort((a,b)=>a-b);
    let best=null, bc=1e9;
    for(let inv=0;inv<raw.length;inv++){
      const v=raw.map((n,i)=> i<inv? n+12 : n).sort((a,b)=>a-b);
      for(const o of [-24,-12,0,12]){
        const w=v.map(n=>n+o);
        const mean=w.reduce((a,b)=>a+b,0)/w.length;
        let c=Math.abs(mean-center)*0.6;
        if(prev && prev.length===w.length) c+= w.reduce((a,n,i)=>a+Math.abs(n-prev[i]),0);
        else if(prev){ c+= Math.abs(mean - prev.reduce((a,b)=>a+b,0)/prev.length); }
        if(c<bc){bc=c;best=w;}
      }
    }
    out.push(best); prev=best;
  }
  return out;
}

/* ---------- default project ---------- */
function emptyScene(bars=4){
  return {
    bars,
    drum: DRUMS.map(()=>new Array(16).fill(0)),
    bass: new Array(16).fill(null),
    bassFollow: 1,
    chords: Array.from({length:8},()=>({d:0,t:0})),
    rhythm: [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    lead: [], take: 0,
    motion: {bass:[],chord:[],lead:[]}
  };
}
function P(str){ return str.split('').map(c=> c==='x'?1 : c==='X'?2 : 0); }
function demoProject(){
  const a = emptyScene(4);
  a.drum[0]=P('X...x...x...x..x');
  a.drum[1]=P('....x.......x...');
  a.drum[3]=P('x.x.x.x.x.x.x.xx');
  a.drum[4]=P('................');
  a.drum[5]=P('...x......x.....');
  a.bass=[0,null,0,null,null,null,7,null,0,null,null,0,null,4,null,null];
  a.chords=[{d:0,t:1},{d:5,t:1},{d:2,t:0},{d:6,t:0},{d:0,t:0},{d:0,t:0},{d:0,t:0},{d:0,t:0}];
  a.rhythm=P('x...............');
  const b = emptyScene(4);
  b.drum[0]=P('X...x...X...x...');
  b.drum[1]=P('....x.......x..x');
  b.drum[2]=P('....x.......x...');
  b.drum[3]=P('x.x.x.x.x.x.x.x.');
  b.drum[4]=P('..x...x...x...x.');
  b.drum[5]=P('.x.....x..x..x..');
  b.bass=[0,null,7,0,null,0,7,null,0,null,7,0,null,4,2,null];
  b.chords=[{d:0,t:1},{d:5,t:1},{d:2,t:4},{d:6,t:3},{d:0,t:0},{d:0,t:0},{d:0,t:0},{d:0,t:0}];
  b.rhythm=P('x..x..x...x..x..');
  const c = emptyScene(2);
  c.drum[0]=P('x.........x.....');
  c.drum[3]=P('..x...x...x...x.');
  c.drum[5]=P('x..x..x..x..x...');
  c.bass=[0,null,null,null,null,null,null,null,-7,null,null,null,null,null,null,null];
  c.chords=[{d:3,t:1},{d:4,t:3},{d:0,t:0},{d:0,t:0},{d:0,t:0},{d:0,t:0},{d:0,t:0},{d:0,t:0}];
  c.rhythm=P('x.......x.......');
  return {
    v:1, bpm:112, swing:0.08, key:9, scale:'MIN',
    scene:0, chain:false, drumKit:1, song:[0,0,1,1,2,1,-1,-1], metro:false,
    kit: [
      {tune:.4,decay:.45,tone:.45,level:.95},
      {tune:.5,decay:.45,tone:.5,level:.8},
      {tune:.45,decay:.4,tone:.4,level:.75},
      {tune:.55,decay:.3,tone:.55,level:.6},
      {tune:.55,decay:.4,tone:.55,level:.55},
      {tune:.4,decay:.3,tone:.75,level:.6}
    ],
    synth: {
      bass:{wave:0,det:.12,sub:.55,cut:.30,res:.38,env:.45,a:.003,d:.22,s:.2,r:.08,glide:.04,drive:.3,oct:0,gate:.55,level:.8},
      chord:{wave:0,det:.5,sub:0,cut:.44,res:.12,env:.22,a:.06,d:.9,s:.55,r:.6,glide:0,drive:0,oct:0,gate:.92,level:.7},
      lead:{wave:0,det:.22,sub:.15,cut:.56,res:.25,env:.3,a:.006,d:.4,s:.75,r:.3,glide:.05,drive:.15,oct:0,bend:2,mode:0,level:.75}
    },
    mix: {
      drum:{vol:.85,mute:0,solo:0,dly:0,rev:.06},
      bass:{vol:.75,mute:0,solo:0,dly:0,rev:0},
      chord:{vol:.55,mute:0,solo:0,dly:.16,rev:.38},
      lead:{vol:.62,mute:0,solo:0,dly:.3,rev:.3},
      master:{vol:.85,dlyDiv:2,fb:.38,rev:.55,drive:.15,duck:.3}
    },
    scenes:[a,b,c,emptyScene(4)]
  };
}

let S = null;
function loadProject(){
  try{
    const raw = localStorage.getItem(STORE_KEY);
    if(raw){
      const p = JSON.parse(raw);
      if(p && p.v===1 && p.scenes && p.scenes.length===4){ S = mergeDefaults(p, demoProject()); return; }
    }
  }catch(e){ console.warn(e); }
  S = demoProject();
}
function mergeDefaults(p,d){
  for(const k in d){
    if(p[k]===undefined) p[k]=d[k];
    else if(d[k] && typeof d[k]==='object' && !Array.isArray(d[k])) mergeDefaults(p[k],d[k]);
  }
  return p;
}
let _saveT=0;
function markDirty(){
  clearTimeout(_saveT);
  _saveT=setTimeout(()=>{ try{ localStorage.setItem(STORE_KEY, JSON.stringify(S)); }catch(e){} },400);
}
function cur(){ return S.scenes[S.scene]; }
function sceneHasContent(sc){
  return sc.drum.some(r=>r.some(v=>v)) || sc.bass.some(v=>v!==null) || sc.lead.length>0;
}
