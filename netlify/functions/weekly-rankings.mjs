
import { getStore } from '@netlify/blobs';
import { fetchFanRanked } from '../lib/weekly-source.mjs';
export default async (req)=>{
 const u=new URL(req.url),week=Math.max(1,Math.min(18,Number(u.searchParams.get('week')||1))),store=getStore({name:'lone-star-weekly-rankings',consistency:'strong'}),key=`2026-week-${week}`;
 let data=await store.get(key,{type:'json',consistency:'strong'});
 if(!data){
   try{data=await fetchFanRanked(week);await store.setJSON(key,data);await store.setJSON('latest',data)}
   catch(e){return Response.json({ok:false,error:String(e?.message||e),diagnostics:e?.diagnostics||null,players:[]},{status:502,headers:{'cache-control':'no-store'}})}
 }
 const age=Date.now()-Date.parse(data.updatedAt||0);
 return Response.json({...data,ok:true,stale:age>4*86400000},{headers:{'cache-control':'public, max-age=900'}});
};
