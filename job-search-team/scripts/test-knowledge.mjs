import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, symlink, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initializeKnowledge } from './init-knowledge.mjs';

// Synthetic workspaces only. Leave production browsers, pairing and private records untouched.
const temporary = () => mkdtemp(path.join(os.tmpdir(), 'job-knowledge-test-'));

test('declined or missing consent performs no writes', async () => {
  const workspace = await temporary();
  await assert.rejects(initializeKnowledge({ workspace }), /permission/);
  assert.deepEqual(await readdir(workspace), []);
});

test('fresh workspace gets linked problem, case and continuation files without user facts', async () => {
  const workspace = await temporary();
  const result = await initializeKnowledge({ workspace, enabled: true });
  assert.equal(result.browserActions, 0);
  assert.equal(result.outboundActions, 0);
  assert.equal(await readFile(path.join(result.knowledgeDir, 'incidents.jsonl'), 'utf8'), '');
  for (const file of [result.problemFile, result.handoff, path.join(workspace, 'AGENTS.md'), path.join(workspace, '.gitignore'), path.join(result.knowledgeDir, 'README.md'), path.join(result.knowledgeDir, '人工干预记录.md')]) await access(file);
  const index = await readFile(path.join(result.knowledgeDir, 'README.md'), 'utf8');
  for (const match of index.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) await access(path.resolve(result.knowledgeDir, decodeURI(match[1])));
  const agents = await readFile(path.join(workspace, 'AGENTS.md'), 'utf8');
  for (const match of agents.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) await access(path.resolve(workspace, decodeURI(match[1])));
});

test('reuse preserves all private records and unrelated project rules byte for byte', async () => {
  const workspace = await temporary();
  const kb = path.join(workspace, 'private cases');
  await mkdir(kb);
  const saved = new Map([
    [path.join(workspace, '问题及解决.md'), 'PRIVATE_EXISTING_PROBLEM\r\n'],
    [path.join(workspace, '会话接续.md'), 'PRIVATE_EXISTING_HANDOFF\r\n'],
    [path.join(kb, 'README.md'), 'PRIVATE_EXISTING_INDEX\r\n'],
    [path.join(kb, 'incidents.jsonl'), '{"synthetic":true}\r\n'],
    [path.join(kb, '人工干预记录.md'), 'PRIVATE_EXISTING_HUMAN\r\n'],
    [path.join(workspace, 'policy.json'), '{"paused":true}\r\n'],
  ]);
  for (const [file, text] of saved) await writeFile(file, text);
  const originalRules = '# Existing unrelated rules\r\nKeep protected files.\r\n';
  await writeFile(path.join(workspace, 'AGENTS.md'), originalRules);
  await writeFile(path.join(workspace, '.gitignore'), '/existing-private/\r\n');
  await initializeKnowledge({ workspace, enabled: true, knowledgeDir: 'private cases' });
  const before = new Map(await Promise.all(['AGENTS.md', '.gitignore'].map(async name => [name, await readFile(path.join(workspace, name))])));
  await initializeKnowledge({ workspace, enabled: true, knowledgeDir: 'private cases' });
  for (const [file, text] of saved) assert.equal(await readFile(file, 'utf8'), text);
  assert.ok((await readFile(path.join(workspace, 'AGENTS.md'), 'utf8')).startsWith(originalRules));
  for (const [name, bytes] of before) assert.deepEqual(await readFile(path.join(workspace, name)), bytes);
});

test('workspace escape is rejected before creating any files', async () => {
  const workspace = await temporary();
  await assert.rejects(initializeKnowledge({ workspace, enabled: true, knowledgeDir: '../outside' }), /inside/);
  assert.deepEqual(await readdir(workspace), []);
});

test('symlinked knowledge directories cannot write outside the workspace', async () => {
  const workspace = await temporary();
  const outside = await temporary();
  await symlink(outside, path.join(workspace, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(initializeKnowledge({ workspace, enabled: true, knowledgeDir: 'linked' }), /symbolic-link/);
  assert.deepEqual(await readdir(outside), []);
  await assert.rejects(access(path.join(workspace, '问题及解决.md')));
});

test('changed managed paths require reconciliation and preserve existing state', async () => {
  const workspace = await temporary();
  await initializeKnowledge({ workspace, enabled: true });
  const before = await readFile(path.join(workspace, 'AGENTS.md'));
  await assert.rejects(initializeKnowledge({ workspace, enabled: true, knowledgeDir: 'different' }), /differs/);
  assert.deepEqual(await readFile(path.join(workspace, 'AGENTS.md')), before);
  await assert.rejects(access(path.join(workspace, 'different')));
});

test('standalone CLI initializes from an unrelated empty working directory', async () => {
  const workspace = await temporary();
  const cwd = await temporary();
  const script = fileURLToPath(new URL('./init-knowledge.mjs', import.meta.url));
  const result = JSON.parse(execFileSync(process.execPath, [script, '--workspace', workspace, '--enable'], { cwd, encoding: 'utf8', windowsHide: true }));
  assert.equal(result.status, 'initialized_or_reused');
  await access(result.problemFile);
  await access(result.handoff);
  assert.deepEqual(await readdir(cwd), []);
});
