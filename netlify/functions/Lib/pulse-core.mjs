export const LEAGUE_ID='1311994122080354304';
export const LIMIT=50, THRESHOLD=400, BURST_MS=90000, MAX_GAP_MS=155000;
const cents=x=>x!=null&&x!==''&&Number.isFinite(Number(x))?Math.round(Number(x)*100):null;
export const validWeek=x=>/^(?:[1-9]|1[0-8])$/.test(String(x));
export const validSeason=x=>/^20\d\d$/.test(String(x));
export const keyFor=(season,week)=>`${LEAGUE_ID}/${season}/${week}`;

export function snapshot(rows,at,expected){
 if(!Array.isArray(rows)||rows.length!==expected||!rows.length)throw Error('Incomplete Sleeper scoreboard');
 const players={},groups=new Map(),seen=new Set();
 for(const row of rows){
  const roster=String(row.roster_id),score=cents(row.custom_points??row.points);
  if(!/^\d+$/.test(roster)||seen.has(roster)||score===null||!Array.isArray(row.starters))throw Error('Invalid Sleeper matchup');
  seen.add(roster);
  for(const id of new Set(row.starters.map(String))){
   if(!/^[\dA-Z]+$/.test(id)||id==='0')continue;
   const points=cents(row.players_points?.[id]??row.starters_points?.[row.starters.findIndex(value=>String(value)===id)]);
   if(points!==null)players[`${roster}:${id}`]=points;
  }
  if(row.matchup_id!=null){
   const id=String(row.matchup_id),pair=groups.get(id)||[];
   pair.push({roster,score});groups.set(id,pair);
  }
 }
 if(!groups.size||[...groups.values()].some(pair=>pair.length!==2))throw Error('Sleeper matchup pairs not ready');
 return {at,players,games:Object.fromEntries(groups)};
}

export function advance(prior,next){
 if(prior?.snapshot?.at>=next.at)return prior;
 const before=prior?.snapshot,events=[...(prior?.events||[])],bursts={},leaders={};
 const continuous=before&&next.at-before.at<=MAX_GAP_MS;
 const push=(type,id,fields)=>events.unshift({id:`${next.at}:${type}:${id}`,ts:next.at,type,...fields});
 for(const [key,total] of Object.entries(next.players)){
  if(!continuous||!Number.isFinite(before.players[key]))continue;
  const delta=total-before.players[key];
  if(delta<0)continue;
  const ticks=(prior.bursts?.[key]||[]).filter(x=>next.at-x.at<=BURST_MS);
  if(delta>0&&delta<THRESHOLD)ticks.push({at:next.at,delta});
  const combined=ticks.reduce((sum,x)=>sum+x.delta,0),burst=ticks.length>1&&combined>=THRESHOLD;
  if(delta>=THRESHOLD||(delta>0&&burst)){
   const [roster,player]=key.split(':');
   push('big',key,{roster,player,delta:delta>=THRESHOLD?delta:combined,total,burst:delta<THRESHOLD});
  }else if(ticks.length)bursts[key]=ticks;
 }
 for(const [id,pair] of Object.entries(next.games)){
  const [a,b]=pair,leader=a.score===b.score?null:a.score>b.score?a:b,previous=before?.games[id];
  const samePair=previous?.every(x=>pair.some(y=>x.roster===y.roster));
  const old=continuous&&samePair?prior.leaders?.[id]:null;
  if(leader&&old&&old!==leader.roster){
   const other=leader===a?b:a;
   push('lead',id,{roster:leader.roster,other:other.roster,score:leader.score,otherScore:other.score});
  }
  const tracked=leader?.roster||old;if(tracked)leaders[id]=tracked;
 }
 return {snapshot:next,events:events.slice(0,LIMIT),bursts,leaders};
}
