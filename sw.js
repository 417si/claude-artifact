const V='ld1-v1';
const SHELL=['./','index.html','css/style.css','js/core.js','js/audio.js','js/seq.js','js/ui.js','js/main.js','manifest.webmanifest','icons/icon-180.png','icons/icon-192.png','fonts/doto.woff2','fonts/plex-regular.woff2','fonts/plex-medium.woff2','fonts/plex-semibold.woff2'];
self.addEventListener('install',e=>{ e.waitUntil(caches.open(V).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())); });
self.addEventListener('activate',e=>{ e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
self.addEventListener('fetch',e=>{
  const req=e.request; if(req.method!=='GET') return;
  const url=new URL(req.url);
  if(url.origin===location.origin){
    // network-first for app files so updates land, cache fallback offline
    e.respondWith(fetch(req).then(r=>{ const cp=r.clone(); caches.open(V).then(c=>c.put(req,cp)); return r; }).catch(()=>caches.match(req,{ignoreSearch:true})));
  }
});
