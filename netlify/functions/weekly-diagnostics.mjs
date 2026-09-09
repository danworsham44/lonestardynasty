import { diagnoseWeeklyConsensus } from '../lib/weekly-source.mjs';
export default async (req)=>{
 const u=new URL(req.url),week=Math.max(1,Math.min(18,Number(u.searchParams.get('week')||1)));
 const data=await diagnoseWeeklyConsensus(week);
 return Response.json(data,{status:data.ok?200:502,headers:{'cache-control':'no-store'}});
};
