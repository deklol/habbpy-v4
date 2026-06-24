const MODULE = {
  "sourceModuleId": "about",
  "name": "About",
  "summary": "Version, credits, build/profile facts, and project links.",
  "capabilities": [
    "App version and runtime mode",
    "Selected Shockless profile/build facts",
    "Credits",
    "Reference links"
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
  const { log, storage } = api;
  const disposers = [];
  const state = { activatedAt: new Date().toISOString() };
  await remember(storage, 'module', MODULE);
  await remember(storage, 'state', state);
  log.info(MODULE.name + ' premade module ready.');

  await remember(storage, 'about', {
    module: MODULE.name,
    sourceModuleId: MODULE.sourceModuleId,
    summary: MODULE.summary,
    capabilities: MODULE.capabilities,
  });

  return () => {
    for (const dispose of disposers) dispose();
  };
}

async function remember(storage, key, value) {
  await storage.set(key, { value, updatedAt: new Date().toISOString() });
}
