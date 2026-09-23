const s = require('../lib/session');
module.exports = async function(req,res) {
  if (!['GET','POST','DELETE'].includes(req.method)) return s.send(res,405,{error:'허용되지 않는 요청입니다.'});
  if (req.method !== 'GET' && !s.sameOrigin(req)) return s.send(res,403,{error:'같은 사이트에서만 설정할 수 있습니다.'});
  try {
    if(req.method==='DELETE') { s.clear(res); return s.send(res,200,s.publicState(null)); }
    const old=s.read(req);
    if(req.method==='GET') return s.send(res,200,s.publicState(old));
    let input;
    try { input=s.body(req); } catch { return s.send(res,400,{error:'설정 요청 형식이 올바르지 않습니다.'}); }
    const data=old || {v:1,keys:{},cooldowns:{}};
    for(const name of ['gemini','openai']) {
      if(input[name] === null) { delete data.keys[name]; delete data.cooldowns[name]; }
      else if(input[name] !== undefined) {
        const value = typeof input[name] === 'string' ? input[name].trim() : '';
        if(value.length < 10 || value.length > 512 || /[\s\x00-\x1f\x7f]/u.test(value)) {
          const label = name === 'gemini' ? 'Gemini' : 'OpenAI';
          return s.send(res,400,{error:`${label} API 키 형식을 확인해주세요. 키 앞뒤의 공백과 줄바꿈도 제거해주세요.`});
        }
        if(data.keys[name] !== value) delete data.cooldowns[name];
        data.keys[name]=value;
      }
    }
    if(!['gemini','openai'].includes(input.preferred)) return s.send(res,400,{error:'우선 제공자를 선택해주세요.'});
    data.preferred=input.preferred;
    if(!data.keys[data.preferred]) {
      data.preferred = data.keys.gemini ? 'gemini' : data.keys.openai ? 'openai' : data.preferred;
    }
    data.exp=Date.now()+s.TTL*1000;
    s.write(res,data);
    return s.send(res,200,s.publicState(data));
  } catch { return s.send(res,503,{error:'키 보관 서버가 준비되지 않았습니다. 운영자의 COOKIE_SECRET 설정이 필요합니다.'}); }
};
