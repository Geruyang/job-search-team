import http from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ACTIONS = new Set(['tabs', 'snapshot', 'screenshot', 'click', 'fill', 'select', 'scroll', 'reload', 'activate', 'open-observed-job', 'open-observed-search']);
const WRITES = new Set(['click', 'fill', 'select', 'scroll', 'reload', 'activate', 'open-observed-job', 'open-observed-search']);
const ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;
const MAX_BODY = 512 * 1024;
const MAX_RECORDS = 500;
const OBSERVED_TTL_MS = 30 * 60 * 1000;
const DOCUMENT_GUARD_TTL_MS = 5 * 60 * 1000;
const MAX_OBSERVED_URLS_PER_PLATFORM = 2000;
const MAX_OBSERVED_CLIENTS = 8;

function allowedUrl(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port &&
      ['www.liepin.com', 'c.liepin.com', 'www.zhipin.com', 'cv.zhipin.com'].includes(u.hostname);
  } catch { return false; }
}

function platform(raw) {
  try { const host=new URL(raw).hostname; return host==='www.zhipin.com' || host==='cv.zhipin.com'?'zhipin':['www.liepin.com','c.liepin.com'].includes(host)?'liepin':null; } catch { return null; }
}
function observedJobUrl(raw) {
  try {
    const u=new URL(raw);
    if (/(?:^|\/)(?:cv(?:[._-][^/]*)?|account(?:[._-][^/]*)?|login(?:[._-][^/]*)?|logout(?:[._-][^/]*)?|signout(?:[._-][^/]*)?|wapi(?:[._-][^/]*)?|private(?:[._-][^/]*)?)(?:\/|$)/i.test(u.pathname)) return false;
    return u.protocol==='https:' && !u.username && !u.password && !u.port &&
      ((u.hostname==='www.zhipin.com' && /^\/job_detail\/[^/]+\.html$/.test(u.pathname)) ||
       (u.hostname==='www.liepin.com' && /^\/(?:job\/\d+\.shtml|a\/\d+\.shtml)$/.test(u.pathname)));
  } catch { return false; }
}
function observedSearchUrl(raw) {
  try { const u=new URL(raw); return !/(?:^|\/)(?:cv|account|login|logout|signout|wapi|private)(?:\/|$)/i.test(u.pathname) && u.protocol==='https:' && !u.username && !u.password && !u.port &&
    ((u.hostname==='www.zhipin.com' && u.pathname==='/web/geek/jobs') || (u.hostname==='www.liepin.com' && u.pathname==='/zhaopin/')); } catch { return false; }
}

function equalToken(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

function bad(message, status = 400) {
  const error = new Error(message); error.status = status; return error;
}

async function body(req, maxBody = MAX_BODY) {
  let length = 0; const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > maxBody) throw bad('Request body too large', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw bad('Invalid JSON'); }
}

function validateCommand(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad('Command must be an object');
  if (!ACTIONS.has(input.action)) throw bad('Unsupported action');
  const known = new Set(['action', 'tabId', 'expectedUrl', 'documentId', 'targetUrl', 'ref', 'value', 'direction', 'pixels', 'timeoutMs']);
  for (const key of Object.keys(input)) if (!known.has(key)) throw bad(`Unknown command property: ${key}`);
  if (input.action !== 'tabs') {
    if (!Number.isSafeInteger(input.tabId) || input.tabId < 0) throw bad('A valid tabId is required');
    if (input.expectedUrl !== undefined && !allowedUrl(input.expectedUrl)) throw bad('Unsupported expectedUrl');
  }
  if (WRITES.has(input.action) && !allowedUrl(input.expectedUrl)) throw bad('Writes require an allowed expectedUrl');
  if (WRITES.has(input.action)) {
    if (typeof input.documentId !== 'string' || !input.documentId || input.documentId.length > 200) throw bad('documentId is required');
  }
  if (input.action === 'screenshot' && (!allowedUrl(input.expectedUrl) || typeof input.documentId !== 'string' || !input.documentId || input.documentId.length > 200)) throw bad('Screenshot requires an allowed expectedUrl and documentId');
  if (['open-observed-job','open-observed-search'].includes(input.action) && (typeof input.targetUrl!=='string' || input.targetUrl.length>3000)) throw bad('targetUrl is required');
  if (['click', 'fill', 'select'].includes(input.action)) {
    if (typeof input.ref !== 'string' || !input.ref || input.ref.length > 200) throw bad('Element ref is required');
  }
  if (['fill', 'select'].includes(input.action) && (typeof input.value !== 'string' || input.value.length > 30000)) throw bad('value must be a string of at most 30000 characters');
  if (input.action === 'scroll') {
    if (input.direction !== undefined && !['up', 'down'].includes(input.direction)) throw bad('Invalid scroll direction');
    if (input.pixels !== undefined && (!Number.isFinite(input.pixels) || input.pixels < 1 || input.pixels > 4000)) throw bad('pixels must be between 1 and 4000');
  }
  if (input.timeoutMs !== undefined && (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 100 || input.timeoutMs > 120000)) throw bad('timeoutMs must be between 100 and 120000');
  return { ...input };
}

export async function loadSession(directory, port) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const target = path.join(directory, 'session.json');
  let session;
  try { session = JSON.parse(await readFile(target, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (session && (!/^[a-f0-9]{64}$/.test(session.controllerToken) || !/^[a-f0-9]{64}$/.test(session.extensionToken))) throw new Error('Invalid saved session; stop and inspect .local/session.json');
  session ??= { controllerToken: randomBytes(32).toString('hex'), extensionToken: randomBytes(32).toString('hex') };
  if (session.controllerToken === session.extensionToken) throw new Error('Role tokens must be different');
  session.port = port;
  await writeFile(target, JSON.stringify(session, null, 2) + '\n', { mode: 0o600 });
  return session;
}

export async function createBridge({ port = 17373, directory = path.join(ROOT, '.local'), leaseMs = 15000, now = Date.now } = {}) {
  const session = await loadSession(directory, port);
  const records = new Map(), queue = [], active = new Map(), observed = new Map();
  let agent = null;

  function sweep() {
    const stamp = now();
    for (const [clientId, registry] of observed) {
      for (const [tabId, guard] of registry.documents) if (stamp-guard.at > DOCUMENT_GUARD_TTL_MS) registry.documents.delete(tabId);
      for (const [plat, urls] of registry.urls) {
        for (const [target, at] of urls) if (stamp-at > OBSERVED_TTL_MS) urls.delete(target);
        if (!urls.size) registry.urls.delete(plat);
      }
      if (!registry.documents.size && !registry.urls.size) observed.delete(clientId);
    }
    for (const record of records.values()) {
      if (['pending', 'dispatched'].includes(record.status) && record.expiresAt <= stamp) {
        record.status = 'expired'; record.error = record.dispatchedAt ? 'Command expired after dispatch; execution outcome may be unknown. It will not be retried.' : 'Command expired before dispatch';
        record.completedAt = stamp;
        // A timed-out dispatched tab stays locked until the extension acknowledges completion.
      }
    }
    if (agent && stamp - agent.lastSeen > leaseMs) {
      for (const record of records.values()) {
        if (record.clientId === agent.clientId && record.status === 'pending') {
          record.status = 'failed'; record.error = 'Extension lease expired before dispatch'; record.completedAt = stamp;
        }
      }
    }
    while (records.size >= MAX_RECORDS) {
      const candidate = [...records.values()].find(r => !['pending', 'dispatched'].includes(r.status) && ![...active.values()].includes(r.id));
      if (!candidate) break;
      records.delete(candidate.id);
    }
  }

  function liveAgent() { return agent && now() - agent.lastSeen <= leaseMs ? agent : null; }
  function view(r) {
    const result = { id: r.id, status: r.status, action: r.action, tabId: r.tabId, createdAt: r.createdAt, expiresAt: r.expiresAt, dispatchedAt: r.dispatchedAt, completedAt: r.completedAt };
    if (r.result !== undefined) result.result = r.result;
    if (r.error !== undefined) result.error = r.error;
    if (r.lateAcknowledgement !== undefined) result.lateAcknowledgement = r.lateAcknowledgement;
    return result;
  }
  function checkTab(command) {
    if (command.action === 'tabs') return;
    const tab = liveAgent()?.tabs.find(t => t.id === command.tabId);
    if (!tab) throw bad('Tab is not selected in the connected extension', 409);
    if (command.expectedUrl && tab.url !== command.expectedUrl) throw bad('Tab URL changed; take a fresh snapshot', 409);
    if (WRITES.has(command.action) && !tab.writeEnabled) throw bad('Tab is read-only; enable editing explicitly in the extension', 403);
    if (command.action === 'screenshot') {
      const guard=observed.get(liveAgent()?.clientId)?.documents.get(command.tabId);
      if (!guard || now()-guard.at>DOCUMENT_GUARD_TTL_MS || guard.url!==command.expectedUrl || guard.documentId!==command.documentId) throw bad('Current document guard is missing or stale',403);
    }
    if (command.action === 'open-observed-job' || command.action === 'open-observed-search') {
      const registry=observed.get(liveAgent()?.clientId);
      const source=registry?.documents.get(command.tabId);
      const allowedTarget=command.action==='open-observed-job'?observedJobUrl(command.targetUrl):observedSearchUrl(command.targetUrl);
      const targetPlatform=platform(command.targetUrl), inventory=registry?.urls.get(targetPlatform);
      if (!allowedTarget || !source || now()-source.at>DOCUMENT_GUARD_TTL_MS || source.url!==command.expectedUrl || source.documentId!==command.documentId || !inventory?.has(command.targetUrl) || platform(source.url)!==targetPlatform) throw bad('Target URL was not observed in this client platform inventory or the current document guard is stale',403);
      registry.touchedAt=now();
    }
  }
  const server = http.createServer(async (req, res) => {
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); };
    try {
      const address = server.address();
      if (req.headers.host !== `127.0.0.1:${address.port}`) throw bad('Invalid Host header', 403);
      const url = new URL(req.url, `http://127.0.0.1:${address.port}`);
      const agentRoute = ['/v1/agent/poll', '/v1/agent/result'].includes(url.pathname);
      const origin = req.headers.origin;
      if (origin !== undefined && (!agentRoute || !ORIGIN.test(origin))) throw bad('Origin is not allowed', 403);
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      }
      if (req.method === 'OPTIONS') {
        if (!agentRoute || !origin || req.headers['access-control-request-method'] !== 'POST') throw bad('Preflight is not allowed', 403);
        const headers = (req.headers['access-control-request-headers'] || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
        if (headers.some(h => !['authorization', 'content-type'].includes(h))) throw bad('Preflight header is not allowed', 403);
        res.writeHead(204, { 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '300' }); res.end(); return;
      }
      if (req.method === 'GET' && url.pathname === '/health') { send(200, { ok: true, service: 'resume-browser-bridge', version: 1 }); return; }
      const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
      if (!equalToken(token, agentRoute ? session.extensionToken : session.controllerToken)) throw bad('Unauthorized', 401);
      sweep();
      if (req.method === 'GET' && url.pathname === '/v1/status') {
        send(200, { connected: !!liveAgent(), clientId: liveAgent()?.clientId ?? null, tabs: liveAgent()?.tabs ?? [], pending: [...records.values()].filter(r => r.status === 'pending').length, active: [...active.entries()].map(([tabId, id]) => ({ tabId, id, status: records.get(id)?.status })) }); return;
      }
      if (req.method === 'POST' && url.pathname === '/v1/commands') {
        const command = validateCommand(await body(req));
        if (!liveAgent()) throw bad('Extension is not connected', 409);
        command.clientId = agent.clientId;
        checkTab(command);
        if (records.size >= MAX_RECORDS) throw bad('Command store is full', 429);
        const id = randomUUID(), createdAt = now();
        const record = { ...command, id, createdAt, expiresAt: createdAt + (command.timeoutMs ?? 45000), status: 'pending', clientId: agent.clientId };
        delete record.timeoutMs;
        records.set(id, record); queue.push(id);
        send(202, view(record)); return;
      }
      if (req.method === 'GET' && url.pathname.startsWith('/v1/results/')) {
        const record = records.get(url.pathname.slice('/v1/results/'.length));
        if (!record) throw bad('Unknown command', 404);
        send(200, view(record)); return;
      }
      if (req.method === 'POST' && agentRoute) {
        const data = await body(req, url.pathname === '/v1/agent/result' ? 4 * 1024 * 1024 : MAX_BODY);
        if (typeof data.clientId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(data.clientId)) throw bad('Invalid clientId');
        if (liveAgent() && agent.clientId !== data.clientId) throw bad('Another extension client holds the lease', 409);
        if (agent?.clientId === data.clientId && agent.origin !== origin) throw bad('Client origin changed', 403);
        if (url.pathname === '/v1/agent/poll') {
          if (!Array.isArray(data.tabs) || data.tabs.length > 20) throw bad('tabs must contain at most 20 selected tabs');
          const tabs = data.tabs.map(t => {
            if (!Number.isSafeInteger(t.id) || t.id < 0 || !allowedUrl(t.url)) throw bad('Invalid selected tab');
            return { id: t.id, url: t.url, title: String(t.title ?? '').slice(0,300), writeEnabled: t.writeEnabled === true };
          });
          if (new Set(tabs.map(t => t.id)).size !== tabs.length) throw bad('Duplicate tabs');
          if (agent?.clientId !== data.clientId && active.size) throw bad('Previous client has unresolved dispatched commands; restart bridge after reviewing their outcomes', 409);
          agent = { clientId: data.clientId, origin, tabs, lastSeen: now() };
          let command = null;
          for (let i = 0; i < queue.length; i++) {
            const record = records.get(queue[i]);
            if (!record || record.status !== 'pending') { queue.splice(i--, 1); continue; }
            if (record.clientId !== agent.clientId) continue;
            const key = record.action === 'tabs' ? 'tabs' : record.tabId;
            if (active.has(key)) continue;
            try { checkTab(record); } catch (error) { record.status = 'failed'; record.error = error.message; record.completedAt = now(); queue.splice(i--,1); continue; }
            record.status = 'dispatched'; record.dispatchedAt = now(); active.set(key,record.id); queue.splice(i,1);
            command = { ...record }; delete command.status; delete command.clientId; delete command.dispatchedAt;
            break;
          }
          send(200, { command }); return;
        }
        const record = records.get(data.id);
        if (!record || record.clientId !== data.clientId) throw bad('Unknown command or wrong client', 404);
        if (typeof data.ok !== 'boolean') throw bad('ok must be boolean');
        if (record.action !== 'screenshot' && Buffer.byteLength(JSON.stringify(data),'utf8') > MAX_BODY) throw bad('Request body too large',413);
        if (data.ok && record.action === 'screenshot' && (typeof data.result?.image !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(data.result.image) || data.result.image.length > 3 * 1024 * 1024)) throw bad('Invalid screenshot result');
        const digest=createHash('sha256').update(JSON.stringify({ok:data.ok,result:data.result,error:data.error})).digest('hex');
        if(record.resultDigest !== undefined) {
          if(record.resultDigest !== digest) throw bad('Conflicting duplicate result',409);
          send(200,{accepted:true,duplicate:true,status:record.status});return;
        }
        if (record.status !== 'dispatched' && !(record.status === 'expired' && record.dispatchedAt !== undefined)) throw bad('Command is not awaiting a result', 409);
        const key = record.action === 'tabs' ? 'tabs' : record.tabId;
        if (active.get(key) !== record.id) throw bad('Command is not active', 409);
        active.delete(key);
        record.resultDigest=digest;
        if (record.status === 'expired') record.lateAcknowledgement = { ok: data.ok, receivedAt: now() };
        else {
          if (data.ok && record.action === 'screenshot') {
            // Keep at most the latest image in memory; all command metadata remains available.
            for (const other of records.values()) if (other.action==='screenshot' && other.result?.image) {
              delete other.result.image; other.result.imageDiscarded=true;
            }
          }
          record.status = data.ok ? 'succeeded' : 'failed'; record.result = data.result; record.error = data.ok ? undefined : String(data.error || 'Extension operation failed').slice(0,2000); record.completedAt = now();
          if (data.ok && record.action==='snapshot' && data.result && data.result.url===record.expectedUrl && typeof data.result.documentId==='string' && Array.isArray(data.result.fields)) {
            const plat=platform(record.expectedUrl);
            let links=[];
            for (const field of data.result.fields.slice(0,500)) if (typeof field?.href==='string' && field.href.length<=3000) {
              try { const resolved=new URL(field.href,record.expectedUrl).href; if (platform(resolved)===plat && (observedJobUrl(resolved)||observedSearchUrl(resolved))) links.push(resolved); } catch {}
            }
            if (observedSearchUrl(data.result.url) && platform(data.result.url)===plat) links.push(data.result.url);
            let registry=observed.get(record.clientId); if(!registry){
              if(observed.size>=MAX_OBSERVED_CLIENTS){const oldest=[...observed.entries()].sort((a,b)=>(a[1].touchedAt??0)-(b[1].touchedAt??0))[0];if(oldest)observed.delete(oldest[0]);}
              registry={documents:new Map(),urls:new Map(),touchedAt:now()};observed.set(record.clientId,registry);
            }
            const stamp=now(); registry.documents.set(record.tabId,{url:record.expectedUrl,documentId:data.result.documentId,at:stamp});
            registry.touchedAt=stamp;
            if (plat) {
              let inventory=registry.urls.get(plat); if(!inventory){inventory=new Map();registry.urls.set(plat,inventory);}
              for(const target of links) { inventory.delete(target); inventory.set(target,stamp); }
              while(inventory.size>MAX_OBSERVED_URLS_PER_PLATFORM) inventory.delete(inventory.keys().next().value);
            }
          }
        }
        send(200, { accepted: true, status: record.status }); return;
      }
      throw bad('Not found', 404);
    } catch (error) { if (!res.headersSent) send(error.status ?? 500, { error: error.status ? error.message : 'Internal server error' }); else res.end(); }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  await new Promise((resolve,reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  session.port = server.address().port;
  await writeFile(path.join(directory,'session.json'),JSON.stringify(session,null,2)+'\n',{mode:0o600});
  await writeFile(path.join(directory,'extension-pairing.json'),JSON.stringify({baseUrl:`http://127.0.0.1:${session.port}`,extensionToken:session.extensionToken},null,2)+'\n',{mode:0o600});
  return { server, session, url: `http://127.0.0.1:${session.port}`, close: () => new Promise((resolve,reject) => server.close(error => error ? reject(error) : resolve())) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.RESUME_BRIDGE_PORT ?? 17373);
  const bridge = await createBridge({port});
  console.log(`Resume browser bridge listening on ${bridge.url}`);
  console.log('Pairing file: run node cli.mjs pair. No resume content is logged or persisted.');
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal, async () => { await bridge.close(); process.exit(0); });
}
