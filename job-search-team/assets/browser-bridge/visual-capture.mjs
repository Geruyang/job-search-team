import { resolveVisualTarget, verifyVisualObservation } from './visual-guard.mjs';

/**
 * Coordinate a read-only host capture with bridge page/document checks.
 * The host must provide a supported read-only pixel source; this module does
 * not connect to a browser or implement a screenshot backend itself.
 */
export async function captureVerified({ bridge, host, bridgeTabId }) {
  if (!bridge || typeof bridge.status !== 'function' || typeof bridge.snapshot !== 'function' ||
      !host || typeof host.listTabs !== 'function' || typeof host.capture !== 'function') {
    throw new Error('缺少可用的助手或只读截图提供方');
  }
  const target = resolveVisualTarget(await bridge.status(), await host.listTabs(), bridgeTabId);
  const before = await bridge.snapshot(bridgeTabId);
  verifyVisualObservation(target, before, before);
  const image = await host.capture(target.hostTabId);
  if (!(image instanceof Uint8Array) || !image.byteLength) throw new Error('截图提供方未返回图像');
  const after = await bridge.snapshot(bridgeTabId);
  verifyVisualObservation(target, before, after);
  const current = resolveVisualTarget(await bridge.status(), await host.listTabs(), bridgeTabId);
  if (current.hostTabId !== target.hostTabId || current.url !== target.url) throw new Error('截图期间目标标签已变化');
  return { target, documentId: before.documentId, image };
}
