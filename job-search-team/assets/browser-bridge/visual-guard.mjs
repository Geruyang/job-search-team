// Pure identity checks for a host-provided, read-only visual capture.
// This module does not access a browser, capture pixels, or control a page.
const HOSTS = new Set(['www.zhipin.com', 'cv.zhipin.com', 'www.liepin.com', 'c.liepin.com']);

function validUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && HOSTS.has(url.hostname);
  } catch { return false; }
}

/** Resolve a bridge tab against a fresh host tab inventory without guessing IDs. */
export function resolveVisualTarget(status, hostTabs, bridgeTabId) {
  if (!status?.connected || !Array.isArray(status.tabs) || !Number.isSafeInteger(bridgeTabId)) {
    throw new Error('助手未连接或目标标签无效');
  }
  const selected = status.tabs.filter(tab => tab.id === bridgeTabId);
  if (selected.length !== 1 || !validUrl(selected[0].url)) throw new Error('目标标签不存在或地址不受支持');
  const url = selected[0].url;
  if (status.tabs.filter(tab => tab.url === url).length !== 1) throw new Error('助手存在相同地址的多个标签，无法安全匹配');
  if (!Array.isArray(hostTabs)) throw new Error('缺少宿主标签清单');
  const matches = hostTabs.filter(tab => tab.url === url);
  if (matches.length !== 1 || typeof matches[0].id !== 'string' || !matches[0].id) {
    throw new Error('宿主标签无法唯一匹配');
  }
  return { bridgeTabId, hostTabId: matches[0].id, url };
}

/** Reject a visual observation when the selected page/document changes. */
export function verifyVisualObservation(target, before, after) {
  if (!target || !validUrl(target.url) || !before || !after ||
      before.url !== target.url || after.url !== target.url ||
      typeof before.documentId !== 'string' || !before.documentId ||
      after.documentId !== before.documentId ||
      typeof before.contextKey !== 'string' || !before.contextKey ||
      after.contextKey !== before.contextKey) {
    throw new Error('截图前后目标页面、文档或会话不一致');
  }
  return { stable: true, bridgeTabId: target.bridgeTabId, hostTabId: target.hostTabId, url: target.url };
}
