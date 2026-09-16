(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const definitions = window.T360_LEAGUES || {};
  const league = () => window.v32ActiveLeague || 'tur.1';
  const active = () => typeof aktifFiltre === 'undefined' ? 'LIVE' : aktifFiltre;
  const isHome = () => active() === 'LIVE';
  const label = l => definitions[l]?.name || l;
  const stamp = date => date ? new Date(date).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'}) : 'Henüz güncellenmedi';
  const dateLabel = date => date ? new Date(date).toLocaleString('tr-TR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : 'Saat açıklanmadı';
  const image = (src,alt='') => /^https:\/\//.test(src || '') ? `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" decoding="async" width="30" height="30">` : '';
  const skeleton = '<div class="t360-skeleton" aria-label="Yükleniyor"></div>';
  const state = new Map(), pending = new Map();
  const saved = (key, fallback=null) => {try{return JSON.parse(localStorage.getItem(key)) ?? fallback}catch{return fallback}};
  const persist = (key,value) => {try{localStorage.setItem(key,JSON.stringify(value))}catch{/* Storage may be disabled. */}};
  async function data(url, force=false) {
    if (pending.has(url)) return pending.get(url);
    const hit = state.get(url);
    if (!force && hit && !hit.stale && Date.now()-hit.at < 15000) return hit;
    const task = (async()=>{
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),18000);
      try {
        const response=await fetch(url,{signal:controller.signal,cache:'no-store'});
        if(!response.ok)throw Error(`HTTP ${response.status}`);
        const body=await response.json(); if(body.ok===false)throw Error(body.error||'Kaynak hatası');
        const result={body,at:Date.now(),stale:false}; state.set(url,result);
        if(state.size>40)state.delete(state.keys().next().value);
        if(url.includes('/app/fixtures')||url.includes('/app/standings'))persist('t360:last:'+url,result);
        return result;
      } catch(error) {
        const previous=hit||saved('t360:last:'+url);
        if(previous && Date.now()-previous.at < 86400000)return {...previous,stale:true};
        throw error;
      } finally {clearTimeout(timer)}
    })().finally(()=>pending.delete(url));
    pending.set(url,task); return task;
  }
  const fixturesUrl = l => '/api/app/fixtures?league='+encodeURIComponent(l)+'&daysBack=8&daysForward=28';
  const standingsUrl = l => '/api/app/standings?league='+encodeURIComponent(l);
  const notice = text => `<p class="t360-notice" role="status">${esc(text)}</p>`;
  const freshness = result => result ? `${result.stale?'Son kayıt • ':''}Son güncelleme: ${stamp(result.body.updatedAt||result.at)}` : '';
  let favorite=saved('t360:favorite'), generation=0, homeTask=null, searchGeneration=0, detailGeneration=0;
  const dialog=document.createElement('dialog');dialog.className='t360-dialog';dialog.setAttribute('aria-label','Maç detayları');document.body.appendChild(dialog);
  const picker=document.createElement('dialog');picker.className='t360-dialog';picker.setAttribute('aria-label','Favori takım seç');document.body.appendChild(picker);
  const closeDialog = d => {if(typeof d.close==='function')d.close();else d.removeAttribute('open')};
  const openDialog = d => {if(!d.open){if(typeof d.showModal==='function')d.showModal();else d.setAttribute('open','')}};
  function frame(d,title,body){d.innerHTML=`<header class="t360-dialog-head t360-toolbar"><strong>${esc(title)}</strong><button class="t360-action" data-close aria-label="Kapat">✕</button></header><div class="t360-dialog-body">${body}</div>`;d.querySelector('[data-close]').onclick=()=>closeDialog(d)}
  dialog.addEventListener('close',()=>{detailGeneration++;currentMatch=null});
  let currentMatch=null;
  function matchRow(m,stale=false){return `<button class="t360-match" data-match="${esc(m.id)}" data-league="${esc(m.league)}" aria-label="${esc(m.home.name)} - ${esc(m.away.name)} maç detayları"><span class="t360-side">${image(m.home.logo)}<span>${esc(m.home.name)}</span></span><span class="t360-score ${m.live&&!stale?'live':''}">${m.live||m.completed?`${esc(m.home.score??'—')} - ${esc(m.away.score??'—')}`:'VS'}<small>${stale?'Son kayıt':m.live?'● '+esc(m.clock):m.completed?'Maç sonu':esc(dateLabel(m.date))}</small></span><span class="t360-side"><span>${esc(m.away.name)}</span>${image(m.away.logo)}</span></button>`}
  function bindMatches(root){root.querySelectorAll('[data-match]').forEach(b=>b.onclick=()=>openMatch(b.dataset.match,b.dataset.league))}
  function listCard(title,events,empty){return `<section class="t360-card"><h3>${esc(title)}</h3>${events.length?events.slice(0,6).map(m=>matchRow(m)).join(''):`<p>${esc(empty)}</p>`}</section>`}
  async function favoriteCard(force=false){
    if(!favorite){
      const legacy=localStorage.getItem('kullanici_favori_takim');
      if(legacy){try{const r=await data('/api/app/teams?league=tur.1');const norm=s=>s.replace(/\s+A\.?Ş\.?$/i,'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');const t=r.body.teams.find(t=>norm(t.name)===norm(legacy)||norm(t.shortName)===norm(legacy));if(t){favorite=t;persist('t360:favorite',t)}}catch{}}
    }
    if(!favorite)return '<section class="t360-card"><h3>⭐ Senin takımın</h3><p>Takımını seç; sonraki maçı ve ligdeki yerini burada gör.</p><button class="t360-action" data-pick>Favori takım seç</button></section>';
    const t=favorite,[table,fx]=await Promise.allSettled([data(standingsUrl(t.league),force),data(fixturesUrl(t.league),force)]);
    const r=table.status==='fulfilled'?table.value:null,f=fx.status==='fulfilled'?fx.value:null;
    const row=r?.body.rows.find(x=>x.teamId===t.id),events=f?.body.events.filter(m=>m.home.id===t.id||m.away.id===t.id)||[];
    const next=events.find(m=>m.live)||events.find(m=>!m.completed&&new Date(m.date)>new Date());
    return `<section class="t360-card"><div class="t360-toolbar"><h3>⭐ Favori takımın</h3><button class="t360-action" data-pick>Değiştir</button></div><div class="t360-favorite-head">${image(t.logo)}<div><strong>${esc(t.name)}</strong><span class="t360-muted">${esc(label(t.league))}</span></div></div>${row?`<span class="t360-badge">${row.rank}. sıra</span><span class="t360-badge">${row.points??'—'} puan</span><span class="t360-badge">${row.played??'—'} maç</span>`:notice('Puan bilgisi şu anda alınamadı.')}${next?matchRow(next,!!f?.stale):`<p>${f?'Önümüzdeki 28 gün için maç bulunamadı.':'Sonraki maç bilgisi şu anda alınamadı.'}</p>`}${r?.stale||f?.stale?notice('Bağlantı yenilenemedi; son kaydedilen bilgiler gösteriliyor.'):''}<p>${esc(freshness(f||r))}</p></section>`;
  }
  function bindFavorite(root){root.querySelectorAll('[data-pick]').forEach(b=>b.onclick=()=>openPicker());bindMatches(root)}
  async function renderHome(force=false){
    const box=$('t360HomeCenter');if(!box)return;
    syncHome();if(!isHome())return;
    const id=++generation,l=league();
    box.className='t360-dashboard';
    if(!box.querySelector('[data-home-content]'))box.innerHTML=`<div class="t360-toolbar"><h2>Maç merkezi</h2><button class="t360-action" data-refresh>↻ Yenile</button></div><p class="t360-muted" role="status" data-status>Veriler yükleniyor…</p><div data-favorite>${skeleton}</div><div data-home-content>${skeleton}${skeleton}</div>`;
    box.querySelector('[data-refresh]').onclick=()=>{window.t360ClearRequestCache?.();renderHome(true)};
    box.querySelector('[data-status]').textContent=navigator.onLine?'Güncelleniyor…':'Çevrimdışısın • son bilgiler aranıyor';
    const favTask=favoriteCard(force).then(html=>{if(id===generation){box.querySelector('[data-favorite]').innerHTML=html;bindFavorite(box)}});
    try{
      const result=await data(fixturesUrl(l),force);if(id!==generation||!isHome())return;
      const events=result.body.events||[], live=events.filter(m=>m.live),up=events.filter(m=>!m.live&&!m.completed&&new Date(m.date)>new Date());
      const content=box.querySelector('[data-home-content]');content.innerHTML=`${result.stale?notice('Bağlantı yenilenemedi. Aşağıdaki maçlar son kayıttan; canlı skorları doğrulayamadık.'):''}<div class="t360-home-sections">${listCard('● Canlı maçlar • '+label(l),result.stale?[]:live,result.stale?'Canlı bağlantı bekleniyor.':'Bu ligde şu anda canlı maç yok.')}${listCard('Yaklaşan maçlar',up,'Önümüzdeki 28 gün için maç bulunamadı.')}</div>`;
      box.querySelector('[data-status]').textContent=`${result.stale||!navigator.onLine?'Bağlantı kesildi':'Bağlantı açık'} • ${freshness(result)}`;
      bindMatches(content);
    }catch{
      if(id!==generation)return;
      box.querySelector('[data-status]').textContent='Maç bağlantısı kurulamadı';
      const content=box.querySelector('[data-home-content]');
      content.innerHTML=notice('Maçlar yüklenemedi. Favori takım bölümünü kullanabilir veya yeniden deneyebilirsin.');
    }
    await favTask;
  }
  function syncHome(){const home=isHome();document.body.classList.toggle('t360-home',home);if($('t360HomeCenter'))$('t360HomeCenter').style.display=home?'grid':'none'}
  function scheduleHome(force=false){if(homeTask)clearTimeout(homeTask);homeTask=setTimeout(()=>renderHome(force),80)}
  async function openPicker(){
    frame(picker,'Favori takım seç',`<label>Lig<select data-league>${Object.keys(definitions).map(l=>`<option value="${esc(l)}" ${l===(favorite?.league||league())?'selected':''}>${esc(label(l))}</option>`).join('')}</select></label><label>Takım ara<input data-query type="search" placeholder="Takım adı" autocomplete="off"></label><div data-teams>${skeleton}</div>`);openDialog(picker);
    const select=picker.querySelector('[data-league]'),query=picker.querySelector('[data-query]'),list=picker.querySelector('[data-teams]');let teams=[];
    const draw=()=>{const q=query.value.toLocaleLowerCase('tr-TR');list.innerHTML=teams.filter(t=>(t.name+' '+t.shortName).toLocaleLowerCase('tr-TR').includes(q)).map(t=>`<button class="t360-team-option" data-id="${esc(t.id)}">${image(t.logo)}<span>${esc(t.name)}</span>${favorite?.id===t.id&&favorite?.league===t.league?' ★':''}</button>`).join('')||'<p class="t360-muted">Takım bulunamadı.</p>';list.querySelectorAll('[data-id]').forEach(b=>b.onclick=()=>{favorite=teams.find(t=>t.id===b.dataset.id);persist('t360:favorite',favorite);try{localStorage.setItem('kullanici_favori_takim',favorite.name)}catch{}closeDialog(picker);if(active()==='FAV')renderFavorites();else scheduleHome();})};
    const load=async()=>{const id=++searchGeneration;list.innerHTML=skeleton;try{const r=await data('/api/app/teams?league='+encodeURIComponent(select.value));if(id!==searchGeneration)return;teams=r.body.teams;draw()}catch{if(id===searchGeneration)list.innerHTML=notice('Takımlar yüklenemedi. Başka bir lig seçerek tekrar deneyebilirsin.')}};
    select.onchange=load;query.oninput=draw;await load();query.focus();
  }
  async function renderFavorites(force=false){const box=$('match-list');if(!box)return;box.style.display='';box.innerHTML=skeleton;const html=await favoriteCard(force);if(active()!=='FAV')return;box.innerHTML=`<div class="t360-dashboard">${html}</div>`;bindFavorite(box)}
  async function renderTable(force=false){const box=$('match-list'),l=league();if(!box)return;box.style.display='';box.innerHTML=skeleton;try{const r=await data(standingsUrl(l),force);if(active()!=='TABLE'||league()!==l)return;box.innerHTML=`<section class="t360-card"><div class="t360-toolbar"><h3>${esc(label(l))} • Puan durumu</h3><button class="t360-action" data-table-refresh>↻ Yenile</button></div>${window.v33LeagueSwitchHtml?.('table')||''}<p class="t360-muted">${esc(freshness(r))} • Kaynak: ESPN</p>${r.stale?notice('Bağlantı yenilenemedi; son kaydedilen tablo gösteriliyor.'):''}<div class="t360-table-scroll"><table><caption class="t360-muted">O: oynanan, G: galibiyet, B: beraberlik, M: mağlubiyet, AG/YG: atılan/yenen gol, AV: averaj, P: puan</caption><thead><tr>${['#','Takım','O','G','B','M','AG','YG','AV','P'].map(x=>`<th scope="col">${x}</th>`).join('')}</tr></thead><tbody>${r.body.rows.map(t=>`<tr data-favorite="${favorite?.id===t.teamId&&favorite?.league===l}"><td>${t.rank}</td><td>${esc(t.name)}</td>${['played','wins','draws','losses','gf','ga','gd','points'].map(k=>`<td>${t[k]??'—'}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`;box.querySelector('[data-table-refresh]').onclick=()=>renderTable(true);window.v33SyncLeagueButtons?.()}catch{if(active()!=='TABLE'||league()!==l)return;box.innerHTML=`<section class="t360-card">${notice('Puan tablosu yüklenemedi.')}<button class="t360-action" data-retry>Tekrar Dene</button></section>`;box.querySelector('[data-retry]').onclick=()=>renderTable(true)}}
  const statNames={possessionPct:'Topa sahip olma (%)',totalShots:'Şut',shotsOnTarget:'İsabetli şut',wonCorners:'Korner',foulsCommitted:'Faul',yellowCards:'Sarı kart',redCards:'Kırmızı kart',offsides:'Ofsayt',saves:'Kurtarış'};
  async function openMatch(id,l=league(),refresh=false){
    const token=++detailGeneration;currentMatch={id,l};
    if(!refresh){frame(dialog,'Maç detayları',skeleton+skeleton);openDialog(dialog)}
    try{
      const result=await data('/api/summary?league='+encodeURIComponent(l)+'&id='+encodeURIComponent(id),refresh);if(token!==detailGeneration||!dialog.open)return;
      const d=result.body,c=d.header?.competitions?.[0],teams=c?.competitors||[],h=teams.find(t=>t.homeAway==='home')||teams[0],a=teams.find(t=>t.homeAway==='away')||teams[1];if(!h||!a)throw Error('Takım bilgisi yok');
      const status=c.status||d.header.status||{},live=status.type?.state==='in',done=status.type?.completed;
      currentMatch={id,l,live};
      const score=t=>t.score?.displayValue??t.score??'—';
      const summary=`<section class="t360-card"><div class="t360-match"><span class="t360-side">${image(h.team.logo||h.team.logos?.[0]?.href)}${esc(h.team.displayName)}</span><span class="t360-score ${live?'live':''}">${done||live?`${esc(score(h))} - ${esc(score(a))}`:'VS'}<small>${live?'● '+esc(status.displayClock||status.type.shortDetail):done?'Maç sonu':esc(dateLabel(c.date))}</small></span><span class="t360-side">${esc(a.team.displayName)}${image(a.team.logo||a.team.logos?.[0]?.href)}</span></div><p>${esc(label(l))} • ${esc(c.venue?.fullName||d.gameInfo?.venue?.fullName||'Stadyum açıklanmadı')}</p><div class="t360-toolbar"><span class="t360-muted">${esc(freshness(result))}</span><button class="t360-action" data-detail-refresh>↻ Yenile</button></div></section>`;
      const raw=d.keyEvents?.length?d.keyEvents:(d.commentary||[]).map(x=>x.play||x);
      const events=raw.filter(p=>/goal|card|substitution/i.test((p.type?.text||p.type?.type||'')+' '+(p.text||'')));
      const translate=p=>{const type=String(p.type?.text||p.type?.type||'').toLowerCase();return type.includes('yellow')?'🟨 Sarı kart':type.includes('red')?'🟥 Kırmızı kart':type.includes('sub')?'🔁 Oyuncu değişikliği':type.includes('own')?'⚽ Kendi kalesine gol':type.includes('goal')?'⚽ Gol':p.type?.text||'Olay'};
      const timeline=`<details open><summary>Goller ve önemli olaylar</summary>${events.map(p=>`<div class="t360-event"><time>${esc(p.clock?.displayValue||p.time?.displayValue||'')}</time><strong>${esc(translate(p))}</strong><div>${esc((p.participants||[]).map(x=>x.athlete?.displayName).filter(Boolean).join(' → ')||p.shortText||p.text||'')}</div></div>`).join('')||'<p class="t360-muted">Kaynak henüz olay bilgisi paylaşmadı.</p>'}</details>`;
      const groups=d.rosters||[];
      const rosters=`<details><summary>Kadrolar</summary>${groups.map(g=>`<h4>${esc(g.team?.displayName)}</h4>${['İlk 11','Yedekler'].map((name,i)=>`<h5>${name}</h5>${(g.roster||[]).filter(p=>i?!p.starter:p.starter).map(p=>`<div class="t360-event">${esc(p.jersey||'—')} · ${esc(p.athlete?.displayName)} <span class="t360-muted">${esc(p.position?.abbreviation||'')}</span></div>`).join('')||'<p class="t360-muted">Açıklanmadı.</p>'}`).join('')}`).join('')||'<p class="t360-muted">Kadrolar henüz açıklanmadı.</p>'}</details>`;
      const blocks=d.boxscore?.teams||[],hb=blocks.find(x=>x.team?.id===h.team.id),ab=blocks.find(x=>x.team?.id===a.team.id),value=(b,k)=>b?.statistics?.find(x=>x.name===k)?.displayValue;
      const stats=`<details open><summary>Maç istatistikleri</summary>${Object.entries(statNames).filter(([k])=>value(hb,k)!=null||value(ab,k)!=null).map(([k,n])=>`<div class="t360-stat"><b>${esc(value(hb,k)??'—')}</b><span>${n}</span><b>${esc(value(ab,k)??'—')}</b></div>`).join('')||'<p class="t360-muted">Kaynak henüz istatistik paylaşmadı.</p>'}</details>`;
      const openSections=refresh?[...dialog.querySelectorAll('details')].map(x=>x.open):null;
      frame(dialog,'Maç detayları',summary+timeline+stats+rosters);if(openSections)dialog.querySelectorAll('details').forEach((x,i)=>x.open=openSections[i]);
      dialog.querySelector('[data-detail-refresh]').onclick=()=>openMatch(id,l,true);
    }catch{if(token===detailGeneration){if(refresh){let n=dialog.querySelector('[data-detail-error]');if(!n){n=document.createElement('p');n.dataset.detailError='';n.className='t360-notice';dialog.querySelector('.t360-dialog-body').prepend(n)}n.textContent='Güncelleme alınamadı; önceki bilgiler korunuyor.'}else{frame(dialog,'Maç detayları',notice('Maç bilgisi yüklenemedi. Bağlantını kontrol edip tekrar dene.')+'<button class="t360-action" data-retry>Tekrar Dene</button>');dialog.querySelector('[data-retry]').onclick=()=>openMatch(id,l)}}}
  }
  window.t360RenderHome=renderHome;window.t360RefreshTicker=()=>{};window.t360HomeMode=()=>renderHome();
  window.v32RenderTable=renderTable;window.v32RenderFavorites=renderFavorites;window.__openV8=id=>openMatch(id);
  window.v32OpenFixture=id=>openMatch(id,league());
  window.t360OpenSearch=openPicker;window.t360CloseSearch=()=>closeDialog(picker);
  const oldLeague=window.v32SetLeague;window.v32SetLeague=function(){const result=oldLeague?.apply(this,arguments);if(isHome())scheduleHome();return result};
  document.querySelectorAll('.bottom-nav .nav-item').forEach(b=>b.addEventListener('click',()=>setTimeout(()=>{syncHome();if(isHome())scheduleHome();},0)));
  $('savePrefBtnText')?.addEventListener('click',()=>{favorite=null;persist('t360:favorite',null);scheduleHome(true)});
  window.addEventListener('online',()=>scheduleHome(true));window.addEventListener('offline',()=>scheduleHome());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&isHome())scheduleHome()});
  setInterval(()=>{if(document.hidden||!navigator.onLine)return;if(isHome())scheduleHome();if(dialog.open&&currentMatch?.live)openMatch(currentMatch.id,currentMatch.l,true)},30000);
  // A single refresh gesture in browsers; the Android shell supplies its own gesture.
  if(!window.Tribun360Android){let y=0;document.addEventListener('touchstart',e=>{y=e.touches[0]?.clientY||0},{passive:true});document.addEventListener('touchend',e=>{if(!dialog.open&&!picker.open&&scrollY<8&&(e.changedTouches[0]?.clientY||0)-y>110&&isHome())scheduleHome(true)},{passive:true})}
  scheduleHome();
})();
