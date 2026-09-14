// Canli Mac Merkezi V26
// Harici npm paketi gerekmez. Node.js 18+ yeterlidir.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { exec } = require('child_process');

const PORT = Number(process.env.PORT || 3000);
const HOST = '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const ESPN_SITE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const ESPN_V2 = 'https://site.api.espn.com/apis/v2/sports/soccer';

// V46: current-season player leaders, built from the season's actual match summaries.
// This avoids ESPN's unscoped /leaders endpoint accidentally returning the previous season.
const V46_SUMMARY_CACHE = new Map();
function v46Ymd(d){ return d.toISOString().slice(0,10).replace(/-/g,''); }
function v46N(v){ const n=Number(String(v??'').replace(',','.').replace(/[^0-9.\-]/g,'')); return Number.isFinite(n)?n:0; }
function v46Img(v){ return typeof v==='string'?v:(v?.href||v?.url||''); }
function v46PlayerInfo(a){
  a=a?.athlete||a?.player||a||{};
  return {id:String(a?.id||a?.uid||a?.displayName||a?.fullName||''),name:a?.displayName||a?.fullName||a?.shortName||a?.name||'',photo:v46Img(a?.headshot||a?.photo||a?.image)};
}
function v46Add(map,a,team,goals=0,assists=0){
  const p=v46PlayerInfo(a); if(!p.id||!p.name)return;
  const cur=map.get(p.id)||{id:p.id,name:p.name,team:team?.displayName||team?.name||team?.shortDisplayName||'',photo:p.photo,goals:0,assists:0};
  cur.goals+=v46N(goals);cur.assists+=v46N(assists);if(!cur.team)cur.team=team?.displayName||team?.name||'';if(!cur.photo&&p.photo)cur.photo=p.photo;map.set(p.id,cur);
}
function v46StatIndex(labels,kind){
  const norm=x=>String(x||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const goal=['g','goal','goals','totalgoals']; const ast=['a','ast','assist','assists','goalassists'];
  const set=kind==='goal'?goal:ast;
  return (labels||[]).findIndex(x=>set.includes(norm(x)) || (kind==='goal'?/^goals?$/.test(norm(x)):/assist/.test(norm(x))));
}
function v46FromPlayerBlocks(d,map){
  const groups=[];
  if(Array.isArray(d?.boxscore?.players))groups.push(...d.boxscore.players);
  if(Array.isArray(d?.rosters))groups.push(...d.rosters);
  for(const g of groups){
    const team=g?.team||{};
    // ESPN common boxscore shape: statistics[] -> labels/keys + athletes[] -> stats[]
    for(const block of (Array.isArray(g?.statistics)?g.statistics:[])){
      const labels=block?.keys||block?.labels||block?.names||block?.displayNames||[];
      const gi=v46StatIndex(labels,'goal'), ai=v46StatIndex(labels,'assist');
      if(gi<0&&ai<0)continue;
      for(const row of (Array.isArray(block?.athletes)?block.athletes:[])){
        const st=Array.isArray(row?.stats)?row.stats:[];
        v46Add(map,row?.athlete||row,team,gi>=0?st[gi]:0,ai>=0?st[ai]:0);
      }
    }
    // ESPN roster-like shape: roster/athletes with object stats.
    for(const row of (Array.isArray(g?.roster)?g.roster:(Array.isArray(g?.athletes)?g.athletes:[]))){
      const st=row?.stats||row?.statistics||{};
      if(Array.isArray(st)){
        let gg=0,aa=0;for(const x of st){const k=String(x?.name||x?.label||x?.abbreviation||'').toLowerCase();if(/(^|total)goals?$/.test(k)||k==='g')gg=v46N(x?.value??x?.displayValue);if(/assist/.test(k)||k==='a')aa=v46N(x?.value??x?.displayValue)}
        if(gg||aa)v46Add(map,row?.athlete||row,team,gg,aa);
      }else{
        const gg=st?.goals??st?.totalGoals??row?.goals??0, aa=st?.assists??st?.goalAssists??row?.assists??0;
        if(v46N(gg)||v46N(aa))v46Add(map,row?.athlete||row,team,gg,aa);
      }
    }
  }
}
function v46FromPlays(d,map,teamById){
  // Goal fallback. Only use this for players that were not already credited via boxscore player stats.
  const plays=Array.isArray(d?.plays)?d.plays:(Array.isArray(d?.commentary)?d.commentary:[]);
  for(const p of plays){
    const typ=String(p?.type?.text||p?.type?.name||p?.text||'').toLowerCase();
    const isGoal=p?.scoringPlay===true || /(^|\s)(goal|penalty goal)(\s|$)/i.test(typ);
    if(!isGoal || p?.ownGoal || /own goal/i.test(typ))continue;
    const people=p?.athletesInvolved||p?.athletes||p?.participants||[];
    const first=people?.[0]?.athlete||people?.[0]; if(!first)continue;
    const id=String(first?.id||first?.uid||first?.displayName||first?.fullName||'');
    // avoid double counting when player-stat blocks already supplied this match's goal stat
    const team=teamById.get(String(p?.team?.id||p?.team?.uid||''))||{};
    const mark='play:'+id+':'+String(p?.clock?.displayValue||p?.id||Math.random());
    if(!map.__plays)map.__plays=new Set(); if(map.__plays.has(mark))continue;map.__plays.add(mark);
    v46Add(map,first,team,1,0);
    // If ESPN explicitly supplies a second involved athlete, count as assist only when play text says assist.
    const second=people?.[1]?.athlete||people?.[1];
    if(second && /assist/i.test(String(p?.text||p?.description||'')))v46Add(map,second,team,0,1);
  }
}
async function v46Summary(league,event){
  const id=String(event?.id||''); if(!id)return null;
  const state=event?.status?.type?.state||''; const ttl=state==='in'?15000:12*60*60*1000;
  const hit=V46_SUMMARY_CACHE.get(league+':'+id); if(hit&&Date.now()-hit.ts<ttl)return hit.data;
  const data=await tryGetJson(`${ESPN_SITE}/${league}/summary?event=${encodeURIComponent(id)}`);
  if(data)V46_SUMMARY_CACHE.set(league+':'+id,{ts:Date.now(),data});return data;
}
async function v46MapLimit(items,limit,fn){
  const out=new Array(items.length);let i=0;
  async function worker(){while(true){const n=i++;if(n>=items.length)return;try{out[n]=await fn(items[n],n)}catch(e){out[n]=null}}}
  await Promise.all(Array.from({length:Math.min(limit,items.length)},worker));return out;
}
async function v46CurrentSeasonLeaders(league,season){
  const now=new Date();const start=new Date(Date.UTC(Number(season),7,1,0,0,0));const end=new Date(Math.min(now.getTime()+12*60*60*1000,Date.UTC(Number(season)+1,5,15)));
  const all=[];let cur=new Date(start);
  while(cur<=end){const ce=new Date(Math.min(end.getTime(),cur.getTime()+29*86400000));const range=`${v46Ymd(cur)}-${v46Ymd(ce)}`;const d=await tryGetJson(`${ESPN_SITE}/${league}/scoreboard?dates=${range}&limit=300`);if(Array.isArray(d?.events))all.push(...d.events);cur=new Date(ce.getTime()+86400000)}
  const seen=new Set();const events=all.filter(e=>{const id=String(e?.id||'');const y=Number(e?.season?.year||season);const state=e?.status?.type?.state||'';if(!id||seen.has(id)||y!==Number(season)||state==='pre')return false;seen.add(id);return true});
  const summaries=await v46MapLimit(events,8,e=>v46Summary(league,e));
  const map=new Map();
  for(let n=0;n<events.length;n++){
    const d=summaries[n];if(!d)continue;const teamById=new Map();
    for(const c of (events[n]?.competitions?.[0]?.competitors||[]))teamById.set(String(c?.team?.id||c?.id||''),c?.team||{});
    const before=new Map([...map.entries()].map(([k,v])=>[k,{g:v.goals,a:v.assists}]));
    v46FromPlayerBlocks(d,map);
    // Only apply play fallback if player blocks did not produce any goals in this summary.
    let delta=0;for(const [k,v] of map){const b=before.get(k);delta+=Math.max(0,v.goals-(b?.g||0))}
    if(delta===0)v46FromPlays(d,map,teamById);
  }
  if(map.__plays)delete map.__plays;
  const vals=[...map.values()];
  return {ok:true,league,season:Number(season),source:'season-match-summaries',updatedAt:new Date().toISOString(),matchesProcessed:events.length,
    goals:vals.filter(x=>x.goals>0).sort((a,b)=>b.goals-a.goals||a.name.localeCompare(b.name)).slice(0,20).map(x=>({...x,value:x.goals})),
    assists:vals.filter(x=>x.assists>0).sort((a,b)=>b.assists-a.assists||a.name.localeCompare(b.name)).slice(0,20).map(x=>({...x,value:x.assists}))};
}

const ESPN_BASE = `${ESPN_SITE}/tur.1`;
const SUPPORTED_LEAGUES = new Set(['tur.1','eng.1','esp.1','fra.1','ger.1','ita.1']);
const apiCache = new Map();
const upstreamInflight = new Map();
const API_CACHE_MAX = 700;

function leagueCode(url) {
  const raw = String(url.searchParams.get('league') || 'tur.1').trim();
  return SUPPORTED_LEAGUES.has(raw) ? raw : 'tur.1';
}
function cacheGet(key, ttlMs) {
  const hit = apiCache.get(key);
  return hit && Date.now() - hit.ts < ttlMs ? hit.data : null;
}
function cacheSet(key, data) {
  apiCache.set(key, { ts: Date.now(), data });
  if (apiCache.size > API_CACHE_MAX) {
    const remove = apiCache.size - API_CACHE_MAX;
    let n=0; for (const k of apiCache.keys()) { apiCache.delete(k); if (++n >= remove) break; }
  }
  return data;
}

function ymd(d) {
  return d.toISOString().slice(0,10).replace(/-/g,'');
}
function addDays(d, n) {
  const x = new Date(d.getTime());
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}
const SPORT_SCORE = 'https://sportscore.com/api/widget';

// V63 normalized application schema
const APP_LEAGUES=['tur.1','eng.1','esp.1','fra.1','ger.1','ita.1'];
function appImg(v){return typeof v==='string'?v:(v?.href||v?.url||'')}
function appN(v){const n=Number(String(v??0).replace(',','.').replace(/[^0-9.\-]/g,''));return Number.isFinite(n)?n:0}
function appStat(e,names){const w=names.map(x=>String(x).toLowerCase().replace(/[^a-z0-9]/g,''));for(const s of (e?.stats||[])){const k=[s?.name,s?.abbreviation,s?.displayName,s?.shortDisplayName].filter(Boolean).map(x=>String(x).toLowerCase().replace(/[^a-z0-9]/g,''));if(k.some(a=>w.some(b=>a===b||a.includes(b)||b.includes(a))))return s?.value??s?.displayValue??0}return 0}
function appStandingsEntries(d){const out=[],seen=new Set();(function walk(v){if(!v)return;if(Array.isArray(v)){v.forEach(walk);return}if(typeof v!=='object')return;if(v.team&&Array.isArray(v.stats)){const id=String(v.team.id||v.team.uid||v.team.displayName||'');if(id&&!seen.has(id)){seen.add(id);out.push(v)}}Object.values(v).forEach(x=>{if(x&&typeof x==='object')walk(x)})})(d);return out}
function appStandings(d,league){return appStandingsEntries(d).map((e,i)=>{const t=e.team||{};return{rank:appN(appStat(e,['rank','position']))||i+1,teamId:String(t.id||t.uid||''),name:t.displayName||t.name||'',shortName:t.shortDisplayName||t.abbreviation||'',logo:appImg(t.logos?.[0])||appImg(t.logo),played:appN(appStat(e,['gamesplayed','played','gp'])),wins:appN(appStat(e,['wins','w'])),draws:appN(appStat(e,['ties','draws','d'])),losses:appN(appStat(e,['losses','l'])),gf:appN(appStat(e,['pointsfor','goalsfor','gf','f'])),ga:appN(appStat(e,['pointsagainst','goalsagainst','ga','a'])),gd:appN(appStat(e,['pointdifferential','goaldifference','gd'])),points:appN(appStat(e,['points','pts','p'])),league}})}
function appEvent(ev,league){const c=ev?.competitions?.[0]||{},a=Array.isArray(c.competitors)?c.competitors:[],h=a.find(x=>x.homeAway==='home')||a[0]||{},w=a.find(x=>x.homeAway==='away')||a[1]||{},st=ev?.status?.type||{};return{id:String(ev?.id||''),league,date:ev?.date||'',state:st.state||'',completed:!!st.completed,live:st.state==='in',clock:ev?.status?.displayClock||st.shortDetail||st.detail||'',home:{id:String(h?.team?.id||''),name:h?.team?.displayName||h?.team?.name||'',logo:appImg(h?.team?.logo)||appImg(h?.team?.logos?.[0]),score:h?.score?.displayValue??h?.score??null},away:{id:String(w?.team?.id||''),name:w?.team?.displayName||w?.team?.name||'',logo:appImg(w?.team?.logo)||appImg(w?.team?.logos?.[0]),score:w?.score?.displayValue??w?.score??null}}}
function appTeams(d,league){const raw=d?.sports?.[0]?.leagues?.[0]?.teams||d?.teams||[];return(Array.isArray(raw)?raw:[]).map(x=>x?.team||x).filter(Boolean).map(t=>({id:String(t.id||t.uid||''),league,name:t.displayName||t.name||'',shortName:t.shortDisplayName||t.abbreviation||'',logo:appImg(t.logos?.[0])||appImg(t.logo)})).filter(x=>x.id&&x.name)}
async function appRows(league){const now=new Date(),season=now.getUTCMonth()>=6?now.getUTCFullYear():now.getUTCFullYear()-1;const d=await tryGetJson(`${ESPN_V2}/${league}/standings?season=${season}`)||await tryGetJson(`${ESPN_V2}/${league}/standings`);return appStandings(d||{},league)}
async function appFixtures(league,b=14,f=45){const now=new Date(),d=await tryGetJson(`${ESPN_SITE}/${league}/scoreboard?dates=${ymd(addDays(now,-b))}-${ymd(addDays(now,f))}&limit=300`);return(d?.events||[]).map(x=>appEvent(x,league)).sort((a,b)=>String(a.date).localeCompare(String(b.date)))}
async function appLiveAll(){const p=await Promise.all(APP_LEAGUES.map(async l=>{const d=await tryGetJson(`${ESPN_SITE}/${l}/scoreboard`);return(d?.events||[]).map(x=>appEvent(x,l)).filter(x=>x.live)}));return p.flat()}


const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

async function tryGetJson(url){try{return await getJson(url)}catch(e){return null}}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(body);
}

async function getJson(url, timeoutMs = 12000) {
  // Multiple endpoints can ask ESPN for the same resource at once. Share one upstream request.
  if (upstreamInflight.has(url)) return upstreamInflight.get(url);
  const task = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await fetch(url, {
        signal: controller.signal,
        headers: { 'accept': 'application/json,text/plain,*/*' },
        cache: 'no-store'
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } finally { clearTimeout(timer); }
  })();
  upstreamInflight.set(url, task);
  try { return await task; }
  finally { if (upstreamInflight.get(url) === task) upstreamInflight.delete(url); }
}

async function handleApi(req, res, url) {
  try {
    if (url.pathname === '/api/health') {
      return sendJson(res, 200, {
        ok: true,
        service: 'tribun360 V63',
        node: process.version,
        time: new Date().toISOString()
      });
    }

    if (url.pathname === '/api/league-test') {
      const league = leagueCode(url);
      const result = { ok: true, league, checks: {} };

      const scoreboard = await tryGetJson(`${ESPN_SITE}/${league}/scoreboard`);
      result.checks.scoreboard = {
        ok: !!scoreboard,
        events: Array.isArray(scoreboard?.events) ? scoreboard.events.length : 0,
        leagueName: scoreboard?.leagues?.[0]?.name || ''
      };

      const standings = await tryGetJson(`${ESPN_V2}/${league}/standings`);
      result.checks.standings = { ok: !!standings };

      const teams = await tryGetJson(`${ESPN_SITE}/${league}/teams?limit=50`);
      const teamRows = teams?.sports?.[0]?.leagues?.[0]?.teams;
      result.checks.teams = {
        ok: Array.isArray(teamRows),
        count: Array.isArray(teamRows) ? teamRows.length : 0
      };

      result.ok = result.checks.scoreboard.ok && result.checks.standings.ok && result.checks.teams.ok;
      return sendJson(res, result.ok ? 200 : 502, result);
    }

    if (url.pathname === '/api/league-logo') {
      const league=leagueCode(url),key=`league-logo:${league}`,hit=apiCache.get(key);
      if(hit&&hit.buffer&&Date.now()-hit.ts<86400000){res.writeHead(200,{'Content-Type':hit.contentType||'image/png','Cache-Control':'public, max-age=86400','Access-Control-Allow-Origin':'*'});return res.end(hit.buffer)}
      let source=league==='tur.1'?'https://www.tff.org/Resources/TFF/Images/0000000015/TFF/TFF-Logolar/2024-2025/trendyol-super-lig-dikey-logo.png':null;
      if(!source){const d=await tryGetJson(`${ESPN_SITE}/${league}/scoreboard`),logos=d?.leagues?.[0]?.logos||[];source=logos[0]?.href||d?.leagues?.[0]?.logo||null}
      if(!source)return sendJson(res,404,{ok:false,error:'league logo unavailable',league});
      const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),10000);try{const rr=await fetch(source,{signal:ctrl.signal});if(!rr.ok)throw Error(`Logo HTTP ${rr.status}`);const buf=Buffer.from(await rr.arrayBuffer()),contentType=rr.headers.get('content-type')||(String(source).includes('.svg')?'image/svg+xml':'image/png');apiCache.set(key,{ts:Date.now(),buffer:buf,contentType});res.writeHead(200,{'Content-Type':contentType,'Content-Length':buf.length,'Cache-Control':'public, max-age=86400','Access-Control-Allow-Origin':'*'});return res.end(buf)}finally{clearTimeout(timer)}
    }


    if(url.pathname==='/api/app/standings'){const league=leagueCode(url),key=`app-standings:${league}`,hit=cacheGet(key,20000);if(hit)return sendJson(res,200,hit);const data={ok:true,league,updatedAt:new Date().toISOString(),rows:await appRows(league)};cacheSet(key,data);return sendJson(res,200,data)}
    if(url.pathname==='/api/app/fixtures'){const league=leagueCode(url),b=Math.max(0,Math.min(30,Number(url.searchParams.get('daysBack')||14))),f=Math.max(1,Math.min(120,Number(url.searchParams.get('daysForward')||45))),key=`app-fixtures:${league}:${b}:${f}`,hit=cacheGet(key,20000);if(hit)return sendJson(res,200,hit);const data={ok:true,league,updatedAt:new Date().toISOString(),events:await appFixtures(league,b,f)};cacheSet(key,data);return sendJson(res,200,data)}
    if(url.pathname==='/api/app/teams'){const league=leagueCode(url),key=`app-teams:${league}`,hit=cacheGet(key,300000);if(hit)return sendJson(res,200,hit);const d=await getJson(`${ESPN_SITE}/${league}/teams?limit=50`),data={ok:true,league,teams:appTeams(d,league)};cacheSet(key,data);return sendJson(res,200,data)}
    if(url.pathname==='/api/app/leaders'){const league=leagueCode(url),now=new Date(),season=now.getUTCMonth()>=6?now.getUTCFullYear():now.getUTCFullYear()-1,key=`app-leaders:${league}:${season}`,hit=cacheGet(key,60000);if(hit)return sendJson(res,200,hit);const d=await v46CurrentSeasonLeaders(league,season),data={ok:true,league,season,updatedAt:new Date().toISOString(),goals:d.goals||[],assists:d.assists||[]};cacheSet(key,data);return sendJson(res,200,data)}
    if(url.pathname==='/api/app/live-all'){const key='app-live-all',hit=cacheGet(key,12000);if(hit)return sendJson(res,200,hit);const data={ok:true,updatedAt:new Date().toISOString(),events:await appLiveAll()};cacheSet(key,data);return sendJson(res,200,data)}
    if(url.pathname==='/api/app/search'){const q=String(url.searchParams.get('q')||'').trim().toLocaleLowerCase('tr-TR');if(q.length<2)return sendJson(res,200,{ok:true,results:[]});const groups=await Promise.all(APP_LEAGUES.map(async l=>{const key=`app-teams:${l}`;let d=cacheGet(key,300000);if(!d){const raw=await tryGetJson(`${ESPN_SITE}/${l}/teams?limit=50`);d={ok:true,league:l,teams:appTeams(raw||{},l)};cacheSet(key,d)}return d.teams||[]}));return sendJson(res,200,{ok:true,results:groups.flat().filter(t=>(t.name+' '+t.shortName).toLocaleLowerCase('tr-TR').includes(q)).slice(0,24)})}

    if (url.pathname === '/api/scoreboard') {
      const league = leagueCode(url);
      const rawInput = String(url.searchParams.get('date') || url.searchParams.get('dates') || '').trim();
      const safe = rawInput.replace(/[^0-9-]/g, '');
      if (safe && !/^\d{8}(?:-\d{8})?$/.test(safe)) {
        return sendJson(res, 400, { ok: false, error: 'dates YYYYMMDD veya YYYYMMDD-YYYYMMDD olmalı' });
      }
      const q = safe ? `?dates=${encodeURIComponent(safe)}` : '';
      const key = `scoreboard:${league}:${safe}`;
      const cached = cacheGet(key, 15000);
      const data = cached || cacheSet(key, await getJson(`${ESPN_SITE}/${league}/scoreboard${q}`));
      return sendJson(res, 200, data);
    }

    if (url.pathname === '/api/summary') {
      const league = leagueCode(url);
      const id = String(url.searchParams.get('id') || '').replace(/\D/g, '');
      if (!id) return sendJson(res, 400, { ok: false, error: 'id gerekli' });
      const key = `summary:${league}:${id}`;
      const cached = cacheGet(key, 12000);
      const data = cached || cacheSet(key, await getJson(`${ESPN_SITE}/${league}/summary?event=${encodeURIComponent(id)}`));
      return sendJson(res, 200, data);
    }

    if (url.pathname === '/api/standings') {
      const league = leagueCode(url);
      const now = new Date();
      const defaultSeason = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
      const season = String(url.searchParams.get('season') || defaultSeason).replace(/\D/g,'').slice(0,4);
      const key = `standings:${league}:${season}`;
      const cached = cacheGet(key, 20000);
      if (cached) return sendJson(res, 200, cached);

      let data = await tryGetJson(`${ESPN_V2}/${league}/standings?season=${encodeURIComponent(season)}`);
      if (!data) data = await tryGetJson(`${ESPN_V2}/${league}/standings`);
      if (!data) data = await tryGetJson(`https://site.web.api.espn.com/apis/v2/sports/soccer/${league}/standings?season=${encodeURIComponent(season)}`);
      if (!data) data = await tryGetJson(`https://site.web.api.espn.com/apis/v2/sports/soccer/${league}/standings`);
      if (!data) throw new Error('Standings kaynağına ulaşılamadı');

      cacheSet(key, data);
      return sendJson(res, 200, data);
    }

    if (url.pathname === '/api/leaders') {
      const league = leagueCode(url);
      const now = new Date();
      const season = String(url.searchParams.get('season') || (now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear()-1)).replace(/\D/g,'').slice(0,4);
      const key = `leaders-v46:${league}:${season}`;
      const cached = cacheGet(key, 60000);
      if (cached) return sendJson(res, 200, cached);

      // Primary source: aggregate THIS season's played/live matches. This cannot leak previous-season leaders.
      let normalized = await v46CurrentSeasonLeaders(league, season);

      // Supplemental ESPN season endpoint only when it is explicitly season-scoped.
      // Kept as rawFallback for diagnostics; UI uses normalized goals/assists above.
      const rawFallback = await tryGetJson(`https://sports.core.api.espn.com/v2/sports/soccer/leagues/${league}/seasons/${season}/leaders?limit=100`);
      normalized.rawSeasonEndpointAvailable = !!rawFallback;
      cacheSet(key, normalized);
      return sendJson(res, 200, normalized);
    }

    if (url.pathname === '/api/team') {
      const league = leagueCode(url);
      const team = String(url.searchParams.get('team') || '').replace(/[^A-Za-z0-9._-]/g,'');
      if (!team) return sendJson(res, 400, {ok:false,error:'team gerekli'});
      const key = `team:${league}:${team}`;
      const cached = cacheGet(key, 300000);
      if (cached) return sendJson(res, 200, cached);
      const data = await getJson(`${ESPN_SITE}/${league}/teams/${encodeURIComponent(team)}`);
      cacheSet(key, data);
      return sendJson(res, 200, data);
    }

    if (url.pathname === '/api/team-schedule') {
      const league = leagueCode(url);
      const team = String(url.searchParams.get('team') || '').replace(/[^A-Za-z0-9._-]/g,'');
      if (!team) return sendJson(res, 400, {ok:false,error:'team gerekli'});
      const now = new Date();
      const season = String(url.searchParams.get('season') || (now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear()-1)).replace(/\D/g,'').slice(0,4);
      const key = `team-schedule:${league}:${team}:${season}`;
      const cached = cacheGet(key, 120000);
      if (cached) return sendJson(res, 200, cached);
      const data = await getJson(`${ESPN_SITE}/${league}/teams/${encodeURIComponent(team)}/schedule?season=${encodeURIComponent(season)}`);
      cacheSet(key, data);
      return sendJson(res, 200, data);
    }

    if (url.pathname === '/api/player') {
      const league = leagueCode(url);
      const id = String(url.searchParams.get('id') || '').replace(/\D/g,'');
      if (!id) return sendJson(res, 400, {ok:false,error:'id gerekli'});
      const key = `player:${league}:${id}`;
      const cached = cacheGet(key, 300000);
      if (cached) return sendJson(res, 200, cached);
      let data = await tryGetJson(`${ESPN_SITE}/${league}/athletes/${encodeURIComponent(id)}`);
      if (!data) data = await tryGetJson(`https://sports.core.api.espn.com/v3/sports/soccer/${league}/athletes/${encodeURIComponent(id)}`);
      if (!data) throw new Error('Oyuncu bilgisi alınamadı');
      cacheSet(key, data);
      return sendJson(res, 200, data);
    }

    if (url.pathname === '/api/player-stats') {
      const league = leagueCode(url);
      const id = String(url.searchParams.get('id') || '').replace(/\D/g,'');
      if (!id) return sendJson(res, 400, {ok:false,error:'id gerekli'});
      const key = `player-stats:${league}:${id}`;
      const cached = cacheGet(key, 120000);
      if (cached) return sendJson(res, 200, cached);
      let data = await tryGetJson(`https://site.web.api.espn.com/apis/common/v3/sports/soccer/${league}/athletes/${encodeURIComponent(id)}/stats`);
      if (!data) data = await tryGetJson(`https://sports.core.api.espn.com/v2/sports/soccer/leagues/${league}/athletes/${encodeURIComponent(id)}/statistics`);
      if (!data) data = {};
      cacheSet(key, data);
      return sendJson(res, 200, data);
    }

    if (url.pathname === '/api/injuries') {
      const league = leagueCode(url);
      const key = `injuries:${league}`;
      const cached = cacheGet(key, 120000);
      if (cached) return sendJson(res, 200, cached);
      const data = await tryGetJson(`${ESPN_SITE}/${league}/injuries`) || {};
      cacheSet(key, data);
      return sendJson(res, 200, data);
    }

    if (url.pathname === '/api/teams') {
      const league = leagueCode(url);
      const key = `teams:${league}`;
      const cached = cacheGet(key, 300000);
      if (cached) return sendJson(res, 200, cached);
      const data = await getJson(`${ESPN_SITE}/${league}/teams?limit=50`);
      cacheSet(key, data);
      return sendJson(res, 200, data);
    }

    if (url.pathname === '/api/roster') {
      const league = leagueCode(url);
      const team = String(url.searchParams.get('team') || '').replace(/[^A-Za-z0-9._-]/g,'');
      if (!team) return sendJson(res, 400, {ok:false,error:'team gerekli'});
      const key = `roster:${league}:${team}`;
      const cached = cacheGet(key, 300000);
      if (cached) return sendJson(res, 200, cached);
      const data = await getJson(`${ESPN_SITE}/${league}/teams/${encodeURIComponent(team)}/roster`);
      cacheSet(key, data);
      return sendJson(res, 200, data);
    }

    if (url.pathname === '/api/fixtures') {
      const league = leagueCode(url);
      const today = new Date();
      const scope = String(url.searchParams.get('scope') || '').toLowerCase();

      if (scope === 'season') {
        const seasonStartYear = today.getUTCMonth() >= 6 ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
        const seasonStart = new Date(Date.UTC(seasonStartYear, 7, 1, 12));
        const seasonEnd = new Date(Date.UTC(seasonStartYear + 1, 5, 15, 12));
        const key = `fixtures:${league}:season:${seasonStartYear}`;
        const cached = cacheGet(key, 180000);
        if (cached) return sendJson(res, 200, cached);

        const ranges = [];
        let cursor = new Date(seasonStart);
        while (cursor <= seasonEnd) {
          const chunkEnd = addDays(cursor, 30);
          const end = chunkEnd > seasonEnd ? seasonEnd : chunkEnd;
          ranges.push(`${ymd(cursor)}-${ymd(end)}`);
          cursor = addDays(end, 1);
        }

        const parts = await Promise.all(
          ranges.map(range =>
            tryGetJson(`${ESPN_SITE}/${league}/scoreboard?dates=${encodeURIComponent(range)}&limit=300`)
          )
        );

        const merged = new Map();
        for (const part of parts) {
          const events = Array.isArray(part?.events) ? part.events : [];
          for (const ev of events) if (ev?.id) merged.set(String(ev.id), ev);
        }

        if (merged.size === 0) {
          const start = ymd(addDays(today, -21));
          const end = ymd(addDays(today, 75));
          const fallback = await tryGetJson(`${ESPN_SITE}/${league}/scoreboard?dates=${start}-${end}&limit=300`);
          const events = Array.isArray(fallback?.events) ? fallback.events : [];
          for (const ev of events) if (ev?.id) merged.set(String(ev.id), ev);
        }

        if (merged.size === 0) throw new Error('Sezon fikstürü alınamadı');
        const data = {
          league,
          season: seasonStartYear,
          events: [...merged.values()].sort((a,b)=>String(a?.date||'').localeCompare(String(b?.date||'')))
        };
        cacheSet(key, data);
        return sendJson(res, 200, data);
      }

      const fromRaw = String(url.searchParams.get('from') || '').replace(/\D/g,'');
      let base = today;
      if (fromRaw && /^\d{8}$/.test(fromRaw)) {
        base = new Date(`${fromRaw.slice(0,4)}-${fromRaw.slice(4,6)}-${fromRaw.slice(6,8)}T12:00:00Z`);
      }
      const back = Math.max(0, Math.min(21, Number(url.searchParams.get('daysBack') || 7)));
      const forward = Math.max(1, Math.min(60, Number(url.searchParams.get('daysForward') || 28)));
      const start = ymd(addDays(base, -back));
      const end = ymd(addDays(base, forward));
      const range = `${start}-${end}`;
      const key = `fixtures:${league}:${range}`;
      const cached = cacheGet(key, 20000);
      if (cached) return sendJson(res, 200, cached);
      const data = await getJson(`${ESPN_SITE}/${league}/scoreboard?dates=${encodeURIComponent(range)}&limit=200`);
      cacheSet(key, data);
      return sendJson(res, 200, data);
    }

    if (url.pathname === '/api/sportscore') {
      const data = await getJson(`${SPORT_SCORE}/matches/?sport=football&limit=50&src=canli-mac-merkezi-2026-tr`);
      return sendJson(res, 200, data);
    }

    if (url.pathname === '/api/sportscore-detail') {
      const slug = String(url.searchParams.get('slug') || '').trim();
      if (!slug) return sendJson(res, 400, { ok: false, error: 'slug gerekli' });
      const data = await getJson(`${SPORT_SCORE}/match/?sport=football&src=canli-mac-merkezi-2026-tr&slug=${encodeURIComponent(slug)}`);
      return sendJson(res, 200, data);
    }

    return sendJson(res, 404, { ok: false, error: 'API yolu bulunamadı' });
  } catch (e) {
    const msg = e && e.name === 'AbortError' ? 'Kaynak zaman aşımına uğradı' : String(e && e.message ? e.message : e);
    return sendJson(res, 502, { ok: false, error: msg });
  }
}

function safePublicPath(urlPath) {
  let pathname;
  try { pathname = decodeURIComponent(urlPath); }
  catch { return null; }
  if (pathname === '/') pathname = '/index.html';
  const normalized = path.normalize(pathname).replace(/^([.][.][/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, normalized);
  if (!filePath.startsWith(PUBLIC_DIR)) return null;
  return filePath;
}

function serveFile(req, res, filePath) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      const fallback = path.join(PUBLIC_DIR, 'index.html');
      fs.readFile(fallback, (e, data) => {
        if (e) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          return res.end('Dosya bulunamadı.');
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(data);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const textLike = new Set(['.html','.js','.css','.json','.svg','.webmanifest']).has(ext);
    const acceptsGzip = /\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''));
    const gzPath = filePath + '.gz';
    if (textLike && acceptsGzip && fs.existsSync(gzPath)) {
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Encoding': 'gzip',
        'Vary': 'Accept-Encoding',
        'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=300'
      });
      return fs.createReadStream(gzPath).pipe(res);
    }
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=300'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

async function requestHandler(req, res) {
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  const host = req.headers.host || HOST;
  const url = new URL(req.url, `${proto}://${host}`);
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  const filePath = safePublicPath(url.pathname);
  if (!filePath) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Geçersiz istek.');
  }
  return serveFile(req, res, filePath);
}

module.exports = requestHandler;
module.exports.handler = requestHandler;

if (require.main === module) {
  const server = http.createServer(requestHandler);
  server.on('error', err => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`\nPort ${PORT} zaten kullanımda.`);
      console.error(`Tarayıcıdan http://localhost:${PORT} adresini kontrol et veya açık eski sunucuyu kapat.\n`);
    } else {
      console.error(err);
    }
    process.exitCode = 1;
  });

  server.listen(PORT, HOST, () => {
    const appUrl = `http://localhost:${PORT}`;
    console.log('\n========================================');
    console.log(' tribün360 V64 CALISIYOR');
    console.log('========================================');
    console.log(appUrl);
    console.log(`Test: ${appUrl}/api/health`);
    console.log('\nBu pencere acik kaldigi surece canli veri calisir.');
    console.log('Durdurmak icin Ctrl+C kullanabilirsin.\n');
    if (process.platform === 'win32') {
      setTimeout(() => exec(`start "" "${appUrl}"`), 500);
    }
  });
}
