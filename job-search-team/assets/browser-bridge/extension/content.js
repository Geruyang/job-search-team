/* Runs only in the extension isolated world. No debugger/CDP, eval, or page internals. */
(() => {
  if (globalThis.__resumeBridgeContentInstalled) return;
  globalThis.__resumeBridgeContentInstalled = true;

  const documentId = crypto.randomUUID();
  let generation = 0;
  let refs = new Map();
  let busy = false;
  const MAX_FIELDS = 500;
  const MAX_SNAPSHOT_BYTES = 448 * 1024; // Leave room for the bridge result envelope (512 KiB transport cap).
  const MAX_TEXT = 16000;
  const MAX_VALUE = 20000;
  const HOSTS = new Set(['www.liepin.com', 'c.liepin.com', 'www.zhipin.com', 'cv.zhipin.com']);
  const AUTH = /password|passwd|otp|one.?time|verification|verify.?code|captcha|sms.?code|auth.?code|验证码|校验码|密码|口令|短信码|安全码|登录|登入|注册|sign.?in|log.?in/i;
  const ACTION_TEXT = /^(编辑|添加|新增|保存|取消|确定|完成|展开|收起|下一步|上一步|删除|修改|编辑简历)$/;
  const fail = (code, message, details) => { const error = new Error(message); error.code = code; if (details) error.details = details; throw error; };
  const clean = (value, limit = 500) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);

  function allowedPage() {
    const url = new URL(location.href);
    return url.protocol === 'https:' && HOSTS.has(url.hostname) && !url.username && !url.password && !url.port;
  }

  function visible(element) {
    if (!element?.isConnected || element.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    return element.getClientRects().length > 0;
  }

  function label(element) {
    const labelledBy = (element.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)
      .map(id => document.getElementById(id)).filter(node => node && visible(node)).map(node => node.innerText || node.textContent).join(' ');
    return clean(element.getAttribute('aria-label') || labelledBy ||
      Array.from(element.labels || []).map(node => node.innerText || node.textContent).join(' ') ||
      element.getAttribute('placeholder') || element.getAttribute('title') ||
      (element.tagName === 'INPUT' ? element.getAttribute('value') && /^(button|submit|reset)$/.test(element.type) ? element.value : '' : element.innerText || element.textContent), 300);
  }

  function protectedElement(element) {
    const hint = [element.getAttribute('type'), element.getAttribute('name'), element.id,
      element.getAttribute('autocomplete'), label(element)].join(' ');
    if (element.tagName === 'INPUT' && ['password', 'file', 'hidden'].includes(element.type)) return true;
    if (AUTH.test(hint)) return true;
    const form = element.closest('form');
    if (form && Array.from(form.querySelectorAll('input')).some(input =>
      visible(input) && (input.type === 'password' || AUTH.test([input.name, input.id, input.autocomplete, input.placeholder].join(' '))))) return true;
    return false;
  }

  function fingerprint(element) {
    return JSON.stringify([element.tagName, element.getAttribute('role'), element.getAttribute('type'),
      element.getAttribute('name'), element.getAttribute('href'), label(element)]);
  }

  function candidates() {
    const regular = Array.from(document.querySelectorAll('button,a,input,textarea,select,label,li,option,[tabindex],[contenteditable],[role="button"],[role="textbox"],[role="combobox"],[role="listbox"],[role="menuitem"],[role="checkbox"],[role="radio"],[role="option"],[role="tab"],[data-nick="resume-edit-icon"]')).filter(element => element.getAttribute('contenteditable') === null || element.isContentEditable || ['INPUT','TEXTAREA','SELECT','BUTTON','A','LABEL','LI','OPTION'].includes(element.tagName) || element.getAttribute('role') || element.getAttribute('tabindex') !== null);
    const plainActions = Array.from(document.querySelectorAll('span,div')).filter(element =>
      element.children.length === 0 && ACTION_TEXT.test(clean(element.innerText || element.textContent)));
    // Liepin's visible unread-message entry has no button role or pointer cursor.
    // Expose that observed entry without changing the normal visibility/hit checks.
    const unreadEntries = Array.from(document.querySelectorAll('div.im-ui-basic-entry-title'))
      .filter(element => clean(element.innerText || element.textContent) === '有新消息');
    const pointerControls = Array.from(document.querySelectorAll('button,a,label,span,div,i,svg')).slice(0, 6000).filter(element => {
      if (!visible(element) || getComputedStyle(element).cursor !== 'pointer') return false;
      const parent = element.parentElement;
      return !parent || getComputedStyle(parent).cursor !== 'pointer' || element.children.length === 0;
    });
    const scrollContainers = Array.from(document.querySelectorAll('div,ul,ol,section,[role="listbox"]')).slice(0,6000).filter(element => visible(element) && scrollable(element));
    const covers = regular.filter(element => visible(element) && (['INPUT','TEXTAREA','SELECT'].includes(element.tagName) || element.isContentEditable)).map(element => centerHit(element)?.hit)
      .filter(element => element && visible(element) && !['BODY','HTML'].includes(element.tagName));
    let found = Array.from(new Set([...regular, ...plainActions, ...unreadEntries, ...pointerControls, ...scrollContainers, ...covers])).filter(visible);
    const total = found.length;
    if (total > 250) {
      const score = element => {
        let value = 0;
        if (element.closest('footer,[role="contentinfo"]')) value -= 100;
        if (element.closest('header,nav,[role="navigation"]')) value -= 60;
        if (element.closest('form,[role="dialog"],dialog,fieldset')) value += 60;
        if (element.closest('[role="listbox"],[role="menu"],[class*="dropdown"],[class*="select-dropdown"],[class*="picker-panel"]')) value += 70;
        if (['INPUT','TEXTAREA','SELECT'].includes(element.tagName) || element.isContentEditable) value += 50;
        if (ACTION_TEXT.test(label(element))) value += 40;
        if (/edit|resume|experience|section|field|form|skill|education|expect|picker|date/i.test([element.id,element.getAttribute('class'),element.parentElement?.getAttribute('class')].join(' '))) value += 25;
        if (protectedElement(element)) value -= 150;
        const rect = element.getBoundingClientRect();
        if (rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth) {
          value += 200;
          const hit = centerHit(element)?.hit;
          if (hit && (hit === element || element.contains(hit))) value += 150;
        }
        return value;
      };
      found = found.map((element,index) => ({element,index,score:score(element)}))
        .sort((a,b) => b.score-a.score || a.index-b.index).slice(0,MAX_FIELDS).map(item=>item.element);
    }
    return {elements:found.slice(0,MAX_FIELDS),total};
  }

  function nearContext(element) {
    const own = clean(element.innerText || element.textContent, 1201);
    let parent = element.parentElement;
    for (let depth = 0; parent && depth < 5; depth++, parent = parent.parentElement) {
      if (['BODY','HTML'].includes(parent.tagName)) break;
      if (!visible(parent)) continue;
      const text = clean(typeof parent.innerText === 'string' ? parent.innerText : '', 1201);
      if (text && text !== own && text.length <= 1200) return text.slice(0,500);
    }
    return own.slice(0,500);
  }

  function bounds(element) {
    const rect = element.getBoundingClientRect();
    const rounded = value => Number.isFinite(value) ? Math.round(value * 10) / 10 : 0;
    return {left:rounded(rect.left),top:rounded(rect.top),right:rounded(rect.right),bottom:rounded(rect.bottom),
      width:rounded(rect.width ?? rect.right-rect.left),height:rounded(rect.height ?? rect.bottom-rect.top)};
  }

  function scrollable(element) {
    const overflow = getComputedStyle(element).overflowY;
    const visibleVirtualList = overflow === 'hidden' && /(?:^|\s)rc-virtual-list-holder(?:\s|$)/.test(element.getAttribute('class') || '') && visible(element);
    return (['auto','scroll'].includes(overflow) || visibleVirtualList) && element.scrollHeight > element.clientHeight + 1 && element.clientHeight > 0;
  }

  function ancestorScrollMetadata(element) {
    const ancestors = [];
    let parent = element.parentElement;
    for (let depth = 0; parent && depth < 3; depth++, parent = parent.parentElement) {
      ancestors.push({tag:parent.tagName.toLowerCase(),class:clean(parent.getAttribute('class'),160),
        overflowY:clean(getComputedStyle(parent).overflowY,20),clientHeight:parent.clientHeight || 0,
        scrollHeight:parent.scrollHeight || 0,scrollTop:parent.scrollTop || 0,visible:visible(parent)});
    }
    return ancestors;
  }

  function centerHit(element) {
    const rect = element.getBoundingClientRect();
    const left = Math.max(0, rect.left), right = Math.min(window.innerWidth, rect.right);
    const top = Math.max(0, rect.top), bottom = Math.min(window.innerHeight, rect.bottom);
    if (right <= left || bottom <= top) return null;
    const clientX = (left + right) / 2, clientY = (top + bottom) / 2;
    return {hit:document.elementFromPoint(clientX,clientY),clientX,clientY};
  }

  function uiMetadata(element) {
    return element ? {tag:element.tagName.toLowerCase(),id:clean(element.id,200),class:clean(element.getAttribute('class'),300),label:label(element),rect:bounds(element)} : null;
  }

  function visibleText() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const chunks = [];
    let size = 0;
    let scanned = 0;
    let node;
    while ((node = walker.nextNode()) && scanned++ < 15000 && size < MAX_TEXT) {
      const element = node.parentElement;
      if (!element || !visible(element) || element.isContentEditable || element.closest('script,style,noscript,textarea')) continue;
      const text = clean(node.textContent, MAX_TEXT - size);
      if (text) { chunks.push(text); size += text.length + 1; }
    }
    return chunks.join('\n').slice(0, MAX_TEXT);
  }

  function snapshot() {
    generation++;
    refs = new Map();
    const observed = candidates();
    let fields = observed.elements.map((element, index) => {
      const ref = `${generation}:${index + 1}`;
      const protectedField = protectedElement(element);
      refs.set(ref, { element, fingerprint: fingerprint(element) });
      const field = { ref, tag: element.tagName.toLowerCase(), role: element.getAttribute('role') || '',
        label: label(element), type: element.getAttribute('type') || '',
        id: clean(element.id,200), class: clean(element.getAttribute('class'),300),
        rect: bounds(element), nearContext: protectedField ? '[REDACTED]' : nearContext(element), ancestorScroll:ancestorScrollMetadata(element),
        disabled: !!element.disabled || element.getAttribute('aria-disabled') === 'true', readOnly: !!element.readOnly, protected: protectedField };
      if (element.tagName === 'A') field.href = clean(element.getAttribute('href'),2000);
      if (scrollable(element)) { field.scrollTop = element.scrollTop; field.scrollHeight = element.scrollHeight; field.clientHeight = element.clientHeight; }
      const hit = centerHit(element)?.hit;
      if (hit && hit !== element && !element.contains(hit)) field.coveredBy = uiMetadata(hit);
      if (!protectedField && ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)) field.value = String(element.value ?? '').slice(0, MAX_VALUE);
      if (!protectedField && element.isContentEditable) field.value = (element.innerText || element.textContent || '').slice(0, MAX_VALUE);
      if (!protectedField && element.tagName === 'SELECT') field.options = Array.from(element.options).slice(0, 150).map(option => ({value: option.value, text: clean(option.text), disabled: option.disabled}));
      if (!protectedField && /^(checkbox|radio)$/.test(element.type)) field.checked = !!element.checked;
      if (protectedField) field.value = '[REDACTED]';
      return field;
    });
    const base = {documentId,url:location.href,title:clean(document.title,500),text:visibleText(),capabilities:['open-in-same-tab']};
    const encoder = new TextEncoder();
    let bytes = encoder.encode(JSON.stringify(base)).byteLength + 1024;
    let count = 0;
    for (const field of fields) {
      const size = encoder.encode(JSON.stringify(field)).byteLength + 1;
      if (bytes + size > MAX_SNAPSHOT_BYTES) break;
      bytes += size;
      count++;
    }
    const byteLimited = count < fields.length;
    for (const field of fields.slice(count)) refs.delete(field.ref);
    fields = fields.slice(0,count);
    return {...base,fields,fieldLimit:MAX_FIELDS,totalCandidateCount:observed.total,truncated:observed.total > fields.length,
      truncatedReasons:[...(observed.total > MAX_FIELDS ? ['candidate-limit'] : []),...(byteLimited ? ['result-byte-limit'] : [])]};
  }

  function target(command) {
    const entry = refs.get(command.ref);
    if (!entry) fail('STALE_REF', 'Reference is unknown or from an older snapshot; take a new snapshot.');
    const element = entry.element;
    if (!visible(element) || fingerprint(element) !== entry.fingerprint) fail('STALE_REF', 'The observed element changed or disappeared; take a new snapshot.');
    if (element.disabled || element.getAttribute('aria-disabled') === 'true') fail('DISABLED', 'Element is disabled.');
    if (element.readOnly && ['fill','select'].includes(command.action)) fail('READ_ONLY', 'Read-only controls can be opened with click, but cannot be filled directly.');
    if (protectedElement(element)) fail('PROTECTED_FIELD', 'Authentication, verification, password and file controls must be handled by the user.');
    return element;
  }

  function checkExpiry(command) {
    if (command.expiresAt === undefined) return;
    const expiry = typeof command.expiresAt === 'number' ? command.expiresAt : Date.parse(command.expiresAt);
    if (!Number.isFinite(expiry) || expiry <= Date.now()) fail('COMMAND_EXPIRED', 'Command lease expired; do not retry a write automatically.');
  }

  function checkUncovered(element) {
    const observation = centerHit(element);
    if (!observation) fail('ELEMENT_OFFSCREEN', 'Element is outside the viewport; scroll and take a new snapshot.');
    const {hit} = observation;
    if (!hit || (hit !== element && !element.contains(hit))) fail('ELEMENT_COVERED', 'Another page element covers this control; resolve the overlay and take a new snapshot.',{coveredBy:uiMetadata(hit)});
    return observation;
  }

  function validateMutation(command) {
    if (!command.documentId || command.documentId !== documentId) fail('DOCUMENT_CHANGED', 'Document changed; take a new snapshot.');
    if (!command.expectedUrl || command.expectedUrl !== location.href) fail('URL_CHANGED', 'URL differs from the observed page; take a new snapshot.');
  }

  function setNativeValue(element, value) {
    const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (!setter) fail('UNSUPPORTED_CONTROL', 'Native value setter is unavailable.');
    setter.call(element, value);
  }

  function transparentInputHit(element, context) {
    if (!context || element.tagName !== 'INPUT' || element !== context.hit || context.wrapper === element ||
      !visible(context.wrapper) || !context.wrapper.contains(element) || !element.isConnected ||
      element.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
    const style = getComputedStyle(element);
    if (Number(style.opacity) !== 0 || style.display === 'none' || ['hidden','collapse'].includes(style.visibility) || element.getClientRects().length === 0) return false;
    // AntD select inputs can be transparent while remaining the normal mouse hit target.
    // This exception is limited to that observed hit inside a visible wrapper, never discovery.
    return document.elementFromPoint(context.clientX,context.clientY) === element;
  }

  function decorativeSvgHit(element, context) {
    if (!context || context.wrapper === element || !element?.isConnected ||
      !visible(context.wrapper) || !context.wrapper.contains(element) ||
      element.closest('[hidden],[inert]')) return false;
    const svg = element.tagName === 'SVG' ? element : element.closest('svg');
    if (!svg || svg.getAttribute('aria-hidden') !== 'true' ||
      !context.wrapper.contains(svg) || svg.closest('[hidden],[inert]')) return false;
    const style = getComputedStyle(svg);
    const rects = svg.getClientRects();
    const rect = svg.getBoundingClientRect();
    if (style.display === 'none' || ['hidden','collapse'].includes(style.visibility) ||
      Number(style.opacity) === 0 || !rects.length || rect.width <= 0 || rect.height <= 0) return false;
    // Some controls paint a decorative, aria-hidden SVG above their observed wrapper.
    // Allow only that exact, currently rendered center hit; never infer a new target.
    return document.elementFromPoint(context.clientX,context.clientY) === element;
  }

  function checkContinuation(element, command, clickContext) {
    validateMutation(command);
    checkExpiry(command);
    if ((!visible(element) && !transparentInputHit(element,clickContext) && !decorativeSvgHit(element,clickContext)) || element.disabled || element.getAttribute('aria-disabled') === 'true') fail('TARGET_CHANGED', 'The control changed during interaction; take a fresh snapshot.');
  }

  function focusElement(element, command, clickContext) {
    const focusable = ['INPUT','TEXTAREA','SELECT','BUTTON','SUMMARY'].includes(element.tagName) ||
      (['A','AREA'].includes(element.tagName) && element.getAttribute('href') !== null) ||
      element.getAttribute('tabindex') !== null || element.isContentEditable;
    if (focusable && typeof element.focus === 'function') element.focus({ preventScroll: true });
    checkContinuation(element, command, clickContext);
  }

  function validateClickTarget(element) {
    if (protectedElement(element) || (element.control && protectedElement(element.control))) fail('PROTECTED_FIELD','The clicked control or associated field requires user interaction.');
    const anchor = element.tagName === 'A' ? element : element.closest('a[href]');
    if (anchor && anchor.getAttribute('href') !== null) {
      const rawHref = anchor.getAttribute('href').trim();
      // Existing UI anchors often use one of these inert placeholders. Only the URL
      // scheme is case-insensitive: VOID(0) could invoke a page function, unlike void(0).
      const inertHref = /^javascript:/i.test(rawHref) && [';','void(0)','void(0);'].includes(rawHref.slice(rawHref.indexOf(':')+1));
      if (inertHref) return;
      const href = new URL(rawHref,location.href);
      if (href.protocol !== 'https:' || !HOSTS.has(href.hostname) || href.username || href.password || href.port) fail('LINK_NOT_ALLOWED','Only approved HTTPS recruitment-site links may be clicked.');
    }
  }

  function clickWithEvents(element, command) {
    const {hit,clientX,clientY} = checkUncovered(element);
    const clickContext = {wrapper:element,hit,clientX,clientY};
    validateClickTarget(element);
    validateClickTarget(hit);
    checkContinuation(hit,command,clickContext);
    const check = () => {checkContinuation(element,command);checkContinuation(hit,command,clickContext);};
    const mouse = { bubbles:true,cancelable:true,composed:true,view:window,clientX,clientY,button:0,buttons:1 };
    const pointer = { ...mouse,pointerId:1,pointerType:'mouse',isPrimary:true };
    try {
      const entered = [];
      for (let node = hit; node; node = node.parentElement) {
        entered.unshift(node);
        if (node === element) break;
      }
      const hoverMouse = {...mouse,buttons:0,relatedTarget:null};
      const hoverPointer = {...pointer,buttons:0,relatedTarget:null};
      hit.dispatchEvent(new PointerEvent('pointerover',hoverPointer));
      check();
      for (const node of entered) {
        node.dispatchEvent(new PointerEvent('pointerenter',{...hoverPointer,bubbles:false,cancelable:false,composed:false}));
        check();
      }
      hit.dispatchEvent(new MouseEvent('mouseover',hoverMouse));
      check();
      for (const node of entered) {
        node.dispatchEvent(new MouseEvent('mouseenter',{...hoverMouse,bubbles:false,cancelable:false,composed:false}));
        check();
      }
      const pointerAccepted = hit.dispatchEvent(new PointerEvent('pointerdown',pointer));
      check();
      if (pointerAccepted !== false) {
        const mouseAccepted = hit.dispatchEvent(new MouseEvent('mousedown',mouse));
        check();
        if (mouseAccepted !== false) {
          let focus = hit;
          while (focus !== element && focus.parentElement && !(['INPUT','TEXTAREA','SELECT','BUTTON','SUMMARY'].includes(focus.tagName) || focus.isContentEditable || focus.getAttribute('tabindex') !== null || (focus.tagName === 'A' && focus.getAttribute('href') !== null))) focus=focus.parentElement;
          focusElement(focus,command,clickContext);
        }
      }
      hit.dispatchEvent(new PointerEvent('pointerup',{...pointer,buttons:0}));
      check();
      if (pointerAccepted !== false) hit.dispatchEvent(new MouseEvent('mouseup',{...mouse,buttons:0}));
      check();
      if (typeof hit.click === 'function') hit.click();
      else hit.dispatchEvent(new MouseEvent('click',{...mouse,buttons:0}));
    } finally {
      // A canceled/interrupted sequence can still have opened a menu or focused a field.
      refs.clear();
    }
  }

  async function execute(command) {
    if (!allowedPage()) fail('SITE_NOT_ALLOWED', 'This tool only operates on HTTPS Liepin and BOSS pages.');
    if (!command || typeof command !== 'object') fail('INVALID_COMMAND', 'Command must be an object.');
    checkExpiry(command);
    if (command.action === 'snapshot') return snapshot();
    validateMutation(command);
    if (!['click', 'fill', 'select', 'scroll'].includes(command.action)) fail('UNSUPPORTED_ACTION', 'Action is not supported by the DOM bridge.');
    if (command.action === 'scroll') {
      const pixels = command.pixels ?? 500;
      if (!Number.isFinite(pixels) || pixels < 1 || pixels > 4000 || !['up', 'down'].includes(command.direction)) fail('INVALID_VALUE', 'Scroll requires direction up/down and pixels between 1 and 4000.');
      const amount = command.direction === 'up' ? -pixels : pixels;
      checkExpiry(command);
      let scrollResult = {};
      if (command.ref !== undefined) {
        const observedTarget = target(command);
        checkUncovered(observedTarget);
        let container = observedTarget;
        while (container && !scrollable(container)) container = container.parentElement;
        if (!container || !visible(container)) fail('NOT_SCROLLABLE','No visible scrollable ancestor was found for this reference.');
        const before = container.scrollTop;
        checkExpiry(command);
        container.scrollBy({ top:amount,behavior:'instant' });
        container.dispatchEvent(new Event('scroll'));
        scrollResult = {scope:'element',before,scrollTop:container.scrollTop,scrollHeight:container.scrollHeight,clientHeight:container.clientHeight,moved:container.scrollTop !== before};
      } else {
        window.scrollBy({ top: amount, behavior: 'instant' });
        scrollResult = {scope:'window'};
      }
      refs.clear();
      return { action: 'scroll', pixels: amount, ...scrollResult,url: location.href, documentId };
    }
    const element = target(command);
    checkUncovered(element);
    checkExpiry(command);
    if (command.action === 'click') {
      if (command.value === 'open-in-same-tab') {
        const anchor = element.tagName === 'A' ? element : element.closest('a[href]');
        if (!anchor || anchor.getAttribute('href') === null) fail('UNSUPPORTED_CONTROL', 'Open requires an observed link.');
        validateClickTarget(anchor);
        const destination = new URL(anchor.getAttribute('href'), location.href);
        if (destination.protocol !== 'https:' || !HOSTS.has(destination.hostname) || destination.username || destination.password || destination.port) fail('LINK_NOT_ALLOWED', 'Open requires an approved HTTPS recruitment link.');
        validateMutation(command); checkExpiry(command);
        refs.clear();
        location.assign(destination.href);
        return {action:'click',navigationRequested:true,destination:destination.href,documentId,note:'Observed link opened in the selected tab; read the new document.'};
      }
      clickWithEvents(element,command);
      return { action: 'click', clicked: true, url: location.href, documentId, note: 'Click dispatched; take a new snapshot to verify the result.' };
    }
    if (typeof command.value !== 'string' || command.value.length > MAX_VALUE) fail('INVALID_VALUE', `Value must be a string of at most ${MAX_VALUE} characters.`);
    if (command.action === 'fill') {
      if (!(element.isContentEditable || element.tagName === 'TEXTAREA' || (element.tagName === 'INPUT' && ['text','email','tel','url','search','number','date','month','time','datetime-local','week'].includes(element.type)))) fail('UNSUPPORTED_CONTROL', 'Fill supports text fields, native date/number fields, and contenteditable controls.');
      focusElement(element,command);
      if (element.isContentEditable) element.textContent = command.value;
      else setNativeValue(element, command.value);
    } else {
      if (element.tagName !== 'SELECT') fail('UNSUPPORTED_CONTROL', 'Use select only on a native select control.');
      const option = Array.from(element.options).find(item => item.value === command.value && !item.disabled);
      if (!option) fail('INVALID_OPTION', 'Option is absent or disabled.');
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      if (!setter) fail('UNSUPPORTED_CONTROL', 'Native select setter is unavailable.');
      setter.call(element, command.value);
    }
    element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 50));
    const actual = element.isContentEditable ? element.textContent : element.value;
    refs.clear();
    if (!element.isConnected || actual !== command.value) fail('VALUE_NOT_RETAINED', 'Page did not retain the requested field value; do not automatically retry.');
    return { action: command.action, verified: true, value: actual, documentId, url: location.href,
      note: 'Field value verified only; server-side save must be checked separately.' };
  }

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || message?.type !== 'resume-bridge-command') return false;
    if (busy) { respond({ok:false,error:{code:'BUSY',message:'A command is already running in this document.'}}); return false; }
    busy = true;
    Promise.resolve().then(() => execute(message.command))
      .then(result => respond({ok:true,result}), error => respond({ok:false,error:{code:error.code || 'DOM_ERROR',message:clean(error.message, 500),...(error.details ? {details:error.details} : {})}}))
      .finally(() => { busy = false; });
    return true;
  });
})();
