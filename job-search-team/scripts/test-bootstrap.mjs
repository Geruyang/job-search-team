import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const launcher = fileURLToPath(new URL('./ensure-assistant.mjs', import.meta.url));
const run = args => execFileSync(process.execPath, [launcher, ...args], { cwd: os.tmpdir(), encoding: 'utf8', windowsHide: true, timeout: 20000 });

test('fresh deployment, server startup and reuse preserve pairing without a browser', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), '求职 bootstrap '));
  const bridge = path.join(workspace, '.job-search-assistant', 'browser-bridge');
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const args = ['--workspace', workspace, '--port', String(port)];
  let pid;
  try {
    const first = run(args);
    assert.match(first, /Verify connected state/);
    pid = Number(await readFile(path.join(bridge, '.local', 'server.pid'), 'utf8'));
    const pairing = await readFile(path.join(bridge, '.local', 'extension-pairing.json'), 'utf8');
    const second = run(args);
    assert.match(second, /Verify connected state/);
    assert.equal(await readFile(path.join(bridge, '.local', 'extension-pairing.json'), 'utf8'), pairing);
    assert.equal(Number(await readFile(path.join(bridge, '.local', 'server.pid'), 'utf8')), pid);
    assert.doesNotMatch(first + second, /extensionToken|controllerToken/);
  } finally {
    if (!pid) {
      try { pid = Number(await readFile(path.join(bridge, '.local', 'server.pid'), 'utf8')); } catch {}
    }
    // Only the server PID created inside this test's unique temporary workspace.
    if (Number.isInteger(pid) && pid > 0) { try { process.kill(pid); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
  }
});

test('an incomplete existing directory is never overwritten', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'job-search-bootstrap-'));
  const bridge = path.join(workspace, 'existing');
  await mkdir(bridge);
  await writeFile(path.join(bridge, 'server.mjs'), 'preserve-existing');
  assert.throws(() => run(['--workspace', workspace, '--bridge-root', bridge, '--prepare-only']), /incomplete/);
  assert.equal(await readFile(path.join(bridge, 'server.mjs'), 'utf8'), 'preserve-existing');
});
