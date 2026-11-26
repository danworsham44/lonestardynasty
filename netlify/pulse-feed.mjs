import {getStore} from '@netlify/blobs';
import {keyFor,validSeason,validWeek} from './lib/pulse-core.mjs';

export default async function(request){
 if(request.method!=='GET')return new Response(null,{status:405,headers:{Allow:'GET'}});
 if(process.env.LSD_SHARED_PULSE!=='1')return Response.json({enabled:false},{headers:{'Cache-Control':'no-store'}});
 const {searchParams}=new URL(request.url),season=searchParams.get('season'),week=searchParams.get('week');
 if(!validSeason(season)||!validWeek(week))return Response.json({error:'Invalid season or week'},{status:400});
 try{
  const store=getStore({name:'lsd-shared-pulse',consistency:'strong'});
  const data=await store.get(keyFor(season,week),{type:'json'});
  return Response.json({enabled:true,events:data?.events||[],checkedAt:data?.snapshot?.at||null},{
   headers:{'Cache-Control':'public, max-age=30','Netlify-CDN-Cache-Control':'public, durable, s-maxage=30','Netlify-Vary':'query=season|week'}
  });
 }catch(e){
  console.warn('Pulse read failed',e.message);
  return Response.json({error:'Pulse temporarily unavailable'},{status:503,headers:{'Cache-Control':'no-store'}});
 }
}
