const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
process.env.COOKIE_SECRET=crypto.randomBytes(32).toString('base64');
const session=require('../api/session');
const news=require('../api/news');
const vault=require('../lib/session');
const providerLib=require('../lib/providers');
function req(method,body,cookie='',origin='https://test.example') {return {method,body,headers:{host:'test.example',origin,cookie,'content-type':'application/json'}};}
function res(){return {headers:{},setHeader(k,v){this.headers[k]=v;},end(v){this.data=JSON.parse(v);}};}
async function invoke(handler,request){const response=res();await handler(request,response);return response;}
const keyA='AIza-test-person-A-123456789';
const keyB='sk-test-person-A-123456789';
async function register(){const r=await invoke(session,req('POST',{gemini:keyA,openai:keyB,preferred:'gemini'}));assert.equal(r.statusCode,200);return r.headers['Set-Cookie'].split(';')[0];}
const item={title:'기사',snippet:'요약',publisher:'출처',date:'2026-09-23',url:'https://news.example/story'};
function mock(status,provider='openai') {return {ok:status===200,status,headers:{get:()=> '120'},json:async()=>provider==='openai'?{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({items:[item]}),annotations:[{type:'url_citation',url:item.url,title:'출처'}]}]}],usage:{total_tokens:100}}:{candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({items:[item]})}]},groundingMetadata:{groundingChunks:[{web:{uri:item.url,title:'출처'}}]}}],usageMetadata:{totalTokenCount:100}}};}
test('encrypted private cookies, no returned key, tamper/expiry rejection, deletion and origin guard',async()=>{
 const cookie=await register();assert.ok(!cookie.includes(keyA));assert.ok(!cookie.includes(keyB));
 const state=await invoke(session,req('GET',null,cookie));assert.deepEqual([state.data.gemini,state.data.openai],[true,true]);assert.ok(!JSON.stringify(state.data).includes(keyA));
 const separate=await invoke(session,req('GET'));assert.equal(separate.data.gemini,false);
 const value=cookie.split('=')[1];const raw=Buffer.from(value,'base64url');raw[35]^=1;
 const tampered=await invoke(session,req('GET',null,cookie.split('=')[0]+'='+raw.toString('base64url')));assert.equal(tampered.data.openai,false);
 const expired=res();vault.write(expired,{v:1,exp:Date.now()-100,keys:{gemini:keyA},cooldowns:{},preferred:'gemini'});assert.equal(vault.read(req('GET',null,expired.headers['Set-Cookie'])),null);
 const blocked=await invoke(session,req('POST',{gemini:keyA,preferred:'gemini'},'', 'https://evil.example'));assert.equal(blocked.statusCode,403);
 const saved=await invoke(session,req('POST',{preferred:'openai'},cookie));assert.match(saved.headers['Set-Cookie'],/HttpOnly; Secure; SameSite=Strict/);assert.equal(saved.data.gemini,true);
 const removed=await invoke(session,req('POST',{gemini:null,preferred:'openai'},cookie));assert.equal(removed.data.gemini,false);assert.equal(removed.data.openai,true);
 const deleted=await invoke(session,req('DELETE',null,cookie));assert.match(deleted.headers['Set-Cookie'],/Max-Age=0/);
});
test('429 switches once to second key, records tokens, and subsequent requests skip cooled provider',async()=>{
 const cookie=await register();const seen=[];
 global.fetch=async(url,options)=>{seen.push({url,options});return mock(seen.length===1?429:200);};
 const r=await invoke(news,req('POST',{keyword:'AI',days:3},cookie));assert.equal(r.statusCode,200);assert.equal(r.data.provider,'openai');assert.equal(r.data.switched,true);assert.equal(r.data.tokens,100);assert.equal(seen.length,2);
 assert.equal(seen[0].options.headers['x-goog-api-key'],keyA);assert.ok(!seen[0].url.includes(keyA));assert.equal(seen[1].options.headers.Authorization,'Bearer '+keyB);
 assert.equal(JSON.parse(seen[1].options.body).max_output_tokens,2200);
 const next=await invoke(news,req('POST',{keyword:'chips',days:3},r.headers['Set-Cookie'].split(';')[0]));assert.equal(next.statusCode,200);assert.equal(seen.length,3);assert.equal(next.data.attempts[0],'openai');
});
test('401 never switches and errors do not expose upstream secrets',async()=>{
 const cookie=await register();let calls=0;global.fetch=async()=>{calls++;return mock(401);};
 const r=await invoke(news,req('POST',{keyword:'AI',days:3},cookie));assert.equal(r.statusCode,422);assert.equal(calls,1);assert.ok(!JSON.stringify(r.data).includes(keyA));
});
test('both exhausted stop after two calls, cooldown prevents all calls',async()=>{
 let cookie=await register();let calls=0;global.fetch=async()=>{calls++;return mock(429);};
 const r=await invoke(news,req('POST',{keyword:'AI',days:3},cookie));assert.equal(r.statusCode,429);assert.equal(calls,2);assert.ok(r.data.retryAfter>100000);
 cookie=r.headers['Set-Cookie'].split(';')[0];await invoke(news,req('POST',{keyword:'AI',days:3},cookie));assert.equal(calls,2);
});
test('OpenAI preferred can fall back to Gemini and a single registered provider is supported',async()=>{
 const first=await invoke(session,req('POST',{gemini:keyA,openai:keyB,preferred:'openai'}));let calls=0;
 global.fetch=async()=>{calls++;return mock(calls===1?429:200,'gemini');};
 const result=await invoke(news,req('POST',{keyword:'AI',days:3},first.headers['Set-Cookie'].split(';')[0]));assert.equal(result.data.provider,'gemini');assert.equal(calls,2);
 const single=await invoke(session,req('POST',{openai:keyB,preferred:'gemini'}));calls=0;global.fetch=async()=>{calls++;return mock(200);};
 const r=await invoke(news,req('POST',{keyword:'AI',days:3},single.headers['Set-Cookie'].split(';')[0]));assert.equal(r.data.provider,'openai');assert.equal(calls,1);
});
test('invalid requests and missing cookie make zero provider calls; malformed responses do not retry',async()=>{
 let calls=0;global.fetch=async()=>{calls++;return {ok:true,json:async()=>({status:'completed',output:[]})};};
 const cookie=await register();assert.equal((await invoke(news,req('POST',{keyword:'AI',days:3}))).statusCode,401);
 assert.equal((await invoke(news,req('POST',{keyword:'AI',days:99},cookie))).statusCode,400);
 assert.equal((await invoke(news,req('POST',{keyword:'AI',days:3},cookie,'https://evil.example'))).statusCode,403);assert.equal(calls,0);
 assert.equal((await invoke(news,req('POST',{keyword:'AI',days:3},cookie))).statusCode,502);assert.equal(calls,1);
});
test('cookie secret missing fails closed',async()=>{const old=process.env.COOKIE_SECRET;delete process.env.COOKIE_SECRET;try {assert.equal((await invoke(session,req('GET'))).statusCode,503);} finally {process.env.COOKIE_SECRET=old;}});
test('two browser cookies use their own keys without sharing credentials',async()=>{
 const cookieA=await register();const personB='sk-person-B-123456789';
 const b=await invoke(session,req('POST',{openai:personB,preferred:'openai'}));const seen=[];
 global.fetch=async(url,options)=>{seen.push(options.headers.Authorization || options.headers['x-goog-api-key']);return mock(200,url.includes('googleapis')?'gemini':'openai');};
 await invoke(news,req('POST',{keyword:'AI',days:3},cookieA));await invoke(news,req('POST',{keyword:'AI',days:3},b.headers['Set-Cookie'].split(';')[0]));
 assert.deepEqual(seen,[keyA,'Bearer '+personB]);
});
test('unattributed article URLs are rejected without another provider call',async()=>{
 const cookie=await register();let calls=0;
 global.fetch=async()=>{calls++;return {ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({items:[item]})}]}}]})};};
 const result=await invoke(news,req('POST',{keyword:'AI',days:3},cookie));assert.equal(result.statusCode,502);assert.equal(calls,1);
});
test('current provider key punctuation is accepted and embedded whitespace is identified by provider',async()=>{
 const dotted='sk-proj.example:key_123456789';
 const accepted=await invoke(session,req('POST',{openai:`  ${dotted}  `,preferred:'openai'}));
 assert.equal(accepted.statusCode,200);
 const stored=vault.read(req('GET',null,accepted.headers['Set-Cookie'].split(';')[0]));
 assert.equal(stored.keys.openai,dotted);
 const rejected=await invoke(session,req('POST',{gemini:'AIza test key with spaces',preferred:'gemini'}));
 assert.equal(rejected.statusCode,400);
 assert.match(rejected.data.error,/Gemini/);
});
test('either key works alone and preferred provider follows the available key',async()=>{
 let calls=[];
 global.fetch=async(url,options)=>{calls.push({url,headers:options.headers});return mock(200,url.includes('googleapis')?'gemini':'openai');};

 const geminiOnly=await invoke(session,req('POST',{gemini:keyA,preferred:'openai'}));
 assert.equal(geminiOnly.statusCode,200);
 assert.equal(geminiOnly.data.preferred,'gemini');
 let result=await invoke(news,req('POST',{keyword:'AI',days:3},geminiOnly.headers['Set-Cookie'].split(';')[0]));
 assert.equal(result.statusCode,200);
 assert.equal(result.data.provider,'gemini');
 assert.equal(calls[0].headers['x-goog-api-key'],keyA);

 calls=[];
 const openaiOnly=await invoke(session,req('POST',{openai:keyB,preferred:'gemini'}));
 assert.equal(openaiOnly.statusCode,200);
 assert.equal(openaiOnly.data.preferred,'openai');
 result=await invoke(news,req('POST',{keyword:'AI',days:3},openaiOnly.headers['Set-Cookie'].split(';')[0]));
 assert.equal(result.statusCode,200);
 assert.equal(result.data.provider,'openai');
 assert.equal(calls[0].headers.Authorization,'Bearer '+keyB);
});
test('news parser accepts strict object, raw array, fenced JSON and short wrapper text',()=>{
 const itemJson=JSON.stringify(item);
 for(const payload of [
   JSON.stringify({items:[item]}),
   `[${itemJson}]`,
   '```json\n'+JSON.stringify({items:[item]})+'\n```',
   '검색 결과입니다.\n'+JSON.stringify({items:[item]})+'\n확인했습니다.'
 ]) assert.deepEqual(providerLib.parseNews(payload),[item]);
});
test('OpenAI request uses strict structured output schema',async()=>{
 const first=await invoke(session,req('POST',{openai:keyB,preferred:'openai'}));let body;
 global.fetch=async(url,options)=>{body=JSON.parse(options.body);return mock(200,'openai');};
 const result=await invoke(news,req('POST',{keyword:'AI',days:3},first.headers['Set-Cookie'].split(';')[0]));
 assert.equal(result.statusCode,200);
 assert.equal(body.text.format.type,'json_schema');
 assert.equal(body.text.format.strict,true);
 assert.deepEqual(body.text.format.schema.required,['items']);
});
