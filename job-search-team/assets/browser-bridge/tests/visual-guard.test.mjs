import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveVisualTarget, verifyVisualObservation } from '../visual-guard.mjs';

const url = 'https://www.zhipin.com/web/geek/chat?ka=header-message';
const status = { connected: true, tabs: [{ id: 123, url }] };
const tabs = [{ id: '43', url }];

test('resolves distinct bridge and host IDs only by unique exact URL', () => {
  assert.deepEqual(resolveVisualTarget(status, tabs, 123), { bridgeTabId: 123, hostTabId: '43', url });
  assert.throws(() => resolveVisualTarget(status, [{ id: '43', url: url + '&x=1' }], 123), /无法唯一匹配/);
});

test('refuses ambiguity or disconnected and unsupported targets', () => {
  assert.throws(() => resolveVisualTarget(status, [...tabs, { id: '44', url }], 123), /无法唯一匹配/);
  assert.throws(() => resolveVisualTarget({ ...status, tabs: [...status.tabs, { id: 124, url }] }, tabs, 123), /多个标签/);
  assert.throws(() => resolveVisualTarget({ ...status, connected: false }, tabs, 123), /未连接/);
  assert.throws(() => resolveVisualTarget({ connected: true, tabs: [{ id: 123, url: 'https://evil.example/' }] }, tabs, 123), /不受支持/);
  assert.throws(() => resolveVisualTarget(status, tabs, '123'), /无效/);
});

test('requires unchanged URL and document before accepting an observation', () => {
  const target = resolveVisualTarget(status, tabs, 123);
  assert.equal(verifyVisualObservation(target, { url, documentId: 'd1', contextKey: 'recruiter-a' }, { url, documentId: 'd1', contextKey: 'recruiter-a' }).stable, true);
  assert.throws(() => verifyVisualObservation(target, { url, documentId: 'd1', contextKey: 'recruiter-a' }, { url, documentId: 'd2', contextKey: 'recruiter-a' }), /不一致/);
  assert.throws(() => verifyVisualObservation(target, { url, documentId: 'd1', contextKey: 'recruiter-a' }, { url: url + '&x=1', documentId: 'd1', contextKey: 'recruiter-a' }), /不一致/);
  assert.throws(() => verifyVisualObservation(target, { url, documentId: 'd1', contextKey: 'recruiter-a' }, { url, documentId: 'd1', contextKey: 'recruiter-b' }), /会话不一致/);
  assert.throws(() => verifyVisualObservation(target, { url }, { url }), /不一致/);
});
