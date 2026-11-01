const C='lifehub-v1.32.6',A=['./','app.js','style.css','manifest.json','icon.svg','icon-192.png','apple-touch-icon.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(A.map(u=>new Request(u,{cache:'reload'})))));self.skipWaiting()});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x))))));
self.addEventListener('fetch',e=>{
  if(e.request.url.includes('/api/'))return;
  // 同網域的檔案一律向伺服器確認是否有新版（避免瀏覽器快取讓更新晚 10 分鐘才出現）
  const r0=e.request,same=new URL(r0.url).origin===location.origin&&r0.method==='GET';
  // 頁面本身（navigate）不能帶參數重建請求，改用網址重新抓
  const req=!same?r0:r0.mode==='navigate'?fetch(r0.url,{cache:'no-cache',credentials:'same-origin'}):fetch(r0,{cache:'no-cache'});
  e.respondWith((same?req:fetch(r0)).then(r=>{const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));return r}).catch(()=>caches.match(e.request)));
});
