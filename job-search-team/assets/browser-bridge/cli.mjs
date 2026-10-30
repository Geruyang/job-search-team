import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const [operation = 'help', ...args] = process.argv.slice(2);
const usage = `Usage: node cli.mjs health | status | pair [--show] | tabs | snapshot TAB_ID [EXPECTED_URL] | send COMMAND.json | result ID\nCommands and results stay in memory; never retry a timed-out write without checking the page.`;
try {
  if (operation === 'help') { console.log(usage); process.exit(0); }
  const session = JSON.parse(await readFile(path.join(root,'.local/session.json'),'utf8'));
  const base = `http://127.0.0.1:${session.port}`;
  if (operation === 'pair') {
    console.log(args.includes('--show') ? JSON.stringify({baseUrl:base,extensionToken:session.extensionToken},null,2) : path.join(root,'.local/extension-pairing.json'));
    process.exit(0);
  }
  async function request(route, data) {
    const response = await fetch(base+route,{method:data===undefined?'GET':'POST',headers:{Authorization:`Bearer ${session.controllerToken}`,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(10000)});
    const value = await response.json();
    if (!response.ok) throw new Error(`${response.status}: ${value.error}`);
    return value;
  }
  let result;
  if (operation === 'health') result = await request('/health');
  else if (operation === 'status') result = await request('/v1/status');
  else if (operation === 'result') { if(!args[0]) throw new Error('ID required'); result = await request('/v1/results/'+encodeURIComponent(args[0])); }
  else {
    let command;
    if (operation === 'tabs') command = {action:'tabs'};
    else if (operation === 'snapshot') {
      if(!/^\d+$/.test(args[0]??'')) throw new Error('Valid TAB_ID required');
      const tabId=Number(args[0]);
      const expectedUrl=args[1]??(await request('/v1/status')).tabs.find(t=>t.id===tabId)?.url;
      if(!expectedUrl) throw new Error('Tab is not selected in the connected extension');
      command={action:'snapshot',tabId,expectedUrl};
    }
    else if (operation === 'send') { if(!args[0]) throw new Error('Command JSON path required'); command = JSON.parse(await readFile(path.resolve(args[0]),'utf8')); }
    else throw new Error(usage);
    result = await request('/v1/commands',command);
    const deadline = Date.now()+Math.min(command.timeoutMs??45000,120000)+2000;
    while (['pending','dispatched'].includes(result.status) && Date.now()<deadline) {
      await new Promise(resolve=>setTimeout(resolve,400));
      result = await request('/v1/results/'+result.id);
    }
  }
  console.log(JSON.stringify(result,null,2));
  if (['failed','expired','pending','dispatched'].includes(result.status)) process.exitCode=1;
} catch(error) { console.error(error.message); process.exitCode=1; }
