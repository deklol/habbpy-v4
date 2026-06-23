const MODULE = {
  "sourceModuleId": "plugin-manager",
  "name": "Plugin Manager",
  "summary": "Install, create, reload, enable, disable, and inspect Habbpy plugins.",
  "capabilities": [
    "Pinned core plugin that cannot be disabled",
    "Built-in and user plugin list",
    "Enable/disable optional plugins",
    "Per-surface toggles",
    "Create plugin from template",
    "Install plugin from folder",
    "Plugin folder and reload controls"
  ],
  "permissions": [
    "ui.panel",
    "events.session",
    "engine.snapshot",
    "storage"
  ],
  "surfaces": [
    {
      "id": "panel",
      "kind": "panel"
    }
  ]
};

export async function activate(api) {
  const { log, storage, session } = api;
  const disposers = [];
  const state = { activatedAt: new Date().toISOString() };
  await remember(storage, 'module', MODULE);
  await remember(storage, 'state', state);
  log.info(MODULE.name + ' premade module ready.');

  const clients = await session.getClients().catch(() => null);
  await remember(storage, 'pluginManagerExample', {
    purpose: 'Lists plugin metadata and lets the host enable/disable plugins. User plugins cannot alter host plugin settings directly yet.',
    selectedClientId: clients?.selectedClientId ?? null,
    clientCount: Array.isArray(clients?.clients) ? clients.clients.length : 0,
  });

  return () => {
    for (const dispose of disposers) dispose();
  };
}

async function remember(storage, key, value) {
  await storage.set(key, { value, updatedAt: new Date().toISOString() });
}
