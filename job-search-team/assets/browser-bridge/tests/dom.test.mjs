import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../extension/content.js', import.meta.url), 'utf8');

test('observed HTTPS link can open in the selected tab without changing its target attribute', async () => {
  const f=fixture(); const link=new f.Element('A',{href:'https://www.liepin.com/job/123.shtml',target:'_blank'},'外贸业务员');
  let destination; f.location.assign=url=>{destination=url;};
  const {result:s}=await f.command({action:'snapshot'});
  const r=await f.command(f.mutation(s,'click',s.fields[0].ref,{value:'open-in-same-tab'}));
  assert.equal(r.ok,true);assert.equal(r.result.navigationRequested,true);
  assert.equal(destination,'https://www.liepin.com/job/123.shtml');assert.equal(link.attrs.target,'_blank');
  const stale=await f.command(f.mutation(s,'click',s.fields[0].ref,{value:'open-in-same-tab'}));
  assert.equal(stale.error.code,'STALE_REF');
});

test('same-tab open rejects external and no-op links', async () => {
  for(const href of ['https://outside.example/jobs','javascript:;']) {
    const f=fixture();new f.Element('A',{href},'岗位');let assigned=false;f.location.assign=()=>{assigned=true;};
    const {result:s}=await f.command({action:'snapshot'});
    const r=await f.command(f.mutation(s,'click',s.fields[0].ref,{value:'open-in-same-tab'}));
    assert.equal(r.ok,false);assert.equal(r.error.code,'LINK_NOT_ALLOWED');assert.equal(assigned,false);
  }
});

test('same-tab open retains covered-control protection', async () => {
  const f=fixture();new f.Element('A',{href:'https://www.zhipin.com/job_detail/123.html'},'岗位');
  const cover=new f.Element('DIV',{},'遮罩');f.document.cover=cover;let assigned=false;f.location.assign=()=>{assigned=true;};
  const {result:s}=await f.command({action:'snapshot'});
  const r=await f.command(f.mutation(s,'click',s.fields.find(x=>x.tag==='a').ref,{value:'open-in-same-tab'}));
  assert.equal(r.error.code,'ELEMENT_COVERED');assert.equal(assigned,false);
});

function fixture() {
  const elements = [];
  let listener;
  let listenerCount = 0;
  class Element {
    constructor(tag, attrs = {}, text = '') {
      this.tagName = tag; this.attrs = attrs; this.textContent = text; this.innerText = text;
      this.children = []; this.labels = []; this.events = []; this.isConnected = true;
      this.disabled = false; this.readOnly = false; this._value = attrs.value || '';
      this.type = attrs.type || (tag === 'INPUT' ? 'text' : ''); this.id = attrs.id || '';
      this.name = attrs.name || ''; this.autocomplete = attrs.autocomplete || ''; this.placeholder = attrs.placeholder || '';
      this.isContentEditable = 'contenteditable' in attrs && attrs.contenteditable !== 'false'; this.options = [];
      this.scrollTop=0;this.scrollHeight=0;this.clientHeight=0;
      elements.push(this);
    }
    getAttribute(name) { return this.attrs[name] ?? null; }
    getClientRects() { return this.hidden ? [] : [{}]; }
    getBoundingClientRect() {const top=elements.indexOf(this)*30;return this.rect || {left:0,right:200,top,bottom:top+25};}
    contains(element) {return this.children.some(child=>child===element || child.contains(element));}
    closest(selector) {
      if (selector === '[hidden],[inert]' || selector === '[hidden],[inert],[aria-hidden="true"]') {let node=this;while(node){if(node.hidden || node.attrs.hidden !== undefined || node.attrs.inert !== undefined || (selector.includes('aria-hidden') && node.attrs['aria-hidden']==='true'))return node;node=node.parentElement;}return null;}
      if (selector === 'form') return this.form || null;
      if (selector === 'a[href]') {let node=this;while(node){if(node.tagName==='A'&&node.attrs.href!==undefined)return node;node=node.parentElement;}return null;}
      if (selector.includes('script,style')) return ['SCRIPT', 'STYLE', 'NOSCRIPT','TEXTAREA'].includes(this.tagName) || this.isContentEditable ? this : null;
      if (selector === 'footer,[role="contentinfo"]') return this.region === 'footer' ? this : null;
      if (selector === 'header,nav,[role="navigation"]') return this.region === 'nav' ? this : null;
      if (selector === 'form,[role="dialog"],dialog,fieldset') return this.form || (this.region === 'form' ? this : null);
      if (selector === '[role="listbox"],[role="menu"],[class*="dropdown"],[class*="select-dropdown"],[class*="picker-panel"]') return this.region==='dropdown' ? this : null;
      return this.hidden ? this : null;
    }
    dispatchEvent(event) { this.events.push(event.type); this.onEvent?.(event); return !event.defaultPrevented; }
    focus(options) {this.focused=true;this.focusOptions=options;this.onFocus?.();}
    scrollBy({top}) {this.scrollTop=Math.max(0,Math.min(this.scrollHeight-this.clientHeight,this.scrollTop+top));}
    click() { this.clicked = true; this.events.push('click'); this.onClick?.(); }
  }
  class Input extends Element { constructor(attrs, text) { super('INPUT', attrs, text); } get value() {return this._value;} set value(value) {this._value = value;} }
  class TextArea extends Element { constructor(attrs, text) { super('TEXTAREA', attrs, text); } get value() {return this._value;} set value(value) {this._value = value;} }
  class Select extends Element { constructor(attrs, text) { super('SELECT', attrs, text); } get value() {return this._value;} set value(value) {this._value = value;} }
  const location = { href: 'https://c.liepin.com/resume/edit' };
  const document = {
    title: 'Test resume', body: {},
    querySelectorAll(selector) {
      if (selector === 'div.im-ui-basic-entry-title') return elements.filter(element => element.tagName==='DIV' && (element.attrs.class||'').split(/\s+/).includes('im-ui-basic-entry-title'));
      if (selector === 'span,div') return elements.filter(element => ['SPAN','DIV'].includes(element.tagName));
      if (selector === 'button,a,label,span,div,i,svg') return elements.filter(element => ['BUTTON','A','LABEL','SPAN','DIV','I','SVG'].includes(element.tagName));
      if (selector === 'div,ul,ol,section,[role="listbox"]') return elements.filter(element=>['DIV','UL','OL','SECTION'].includes(element.tagName)||element.attrs.role==='listbox');
      return elements.filter(element => ['INPUT','TEXTAREA','SELECT','BUTTON','A','LABEL','LI','OPTION'].includes(element.tagName) || element.attrs.role || 'tabindex' in element.attrs || element.isContentEditable || element.attrs['data-nick']);
    },
    getElementById(id) {return elements.find(element => element.id === id);},
    elementFromPoint(x,y) {return this.cover || elements.find(element => {const r=element.getBoundingClientRect();return x>=r.left && x<=r.right && y>=r.top && y<=r.bottom;}) || null;},
    createTreeWalker() {
      const nodes = elements.filter(element => element.textContent).map(element => ({parentElement:element,textContent:element.textContent}));
      let index = 0; return {nextNode:() => nodes[index++] || null};
    },
  };
  class TestEvent {constructor(type,options={}) {this.type=type;Object.assign(this,options);} preventDefault(){this.defaultPrevented=true;}}
  const context = vm.createContext({
    URL, Map, Set, Promise, TextEncoder, crypto:{randomUUID:()=> 'document-test-1'}, location, document,
    getComputedStyle:element=>({display:'block',visibility:'visible',opacity:'1',cursor:'auto',...element.style}),
    NodeFilter:{SHOW_TEXT:4}, Event:TestEvent, MouseEvent:TestEvent, PointerEvent:TestEvent,
    HTMLInputElement:Input, HTMLTextAreaElement:TextArea, HTMLSelectElement:Select,
    setTimeout:callback=>setTimeout(callback, 0), window:{innerWidth:1024,innerHeight:768,scrollBy:() => {}},
    chrome:{runtime:{id:'a'.repeat(32),onMessage:{addListener(handler) {listener=handler;listenerCount++;}}}},
  });
  vm.runInContext(source, context);
  const command = async payload => {
    const result = await new Promise(resolve => listener({type:'resume-bridge-command',command:payload},{id:'a'.repeat(32)},resolve));
    await new Promise(resolve => setImmediate(resolve));
    return JSON.parse(JSON.stringify(result));
  };
  const mutation = (snapshot, action, ref, extra = {}) => ({action,ref,documentId:snapshot.documentId,expectedUrl:snapshot.url,...extra});
  return {elements,Element,Input,TextArea,Select,context,command,mutation,location,document,
    rawListener:()=>listener,count:()=>listenerCount};
}

test('visible Liepin unread entry is discoverable and remains hit-tested', async () => {
  const f=fixture(); const entry=new f.Element('DIV',{class:'im-ui-basic-entry-title'},'有新消息');
  const {result:s}=await f.command({action:'snapshot'});
  const field=s.fields.find(item=>item.label==='有新消息');
  assert.ok(field);
  const result=await f.command(f.mutation(s,'click',field.ref));
  assert.equal(result.ok,true);assert.equal(entry.clicked,true);
});

test('snapshot reads visible fields and redacts passwords and OTP fields', async () => {
  const f = fixture();
  new f.Input({'aria-label':'姓名',value:'林嘉宁'});
  new f.Input({type:'password','aria-label':'密码',value:'private-password'});
  new f.Input({'aria-label':'短信验证码',value:'123456'});
  const hidden = new f.Input({'aria-label':'hidden payload',value:'secret'}); hidden.hidden = true;
  const result = await f.command({action:'snapshot'});
  assert.equal(result.ok,true);
  assert.equal(result.result.fields.length,3);
  assert.equal(result.result.fields[0].value,'林嘉宁');
  assert.equal(result.result.fields[1].value,'[REDACTED]');
  assert.equal(result.result.fields[2].value,'[REDACTED]');
  assert.ok(!JSON.stringify(result).includes('private-password'));
  assert.ok(!JSON.stringify(result).includes('123456'));
});

test('native fill dispatches framework events and invalidates observation refs', async () => {
  const f = fixture(); const input = new f.Input({'aria-label':'姓名',value:'Original'});
  const {result:snapshot} = await f.command({action:'snapshot'});
  const fill = await f.command(f.mutation(snapshot,'fill',snapshot.fields[0].ref,{value:'林嘉宁'}));
  assert.equal(fill.ok,true); assert.equal(fill.result.verified,true); assert.equal(input.value,'林嘉宁');
  assert.deepEqual(input.events,['input','change']);
  assert.equal(input.focused,true);assert.equal(input.focusOptions.preventScroll,true);
  const retry = await f.command(f.mutation(snapshot,'fill',snapshot.fields[0].ref,{value:'again'}));
  assert.equal(retry.error.code,'STALE_REF');
});

test('new snapshot, detached elements, changed URL and document identity refuse mutation', async () => {
  const f = fixture(); const input = new f.Input({'aria-label':'姓名'});
  const {result:old} = await f.command({action:'snapshot'});
  const {result:current} = await f.command({action:'snapshot'});
  assert.equal((await f.command(f.mutation(old,'fill',old.fields[0].ref,{value:'x'}))).error.code,'STALE_REF');
  assert.equal((await f.command({...f.mutation(current,'fill',current.fields[0].ref,{value:'x'}),documentId:'different'})).error.code,'DOCUMENT_CHANGED');
  f.location.href = 'https://c.liepin.com/account';
  assert.equal((await f.command(f.mutation(current,'fill',current.fields[0].ref,{value:'x'}))).error.code,'URL_CHANGED');
  f.location.href = current.url; input.isConnected=false;
  assert.equal((await f.command(f.mutation(current,'fill',current.fields[0].ref,{value:'x'}))).error.code,'STALE_REF');
  assert.equal(input.value,'');
});

test('protected fields, disabled fields, unsupported actions and disallowed links fail closed', async () => {
  const f = fixture();
  new f.Input({type:'password','aria-label':'Password'});
  const disabled = new f.Input({'aria-label':'姓名'});disabled.disabled=true;
  new f.Element('A',{href:'https://outside.example/submit'},'Continue');
  const {result:snapshot} = await f.command({action:'snapshot'});
  assert.equal((await f.command(f.mutation(snapshot,'fill',snapshot.fields[0].ref,{value:'x'}))).error.code,'PROTECTED_FIELD');
  assert.equal((await f.command(f.mutation(snapshot,'fill',snapshot.fields[1].ref,{value:'x'}))).error.code,'DISABLED');
  assert.equal((await f.command(f.mutation(snapshot,'click',snapshot.fields[2].ref))).error.code,'LINK_NOT_ALLOWED');
  assert.equal((await f.command(f.mutation(snapshot,'evaluate',snapshot.fields[0].ref))).error.code,'UNSUPPORTED_ACTION');
});

test('select validates options and fill detects controlled input rejection', async () => {
  const f = fixture(); const select = new f.Select({'aria-label':'学历'});
  select.options = [{value:'bachelor',text:'本科',disabled:false},{value:'phd',text:'博士',disabled:true}];
  let {result:snapshot} = await f.command({action:'snapshot'});
  assert.equal((await f.command(f.mutation(snapshot,'select',snapshot.fields[0].ref,{value:'phd'}))).error.code,'INVALID_OPTION');
  assert.equal((await f.command(f.mutation(snapshot,'select',snapshot.fields[0].ref,{value:'bachelor'}))).result.verified,true);
  const input = new f.Input({'aria-label':'姓名'}); input.onEvent=()=>{input.value='rejected';};
  ({result:snapshot} = await f.command({action:'snapshot'}));
  const result = await f.command(f.mutation(snapshot,'fill',snapshot.fields[1].ref,{value:'accepted'}));
  assert.equal(result.error.code,'VALUE_NOT_RETAINED');
});

test('sender guard and sentinel prevent foreign commands and duplicate handlers', async () => {
  const f=fixture(); let called=false;
  assert.equal(f.rawListener()({type:'resume-bridge-command',command:{action:'snapshot'}},{id:'b'.repeat(32)},()=>{called=true;}),false);
  assert.equal(called,false);
  vm.runInContext(source,f.context);assert.equal(f.count(),1);
});

test('off-domain documents cannot be inspected', async () => {
  const f=fixture(); f.location.href='https://c.liepin.com.attacker.example/';
  assert.equal((await f.command({action:'snapshot'})).error.code,'SITE_NOT_ALLOWED');
});

test('expiry, offscreen and covered-element checks reject mutations', async () => {
  const f=fixture();const input=new f.Input({'aria-label':'姓名'});
  const {result:snapshot}=await f.command({action:'snapshot'});
  const fill=f.mutation(snapshot,'fill',snapshot.fields[0].ref,{value:'new'});
  assert.equal((await f.command({...fill,expiresAt:Date.now()-1})).error.code,'COMMAND_EXPIRED');
  input.rect={left:0,right:200,top:900,bottom:925};
  assert.equal((await f.command(fill)).error.code,'ELEMENT_OFFSCREEN');
  input.rect=null;f.document.cover=new f.Element('DIV',{class:'modal-overlay'},'Overlay');
  assert.equal((await f.command(fill)).error.code,'ELEMENT_COVERED');
  assert.equal(input.value,'');
});

test('scroll uses bounded direction protocol and invalidates references', async () => {
  const f=fixture();new f.Input({'aria-label':'姓名'});
  const {result:snapshot}=await f.command({action:'snapshot'});
  assert.equal((await f.command(f.mutation(snapshot,'scroll',undefined,{direction:'up',pixels:4000}))).result.pixels,-4000);
  assert.equal((await f.command(f.mutation(snapshot,'scroll',undefined,{direction:'sideways',pixels:10}))).error.code,'INVALID_VALUE');
});

test('unapproved subdomains and nonstandard ports are rejected', async () => {
  const f=fixture();
  for(const url of ['https://other.liepin.com/','https://c.liepin.com:8443/','https://user@c.liepin.com/']) {
    f.location.href=url;assert.equal((await f.command({action:'snapshot'})).error.code,'SITE_NOT_ALLOWED');
  }
});

test('snapshot exposes link and icon UI metadata with nearby resume context', async () => {
  const f=fixture();
  const section=new f.Element('DIV',{class:'resume-section'},'工作经历 示例公司 编辑');
  const link=new f.Element('A',{href:'/web/geek/resume',id:'edit-work',class:'icon-edit'});
  link.parentElement=section;section.children=[link];
  link.rect={left:12.25,right:32.25,top:40.05,bottom:60.05};
  const {result:snapshot}=await f.command({action:'snapshot'});
  const observed=snapshot.fields.find(field=>field.id==='edit-work');
  assert.equal(observed.href,'/web/geek/resume');
  assert.equal(observed.class,'icon-edit');
  assert.equal(observed.nearContext,'工作经历 示例公司 编辑');
  assert.equal(observed.rect.width,20);
  assert.equal(observed.rect.left,12.3);
});

test('snapshot discovers tabindex, labels, listboxes and leaf pointer controls', async () => {
  const f=fixture();
  new f.Element('DIV',{tabindex:'0','aria-label':'添加期望'});
  new f.Element('LABEL',{},'姓名');
  new f.Element('DIV',{role:'listbox','aria-label':'城市'});
  const wrapper=new f.Element('DIV');wrapper.style={cursor:'pointer'};
  const icon=new f.Element('I',{class:'icon-edit'});icon.style={cursor:'pointer'};icon.parentElement=wrapper;wrapper.children=[icon];
  const {result:snapshot}=await f.command({action:'snapshot'});
  assert.ok(snapshot.fields.some(field=>field.label==='添加期望'));
  assert.ok(snapshot.fields.some(field=>field.tag==='label'));
  assert.ok(snapshot.fields.some(field=>field.role==='listbox'));
  assert.ok(snapshot.fields.some(field=>field.class==='icon-edit'));
});

test('candidate limit preserves form controls over a large footer', async () => {
  const f=fixture();
  for(let i=0;i<550;i++) {const link=new f.Element('A',{href:'/footer/'+i},'footer '+i);link.region='footer';}
  const input=new f.Input({'aria-label':'姓名'});input.region='form';
  new f.Element('SPAN',{class:'resume-edit'},'编辑');
  const {result:snapshot}=await f.command({action:'snapshot'});
  assert.equal(snapshot.fields.length,500);
  assert.equal(snapshot.truncated,true);
  assert.equal(snapshot.totalCandidateCount,552);
  assert.ok(snapshot.fields.some(field=>field.label==='姓名'));
  assert.ok(snapshot.fields.some(field=>field.label==='编辑'));
});

test('read-only date controls can be clicked but cannot be filled', async () => {
  const f=fixture();const input=new f.Input({'aria-label':'结束年月'});input.readOnly=true;
  const {result:snapshot}=await f.command({action:'snapshot'});
  assert.equal(snapshot.fields[0].readOnly,true);
  assert.equal((await f.command(f.mutation(snapshot,'fill',snapshot.fields[0].ref,{value:'2026-10'}))).error.code,'READ_ONLY');
  assert.equal((await f.command(f.mutation(snapshot,'click',snapshot.fields[0].ref))).ok,true);
  assert.equal(input.clicked,true);
});

test('visible list options are observed and hidden options are excluded', async () => {
  const f=fixture();new f.Element('LI',{},'离职-随时到岗');
  new f.Element('OPTION',{},'在职-考虑机会');
  const hidden=new f.Element('LI',{},'hidden option');hidden.hidden=true;
  const {result:snapshot}=await f.command({action:'snapshot'});
  assert.deepEqual(snapshot.fields.map(field=>field.label),['离职-随时到岗','在职-考虑机会']);
});

test('click sends pointer and mouse sequence with focus before click', async () => {
  const f=fixture();const input=new f.Input({'aria-label':'学历'});const sequence=[];
  input.onEvent=event=>sequence.push(event.type);input.onFocus=()=>sequence.push('focus');input.onClick=()=>sequence.push('click');
  const {result:snapshot}=await f.command({action:'snapshot'});
  assert.equal((await f.command(f.mutation(snapshot,'click',snapshot.fields[0].ref))).ok,true);
  assert.deepEqual(sequence,['pointerover','pointerenter','mouseover','mouseenter','pointerdown','mousedown','focus','pointerup','mouseup','click']);
  assert.equal(input.focusOptions.preventScroll,true);
});

test('click honors canceled mousedown focus and stops when control detaches', async () => {
  const f=fixture();const input=new f.Input({'aria-label':'学历'});
  input.onEvent=event=>{if(event.type==='mousedown')event.preventDefault();};
  let {result:snapshot}=await f.command({action:'snapshot'});
  assert.equal((await f.command(f.mutation(snapshot,'click',snapshot.fields[0].ref))).ok,true);
  assert.equal(input.focused,undefined);assert.equal(input.clicked,true);
  input.clicked=false;input.onEvent=event=>{if(event.type==='mousedown')input.isConnected=false;};
  ({result:snapshot}=await f.command({action:'snapshot'}));
  assert.equal((await f.command(f.mutation(snapshot,'click',snapshot.fields[0].ref))).error.code,'TARGET_CHANGED');
  assert.equal(input.clicked,false);
});

test('fill focuses before input and refuses detached focused control', async () => {
  const f=fixture();const input=new f.Input({'aria-label':'学校'});const sequence=[];
  input.onFocus=()=>sequence.push('focus');input.onEvent=event=>sequence.push(event.type);
  let {result:snapshot}=await f.command({action:'snapshot'});
  assert.equal((await f.command(f.mutation(snapshot,'fill',snapshot.fields[0].ref,{value:'广东财经大学'}))).ok,true);
  assert.deepEqual(sequence,['focus','input','change']);
  ({result:snapshot}=await f.command({action:'snapshot'}));input.onFocus=()=>{input.isConnected=false;};
  assert.equal((await f.command(f.mutation(snapshot,'fill',snapshot.fields[0].ref,{value:'other'}))).error.code,'TARGET_CHANGED');
  assert.equal(input.value,'广东财经大学');
});

test('click targets observed center descendant and retains ancestor link protection', async () => {
  const f=fixture();const wrapper=new f.Element('DIV',{role:'combobox',tabindex:'0'});
  const selector=new f.Element('SPAN',{class:'ant-select-selector'},'外贸业务员');
  wrapper.children=[selector];selector.parentElement=wrapper;f.document.cover=selector;
  let {result:snapshot}=await f.command({action:'snapshot'});
  assert.equal((await f.command(f.mutation(snapshot,'click',snapshot.fields.find(field=>field.role==='combobox').ref))).ok,true);
  assert.equal(wrapper.clicked,undefined);assert.equal(selector.clicked,true);assert.equal(wrapper.focused,true);
  assert.deepEqual(selector.events,['pointerover','pointerenter','mouseover','mouseenter','pointerdown','mousedown','pointerup','mouseup','click']);
  const badLink=new f.Element('A',{href:'https://outside.example/'});badLink.children=[selector];selector.parentElement=badLink;wrapper.children=[badLink];badLink.parentElement=wrapper;
  ({result:snapshot}=await f.command({action:'snapshot'}));
  assert.equal((await f.command(f.mutation(snapshot,'click',snapshot.fields.find(field=>field.role==='combobox').ref))).error.code,'LINK_NOT_ALLOWED');
});

test('covered field reports UI metadata and actual cover appears in snapshot', async () => {
  const f=fixture();const input=new f.Input({'aria-label':'选择在职时间'});
  const picker=new f.Element('DIV',{class:'date-picker-trigger'},'选择在职时间');f.document.cover=picker;
  const {result:snapshot}=await f.command({action:'snapshot'});
  const field=snapshot.fields.find(field=>field.tag==='input');
  assert.equal(field.coveredBy.class,'date-picker-trigger');
  assert.ok(snapshot.fields.some(field=>field.class==='date-picker-trigger'));
  const result=await f.command(f.mutation(snapshot,'click',field.ref));
  assert.equal(result.error.code,'ELEMENT_COVERED');
  assert.equal(result.error.details.coveredBy.class,'date-picker-trigger');
  assert.equal(input.clicked,undefined);
});

test('empty contenteditable attribute is observed and filled', async () => {
  const f=fixture();const editor=new f.Element('DIV',{contenteditable:'','aria-label':'工作内容'});
  const {result:snapshot}=await f.command({action:'snapshot'});
  assert.equal(snapshot.fields[0].label,'工作内容');
  assert.equal((await f.command(f.mutation(snapshot,'fill',snapshot.fields[0].ref,{value:'客户开发'}))).ok,true);
  assert.equal(editor.textContent,'客户开发');
});

test('scoped scroll resolves visible scrollable ancestor without scrolling window', async () => {
  const f=fixture();const menu=new f.Element('DIV',{role:'listbox',class:'salary-dropdown'});
  menu.style={overflowY:'auto'};menu.scrollTop=200;menu.scrollHeight=1000;menu.clientHeight=200;
  const option=new f.Element('LI',{},'10k');option.parentElement=menu;menu.children=[option];
  const {result:snapshot}=await f.command({action:'snapshot'});
  assert.equal(snapshot.fields.find(field=>field.role==='listbox').scrollTop,200);
  const result=await f.command(f.mutation(snapshot,'scroll',snapshot.fields.find(field=>field.label==='10k').ref,{direction:'up',pixels:150}));
  assert.equal(result.ok,true);assert.equal(result.result.scope,'element');assert.equal(menu.scrollTop,50);
  assert.equal(result.result.moved,true);assert.ok(menu.events.includes('scroll'));
});

test('scoped scroll rejects non-scrollable and covered references', async () => {
  const f=fixture();const input=new f.Input({'aria-label':'姓名'});
  let {result:snapshot}=await f.command({action:'snapshot'});
  assert.equal((await f.command(f.mutation(snapshot,'scroll',snapshot.fields[0].ref,{direction:'down',pixels:100}))).error.code,'NOT_SCROLLABLE');
  f.document.cover=new f.Element('DIV',{class:'mask'},'遮挡');
  ({result:snapshot}=await f.command({action:'snapshot'}));
  assert.equal((await f.command(f.mutation(snapshot,'scroll',snapshot.fields.find(field=>field.tag==='input').ref,{direction:'down',pixels:100}))).error.code,'ELEMENT_COVERED');
});

test('visible wrapper may click its transparent AntD input hit without exposing an input ref', async () => {
  const f=fixture();const wrapper=new f.Element('DIV',{role:'combobox',class:'ant-c-select'},'请选择');
  const input=new f.Input({id:'degreeCode','aria-label':'熟练程度'});input.style={opacity:'0'};
  wrapper.children=[input];input.parentElement=wrapper;f.document.cover=input;
  const {result:snapshot}=await f.command({action:'snapshot'});
  assert.equal(snapshot.fields.length,1);assert.equal(snapshot.fields[0].tag,'div');
  const result=await f.command(f.mutation(snapshot,'click',snapshot.fields[0].ref));
  assert.equal(result.ok,true);assert.equal(input.clicked,true);assert.equal(input.focused,true);
  assert.deepEqual(input.events,['pointerover','pointerenter','mouseover','mouseenter','pointerdown','mousedown','pointerup','mouseup','click']);
});

test('transparent-hit exception does not permit password, disabled, hidden or unrelated controls', async () => {
  for(const kind of ['password','disabled','hidden','unrelated','noninput']) {
    const f=fixture();const wrapper=new f.Element('DIV',{role:'combobox'},'请选择');
    const input=kind==='noninput' ? new f.Element('DIV') : new f.Input({type:kind==='password'?'password':'text','aria-label':'语言'});
    input.style={opacity:'0'};if(kind==='hidden')input.hidden=true;if(kind==='disabled')input.disabled=true;
    if(kind!=='unrelated'){wrapper.children=[input];input.parentElement=wrapper;}f.document.cover=input;
    const {result:snapshot}=await f.command({action:'snapshot'});
    const result=await f.command(f.mutation(snapshot,'click',snapshot.fields[0].ref));
    assert.equal(result.ok,false,kind);assert.notEqual(input.clicked,true,kind);
  }
});

test('transparent input must remain the top hit throughout interaction', async () => {
  const f=fixture();const wrapper=new f.Element('DIV',{role:'combobox'},'请选择');
  const input=new f.Input({'aria-label':'语言'});input.style={opacity:'0'};wrapper.children=[input];input.parentElement=wrapper;f.document.cover=input;
  const overlay=new f.Element('DIV',{class:'dialog-layer'});
  const {result:snapshot}=await f.command({action:'snapshot'});
  input.onEvent=event=>{if(event.type==='pointerdown')f.document.cover=overlay;};
  const result=await f.command(f.mutation(snapshot,'click',snapshot.fields.find(field=>field.role==='combobox').ref));
  assert.equal(result.error.code,'TARGET_CHANGED');assert.notEqual(input.clicked,true);
});

test('visible observed wrapper may click its exact decorative aria-hidden SVG center hit', async () => {
  const f=fixture();const wrapper=new f.Element('SPAN',{role:'button'},'选择行业');
  const svg=new f.Element('SVG',{'aria-hidden':'true'});wrapper.children=[svg];svg.parentElement=wrapper;f.document.cover=svg;
  const {result:snapshot}=await f.command({action:'snapshot'});
  const field=snapshot.fields.find(item=>item.tag==='span');
  assert.ok(field);
  const result=await f.command(f.mutation(snapshot,'click',field.ref));
  assert.equal(result.ok,true);assert.equal(svg.clicked,true);
  assert.ok(svg.events.includes('click'));
});

test('decorative SVG exception rejects hidden and newly covered hits', async () => {
  for(const kind of ['hidden','covered']) {
    const f=fixture();const wrapper=new f.Element('SPAN',{role:'button'},'选择行业');
    const svg=new f.Element('SVG',{'aria-hidden':'true'});wrapper.children=[svg];svg.parentElement=wrapper;f.document.cover=svg;
    const {result:snapshot}=await f.command({action:'snapshot'});
    const field=snapshot.fields.find(item=>item.tag==='span');
    if(kind==='hidden') svg.hidden=true;
    else svg.onEvent=event=>{if(event.type==='pointerover')f.document.cover=new f.Element('DIV',{class:'overlay'});};
    const result=await f.command(f.mutation(snapshot,'click',field.ref));
    assert.equal(result.ok,false,kind);assert.notEqual(svg.clicked,true,kind);
  }
});

test('visible rc virtual-list holder with overflow hidden supports scoped scrolling', async () => {
  const f=fixture();const holder=new f.Element('DIV',{class:'rc-virtual-list-holder'});
  holder.style={overflowY:'hidden'};holder.scrollTop=200;holder.scrollHeight=800;holder.clientHeight=200;
  const inner=new f.Element('DIV',{class:'rc-virtual-list-holder-inner'});inner.parentElement=holder;holder.children=[inner];
  const option=new f.Element('LI',{},'10k');option.parentElement=inner;inner.children=[option];
  const {result:snapshot}=await f.command({action:'snapshot'});
  assert.ok(snapshot.fields.some(field=>field.class==='rc-virtual-list-holder' && field.scrollTop===200));
  const field=snapshot.fields.find(field=>field.label==='10k');
  assert.equal(field.ancestorScroll[1].class,'rc-virtual-list-holder');
  assert.equal(field.ancestorScroll[1].overflowY,'hidden');
  assert.equal(field.ancestorScroll[1].scrollHeight,800);
  const result=await f.command(f.mutation(snapshot,'scroll',field.ref,{direction:'up',pixels:100}));
  assert.equal(result.ok,true);assert.equal(holder.scrollTop,100);
});

test('overflow hidden is not broadly treated as a scrollable control', async () => {
  for(const className of ['ordinary-clipped-container','rc-virtual-list-holder-inner','not-rc-virtual-list-holder']) {
    const f=fixture();const holder=new f.Element('DIV',{class:className});
    holder.style={overflowY:'hidden'};holder.scrollHeight=800;holder.clientHeight=200;
    const option=new f.Element('LI',{},'10k');option.parentElement=holder;holder.children=[option];
    const {result:snapshot}=await f.command({action:'snapshot'});
    const field=snapshot.fields.find(field=>field.label==='10k');
    assert.equal((await f.command(f.mutation(snapshot,'scroll',field.ref,{direction:'up',pixels:100}))).error.code,'NOT_SCROLLABLE',className);
  }
});

test('click enters observed ancestor before descendant for cascading-menu handlers', async () => {
  const f=fixture();const parent=new f.Element('LI',{class:'ui-select-item-arrow'},'本科');
  const text=new f.Element('SPAN',{},'本科');parent.children=[text];text.parentElement=parent;f.document.cover=text;
  const entered=[];
  parent.onEvent=event=>{if(event.type==='mouseenter'){assert.equal(event.bubbles,false);entered.push('parent');}};
  text.onEvent=event=>{if(event.type==='mouseenter')entered.push('text');};
  const {result:snapshot}=await f.command({action:'snapshot'});
  const result=await f.command(f.mutation(snapshot,'click',snapshot.fields.find(field=>field.tag==='li').ref));
  assert.equal(result.ok,true);assert.deepEqual(entered,['parent','text']);
  assert.deepEqual(parent.events,['pointerenter','mouseenter']);assert.equal(text.clicked,true);
});

test('hover-triggered detached controls stop before a click is dispatched', async () => {
  const f=fixture();const input=new f.Input({'aria-label':'选择学历'});
  input.onEvent=event=>{if(event.type==='mouseover')input.isConnected=false;};
  const {result:snapshot}=await f.command({action:'snapshot'});
  const result=await f.command(f.mutation(snapshot,'click',snapshot.fields[0].ref));
  assert.equal(result.error.code,'TARGET_CHANGED');assert.notEqual(input.clicked,true);
});

test('existing exact inert JavaScript UI anchors support normal clicking', async () => {
  for(const href of ['javascript:;','javascript:void(0)','javascript:void(0);',' JAVASCRIPT:void(0); ']) {
    const f=fixture();const item=new f.Element('LI',{},'上海');
    const anchor=new f.Element('A',{href},'上海');item.children=[anchor];anchor.parentElement=item;f.document.cover=anchor;
    const {result:snapshot}=await f.command({action:'snapshot'});
    const result=await f.command(f.mutation(snapshot,'click',snapshot.fields.find(field=>field.tag==='li').ref));
    assert.equal(result.ok,true,href);assert.equal(anchor.clicked,true,href);
  }
});

test('non-inert JavaScript URLs remain blocked including case-sensitive function names', async () => {
  for(const href of ['javascript:alert(1)','javascript:VOID(0)','javascript:;save()','javascript:void(fetch("/api"))','javascript:void(0);save()']) {
    const f=fixture();const anchor=new f.Element('A',{href},'确认');
    const {result:snapshot}=await f.command({action:'snapshot'});
    const result=await f.command(f.mutation(snapshot,'click',snapshot.fields[0].ref));
    assert.equal(result.error.code,'LINK_NOT_ALLOWED',href);assert.notEqual(anchor.clicked,true,href);
  }
});

test('viewport city options survive cap ahead of offscreen form controls', async () => {
  const f=fixture();
  for(let i=0;i<550;i++) {const field=new f.Input({'aria-label':'offscreen '+i});field.region='form';field.rect={left:0,right:200,top:2000+i*30,bottom:2025+i*30};}
  const city=new f.Element('A',{href:'javascript:;'},'宁波');city.rect={left:300,right:400,top:200,bottom:230};
  const {result:snapshot}=await f.command({action:'snapshot'});
  assert.equal(snapshot.fieldLimit,500);
  assert.equal(snapshot.truncated,true);
  assert.equal(snapshot.fields[0].label,'宁波');
  assert.ok(snapshot.truncatedReasons.includes('candidate-limit'));
});

test('snapshot byte budget stays below transport cap and excludes unseen references', async () => {
  const f=fixture();
  for(let i=0;i<40;i++)new f.TextArea({'aria-label':'经历'+i,value:'中'.repeat(20000)});
  const {result:snapshot}=await f.command({action:'snapshot'});
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot),'utf8')<448*1024);
  assert.equal(snapshot.truncated,true);
  assert.ok(snapshot.truncatedReasons.includes('result-byte-limit'));
  assert.ok(snapshot.fields.length<40);
  assert.equal((await f.command(f.mutation(snapshot,'fill',`1:${snapshot.fields.length+1}`,{value:'x'}))).error.code,'STALE_REF');
});
