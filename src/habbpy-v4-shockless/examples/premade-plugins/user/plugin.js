const MODULE = {
  "sourceModuleId": "user",
  "name": "User",
  "summary": "Room user/session state plus wave/dance controls.",
  "capabilities": [
    "Room user selector",
    "Session username, room, owner, and rights",
    "User position, direction, sprite, and appearance fields",
    "Local copy/profile snapshot and parsed-look storage tools",
    "Wave, dance, carry drink, and apply-look controls"
  ],
  "permissions": [
    "ui.panel",
    "ui.overlay",
    "console.commands",
    "events.room",
    "engine.snapshot",
    "actions.avatar",
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
      "id": "commands",
      "kind": "commands"
    }
  ]
};

export async function activate(api) {
  const { log, storage, events, avatar } = api;
  const disposers = [];
  const state = { activatedAt: new Date().toISOString() };
  await remember(storage, 'module', MODULE);
  await remember(storage, 'state', state);
  log.info(MODULE.name + ' premade module ready.');

  let selectedUser = null;
  on(disposers, events, 'room.users', async (event) => {
    selectedUser = Array.isArray(event?.users) ? event.users.find((user) => user?.isSelf) ?? event.users[0] ?? null : null;
    await remember(storage, 'selectedUser', selectedUser);
  });
  async function walkTo(x, y, clientId) {
    return avatar.walkTo(x, y, 0, { clientId });
  }
  async function walkToItem(selector, clientId) {
    return avatar.walkToItem(selector, { clientId });
  }
  async function wave(clientId) {
    return avatar.wave({ clientId });
  }
  async function dance(number = 1, clientId) {
    return avatar.dance(number, { clientId });
  }
  async function carryDrink(clientId) {
    return avatar.carryDrink({ clientId });
  }
  await remember(storage, 'availableActions', ['walkTo(x, y, clientId)', 'walkToItem(idOrName, clientId)', 'wave(clientId)', 'dance(number, clientId)', 'carryDrink(clientId)']);

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
