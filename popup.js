const DEFAULTS = { enabled: true, profileGate: true, previews: true };
chrome.storage.sync.get(DEFAULTS).then(s => {
  for (const [k, v] of Object.entries(s)) {
    const box = document.getElementById(k);
    if (!box) continue;
    box.checked = v;
    box.addEventListener('change', () => chrome.storage.sync.set({ [k]: box.checked }));
  }
});
