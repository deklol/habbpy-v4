const MODULE = {
  "sourceModuleId": "visitors",
  "name": "Visitors",
  "summary": "Current and seen room visitor tracker from live room user state.",
  "capabilities": [
    "Current visitor count",
    "Seen visitor ledger",
    "Search",
    "Entered/left times",
    "Visit count"
  ],
  "permissions": [
    "ui.panel",
    "ui.status",
    "events.room",
    "engine.snapshot",
    "events.chat",
    "storage"
  ],
  "surfaces": [
    {
      "id": "panel",
      "kind": "panel"
    },
    {
      "id": "status",
      "kind": "status"
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

  const visitors = new Map();
  on(disposers, events, 'room.users', async (event) => {
    for (const user of event?.users ?? []) visitors.set(visitorKey(user), { ...user, lastSeenAt: new Date().toISOString(), present: true });
    await remember(storage, 'visitors', [...visitors.values()]);
  });
  on(disposers, events, 'room.userJoined', async (event) => {
    visitors.set(visitorKey(event?.user), { ...event?.user, present: true, joinedAt: new Date().toISOString() });
    await remember(storage, 'visitors', [...visitors.values()]);
  });
  on(disposers, events, 'room.userLeft', async (event) => {
    const key = visitorKey(event?.user);
    visitors.set(key, { ...(visitors.get(key) ?? event?.user), present: false, leftAt: new Date().toISOString() });
    await remember(storage, 'visitors', [...visitors.values()]);
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

function visitorKey(user) {
  return String(user?.accountId ?? user?.id ?? user?.name ?? 'unknown').toLowerCase();
}

