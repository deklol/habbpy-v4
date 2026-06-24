const MODULE = {
  "sourceModuleId": "dev-tools",
  "name": "Dev Tools",
  "summary": "Shockless sprite, window, hit-test, profile, and performance diagnostics.",
  "capabilities": [
    "Sprite inspector",
    "Window tree",
    "Hit probe",
    "Profile doctor",
    "Performance stats",
    "Screenshot/diff runner"
  ],
  "permissions": [
    "ui.panel",
    "ui.overlay",
    "ui.status",
    "console.commands",
    "events.session",
    "engine.snapshot",
    "storage"
  ],
  "surfaces": [
    {
      "id": "panel",
      "kind": "panel"
    },
    {
      "id": "overlay",
      "kind": "overlay"
    },
    {
      "id": "status",
      "kind": "status"
    },
    {
      "id": "commands",
      "kind": "commands"
    }
  ]
};

export async function activate(api) {
  const { log, storage, events } = api;
  const disposers = [];
  const state = { activatedAt: new Date().toISOString() };
  await remember(storage, 'module', MODULE);
  await remember(storage, 'state', state);
  log.info(MODULE.name + ' premade module ready.');

  on(disposers, events, 'runtime.snapshot', async (event) => {
    const snapshot = snapshotFromEvent(event);
    await remember(storage, 'diagnostics', {
      clientId: event?.clientId ?? null,
      fps: snapshot?.performanceStats?.rafPerSecond ?? snapshot?.performanceStats?.rafRate ?? null,
      worstRafMs: snapshot?.performanceStats?.worstRafDeltaMs ?? null,
      frame: snapshot?.frame ?? null,
      errors: snapshot?.errors ?? null,
      windows: snapshot?.windowIds ?? [],
    });
  });

  return () => {
    for (const dispose of disposers) dispose();
  };
}

function on(disposers, events, eventName, handler) {
  disposers.push(events.on(eventName, handler));
}

async function remember(storage, key, value) {
  await storage.set(key, { value, updatedAt: new Date().toISOString() });
}

function snapshotFromEvent(event) {
  return event?.snapshot ?? event?.runtime ?? event ?? null;
}
