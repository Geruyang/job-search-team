import { readFile, writeFile, appendFile, mkdir, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const protocolStart = '<!-- job-search-team:knowledge-protocol -->';
const ignoreStart = '# job-search-team:private-knowledge';
const within = (root, target) => {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
};
const readOptional = async file => {
  try { return await readFile(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
};

async function assertSafe(root, target) {
  if (!within(root, target)) throw new Error('Knowledge paths must stay inside the private workspace');
  let current = root;
  for (const part of path.relative(root, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error('Refusing symbolic-link knowledge paths');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

export async function initializeKnowledge({ workspace, enabled = false, knowledgeDir = '解决方案知识库' }) {
  if (!enabled) throw new Error('Explicit knowledge permission is required: use --enable only after user authorization');
  if (!workspace) throw new Error('--workspace is required');
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node >=22 required');
  if (typeof knowledgeDir !== 'string' || !knowledgeDir || path.isAbsolute(knowledgeDir) || /[\x00-\x1f]/u.test(knowledgeDir)) throw new Error('Use a workspace-relative knowledge directory');
  const root = await realpath(path.resolve(workspace));
  if (!(await lstat(root)).isDirectory()) throw new Error('Workspace must already be a directory');
  const kb = path.resolve(root, knowledgeDir);
  if (kb === root) throw new Error('Knowledge directory must be a subdirectory');
  const problem = path.join(root, '问题及解决.md');
  const handoff = path.join(root, '会话接续.md');
  const agents = path.join(root, 'AGENTS.md');
  const ignore = path.join(root, '.gitignore');
  const files = [problem, handoff, agents, ignore, kb, ...['README.md', 'incidents.jsonl', '人工干预记录.md'].map(name => path.join(kb, name))];
  for (const file of files) await assertSafe(root, file);
  const kbRel = path.relative(root, kb).split(path.sep).join('/');
  const problemRel = path.relative(kb, problem).split(path.sep).join('/');
  const link = text => encodeURI(text).replace(/[()]/gu, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  const protocol = `${protocolStart}\n## 求职运行经验\n\n- 启动、恢复、交接和上下文恢复先读工作区的 [问题及解决.md](问题及解决.md)、[知识库索引](${link(kbRel)}/README.md)及当前任务状态/授权。\n- 遇错误、异常、工具拒绝或用户纠正，先检索问题文件和原案例，再按当前环境采用适用办法；无案例先记录现象。\n- 每次发现、尝试结果、解决、失败或人工介入后，当次更新问题文件、索引及有新增细节的案例/人工记录，下一次相关业务动作前落盘，不只等结束总结。\n- 保留失败、unknown、证据与人工归因，事实/推断/未验证分开；未知提交不重放，旧经验不覆盖新指令或绕过保护。\n- 多执行者指定一名维护者归并。记录仅本地，不上传问题文件、真实知识库、简历/聊天/密钥；导入和维护文件不恢复暂停任务。\n<!-- /job-search-team:knowledge-protocol -->`;
  const escapedKb = kbRel.replace(/([ #!\[\]*?\\])/gu, '\\$1');
  const ignoreBlock = `${ignoreStart}\n/问题及解决.md\n/会话接续.md\n/${escapedKb}/\n# /job-search-team:private-knowledge`;
  const oldAgents = await readOptional(agents);
  const oldIgnore = await readOptional(ignore);
  if (oldAgents.includes(protocolStart) && !oldAgents.includes(protocol)) throw new Error('Existing managed protocol differs; reconcile its paths/content before writing');
  if (oldIgnore.includes(ignoreStart) && !oldIgnore.includes(ignoreBlock)) throw new Error('Existing managed privacy paths differ; reconcile before writing');
  const template = await readFile(path.join(skillRoot, 'assets', 'problem-log-template.md'), 'utf8');
  const outputs = [];
  async function create(file, content) {
    try { await writeFile(file, content, { encoding: 'utf8', flag: 'wx' }); outputs.push({ file, action: 'created' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; outputs.push({ file, action: 'preserved' }); }
  }
  await mkdir(kb, { recursive: true });
  await create(problem, template);
  await create(path.join(kb, 'README.md'), `# 本地解决方案知识库（私有）\n\n先读[统一问题文件](${link(problemRel)})和当前用户指令、任务状态、授权及最近未决项。遇问题先查案例；每次尝试结果和人工干预当次同步问题文件、索引及必要的案例记录。\n\n## 案例索引与未决项\n\n尚无真实案例，依据实际运行逐条登记。详细证据见 incidents.jsonl；人工操作见[人工干预记录](人工干预记录.md)。事实、用户确认、推断和未验证分开，unknown不重发。\n\n不公开上传本目录，不抄完整简历/聊天、联系值或密钥。\n`);
  await create(path.join(kb, 'incidents.jsonl'), '');
  await create(path.join(kb, '人工干预记录.md'), '# 人工干预记录（私有）\n\n尚无实际记录。发生时记时间或unknown、谁做了什么、依据、实际结果、是否接管及下一步。未发生记none，无法确认记unknown，不把用户操作计为Agent成果。只保存必要摘要与证据指针。\n');
  await create(handoff, `# 会话接续（私有）\n\n1. 读取完整求职技能和本工作区[项目规则](AGENTS.md)。\n2. 读取[问题及解决](问题及解决.md)、[知识库索引](${link(kbRel)}/README.md)及最近未决项。\n3. 另读用户私下提供的简历、当前policy/授权、材料版本、真实回执和人工接管记录；这些不包含在公开技能包中。\n4. 先核当前任务是否暂停、在途命令和unknown，不因导入文件自动恢复或重发。\n5. 读取实际助手状态并按授权验收；新环境重新登录配对，不复用旧标签ID或迁移密钥。\n\n当前任务状态尚未由本模板核实，不能从文件创建推断已开始或已授权外发。运行时每次问题/尝试结果当次更新问题文件和本地知识库。\n`);
  for (const [file, old, block, marker] of [[agents, oldAgents, protocol, protocolStart], [ignore, oldIgnore, ignoreBlock, ignoreStart]]) {
    if (old.includes(marker)) outputs.push({ file, action: 'preserved' });
    else { await appendFile(file, `${old && !old.endsWith('\n') ? '\n' : ''}\n${block}\n`, 'utf8'); outputs.push({ file, action: 'protocol_appended' }); }
  }
  return { status: 'initialized_or_reused', workspace: root, problemFile: problem, knowledgeDir: kb, handoff, outputs, browserActions: 0, outboundActions: 0 };
}

async function main() {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help') { console.log('node init-knowledge.mjs --workspace PATH --enable [--knowledge-dir RELATIVE_PATH]'); return; }
    if (args[i] === '--enable') options.enabled = true;
    else if (['--workspace', '--knowledge-dir'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--')) options[args[i] === '--workspace' ? 'workspace' : 'knowledgeDir'] = args[++i];
    else throw new Error(`Unknown or incomplete option: ${args[i]}`);
  }
  console.log(JSON.stringify(await initializeKnowledge(options), null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
