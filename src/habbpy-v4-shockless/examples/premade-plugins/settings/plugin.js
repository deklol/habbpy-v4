const MODULE = {
  "sourceModuleId": "settings",
  "name": "Settings",
  "summary": "Engine preferences, launch settings, hotkeys, console defaults, and session defaults.",
  "capabilities": [
    "Pinned core plugin that cannot be disabled",
    "Engine launch settings",
    "Hardware acceleration preference",
    "VERSIONCHECK override controls",
    "Console key binding management",
    "Session and plugin preference surface"
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

  await remember(storage, 'settingsExample', {
    purpose: 'Settings-style plugins should store plugin-scoped preferences in storage.',
    examplePrefs: { enabled: true, hotkey: 'F1', autoRun: false },
  });
  const prefs = await storage.get('prefs', { enabled: true, hotkey: 'F1', autoRun: false });
  log.info('Loaded settings prefs: ' + JSON.stringify(prefs));

  return () => {
    for (const dispose of disposers) dispose();
  };
}

async function remember(storage, key, value) {
  await storage.set(key, { value, updatedAt: new Date().toISOString() });
}
