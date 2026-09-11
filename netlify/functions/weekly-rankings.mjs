
import { getStore } from '@netlify/blobs';
import { fetchFanRanked } from '../lib/weekly-source.mjs';
export default async (req)=>{
 const u=new URL(req.url),week=Math.max(1,Math.min(18,Number(u.searchParams.get('week')||1))),store=getStore({name:'lone-star-weekly-rankings',consistency:'strong'}),key=`2026-week-${week}`;
 let data=await store.get(key,{type:'json',consistency:'strong'});
 const hasCBSRanks=Array.isArray(data?.players)&&data.players.some(p=>Number(p?.cbsRank)>0);
 const age=Date.now()-Date.parse(data?.updatedAt||0);
 if(!data||!hasCBSRanks||!Number.isFinite(age)||age>18*60*60*1000){
   try{const fresh=await fetchFanRanked(week);data=fresh;await store.setJSON(key,fresh);await store.setJSON('latest',fresh)}
   catch(e){
     if(!data)return Response.json({ok:false,error:String(e?.message||e),diagnostics:e?.diagnostics||null,players:[]},{status:502,headers:{'cache-control':'no-store'}});
     data={...data,refreshError:String(e?.message||e)};
   }
 }
 const responseAge=Date.now()-Date.parse(data.updatedAt||0);
 return Response.json({...data,ok:true,stale:responseAge>4*86400000},{headers:{'cache-control':'no-store'}});
};
