const ESPN_SITE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const SUPPORTED = new Set(['tur.1','eng.1','esp.1','fra.1','ger.1','ita.1']);

function ymd(d){ return d.toISOString().slice(0,10).replace(/-/g,''); }
function addDays(d,n){ const x=new Date(d); x.setUTCDate(x.getUTCDate()+n); return x; }
function send(res,status,data){
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','s-maxage=30, stale-while-revalidate=120');
  res.end(JSON.stringify(data));
}
async function getJson(url){
  const r=await fetch(url,{headers:{Accept:'application/json'}});
  if(!r.ok) throw new Error('ESPN HTTP '+r.status);
  return r.json();
}
async function tryJson(url){ try{return await getJson(url)}catch(e){return null} }
function mergeEvents(parts){
  const map=new Map();
  for(const part of parts){
    for(const ev of (Array.isArray(part?.events)?part.events:[])){
      if(!ev?.id) continue;
      const id=String(ev.id), old=map.get(id);
      // A completed/newer record must win over an older scheduled copy.
      if(!old || ev?.status?.type?.completed || !old?.status?.type?.completed) map.set(id,ev);
    }
  }
  return [...map.values()].sort((a,b)=>String(a?.date||'').localeCompare(String(b?.date||'')));
}

module.exports = async function handler(req,res){
  try{
    const proto=String(req.headers?.['x-forwarded-proto']||'https').split(',')[0];
    const host=req.headers?.host||'localhost';
    const u=new URL(req.url,proto+'://'+host);
    const raw=String(u.searchParams.get('league')||'tur.1');
    const league=SUPPORTED.has(raw)?raw:'tur.1';
    const scope=String(u.searchParams.get('scope')||'').toLowerCase();
    const now=new Date();

    if(scope==='season'){
      const sy=now.getUTCMonth()>=6?now.getUTCFullYear():now.getUTCFullYear()-1;
      const start=new Date(Date.UTC(sy,7,1,12));
      const end=new Date(Date.UTC(sy+1,5,15,12));
      const ranges=[];
      for(let cur=new Date(start);cur<=end;){
        const e=addDays(cur,30)>end?end:addDays(cur,30);
        ranges.push(ymd(cur)+'-'+ymd(e)); cur=addDays(e,1);
      }
      const parts=await Promise.all(ranges.map(r=>tryJson(`${ESPN_SITE}/${league}/scoreboard?dates=${r}&limit=300`)));
      // Re-fetch the recent window last. This makes freshly completed scores override stale season copies.
      parts.push(await tryJson(`${ESPN_SITE}/${league}/scoreboard?dates=${ymd(addDays(now,-45))}-${ymd(addDays(now,2))}&limit=300&_=${Date.now()}`));
      const events=mergeEvents(parts);
      if(!events.length) throw new Error('Sezon fikstürü alınamadı');
      return send(res,200,{league,season:sy,events,updatedAt:new Date().toISOString(),resultSource:'ESPN'});
    }

    const back=Math.max(0,Math.min(45,Number(u.searchParams.get('daysBack')||7)));
    const forward=Math.max(1,Math.min(90,Number(u.searchParams.get('daysForward')||28)));
    const from=String(u.searchParams.get('from')||'').replace(/\D/g,'');
    let base=now;
    if(/^\d{8}$/.test(from)) base=new Date(`${from.slice(0,4)}-${from.slice(4,6)}-${from.slice(6,8)}T12:00:00Z`);
    const range=ymd(addDays(base,-back))+'-'+ymd(addDays(base,forward));
    const data=await getJson(`${ESPN_SITE}/${league}/scoreboard?dates=${range}&limit=300`);
    return send(res,200,data);
  }catch(e){
    return send(res,502,{ok:false,error:String(e?.message||e)});
  }
};
