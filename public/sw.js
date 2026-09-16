const CACHE='tribun360-v120-static-1';
const STATIC=['/manifest.webmanifest','/icon-192.svg','/icon-512.svg'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(STATIC)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url); if(u.origin!==location.origin)return;
  if(u.pathname.startsWith('/api/')){e.respondWith(fetch(e.request,{cache:'no-store'}));return;}
  if(e.request.mode==='navigate'||u.pathname==='/'||u.pathname==='/index.html'){
    e.respondWith(fetch(e.request,{cache:'no-store'}).then(r=>{const cp=r.clone();caches.open(CACHE).then(c=>c.put('/index.html',cp));return r}).catch(()=>caches.match('/index.html')));return;
  }
  e.respondWith(caches.open(CACHE).then(async c=>{
    const hit=await c.match(e.request);
    const net=fetch(e.request).then(r=>{if(r.ok)c.put(e.request,r.clone());return r}).catch(()=>hit);
    return hit||net;
  }));
});
