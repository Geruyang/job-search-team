import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createBridge } from '../server.mjs';
import { request as httpRequest } from 'node:http';

const origin='chrome-extension://'+'a'.repeat(32);
const tab={id:7,url:'https://c.liepin.com/resume/edit',title:'Test resume',writeEnabled:true};
const clientId='test_client_123';

async function fixture(t, options={}) {
  const directory=await mkdtemp(path.join(os.tmpdir(),'resume-bridge-test-'));
  const bridge=await createBridge({port:0,directory,...options});
  t.after(async()=>{await bridge.close();await rm(directory,{recursive:true,force:true});});
  async function request(route,{role='controller',data,headers={},method}={}) {
    const token=role==='controller'?bridge.session.controllerToken:role==='agent'?bridge.session.extensionToken:'invalid';
    const response=await fetch(bridge.url+route,{method:method??(data===undefined?'GET':'POST'),headers:{Authorization:`Bearer ${token}`,...(data===undefined?{}:{'Content-Type':'application/json'}),...headers},body:data===undefined?undefined:JSON.stringify(data)});
    return {status:response.status,headers:response.headers,body:response.status===204?null:await response.json()};
  }
  const poll=(tabs=[tab],id=clientId)=>request('/v1/agent/poll',{role:'agent',headers:{Origin:origin},data:{clientId:id,tabs}});
  const enqueue=(command={action:'snapshot',tabId:7,expectedUrl:tab.url})=>request('/v1/commands',{data:command});
  const ack=(id,extra={})=>request('/v1/agent/result',{role:'agent',headers:{Origin:origin},data:{clientId,id,ok:true,result:{done:true},...extra}});
  return {bridge,directory,request,poll,enqueue,ack};
}

test('loopback health and pairing file expose no controller token',async t=>{
  const f=await fixture(t);
  const health=await f.request('/health',{role:'invalid'});
  assert.equal(health.status,200); assert.deepEqual(Object.keys(health.body).sort(),['ok','service','version']);
  const pairing=JSON.parse(await readFile(path.join(f.directory,'extension-pairing.json'),'utf8'));
  assert.deepEqual(Object.keys(pairing).sort(),['baseUrl','extensionToken']);
  assert.equal(pairing.extensionToken,f.bridge.session.extensionToken);
  assert.notEqual(pairing.extensionToken,f.bridge.session.controllerToken);
  const rawStatus=await new Promise((resolve,reject)=>{
    const req=httpRequest(f.bridge.url+'/health',{headers:{Host:'attacker.example'}},res=>{res.resume();resolve(res.statusCode);});
    req.on('error',reject);req.end();
  });
  assert.equal(rawStatus,403);
});

test('token roles and Origin checks deny browser websites and extension control',async t=>{
  const f=await fixture(t);
  assert.equal((await f.request('/v1/status',{role:'invalid'})).status,401);
  assert.equal((await f.request('/v1/status',{role:'agent'})).status,401);
  assert.equal((await f.request('/v1/agent/poll',{data:{clientId,tabs:[tab]},headers:{Origin:origin}})).status,401);
  assert.equal((await f.request('/v1/status',{headers:{Origin:'https://c.liepin.com'}})).status,403);
  assert.equal((await f.request('/v1/status',{headers:{Origin:origin}})).status,403);
  assert.equal((await f.request('/v1/agent/poll',{role:'agent',data:{clientId,tabs:[tab]},headers:{Origin:'https://evil.test'}})).status,403);
  const preflight=await f.request('/v1/agent/poll',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'}});
  assert.equal(preflight.status,204); assert.equal(preflight.headers.get('access-control-allow-origin'),origin);
  assert.equal((await f.request('/v1/commands',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST'}})).status,403);
});

test('commands need connected selected tabs, allowed origins, write opt-in and stale URL guards',async t=>{
  const f=await fixture(t);
  assert.equal((await f.enqueue()).status,409);
  assert.equal((await f.poll([{...tab,url:'https://evil.test'}])).status,400);
  await f.poll([{...tab,writeEnabled:false}]);
  const write={action:'fill',tabId:7,expectedUrl:tab.url,documentId:'doc1',ref:'el1',value:'Test'};
  assert.equal((await f.enqueue(write)).status,403);
  assert.equal((await f.enqueue({action:'snapshot',tabId:8})).status,409);
  assert.equal((await f.enqueue({action:'snapshot',tabId:7,expectedUrl:'https://www.liepin.com/'})).status,409);
  assert.equal((await f.enqueue({action:'eval',script:'alert(1)'})).status,400);
  assert.equal((await f.enqueue({...write,script:'alert(1)'})).status,400);
  await f.poll();
  assert.equal((await f.enqueue({...write,documentId:undefined})).status,400);
  assert.equal((await f.enqueue({...write,expectedUrl:undefined})).status,400);
  assert.equal((await f.enqueue(write)).status,202);
});

test('observed job navigation requires a successful same-tab snapshot, exact observed URL, current document and write opt-in',async t=>{
  const f=await fixture(t); await f.poll();
  const job='https://www.liepin.com/job/123456.shtml?track=1';
  const snap=(await f.enqueue({action:'snapshot',tabId:7,expectedUrl:tab.url})).body;
  await f.poll();
  await f.ack(snap.id,{result:{documentId:'doc-observed',url:tab.url,fields:[{href:job}]}});
  const nav={action:'open-observed-job',tabId:7,expectedUrl:tab.url,documentId:'doc-observed',targetUrl:job};
  assert.equal((await f.enqueue(nav)).status,202);
  for(const targetUrl of ['https://www.liepin.com/job/654321.shtml','https://www.liepin.com.attacker.example/job/123456.shtml','https://www.liepin.com/wapi/job/123456.shtml','https://www.zhipin.com/job_detail/123.html'])
    assert.equal((await f.enqueue({...nav,targetUrl})).status,403,targetUrl);
  await f.poll([{...tab,writeEnabled:false}]);
  assert.equal((await f.enqueue(nav)).status,403);
  await f.poll([{...tab,url:'https://www.zhipin.com/web/geek/jobs',writeEnabled:true}]);
  assert.equal((await f.enqueue(nav)).status,409);
});

test('observed search navigation only accepts search URLs present in that tab snapshot',async t=>{
  const f=await fixture(t); await f.poll();
  const search='https://www.liepin.com/zhaopin/?key=engineer';
  const snap=(await f.enqueue({action:'snapshot',tabId:7,expectedUrl:tab.url})).body; await f.poll();
  await f.ack(snap.id,{result:{documentId:'doc-search',url:tab.url,fields:[{href:search}]}});
  const nav={action:'open-observed-search',tabId:7,expectedUrl:tab.url,documentId:'doc-search',targetUrl:search};
  assert.equal((await f.enqueue(nav)).status,202);
  assert.equal((await f.enqueue({...nav,targetUrl:'https://www.liepin.com/account/'})).status,403);
  assert.equal((await f.enqueue({...nav,documentId:'another-document'})).status,403);
});

test('job inventory survives detail snapshots so another captured result remains navigable',async t=>{
  const f=await fixture(t);await f.poll();
  const job1='https://www.liepin.com/job/123456.shtml',job2='https://www.liepin.com/a/654321.shtml';
  const searchSnap=(await f.enqueue({action:'snapshot',tabId:7,expectedUrl:tab.url})).body;await f.poll();
  await f.ack(searchSnap.id,{result:{documentId:'search-doc',url:tab.url,fields:[{href:job1},{href:job2}]}});
  const firstNav=(await f.enqueue({action:'open-observed-job',tabId:7,expectedUrl:tab.url,documentId:'search-doc',targetUrl:job1})).body;
  assert.equal((await f.poll()).body.command.id,firstNav.id);await f.ack(firstNav.id,{result:{navigationRequested:true}});
  const detailTab={...tab,url:job1};await f.poll([detailTab]);
  const detailSnap=(await f.enqueue({action:'snapshot',tabId:7,expectedUrl:job1})).body;await f.poll([detailTab]);
  await f.ack(detailSnap.id,{result:{documentId:'detail-doc',url:job1,fields:[]}});
  assert.equal((await f.enqueue({action:'open-observed-job',tabId:7,expectedUrl:job1,documentId:'detail-doc',targetUrl:job2})).status,202);
});

test('observed URL inventory stays client and platform scoped',async t=>{
  let now=1000;const f=await fixture(t,{now:()=>now,leaseMs:100});await f.poll();
  const job='https://www.liepin.com/job/123456.shtml';
  const first=(await f.enqueue({action:'snapshot',tabId:7,expectedUrl:tab.url})).body;await f.poll();
  await f.ack(first.id,{result:{documentId:'client-a-doc',url:tab.url,fields:[{href:job}]}});
  now+=101;await f.poll([tab],'other_client_1');
  const second=(await f.enqueue({action:'snapshot',tabId:7,expectedUrl:tab.url})).body;await f.poll([tab],'other_client_1');
  await f.ack(second.id,{result:{documentId:'client-b-doc',url:tab.url,fields:[]}});
  assert.equal((await f.enqueue({action:'open-observed-job',tabId:7,expectedUrl:tab.url,documentId:'client-b-doc',targetUrl:job})).status,403);
  const boss='https://www.zhipin.com/web/geek/jobs';await f.poll([{...tab,url:boss}],'other_client_1');
  const third=(await f.enqueue({action:'snapshot',tabId:7,expectedUrl:boss})).body;await f.poll([{...tab,url:boss}],'other_client_1');
  await f.ack(third.id,{result:{documentId:'boss-doc',url:boss,fields:[]}});
  assert.equal((await f.enqueue({action:'open-observed-job',tabId:7,expectedUrl:boss,documentId:'boss-doc',targetUrl:job})).status,403);
});

test('platform inventory is capped at 2000 URLs and expires after 30 minutes',async t=>{
  let now=1000;const f=await fixture(t,{now:()=>now});await f.poll();
  let latestDoc='';
  for(let batch=0;batch<5;batch++){
    const firstId=batch*500+1,lastId=Math.min(firstId+499,2001);
    const fields=Array.from({length:lastId-firstId+1},(_,i)=>({href:`https://www.liepin.com/job/${firstId+i}.shtml`}));
    const snap=(await f.enqueue({action:'snapshot',tabId:7,expectedUrl:tab.url})).body;await f.poll();
    latestDoc=`inventory-doc-${batch}`;await f.ack(snap.id,{result:{documentId:latestDoc,url:tab.url,fields}});
  }
  const command=targetUrl=>({action:'open-observed-job',tabId:7,expectedUrl:tab.url,documentId:latestDoc,targetUrl});
  assert.equal((await f.enqueue(command('https://www.liepin.com/job/1.shtml'))).status,403);
  const lastNav=(await f.enqueue(command('https://www.liepin.com/job/2001.shtml'))).body;assert.equal(lastNav.status,'pending');
  assert.equal((await f.poll()).body.command.id,lastNav.id);await f.ack(lastNav.id,{result:{navigationRequested:true}});
  now+=30*60*1000+1;
  const refresh=(await f.enqueue({action:'snapshot',tabId:7,expectedUrl:tab.url})).body;await f.poll();
  latestDoc='fresh-after-expiry';await f.ack(refresh.id,{result:{documentId:latestDoc,url:tab.url,fields:[]}});
  assert.equal((await f.enqueue(command('https://www.liepin.com/job/2001.shtml'))).status,403);
});

test('a selected same-platform tab can reuse a search URL observed by this client on another tab',async t=>{
  const f=await fixture(t);const targetTab={...tab,id:8,url:'https://c.liepin.com/resume/edit?tab=hr'};await f.poll([tab,targetTab]);
  const search='https://www.liepin.com/zhaopin/?key=engineer';
  const first=(await f.enqueue({action:'snapshot',tabId:7,expectedUrl:tab.url})).body;await f.poll([tab,targetTab]);
  await f.ack(first.id,{result:{documentId:'search-doc',url:tab.url,fields:[{href:search}]}});
  const second=(await f.enqueue({action:'snapshot',tabId:8,expectedUrl:targetTab.url})).body;await f.poll([tab,targetTab]);
  await f.ack(second.id,{result:{documentId:'hr-doc',url:targetTab.url,fields:[]}});
  assert.equal((await f.enqueue({action:'open-observed-search',tabId:8,expectedUrl:targetTab.url,documentId:'hr-doc',targetUrl:search})).status,202);
});

test('cv.zhipin.com is allowed while lookalike hosts are rejected',async t=>{
  const f=await fixture(t);
  const cvTab={...tab,url:'https://cv.zhipin.com/edit-resume'};
  assert.equal((await f.poll([cvTab])).status,200);
  assert.equal((await f.enqueue({action:'snapshot',tabId:7,expectedUrl:cvTab.url})).status,202);
  await f.poll();
  assert.equal((await f.poll([{...cvTab,url:'https://cv.zhipin.com.attacker.example/edit-resume'}])).status,400);
  assert.equal((await f.enqueue({action:'snapshot',tabId:7,expectedUrl:'https://cv.zhipin.com.attacker.example/edit-resume'})).status,400);
});

test('at-most-once dispatch, per-tab FIFO, concurrent tabs and idempotent acknowledgements',async t=>{
  const f=await fixture(t); const tabs=[tab,{...tab,id:8}]; await f.poll(tabs);
  const one=(await f.enqueue()).body;
  const two=(await f.enqueue()).body;
  const three=(await f.enqueue({action:'snapshot',tabId:8})).body;
  assert.equal((await f.poll(tabs)).body.command.id,one.id);
  assert.equal((await f.poll(tabs)).body.command.id,three.id);
  assert.equal((await f.poll(tabs)).body.command,null);
  assert.equal((await f.ack(one.id)).status,200);
  assert.equal((await f.ack(one.id)).body.duplicate,true);
  assert.equal((await f.ack(one.id,{result:{changed:true}})).status,409);
  assert.equal((await f.poll(tabs)).body.command.id,two.id);
  const result=(await f.request('/v1/results/'+one.id)).body;
  assert.equal(result.status,'succeeded');assert.deepEqual(result.result,{done:true});
  assert.equal(result.value,undefined);
});

test('dispatch rechecks deselection and write toggle',async t=>{
  const f=await fixture(t);await f.poll();
  const c=(await f.enqueue({action:'click',tabId:7,expectedUrl:tab.url,documentId:'doc1',ref:'el1'})).body;
  assert.equal((await f.poll([{...tab,writeEnabled:false}])).body.command,null);
  assert.equal((await f.request('/v1/results/'+c.id)).body.status,'failed');
  await f.poll();const c2=(await f.enqueue()).body;
  assert.equal((await f.poll([])).body.command,null);
  assert.equal((await f.request('/v1/results/'+c2.id)).body.status,'failed');
});

test('dispatched expiry never retries and holds lock until late acknowledgement',async t=>{
  let now=1000;const f=await fixture(t,{now:()=>now});await f.poll();
  const first=(await f.enqueue({action:'snapshot',tabId:7,timeoutMs:100})).body;
  const second=(await f.enqueue()).body;
  assert.equal((await f.poll()).body.command.id,first.id);
  now+=101;
  assert.equal((await f.poll()).body.command,null);
  assert.equal((await f.request('/v1/results/'+first.id)).body.status,'expired');
  assert.equal((await f.ack(first.id)).body.status,'expired');
  assert.equal((await f.ack(first.id)).body.duplicate,true);
  assert.equal((await f.poll()).body.command.id,second.id);
});

test('client leases isolate queues and reject simultaneous clients',async t=>{
  let now=1000;const f=await fixture(t,{now:()=>now,leaseMs:100});await f.poll();
  const pending=(await f.enqueue()).body;
  assert.equal((await f.poll([tab],'other_client_1')).status,409);
  now+=101;
  assert.equal((await f.poll([tab],'other_client_1')).status,200);
  assert.equal((await f.request('/v1/results/'+pending.id)).body.status,'failed');
  assert.equal((await f.poll([tab],'other_client_1')).body.command,null);
});

test('unacknowledged commands prevent a replacement client from taking ownership',async t=>{
  let now=1000;const f=await fixture(t,{now:()=>now,leaseMs:100});await f.poll();
  await f.enqueue();await f.poll();now+=101;
  assert.equal((await f.poll([tab],'other_client_1')).status,409);
});
