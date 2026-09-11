const clean=s=>String(s||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/&#39;|&apos;|&#x27;/g,"'").replace(/&quot;/g,'"').replace(/&ndash;/g,'-').replace(/\s+/g,' ').trim();
const key=s=>clean(s).toLowerCase().replace(/[^a-z0-9]/g,'');
const POS=['QB','RB','WR','TE'];
const teamKey=t=>({JAX:'JAC',LV:'LVR',WSH:'WAS'}[String(t||'').toUpperCase()]||String(t||'').toUpperCase());
async function get(url){
 const started=Date.now();
 const r=await fetch(url,{redirect:'follow',headers:{'user-agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36','accept':'text/html,application/xhtml+xml'}});
 const body=await r.text();
 return {url,status:r.status,ok:r.ok,bytes:body.length,ms:Date.now()-started,body};
}
function cells(row){return [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(x=>clean(x[1]));}
function parseCSV(text){
 const rows=[];let row=[],field='',q=false;
 for(let i=0;i<text.length;i++){
   const c=text[i],n=text[i+1];
   if(q){if(c==='"'&&n==='"'){field+='"';i++}else if(c==='"')q=false;else field+=c}
   else if(c==='"')q=true;
   else if(c===','){row.push(field);field=''}
   else if(c==='\n'){row.push(field);rows.push(row);row=[];field=''}
   else if(c!=='\r')field+=c;
 }
 if(field.length||row.length){row.push(field);rows.push(row)}
 if(rows.length<2)return [];
 const h=rows[0].map(x=>String(x||'').trim());
 return rows.slice(1).filter(r=>r.length>1).map(r=>{const o={};h.forEach((k,i)=>o[k]=r[i]??'');return o});
}
let fpPromise=null;
async function fantasyProsPlayers(){
 if(fpPromise)return fpPromise;
 fpPromise=(async()=>{
   const url='https://cdn.jsdelivr.net/gh/dynastyprocess/data@master/files/fp_latest_weekly.csv';
   const r=await get(url); if(!r.ok)throw new Error(`FantasyPros helper HTTP ${r.status}`);
   return parseCSV(r.body).map(x=>{
     const pos=String(x.pos||x.page_pos||'').toUpperCase();
     const team=teamKey(x.team);
     const m=String(x.pos_rank||'').toUpperCase().match(/(QB|RB|WR|TE)\s*#?\s*(\d+)/);
     const posRank=m?Number(m[2]):9999;
     return {name:clean(x.player_name),position:pos,team,posRank,rank:Number(x.rank)||9999};
   }).filter(x=>x.name&&POS.includes(x.position)&&x.team);
 })();
 return fpPromise;
}
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

function lastNameKey(name){const a=clean(name).toLowerCase().replace(/[^a-z0-9' -]/g,' ').split(/\s+/).filter(Boolean);while(a.length>1&&/^(jr|sr|ii|iii|iv)$/.test(a[a.length-1].replace(/[^a-z0-9]/g,'')))a.pop();return (a[a.length-1]||'').replace(/[^a-z0-9]/g,'')}
function abbrevMatches(abbrev,full,pos){const text=clean(abbrev).replace(new RegExp(`\\b${pos}\\b.*$`,'i'),'').trim(),m=text.match(/^([A-Za-z])\.?\s+(.+)$/);return !!m&&clean(full)[0]?.toLowerCase()===m[1].toLowerCase()&&lastNameKey(full)===lastNameKey(m[2]);}
function resolveCBSAbbrev(label,pos,helpers){
 const text=clean(label).replace(new RegExp(`\\b${pos}\\b.*$`,'i'),'').trim();
 const m=text.match(/^([A-Za-z])\.?\s+(.+)$/);if(!m)return text;
 const initial=m[1].toLowerCase(),last=lastNameKey(m[2]);
 const hits=helpers.filter(x=>x.position===pos&&x.name&&x.name[0]?.toLowerCase()===initial&&lastNameKey(x.name)===last);
 return hits.length===1?hits[0].name:text;
}
async function cbsRankings(pos,week){
 const urls=[`https://www.cbssports.com/fantasy/football/rankings/ppr/${pos}/weekly/`,`https://new.cbssports.com/fantasy/football/rankings/ppr/${pos}/weekly/`];
 let r=null;for(const u of urls){try{const x=await get(u);if(x.ok){r=x;break}if(!r)r=x}catch(e){}}
 if(!r?.ok)throw Object.assign(new Error(`CBS rankings ${pos} HTTP ${r?.status||0}`),{diag:r||{url:urls[0]}});
 const url=r.url;
 const helpers=await fantasyProsPlayers().catch(()=>[]),out=[];
 // CBS now renders the weekly consensus board as div-based player rows rather
 // than a table. The player URL includes the full name even though the visible
 // label is abbreviated (for example, /tyler-warren/ + "T. Warren").
 const start=r.body.indexOf('<div class="player-wrapper">'),end=start>=0?r.body.indexOf('<div class="experts-column',start):-1;
 const consensusBlock=start>=0?r.body.slice(start,end>start?end:undefined):r.body;
 const divRow=/<div class="player-row[^"]*">\s*<div class="rank">\s*(\d+)\s*<\/div>[\s\S]*?<a\s+href="\/nfl\/players\/\d+\/([^/]+)\/fantasy\/">[\s\S]*?<span class="player-name">([^<]+)<\/span>[\s\S]*?<div class="player-stats">([^<]*)<\/div>/gi;
 for(const m of consensusBlock.matchAll(divRow)){
  const rank=Number(m[1]);if(!Number.isFinite(rank)||rank<1||rank>250)continue;
  const slugName=clean(m[2]).split('-').filter(Boolean).map(x=>/^(jr|sr|ii|iii|iv)$/i.test(x)?x.toUpperCase():x[0]?.toUpperCase()+x.slice(1)).join(' ');
  const name=slugName||resolveCBSAbbrev(m[3],pos,helpers);if(name)out.push({name,position:pos,cbsRank:rank,cbsOpponent:clean(m[4])});
 }
 // Retain the former table parser as a fallback in case CBS switches markup
 // again or serves its legacy layout to a particular edge location.
 for(const tr of r.body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
  const c=cells(tr[1]);if(c.length<2)continue;
  let rank=NaN,playerCell='',opp='';
  for(let i=0;i<c.length;i++){if(!Number.isFinite(rank)&&/^\d+$/.test(c[i])){rank=Number(c[i]);playerCell=c[i+1]||'';opp=c[i+2]||'';break}}
  if(!Number.isFinite(rank)||rank<1||rank>250||!playerCell)continue;
  const name=resolveCBSAbbrev(playerCell,pos,helpers);if(!name)continue;
  if(!out.some(x=>x.cbsRank===rank))out.push({name,position:pos,cbsRank:rank,cbsOpponent:clean(opp)});
 }
 if(out.length<8)throw Object.assign(new Error(`CBS rankings ${pos} parsed ${out.length}`),{diag:{...r,body:undefined,parsed:out.length,sample:out.slice(0,3)}});
 return {rows:out,diag:{source:'CBS Rankings',position:pos,url,status:r.status,bytes:r.bytes,parsed:out.length,ms:r.ms}};
}
export async function fetchWeeklyConsensus(week,{diagnostics=false}={}){
 const map=new Map(),status=[],errors=[];
 const merge=x=>{let k=key(x.name);if(x.cbsRank){const hit=[...map.entries()].find(([,v])=>String(v.position||'').toUpperCase()===String(x.position||'').toUpperCase()&&abbrevMatches(x.name,v.name,x.position));if(hit)k=hit[0]}if(k)map.set(k,{...(map.get(k)||{}),...x})};
 for(const pos of POS){
   try{const r=await cbs(pos,week);r.rows.forEach(merge);status.push({...r.diag,ok:true})}
   catch(e){const d=e?.diag||{};status.push({source:'CBS',position:pos,ok:false,url:d.url||'',status:d.status||0,bytes:d.bytes||0,parsed:d.parsed||0,ms:d.ms||0,error:String(e?.message||e)});errors.push(`CBS ${pos}: ${e?.message||e}`)}
   try{const r=await cbsRankings(pos,week);r.rows.forEach(merge);status.push({...r.diag,ok:true})}
   catch(e){const d=e?.diag||{};status.push({source:'CBS Rankings',position:pos,ok:false,url:d.url||'',status:d.status||0,bytes:d.bytes||0,parsed:d.parsed||0,ms:d.ms||0,error:String(e?.message||e)});errors.push(`CBS Rankings ${pos}: ${e?.message||e}`)}
 }
 const players=[...map.values()],loadedSources=[...new Set(status.filter(x=>x.ok).map(x=>x.source))];
 if(players.length<20){const e=new Error(`Consensus validation failed: ${players.length} players`);e.diagnostics={week,players:players.length,loadedSources,status,errors};throw e}
 return {source:'Lone Star Weekly Sources',week:Number(week),scoring:'PPR',updatedAt:new Date().toISOString(),players,loadedSources,status:diagnostics?status:undefined,errors};
}
export async function fetchFanRanked(week){return fetchWeeklyConsensus(week)}
export async function diagnoseWeeklyConsensus(week){
 try{const data=await fetchWeeklyConsensus(week,{diagnostics:true});return {ok:true,week,players:data.players.length,loadedSources:data.loadedSources,status:data.status,errors:data.errors,samples:data.players.slice(0,8)}}
 catch(e){return {ok:false,week,error:String(e.message||e),...(e.diagnostics||{})}}
}
