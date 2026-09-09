
import { getStore } from '@netlify/blobs';
import { fetchFanRanked } from '../lib/weekly-source.mjs';
function nflWeek(now=new Date()){
 const start=Date.UTC(2026,8,8); // Week 1 opening window for this site's 2026 season.
 return Math.max(1,Math.min(18,Math.floor((now.getTime()-start)/(7*86400000))+1));
}
export default async ()=>{
 const week=nflWeek(),store=getStore({name:'lone-star-weekly-rankings',consistency:'strong'});
 try{
   const data=await fetchFanRanked(week);
   await store.setJSON(`2026-week-${week}`,data);
   await store.setJSON('latest',data);
   console.log(`Saved ${data.players.length} CBS/DraftSharks rows for Week ${week}`);
 }catch(e){
   console.error('Weekly ranking refresh failed; previous snapshot retained:',e);
 }
};
