const s=require('../lib/session');
const providers=require('../lib/providers');
module.exports=async function(req,res) {
  if(req.method!=='POST') return s.send(res,405,{error:'POST 요청만 지원합니다.'});
  if(!s.sameOrigin(req)) return s.send(res,403,{error:'같은 사이트에서만 조회할 수 있습니다.'});
  let data;
  try {data=s.read(req);} catch {return s.send(res,503,{error:'키 보관 서버 설정이 필요합니다.'});}
  if(!data || !Object.values(data.keys).some(Boolean)) return s.send(res,401,{error:'개인 API 키를 먼저 저장해주세요.'});
  let input;
  try {input=s.body(req);} catch {return s.send(res,400,{error:'잘못된 조회 요청입니다.'});}
  if(typeof input.keyword!=='string' || !input.keyword.trim() || input.keyword.length>80 || ![1,3,7,30].includes(input.days)) return s.send(res,400,{error:'키워드와 조회 기간을 확인해주세요.'});
  const order=[data.preferred,...['gemini','openai'].filter(p=>p!==data.preferred)].filter(p=>data.keys[p]);
  const attempts=[];
  for(const provider of order) {
    if((data.cooldowns[provider] || 0)>Date.now()) continue;
    try {
      attempts.push(provider);
      const result=await providers.fetchNews(provider,data.keys[provider],input.keyword.trim(),input.days);
      s.write(res,data);
      return s.send(res,200,{...result,provider,switched:provider!==order[0],attempts});
    } catch(error) {
      if(error.status!==429) {
        const label=provider==='openai'?'OpenAI':'Gemini';
        const message=error instanceof providers.ProviderError?error.message:'뉴스 처리에 실패했습니다.';
        return s.send(res,error.status===401 || error.status===403?422:502,{error:`${label}: ${message}`,attempts,provider});
      }
      data.cooldowns[provider]=Date.now()+error.retryAfter;
      s.write(res,data);
    }
  }
  const retryAfter=Math.max(1000,Math.min(...order.map(p=>data.cooldowns[p] || Date.now()))-Date.now());
  res.setHeader('Retry-After',String(Math.ceil(retryAfter/1000)));
  return s.send(res,429,{error:'등록한 제공자 모두 대기 중입니다. 나중에 다시 실행해주세요.',retryAfter,attempts});
};
