const CACHE='radaretf-v42-20261101';
const SHELL=['./','./index.html','./style.css','./engine.js','./app.js','./forex.js','./autopilot.js','./assets/icon-192.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET'||new URL(e.request.url).origin!==location.origin)return;
  const isData=/\/data\/(market|forex_autopilot)\.json$/.test(new URL(e.request.url).pathname);
  if(isData){const canonical=new Request(new URL(new URL(e.request.url).pathname, self.location.origin));e.respondWith(fetch(e.request).then(res=>{if(res.ok){const copy=res.clone();caches.open(CACHE).then(c=>c.put(canonical,copy));}return res;}).catch(()=>caches.match(canonical)));return;}
  e.respondWith(caches.match(e.request).then(cached=>cached||fetch(e.request)));
});
