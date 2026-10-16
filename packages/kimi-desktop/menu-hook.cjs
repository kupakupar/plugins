// Loaded by the explicitly installed, reversible Kimi desktop compatibility patch.
// Reads display metadata only. No credentials, network calls, DOM or browser driver.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const catalogFile = path.join(os.homedir(), '.config', 'magpie-kimi', 'menu-catalog.json');
const owned = value => /^magpie-local-[a-f0-9]{24}$/.test(value || '');

function merge(original) {
  if (!original || !Array.isArray(original.models)) return original;
  let catalog;
  try {
    if (fs.statSync(catalogFile).size > 8 * 1024 * 1024) return original;
    catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
  } catch { return original; }
  return mergeCatalog(original,catalog);
}

function mergeCatalog(original,catalog,now=Date.now()) {
  const native = original.models.filter(x => !owned(x.modelAlias));
  const more = (original.moreModels || []).filter(x => !owned(x.modelAlias));
  const valid = catalog.schemaVersion === 1 && catalog.enabled === true && Array.isArray(catalog.models)
    && now - Date.parse(catalog.updatedAt) < 120000;
  const models = valid ? catalog.models.filter(x => owned(x.key) && x.key === x.modelAlias && typeof x.displayName === 'string') : [];
  const selected = models.some(x => x.key === catalog.selectedAlias) ? catalog.selectedAlias : '';
  const exclusive=valid&&catalog.exclusive===true;
  return {...original, models: exclusive?models:[...models,...native], moreModels:exclusive?[]:more,
    defaultModelKey: exclusive?(selected||models[0]?.key||'')
      :selected||(owned(original.defaultModelKey)?native[0]?.key||'':original.defaultModelKey)};
}
module.exports = {merge,_internal:{mergeCatalog}};

// Notify the existing Work renderer only when the catalog actually changes.
// Heartbeats update updatedAt without causing repeated cloud catalog requests.
try {
  const {app, webContents} = require('electron');
  app.whenReady().then(() => {
    let signature = '';
    const timer = setInterval(() => {
      try {
        const data = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
        const next = JSON.stringify([data.enabled, data.models]);
        if (next === signature) return;
        signature = next;
        for (const contents of webContents.getAllWebContents()) {
          if (!contents.isDestroyed() && /\/kimi-agent\.html(?:[?#]|$)/.test(contents.getURL())) {
            contents.send('kimi-agent:event', {t:'magpie.catalog.changed'});
          }
        }
      } catch { /* Adapter not running yet. */ }
    }, 1000);
    timer.unref?.();
    app.once('before-quit', () => clearInterval(timer));
  }).catch(() => {});
} catch { /* Pure merge tests do not load Electron. */ }
