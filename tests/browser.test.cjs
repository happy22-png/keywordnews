const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
function setup(){
 const nodes=new Map(),storage=new Map([['briefing_api_key','legacy-key']]),calls=[];
 function node(id){if(!nodes.has(id))nodes.set(id,{value:id==='dateRangeSelect'?'3':id==='preferredProvider'?'gemini':'',checked:id==='dedupToggle',disabled:false,innerHTML:'',textContent:'',style:{},classList:{add(){},remove(){},toggle(){}},appendChild(){},addEventListener(){},setAttribute(){},remove(){}});return nodes.get(id);}
 const context=vm.createContext({console,URL,location:{protocol:'https:'},setTimeout:()=>0,clearTimeout(){},window:{addEventListener(){}},
 localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
 document:{getElementById:node,querySelectorAll:()=>[node('searchBtn')],createElement:()=>node(Symbol()),body:{appendChild(){}}},
 fetch:async(path,options)=>{calls.push({path,options});return {ok:true,json:async()=>path==='/api/session'?{gemini:true,openai:true,preferred:'gemini'}:{items:[],provider:'openai',switched:true,sources:[],tokens:50,attempts:['gemini','openai']}};}});
 vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],context);
 return {run:s=>vm.runInContext(s,context),node,storage,calls,context};
}
test('no provider access at startup; legacy plaintext removed; cache, counters and settings do not trigger model calls',async()=>{
 const t=setup();t.run('loadFromStorage();renderSavedNews()');assert.equal(t.calls.length,0);assert.equal(t.storage.has('briefing_api_key'),false);
 await t.run('refreshCredentials()');await t.run('fetchAllNews()');assert.equal(t.calls.filter(c=>c.path==='/api/news').length,3);assert.match(t.node('usageStatus').textContent,/API 호출 6회/);
 await t.run('fetchAllNews()');assert.equal(t.calls.filter(c=>c.path==='/api/news').length,3);
 t.run('openSettingsModal()');t.node('geminiKey').value='AIza-test-new-key';t.node('openaiKey').value='sk-test-new-key';
 await t.run('saveSettings()');assert.equal(t.node('geminiKey').value,'');assert.equal(t.node('openaiKey').value,'');
 assert.ok(![...t.storage.values()].join().includes('test-new-key'));assert.equal(t.calls.filter(c=>c.path==='/api/news').length,3);
 assert.ok(t.calls.every(c=>c.path.startsWith('/api/')));
});
test('cancel discards draft and entered credentials; duplicate clicks use single flight',async()=>{
 const t=setup();await t.run('refreshCredentials()');t.run('openSettingsModal();draftKeywords.push("new")');t.node('openaiKey').value='private-key';t.run('closeSettingsModal()');assert.equal(t.run('appState.keywords.length'),3);assert.equal(t.node('openaiKey').value,'');
 let finish,calls=0;t.context.fetch=async()=>{calls++;if(calls===1) await new Promise(r=>finish=r);return {ok:true,json:async()=>({items:[],provider:'gemini',sources:[],tokens:1,attempts:['gemini']})};};
 const first=t.run('fetchAllNews()');await t.run('fetchAllNews()');assert.equal(calls,1);finish();await first;assert.equal(calls,3);assert.equal(t.node('searchBtn').disabled,false);
});
test('failed request stops remaining requests; usage counts fallback attempts once',async()=>{
 const t=setup();await t.run('refreshCredentials()');let calls=0;t.context.fetch=async()=>{calls++;return {ok:false,status:429,json:async()=>({error:'대기',retryAfter:120000,attempts:['gemini','openai']})};};
 await t.run('fetchAllNews()');assert.equal(calls,1);assert.match(t.node('usageStatus').textContent,/API 호출 2회/);await t.run('fetchAllNews()');assert.equal(calls,1);
});
