import test from 'node:test';
import assert from 'node:assert/strict';
import { captureVerified } from '../visual-capture.mjs';

const url = 'https://www.zhipin.com/web/geek/chat';
function fixture() {
  const state = { url, documentId: 'doc', contextKey: 'recruiter-a', hostId: '43', captures: 0 };
  return {
    state,
    bridge: {
      status: async () => ({ connected: true, tabs: [{ id: 7, url: state.url }] }),
      snapshot: async () => ({ url: state.url, documentId: state.documentId, contextKey: state.contextKey }),
    },
    host: {
      listTabs: async () => [{ id: state.hostId, url: state.url }],
      capture: async () => { state.captures++; return new Uint8Array([1, 2, 3]); },
    },
  };
}

test('returns host image only after page and tab identity checks', async () => {
  const f = fixture();
  const result = await captureVerified({ ...f, bridgeTabId: 7 });
  assert.equal(result.target.hostTabId, '43');
  assert.deepEqual([...result.image], [1, 2, 3]);
  assert.equal(f.state.captures, 1);
});

test('does not return an image after navigation or host tab replacement', async () => {
  const f = fixture();
  f.host.capture = async () => { f.state.documentId = 'new-doc'; return new Uint8Array([1]); };
  await assert.rejects(captureVerified({ ...f, bridgeTabId: 7 }), /不一致/);
  f.state.documentId = 'doc';
  f.host.capture = async () => { f.state.contextKey = 'recruiter-b'; return new Uint8Array([1]); };
  await assert.rejects(captureVerified({ ...f, bridgeTabId: 7 }), /会话不一致/);
  f.state.contextKey = 'recruiter-a';
  f.host.capture = async () => { f.state.hostId = 'other-tab'; return new Uint8Array([1]); };
  await assert.rejects(captureVerified({ ...f, bridgeTabId: 7 }), /目标标签已变化/);
});

test('fails closed without a provider or image and does not capture ambiguous tabs', async () => {
  const f = fixture();
  await assert.rejects(captureVerified({ bridge: f.bridge, bridgeTabId: 7 }), /截图提供方/);
  f.host.listTabs = async () => [{ id: 'a', url }, { id: 'b', url }];
  await assert.rejects(captureVerified({ ...f, bridgeTabId: 7 }), /无法唯一匹配/);
  assert.equal(f.state.captures, 0);
  f.host.listTabs = async () => [{ id: '43', url }];
  f.host.capture = async () => new Uint8Array();
  await assert.rejects(captureVerified({ ...f, bridgeTabId: 7 }), /未返回图像/);
});
