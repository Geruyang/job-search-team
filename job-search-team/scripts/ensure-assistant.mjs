// Portable bootstrap: no model-provider SDK or host-specific tool API.
import { cp, mkdir, access, readFile, writeFile } from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exists = async p => { try { await access(p); return true; } catch { return false; } };

async function main() {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (['--prepare-only', '--help'].includes(args[i])) options[args[i]] = true;
    else if (['--workspace', '--bridge-root', '--port'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--')) options[args[i]] = args[++i];
    else throw new Error(`Unknown or incomplete option: ${args[i]}`);
  }
  if (options['--help']) {
    console.log('node ensure-assistant.mjs --workspace PATH [--bridge-root PATH] [--prepare-only] [--port 17373]');
    return;
  }
  if (!options['--workspace']) throw new Error('--workspace is required');
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node >=22 required');
  const workspace = path.resolve(options['--workspace']);
  if (!await exists(workspace)) throw new Error('Workspace must already exist');
  const existing = path.join(workspace, 'job-search-team', 'browser-bridge');
  const bridgeRoot = options['--bridge-root'] ? path.resolve(options['--bridge-root'])
    : await exists(path.join(existing, 'server.mjs')) ? existing : path.join(workspace, '.job-search-assistant', 'browser-bridge');
  if (!await exists(bridgeRoot)) {
    await mkdir(path.dirname(bridgeRoot), { recursive: true });
    await cp(path.join(skillRoot, 'assets', 'browser-bridge'), bridgeRoot, {
      recursive: true, force: false, errorOnExist: true,
      filter: src => !['.local', 'node_modules'].includes(path.basename(src)),
    });
  }
  for (const file of ['server.mjs', 'cli.mjs', 'extension/manifest.json']) {
    if (!await exists(path.join(bridgeRoot, file))) throw new Error(`Existing assistant incomplete: ${file}; no files overwritten`);
  }
  console.log(JSON.stringify({ bridgeRoot, extension: path.join(bridgeRoot, 'extension'), pairingFile: path.join(bridgeRoot, '.local', 'extension-pairing.json') }));
  if (options['--prepare-only']) { console.log('Prepared only; no service or browser started.'); return; }
  const sessionPath = path.join(bridgeRoot, '.local', 'session.json');
  let savedPort;
  if (await exists(sessionPath)) savedPort = JSON.parse(await readFile(sessionPath, 'utf8')).port;
  const port = Number(options['--port'] ?? savedPort ?? 17373);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid port');
  if (savedPort && Number(savedPort) !== port) throw new Error('Requested port differs from existing pairing; preserve the current instance');
  async function health() {
    let response;
    try { response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) }); }
    catch (error) {
      if (error.cause?.code === 'ECONNREFUSED') return null;
      throw new Error('Cannot establish service health; check network/port permissions without starting a replacement');
    }
    const value = await response.json().catch(() => null);
    if (!response.ok || value?.service !== 'resume-browser-bridge') throw new Error('Port occupied by another service; no process stopped');
    return value;
  }
  let current = await health();
  if (!current) {
    const state = path.join(bridgeRoot, '.local');
    await mkdir(state, { recursive: true });
    const stdout = openSync(path.join(state, 'server.stdout.log'), 'a');
    const stderr = openSync(path.join(state, 'server.stderr.log'), 'a');
    let child;
    try {
      child = spawn(process.execPath, [path.join(bridgeRoot, 'server.mjs')], {
        cwd: bridgeRoot, detached: true, windowsHide: true,
        stdio: ['ignore', stdout, stderr], env: { ...process.env, RESUME_BRIDGE_PORT: String(port) },
      });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    } finally { closeSync(stdout); closeSync(stderr); }
    await writeFile(path.join(state, 'server.pid'), String(child.pid));
    child.unref();
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => setTimeout(resolve, 250));
      current = await health();
      if (current) break;
    }
    if (!current) throw new Error('Service did not become ready; inspect local logs, do not replay browser commands');
  }
  if (!await exists(sessionPath)) throw new Error('Existing service belongs to another assistant directory; locate it and use --bridge-root');
  // CLI authenticates against local state and prints no pairing/controller secrets.
  execFileSync(process.execPath, [path.join(bridgeRoot, 'cli.mjs'), 'status'], { stdio: 'inherit', windowsHide: true });
  console.log('Verify connected state, account and selected tab permissions before proceeding.');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
