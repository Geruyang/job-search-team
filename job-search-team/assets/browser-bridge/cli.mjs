import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const [operation = 'help', ...args] = process.argv.slice(2);
const usage = `Usage: node cli.mjs health | status | pair [--show] | tabs | snapshot TAB_ID [EXPECTED_URL] | screenshot TAB_ID OUTPUT.jpg | send COMMAND.json | result ID\nCommands and results stay in memory; never retry a timed-out write without checking the page.`;
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
  async function execute(command) {
    let result = await request('/v1/commands',command);
    const deadline = Date.now()+Math.min(command.timeoutMs??45000,120000)+2000;
    while (['pending','dispatched'].includes(result.status) && Date.now()<deadline) {
      await new Promise(resolve=>setTimeout(resolve,400));
      result = await request('/v1/results/'+result.id);
    }
    return result;
  }
  let result;
  if (operation === 'health') result = await request('/health');
  else if (operation === 'status') result = await request('/v1/status');
  else if (operation === 'result') { if(!args[0]) throw new Error('ID required'); result = await request('/v1/results/'+encodeURIComponent(args[0])); }
  else if (operation === 'screenshot') {
    if (!/^\d+$/.test(args[0]??'') || !args[1] || args.length!==2) throw new Error('screenshot requires TAB_ID and a new OUTPUT.jpg path');
    const tabId=Number(args[0]), expectedUrl=(await request('/v1/status')).tabs.find(t=>t.id===tabId)?.url;
    if(!expectedUrl) throw new Error('Tab is not selected in the connected extension');
    const snapshot=await execute({action:'snapshot',tabId,expectedUrl});
    if(snapshot.status!=='succeeded' || snapshot.result?.url!==expectedUrl || !snapshot.result?.documentId) throw new Error('Could not verify the current tab before capture');
    result=await execute({action:'screenshot',tabId,expectedUrl,documentId:snapshot.result.documentId});
    if(result.status==='succeeded') {
      const match=/^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(result.result?.image??'');
      if(!match) throw new Error('Screenshot data is invalid');
      const target=path.resolve(args[1]);
      await writeFile(target,Buffer.from(match[1],'base64'),{mode:0o600,flag:'wx'});
      delete result.result.image; result.result.file=target;
    }
  }
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
    result = await execute(command);
  }
  if (operation !== 'screenshot' && result?.action === 'screenshot' && result.result?.image) { delete result.result.image; result.result.imageOmitted=true; }
  console.log(JSON.stringify(result,null,2));
  if (['failed','expired','pending','dispatched'].includes(result.status)) process.exitCode=1;
} catch(error) { console.error(error.message); process.exitCode=1; }
