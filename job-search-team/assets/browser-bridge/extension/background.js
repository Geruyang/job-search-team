chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('control.html');
  const existing = await chrome.tabs.query({ url });
  if (existing.length) await chrome.tabs.update(existing[0].id, { active: true });
  else await chrome.tabs.create({ url });
});
