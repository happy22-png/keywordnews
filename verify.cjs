const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const nodes = new Map();
function node(id) {
  if (!nodes.has(id)) nodes.set(id, {value: id === 'dateRangeSelect' ? '3' : '', checked: true, disabled: false, innerHTML: '', textContent: '', style: {}, classList: {add(){},remove(){},toggle(){}}, appendChild(){}, addEventListener(){}, remove(){}});
  return nodes.get(id);
}
const storage = new Map();
let calls = 0, mode = 'ok', release;
const context = vm.createContext({console, URL, AbortController, setTimeout, clearTimeout,
 window: {addEventListener(){}},
 localStorage: {getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},
 document: {getElementById:node,querySelectorAll:()=>[node('searchBtn'),node('dateRangeSelect')],createElement:()=>node(Symbol()),body:{appendChild(){}}},
 fetch: async () => {calls++; if (mode === 'pending') await new Promise(r=>release=r); return {ok: mode === 'ok' || mode === 'pending', status: mode === '429' ? 429 : 401, headers: {get:()=>null}, json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify([{title:'기사',snippet:'요약',publisher:'출처',date:'2026-09-23',url:'https://example.com'}])}]}}],usageMetadata:{totalTokenCount:100}})};}
});
vm.runInContext(script, context);
const run = code => vm.runInContext(code, context);
(async()=>{
 run('loadFromStorage(); renderSavedNews()'); assert.equal(calls,0);
 await run('fetchAllNews()'); assert.equal(calls,0, 'missing key must never call API');
 run("appState.apiKey='test';");
 await run('fetchAllNews()'); assert.equal(calls,3);
 await run('fetchAllNews()'); assert.equal(calls,3, 'warm cache');
 run('renderSavedNews(); openSettingsModal(); draftKeywords.push("new"); closeSettingsModal()');
 assert.equal(run('appState.keywords.length'),3,'cancel must discard draft');
 run('openSettingsModal(); saveSettings()'); assert.equal(calls,3,'save must not fetch');
 run("appState.keywords.push('new')"); await run('fetchAllNews()'); assert.equal(calls,4,'only new keyword fetches');
 run('Object.values(newsCache).forEach(e=>e.savedAt=Date.now()-CACHE_TTL-1)');
 mode='pending'; const pending=run('fetchAllNews()'); await run('fetchAllNews()'); assert.equal(calls,5,'single flight');
 mode='ok'; release(); await pending; assert.equal(calls,8);
 node('dateRangeSelect').value='7'; mode='401'; await run('fetchAllNews()'); assert.equal(calls,9,'401 stops run without retry');
 assert.equal(node('searchBtn').disabled,false,'controls restored');
 mode='429'; await run('fetchAllNews()'); assert.equal(calls,10); await run('fetchAllNews()'); assert.equal(calls,10,'429 cooldown');
 assert.equal(run("filterDuplicates([{title:'same'},{title:'same'}], []).length"),1);
 console.log('PASS: no automatic calls, key guard, cache reuse, settings cancellation, incremental keywords, expiry, single flight, error stop, cooldown, deduplication');
})().catch(e=>{console.error(e);process.exitCode=1});
