import {getStore} from '@netlify/blobs';
import {LEAGUE_ID,keyFor,validSeason,validWeek,snapshot,advance} from './lib/pulse-core.mjs';

const api='https://api.sleeper.app/v1';
const localSlot=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'numeric',hourCycle:'h23'});
async function json(path){
 const r=await fetch(api+path,{signal:AbortSignal.timeout(7500)});
 if(!r.ok)throw Error(`Sleeper HTTP ${r.status}`);
 return r.json();
}
export default async function(){
 if(process.env.LSD_SHARED_PULSE!=='1')return new Response(null,{status:204});
 const now=new Date(),parts=localSlot.formatToParts(now),hour=Number(parts.find(x=>x.type==='hour').value);
 // Leave room for international games, holiday games and late windows; skip quiet hours.
 if(hour>=2&&hour<8)return new Response(null,{status:204});
 try{
  const [nfl,league]=await Promise.all([json('/state/nfl'),json('/league/'+LEAGUE_ID)]);
  const season=String(league?.season),week=Number(nfl?.week),expected=Number(league?.total_rosters);
  if(nfl?.season_type!=='regular'||String(nfl?.season)!==season||!validSeason(season)||!validWeek(week)||!Number.isInteger(expected))return new Response(null,{status:204});
  const store=getStore({name:'lsd-shared-pulse',consistency:'strong'}),key=keyFor(season,week);
  const [rows,prior]=await Promise.all([json(`/league/${LEAGUE_ID}/matchups/${week}`),store.get(key,{type:'json'})]);
  if(!rows?.some?.(x=>x.matchup_id!=null))return new Response(null,{status:204});
  const next=advance(prior,snapshot(rows,now.getTime(),expected));
  if(next!==prior)await store.setJSON(key,next);
  return new Response(null,{status:204});
 }catch(e){
  console.warn('Pulse collection failed',e.message);
  return new Response('Pulse collection failed',{status:503});
 }
}
export const config={schedule:'* 0-8,13-23 * * *'};
