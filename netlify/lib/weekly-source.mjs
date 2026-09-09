const clean=s=>String(s||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/&#39;|&apos;|&#x27;/g,"'").replace(/&quot;/g,'"').replace(/&ndash;/g,'-').replace(/\s+/g,' ').trim();
const key=s=>clean(s).toLowerCase().replace(/[^a-z0-9]/g,'');
const POS=['QB','RB','WR','TE'];
async function get(url){
 const started=Date.now();
 const r=await fetch(url,{redirect:'follow',headers:{'user-agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36','accept':'text/html,application/xhtml+xml'}});
 const body=await r.text();
 return {url,status:r.status,ok:r.ok,bytes:body.length,ms:Date.now()-started,body};
}
function cells(row){return [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(x=>clean(x[1]));}
function cbsName(raw,pos){
 // CBS rows repeat the full name: "C. Lamb WR DAL CeeDee Lamb WR DAL".
 const m=raw.match(new RegExp(`\\b${pos}\\s+[A-Z]{2,3}\\s+(.+?)\\s+${pos}\\s+[A-Z]{2,3}\\b`,'i'));
 return m?clean(m[1]):'';
}
async function cbs(pos,week){
 const url=`https://www.cbssports.com/fantasy/football/stats/${pos}/2026/season/projections/ppr/`;
 const r=await get(url); if(!r.ok)throw Object.assign(new Error(`CBS ${pos} HTTP ${r.status}`),{diag:r});
 const out=[];
 for(const tr of r.body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
   const c=cells(tr[1]); if(c.length<3)continue;
   const name=cbsName(c[0],pos); if(!name)continue;
   // fpts is second-to-last in the CBS table (fppg is last). For Week 1 they are equal.
   const nums=c.slice(1).map(x=>Number(String(x).replace(/,/g,'').replace(/[^\d.-]/g,'')));
   const pts=nums.length>=2?nums[nums.length-2]:NaN;
   if(Number.isFinite(pts)&&pts>=0&&pts<80)out.push({name,position:pos,cbsProjection:pts});
 }
 if(out.length<8)throw Object.assign(new Error(`CBS ${pos} parsed ${out.length}`),{diag:{...r,body:undefined,parsed:out.length,sample:out.slice(0,3)}});
 return {rows:out,diag:{source:'CBS',position:pos,url,status:r.status,bytes:r.bytes,parsed:out.length,ms:r.ms}};
}
function dsName(raw,pos){
 let s=clean(raw).replace(/^Image:\s*[A-Z]{2,3}\s+logo\s*/i,'');
 // DraftSharks sometimes splits the first name after its first letter (C.eeDee, J.ustin, P.uka).
 s=s.replace(/^([A-Z])\.(?=[a-z'â])/,'$1');
 s=s.replace(new RegExp(`\\s+[A-Z]{2,3}\\s+${pos}\\d+\\s*$`,'i'),'').trim();
 return s;
}
function dsValidName(name){
 const s=clean(name);
 // Reject the JS-placeholder form DraftSharks sometimes serves: "DAL 5", "CHI 3", etc.
 if(!s||/^[A-Z]{2,3}\s+(?:[A-Z]{1,3})?\d+$/i.test(s)||/^[A-Z]{2,3}\s+\d+$/i.test(s))return false;
 return /[A-Za-z].*[A-Za-z]/.test(s) && !/^Image:/i.test(s);
}
function parseDs(body,pos){
 const out=[];
 for(const tr of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
   const c=cells(tr[1]); if(c.length<8)continue;
   const rank=Number(c[0].replace(/[^\d]/g,'')); if(!rank)continue;
   const name=dsName(c[1],pos); if(!dsValidName(name))continue;
   // RK, Player, Matchup, SOS, Bye, Floor, Consensus, DS, Ceiling, 3D
   const dsProj=Number(String(c[7]||'').replace(/[^\d.-]/g,''));
   const consensus=Number(String(c[6]||'').replace(/[^\d.-]/g,''));
   const projection=Number.isFinite(dsProj)?dsProj:consensus;
   if(Number.isFinite(projection)&&projection>=0&&projection<80)out.push({name,position:pos,dsRank:rank,dsProjection:projection});
 }
 return out;
}
async function ds(pos,week){
 // DS occasionally serves a hydrated placeholder table (team + rank, but no player name)
 // on one URL shape. Try equivalent public Week URLs and keep the first one with real names.
 const urls=[
   `https://www.draftsharks.com/weekly-rankings/${week}/${pos.toLowerCase()}/ppr`,
   `https://www.draftsharks.com/weekly-rankings/${pos.toLowerCase()}/ppr?week=${week}&sort=fanDuel.dollarsPerPoint`,
   `https://www.draftsharks.com/weekly-rankings/${pos.toLowerCase()}/ppr?week=${week}`
 ];
 let best=null,last=null;
 for(const url of urls){
   const r=await get(url); last=r;
   if(!r.ok)continue;
   const rows=parseDs(r.body,pos);
   if(!best||rows.length>best.rows.length)best={rows,r};
   if(rows.length>=8)break;
 }
 if(best&&best.rows.length>=8){
   const r=best.r;
   return {rows:best.rows,diag:{source:'DraftSharks',position:pos,url:r.url,status:r.status,bytes:r.bytes,parsed:best.rows.length,ms:r.ms}};
 }
 const parsed=best?.rows?.length||0;
 throw Object.assign(new Error(`DraftSharks ${pos} parsed ${parsed} real player names`),{diag:{source:'DraftSharks',position:pos,url:best?.r?.url||last?.url||urls[0],status:best?.r?.status||last?.status||0,bytes:best?.r?.bytes||last?.bytes||0,parsed,ms:best?.r?.ms||last?.ms||0,sample:best?.rows?.slice(0,3)||[]}});
}
async function footballers(pos){
 const slug={QB:'quarterback',RB:'running-back',WR:'wide-receiver',TE:'tight-end'}[pos];
 const url=`https://www.thefantasyfootballers.com/2026-${slug}-rankings/`,r=await get(url);
 if(!r.ok)throw Object.assign(new Error(`Footballers ${pos} HTTP ${r.status}`),{diag:r});
 // Keep optional until the public page renders a dependable weekly ranking table server-side.
 throw Object.assign(new Error(`Footballers ${pos}: no dependable public weekly table yet`),{diag:{source:'Fantasy Footballers',position:pos,url,status:r.status,bytes:r.bytes,parsed:0,ms:r.ms}});
}
export async function fetchWeeklyConsensus(week,{diagnostics=false}={}){
 const map=new Map(),status=[],errors=[];
 const merge=x=>{const k=key(x.name);if(k)map.set(k,{...(map.get(k)||{}),...x})};
 for(const pos of POS){
   const jobs=[['CBS',()=>cbs(pos,week)],['DraftSharks',()=>ds(pos,week)],['Fantasy Footballers',()=>footballers(pos)]];
   const res=await Promise.allSettled(jobs.map(x=>x[1]()));
   res.forEach((r,i)=>{
     if(r.status==='fulfilled'){r.value.rows.forEach(merge);status.push({...r.value.diag,ok:true})}
     else {const d=r.reason?.diag||{};status.push({source:jobs[i][0],position:pos,ok:false,url:d.url||'',status:d.status||0,bytes:d.bytes||0,parsed:d.parsed||0,ms:d.ms||0,error:String(r.reason?.message||r.reason)});errors.push(`${jobs[i][0]} ${pos}: ${r.reason?.message||r.reason}`)}
   });
 }
 const players=[...map.values()];
 const loadedSources=[...new Set(status.filter(x=>x.ok).map(x=>x.source))];
 if(players.length<20){const e=new Error(`Consensus validation failed: ${players.length} players`);e.diagnostics={week,players:players.length,loadedSources,status,errors};throw e}
 return {source:'Lone Star Weekly Consensus',week:Number(week),scoring:'PPR',updatedAt:new Date().toISOString(),players,loadedSources,status:diagnostics?status:undefined,errors};
}
export async function fetchFanRanked(week){return fetchWeeklyConsensus(week)}
export async function diagnoseWeeklyConsensus(week){
 try{const data=await fetchWeeklyConsensus(week,{diagnostics:true});return {ok:true,week,players:data.players.length,loadedSources:data.loadedSources,status:data.status,errors:data.errors,samples:data.players.slice(0,8)}}
 catch(e){return {ok:false,week,error:String(e.message||e),...(e.diagnostics||{})}}
}
