'use strict';
const $ = id => document.getElementById(id);
const selected = new Map();
const seenTabs = new Set();
let pairing = null;
let connected = false;
let loopGeneration = 0;
const clientId = crypto.randomUUID();
const lines = [];
const localStore = () => globalThis.chrome?.storage?.local;
async function trustedStore() {
  const store = localStore();
  if (!store || typeof store.setAccessLevel !== 'function') return null;
  await store.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
  return store;
}
const allowed = url => { try { const u = new URL(url); return u.protocol === 'https:' && !u.username && !u.password && !u.port && ['www.liepin.com','c.liepin.com','www.zhipin.com','cv.zhipin.com'].includes(u.hostname); } catch { return false; } };
function log(message) { lines.push(`${new Date().toLocaleTimeString()} ${message}`); if (lines.length > 40) lines.shift(); $('events').textContent = lines.join('\n'); }
function stop() { connected = false; loopGeneration++; $('connection').textContent = '已停止领取任务'; $('connect').disabled = !pairing; $('disconnect').disabled = true; }
async function api(path, data) {
  const response = await fetch(pairing.baseUrl + path, {method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${pairing.extensionToken}`},body:JSON.stringify(data),signal:AbortSignal.timeout(8000),credentials:'omit',redirect:'error',cache:'no-store'});
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
  return json;
}
async function tabMetadata() {
  const result = [];
  for (const [id, permission] of selected) {
    try { const tab = await chrome.tabs.get(id); if (allowed(tab.url)) result.push({id,url:tab.url,title:tab.title||'',writeEnabled:permission.writeEnabled}); else selected.delete(id); }
    catch { selected.delete(id); }
  }
  return result;
}
async function discoverTabs() {
  const tabs = await chrome.tabs.query({url:['https://www.liepin.com/*','https://c.liepin.com/*','https://www.zhipin.com/*','https://cv.zhipin.com/*']});
  for (const tab of tabs.filter(t=>allowed(t.url))) {
    if (!seenTabs.has(tab.id)) { seenTabs.add(tab.id); selected.set(tab.id,{writeEnabled:true}); }
  }
  return tabs.filter(t=>allowed(t.url));
}
async function refreshTabs() {
  const tabs = await discoverTabs();
  const root = $('tabs'); root.replaceChildren();
  for (const tab of tabs.filter(t=>allowed(t.url))) {
    const row = document.createElement('div'); row.className = 'tab';
    const title = document.createElement('strong'); title.textContent = `${tab.title||'网页'} · 标签 ${tab.id}`;
    const url = document.createElement('p'); url.textContent = tab.url;
    const controls = document.createElement('div'); controls.className='checks';
    const claim = document.createElement('input'); claim.type='checkbox'; claim.checked=selected.has(tab.id);
    const write = document.createElement('input'); write.type='checkbox'; write.checked=selected.get(tab.id)?.writeEnabled===true; write.disabled=!claim.checked;
    const claimLabel = document.createElement('label'); claimLabel.append(claim,'允许读取');
    const writeLabel = document.createElement('label'); writeLabel.append(write,'允许操作（填写、点击、导航、刷新）');
    claim.addEventListener('change',()=>{ if(claim.checked) selected.set(tab.id,{writeEnabled:false}); else selected.delete(tab.id); write.checked=false; write.disabled=!claim.checked; });
    write.addEventListener('change',()=>{ if(selected.has(tab.id)) selected.set(tab.id,{writeEnabled:write.checked}); });
    controls.append(claimLabel,writeLabel); row.append(title,url,controls); root.append(row);
  }
  if (!root.children.length) root.textContent='没有可选页面。请在这个浏览器中手动打开猎聘或 BOSS。';
}
async function execute(command, generation) {
  if (!connected || generation !== loopGeneration || Date.now() >= command.expiresAt) throw new Error('任务已停止或过期，未执行');
  if (command.action === 'tabs') return {tabs:await tabMetadata()};
  const permission = selected.get(command.tabId);
  if (!permission) throw new Error('该标签未获控制面板授权');
  const tab = await chrome.tabs.get(command.tabId);
  if (!allowed(tab.url)) throw new Error('该页面不在站点范围内');
  if (command.expectedUrl && tab.url !== command.expectedUrl) throw new Error('页面地址已变化，请重新读取');
  if (!['snapshot','screenshot'].includes(command.action) && !permission.writeEnabled) throw new Error('该标签当前只读');
  if (command.action === 'open-observed-job' || command.action === 'open-observed-search') {
    await chrome.scripting.executeScript({target:{tabId:command.tabId},files:['content.js'],world:'ISOLATED'});
    if (!connected || generation !== loopGeneration || Date.now() >= command.expiresAt || !selected.get(command.tabId)?.writeEnabled) throw new Error('导航前任务或操作权限已撤销');
    const before=await chrome.tabs.sendMessage(command.tabId,{type:'resume-bridge-command',command:{action:'snapshot'}});
    if(!before?.ok || before.result.documentId!==command.documentId || before.result.url!==command.expectedUrl) throw new Error('文档已变化，拒绝导航');
    const current=await chrome.tabs.get(command.tabId);
    if(!connected || generation!==loopGeneration || Date.now()>=command.expiresAt || !selected.get(command.tabId)?.writeEnabled || current.url!==command.expectedUrl) throw new Error('导航前页面、任务或操作权限已变化');
    await chrome.tabs.update(command.tabId,{url:command.targetUrl});
    return {navigationRequested:true,targetUrl:command.targetUrl,note:'正常标签页导航已请求；请对新页面重新 snapshot 验证职位信息。'};
  }
  await chrome.scripting.executeScript({target:{tabId:command.tabId},files:['content.js'],world:'ISOLATED'});
  if (!connected || generation !== loopGeneration || Date.now() >= command.expiresAt || !selected.has(command.tabId)) throw new Error('任务已停止、撤销或过期');
  if (!['snapshot','screenshot'].includes(command.action) && !selected.get(command.tabId).writeEnabled) throw new Error('操作权限已撤销');
  if (command.action === 'screenshot') {
    // Only activate a selected recruiting page after verifying its current document.
    // No window focusing or navigation is needed for captureVisibleTab.
    const initial=await chrome.tabs.sendMessage(command.tabId,{type:'resume-bridge-command',command:{action:'snapshot'}});
    const candidate=await chrome.tabs.get(command.tabId);
    if(!initial?.ok || initial.result.documentId!==command.documentId || initial.result.url!==command.expectedUrl || candidate.url!==command.expectedUrl || candidate.windowId!==tab.windowId) throw new Error('切换前页面或文档已变化');
    if(!selected.has(command.tabId) || !connected || generation!==loopGeneration || Date.now()>=command.expiresAt) throw new Error('切换前读取权限、连接或任务状态已变化');
    if(!candidate.active) await chrome.tabs.update(command.tabId,{active:true});
    // captureVisibleTab captures whichever tab is active, so discard the image on any
    // activation/navigation/focus change even if the original tab is restored later.
    const targetWindowId=tab.windowId;
    let changed=false;
    const onActive=info=>{if(info.windowId===targetWindowId)changed=true;};
    const onUpdate=(id,info)=>{if(id===command.tabId && (info.url!==undefined || info.status==='loading'))changed=true;};
    const onRemove=id=>{if(id===command.tabId)changed=true;};
    const onFocus=()=>{changed=true;};
    chrome.tabs.onActivated.addListener(onActive); chrome.tabs.onUpdated.addListener(onUpdate);
    chrome.tabs.onRemoved.addListener(onRemove); chrome.windows.onFocusChanged.addListener(onFocus);
    try {
      const before=await chrome.tabs.sendMessage(command.tabId,{type:'resume-bridge-command',command:{action:'snapshot'}});
      const current=await chrome.tabs.get(command.tabId);
      if(!before?.ok || before.result.documentId!==command.documentId || before.result.url!==command.expectedUrl || current.url!==command.expectedUrl) throw new Error('截图前页面或文档已变化');
      if(!current.active || current.windowId!==targetWindowId) throw new Error('截图前目标标签未在指定窗口处于活动状态');
      if(changed) throw new Error('截图准备期间标签、页面或窗口焦点发生变化');
      if(!selected.has(command.tabId) || !connected || generation!==loopGeneration || Date.now()>=command.expiresAt) throw new Error('截图前读取权限、连接或任务状态已变化');
      const beforeWindow=await chrome.windows.get(targetWindowId);
      let image;
      let captureTimer;
      try {
        const timeout=new Promise((_,reject)=>{captureTimer=setTimeout(()=>reject(new Error('浏览器截图接口超时，未取得图片')),10000);});
        image=await Promise.race([chrome.tabs.captureVisibleTab(targetWindowId,{format:'jpeg',quality:65}),timeout]);
      }
      catch (error) {
        // Browser failures can also be caused by unsupported APIs or platform limits.
        // Keep a bounded diagnostic without exposing page URLs or claiming a cause.
        const detail=String(error?.message || error || '浏览器未提供错误详情')
          .replace(/(?:https?|chrome-extension):\/\/\S+/gi,'[地址已隐藏]')
          .replace(/[\r\n\t]+/g,' ').slice(0,300);
        throw new Error(`浏览器截图调用失败：${detail}`);
      }
      finally { clearTimeout(captureTimer); }
      const after=await chrome.tabs.get(command.tabId);
      const afterWindow=await chrome.windows.get(targetWindowId);
      const afterDoc=await chrome.tabs.sendMessage(command.tabId,{type:'resume-bridge-command',command:{action:'snapshot'}});
      if(changed || beforeWindow.state!==afterWindow.state || !after.active || after.windowId!==targetWindowId || after.url!==command.expectedUrl || !afterDoc?.ok || afterDoc.result.documentId!==command.documentId || afterDoc.result.url!==command.expectedUrl || !selected.has(command.tabId) || !connected || generation!==loopGeneration || Date.now()>=command.expiresAt) throw new Error('截图期间页面、焦点、窗口状态或读取权限已变化，已丢弃截图');
      if(typeof image!=='string' || !image.startsWith('data:image/jpeg;base64,') || image.length>3*1024*1024) throw new Error('截图无效或过大');
      const windowState=afterWindow.state || 'unknown';
      const freshnessUnverified=windowState==='minimized' || windowState==='unknown';
      const note=freshnessUnverified?'窗口最小化或状态未知，图像可能滞后，不能单凭截图确认弹窗或发送结果；请核对页面当前状态。':'仅为目标标签当前可见区域，截图新鲜度仍需与页面交叉核对。';
      return {image,url:command.expectedUrl,documentId:command.documentId,windowState,freshnessUnverified,note};
    } finally {
      chrome.tabs.onActivated.removeListener(onActive); chrome.tabs.onUpdated.removeListener(onUpdate);
      chrome.tabs.onRemoved.removeListener(onRemove); chrome.windows.onFocusChanged.removeListener(onFocus);
    }
  }
  if (command.action === 'activate') {
    const before = await chrome.tabs.sendMessage(command.tabId,{type:'resume-bridge-command',command:{action:'snapshot'}});
    if (!before?.ok || before.result.documentId !== command.documentId || before.result.url !== command.expectedUrl) throw new Error('文档已变化，拒绝切换');
    const current = await chrome.tabs.get(command.tabId);
    if (!connected || generation !== loopGeneration || Date.now() >= command.expiresAt || !selected.get(command.tabId)?.writeEnabled || current.url !== command.expectedUrl) throw new Error('切换前页面、任务或操作权限已变化');
    await chrome.tabs.update(command.tabId,{active:true});
    await chrome.windows.update(current.windowId,{focused:true});
    const after = await chrome.tabs.get(command.tabId);
    return {activated:after.active === true, note:'已请求切换到现有标签及其窗口；请重新读取页面。'};
  }
  if(command.action==='reload') {
    const before = await chrome.tabs.sendMessage(command.tabId,{type:'resume-bridge-command',command:{action:'snapshot'}});
    if(!before.ok || before.result.documentId!==command.documentId || before.result.url!==command.expectedUrl) throw new Error('文档已变化，拒绝刷新');
    if(!connected || generation!==loopGeneration || !selected.get(command.tabId)?.writeEnabled || Date.now()>=command.expiresAt) throw new Error('刷新前任务或操作权限已撤销');
    await chrome.tabs.reload(command.tabId); return {reloadRequested:true};
  }
  const response = await chrome.tabs.sendMessage(command.tabId,{type:'resume-bridge-command',command});
  if(!response?.ok) throw new Error(response?.error?.message || response?.error || '网页未返回结果');
  return response.result;
}
async function pollLoop(generation) {
  let lastError = '';
  while(connected && generation === loopGeneration) {
    try {
      const beforeCount = seenTabs.size;
      await discoverTabs();
      if (seenTabs.size !== beforeCount) await refreshTabs();
      const {command} = await api('/v1/agent/poll',{clientId,tabs:await tabMetadata()});
      $('connection').textContent=`已连接 · 已授权 ${selected.size} 个标签页`;
      lastError = '';
      if(command) {
        let result;
        try { result={clientId,id:command.id,ok:true,result:await execute(command,generation)}; }
        catch(error) { result={clientId,id:command.id,ok:false,error:String(error.message).slice(0,400)}; }
        // Retrying delivery of a result is safe; never retry the browser operation.
        let delivered=false;
        for(let attempt=0;attempt<3;attempt++){try{await api('/v1/agent/result',result);delivered=true;break;}catch(error){if(attempt===2)log('结果回传失败；请核对页面后再安排后续任务');}}
        log(`${command.action} · ${result.ok?'已执行':'失败'}${delivered?'':' · 回传未确认'}`);
        if(!delivered) stop();
      }
    } catch(error) {
      const message=String(error.message);
      $('connection').textContent='等待本机服务：'+message;
      if (message !== lastError) { log('连接异常，稍后自动重试：'+message.slice(0,150)); lastError=message; }
      if (connected && generation === loopGeneration) await new Promise(resolve=>setTimeout(resolve,3000));
    }
    if(connected && generation === loopGeneration) await new Promise(resolve=>setTimeout(resolve,1000));
  }
}
$('pairFile').addEventListener('change',async event=>{
  stop();
  try {
    const file=event.target.files[0]; if(!file || file.size>8192) throw new Error('请选择有效配对文件');
    const data=JSON.parse(await file.text()); const url=new URL(data.baseUrl);
    if(url.protocol!=='http:' || url.hostname!=='127.0.0.1' || url.username || url.password || url.pathname!=='/' || url.search || url.hash) throw new Error('仅支持127.0.0.1本机地址');
    if(typeof data.extensionToken!=='string'||!/^[a-f0-9]{64}$/.test(data.extensionToken)) throw new Error('配对密钥无效');
    pairing={baseUrl:url.origin,extensionToken:data.extensionToken};
    let saved=false;
    try { const store=await trustedStore(); if(store) {await store.set({pairing}); saved=true;} }
    catch(error) { log('本地存储不可用，使用本次会话连接：'+String(error.message).slice(0,150)); }
    $('pairStatus').textContent=saved?'配对信息已保存到本机扩展存储，后续自动连接':'本次连接可用；扩展存储不可用，重新加载扩展并确认 storage 权限后可启用自动恢复';
    $('connect').disabled=false; $('connect').click();
  }catch(error){pairing=null;$('pairStatus').textContent=error.message;$('connect').disabled=true;}
});
$('connect').addEventListener('click',()=>{if(!pairing||connected)return;connected=true;const generation=++loopGeneration;$('connect').disabled=true;$('disconnect').disabled=false;log('开始本机连接');pollLoop(generation);});
$('disconnect').addEventListener('click',stop);
$('forget').addEventListener('click',async()=>{stop();pairing=null;try{const store=localStore();if(store)await store.remove('pairing');$('pairStatus').textContent='已移除本次及已保存的配对信息';}catch(error){$('pairStatus').textContent='本次连接已清除，但保存的配对信息未能移除，请检查扩展存储权限';} $('connect').disabled=true;});
$('refresh').addEventListener('click',()=>refreshTabs().catch(error=>log(error.message)));
window.addEventListener('pagehide',stop);
async function autoConnect() {
  try {
    const store=await trustedStore();
    if(!store) { $('pairStatus').textContent='扩展存储不可用：请重新加载扩展；也可先导入文件进行本次连接'; await refreshTabs(); return; }
    const saved = (await store.get('pairing')).pairing;
    if (!saved) { $('pairStatus').textContent='首次使用请导入配对文件；后续会自动连接'; await refreshTabs(); return; }
    const url = new URL(saved.baseUrl);
    if(url.protocol!=='http:' || url.hostname!=='127.0.0.1' || url.username || url.password || url.pathname!=='/' || url.search || url.hash || !/^[a-f0-9]{64}$/.test(saved.extensionToken)) throw new Error('已保存的配对信息无效');
    pairing={baseUrl:url.origin,extensionToken:saved.extensionToken};
    $('pairStatus').textContent='已从本机扩展存储恢复配对信息';
    $('connect').disabled=false;
    await refreshTabs();
    $('connect').click();
  } catch(error) {
    $('pairStatus').textContent='自动连接失败，请检查本机服务或重新导入配对文件';
    log('自动连接失败：'+String(error.message).slice(0,200));
    await refreshTabs();
  }
}
autoConnect().catch(error=>log(error.message));
