import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const root=new URL('../',import.meta.url);
const source=await readFile(new URL('extension/control.js',root),'utf8');
function fixture(){
  const nodes=new Map();
  const node=()=>({children:[],handlers:{},addEventListener(type,handler){this.handlers[type]=handler;},replaceChildren(){this.children=[];},append(...items){this.children.push(...items);},textContent:''});
  const calls=[];
  const tab={id:7,url:'https://c.liepin.com/resume/edit',title:'Resume'};
  const chrome={tabs:{query:async()=>[],get:async()=>tab,sendMessage:async(id,message)=>{calls.push(message);return {ok:true,result:{documentId:'doc1',url:tab.url,text:'fixture'}};},reload:async()=>calls.push('reload'),update:async(id,properties)=>{calls.push({update:properties});tab.url=properties.url;return tab;}},scripting:{executeScript:async()=>calls.push('inject')}};
  const context=vm.createContext({document:{getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},createElement:node},window:{addEventListener(){}},chrome,crypto:{randomUUID},URL,Date,Map,Promise,setTimeout,AbortSignal,fetch:async()=>{throw new Error('Unexpected network request');}});
  vm.runInContext(source,context);
  vm.runInContext("connected=true; loopGeneration=1; selected.set(7,{writeEnabled:false});",context);
  return {context,tab,calls,chrome,run:command=>{context.testCommand=command;return vm.runInContext('execute(testCommand,1)',context);}};
}
const command=action=>({action,tabId:7,expectedUrl:'https://c.liepin.com/resume/edit',documentId:'doc1',ref:'1:1',expiresAt:Date.now()+5000});
test('manifest does not request debugger, tabs, history, cookies, or all-sites access',async()=>{
 const manifest=JSON.parse(await readFile(new URL('extension/manifest.json',root),'utf8'));
 assert.deepEqual(manifest.permissions,['scripting','storage']);
  assert.equal(manifest.host_permissions.length,5);
  assert(manifest.host_permissions.includes('https://cv.zhipin.com/*'));
 assert.ok(!manifest.host_permissions.includes('<all_urls>'));
});
test('read-only selection permits snapshot and blocks mutation before injection',async()=>{
 const f=fixture();await f.run(command('snapshot'));const n=f.calls.length;
 await assert.rejects(f.run(command('fill')),/只读/);assert.equal(f.calls.length,n);
});
test('old loop generation, expired command, and changed URL never execute',async()=>{
 const f=fixture();await assert.rejects(f.run({...command('snapshot'),expiresAt:0}),/过期/);
 f.tab.url='https://c.liepin.com/account';await assert.rejects(f.run(command('snapshot')),/地址已变化/);
 f.tab.url='https://c.liepin.com/resume/edit';vm.runInContext('loopGeneration=2',f.context);await assert.rejects(f.run(command('snapshot')),/停止/);assert.equal(f.calls.length,0);
});
test('permission revoked during injection prevents DOM operation',async()=>{
 const f=fixture();vm.runInContext('selected.get(7).writeEnabled=true',f.context);
 f.chrome.scripting.executeScript=async()=>{vm.runInContext('selected.get(7).writeEnabled=false',f.context);};
 await assert.rejects(f.run(command('click')),/撤销/);assert.equal(f.calls.length,0);
});
test('content errors retain their useful message',async()=>{
 const f=fixture();f.chrome.tabs.sendMessage=async()=>({ok:false,error:{code:'STALE_REF',message:'Take a fresh snapshot'}});
 await assert.rejects(f.run(command('snapshot')),/Take a fresh snapshot/);
});
test('reload verifies document and does not reload a replaced document',async()=>{
 const f=fixture();vm.runInContext('selected.get(7).writeEnabled=true',f.context);
 await assert.rejects(f.run({...command('reload'),documentId:'old'}),/文档已变化/);
 assert.ok(!f.calls.includes('reload'));
 await f.run(command('reload'));assert.ok(f.calls.includes('reload'));
});
test('observed navigation snapshots and guards the document before normal tab update',async()=>{
 const f=fixture();vm.runInContext('selected.get(7).writeEnabled=true',f.context);
 const target='https://www.liepin.com/job/123.shtml';
 await f.run({...command('open-observed-job'),targetUrl:target});
 assert.ok(f.calls.some(call=>call?.type==='resume-bridge-command'&&call.command.action==='snapshot'));
 assert.equal(f.calls.find(call=>call?.update)?.update.url,target);
});
test('observed navigation refuses stale document and permission revoked during verification',async()=>{
 const target='https://www.liepin.com/job/123.shtml';
 const stale=fixture();vm.runInContext('selected.get(7).writeEnabled=true',stale.context);
 stale.chrome.tabs.sendMessage=async()=>({ok:true,result:{documentId:'other',url:stale.tab.url}});
 await assert.rejects(stale.run({...command('open-observed-job'),targetUrl:target}),/文档已变化/);
 assert.equal(stale.calls.some(call=>call?.update),false);
 const revoked=fixture();vm.runInContext('selected.get(7).writeEnabled=true',revoked.context);
 revoked.chrome.tabs.sendMessage=async()=>{vm.runInContext('selected.get(7).writeEnabled=false',revoked.context);return {ok:true,result:{documentId:'doc1',url:revoked.tab.url}};};
 await assert.rejects(revoked.run({...command('open-observed-job'),targetUrl:target}),/权限/);
 assert.equal(revoked.calls.some(call=>call?.update),false);
});

test('new eligible tabs are enabled once and manual revocation stays effective',async()=>{
 const f=fixture();
 f.chrome.tabs.query=async()=>[{id:8,url:'https://www.zhipin.com/web/geek/jobs'},{id:9,url:'https://evil.example/'}];
 await vm.runInContext('discoverTabs()',f.context);
 assert.equal(vm.runInContext('selected.get(8).writeEnabled',f.context),true);
 assert.equal(vm.runInContext('selected.has(9)',f.context),false);
 vm.runInContext('selected.get(8).writeEnabled=false',f.context);
 await vm.runInContext('discoverTabs()',f.context);
 assert.equal(vm.runInContext('selected.get(8).writeEnabled',f.context),false);
 vm.runInContext('selected.delete(8)',f.context);
 await vm.runInContext('discoverTabs()',f.context);
 assert.equal(vm.runInContext('selected.has(8)',f.context),false);
});

test('saved pairing restores locally and starts connection without reading a public endpoint',async()=>{
 const f=fixture(); await new Promise(resolve=>setImmediate(resolve));
 const saved={baseUrl:'http://127.0.0.1:17373',extensionToken:'a'.repeat(64)};
 let trusted=false, clicked=false;
 f.chrome.storage={local:{setAccessLevel:async(v)=>{trusted=v.accessLevel==='TRUSTED_CONTEXTS'},get:async()=>({pairing:saved})}};
 f.context.document.getElementById('connect').click=()=>{clicked=true};
 await vm.runInContext('autoConnect()',f.context);
 assert.equal(trusted,true);assert.equal(clicked,true);
 assert.equal(vm.runInContext('pairing.baseUrl',f.context),saved.baseUrl);
 assert.equal(vm.runInContext('pairing.extensionToken',f.context),saved.extensionToken);
});
test('invalid persisted pairing is not used to connect',async()=>{
 const f=fixture(); await new Promise(resolve=>setImmediate(resolve));
 let clicked=false;f.context.document.getElementById('connect').click=()=>{clicked=true};
 f.chrome.storage={local:{setAccessLevel:async()=>{},get:async()=>({pairing:{baseUrl:'https://example.com',extensionToken:'a'.repeat(64)}})}};
 await vm.runInContext('autoConnect()',f.context);
 assert.equal(clicked,false);
});

test('missing storage still permits importing pairing for current session',async()=>{
 const f=fixture(); await new Promise(resolve=>setImmediate(resolve));
 let clicked=false; f.context.document.getElementById('connect').click=()=>{clicked=true};
 const payload=JSON.stringify({baseUrl:'http://127.0.0.1:17373',extensionToken:'a'.repeat(64)});
 const pairFile=f.context.document.getElementById('pairFile');
 await pairFile.handlers.change({target:{files:[{size:payload.length,text:async()=>payload}]}});
 assert.equal(clicked,true);
 assert.equal(vm.runInContext('pairing.extensionToken',f.context),'a'.repeat(64));
 assert.match(f.context.document.getElementById('pairStatus').textContent,/本次连接可用/);
});
test('missing storage startup reports reload guidance without leaking raw TypeError',async()=>{
 const f=fixture(); await vm.runInContext('autoConnect()',f.context);
 assert.match(f.context.document.getElementById('pairStatus').textContent,/扩展存储不可用/);
 assert.doesNotMatch(f.context.document.getElementById('pairStatus').textContent,/undefined/);
});
