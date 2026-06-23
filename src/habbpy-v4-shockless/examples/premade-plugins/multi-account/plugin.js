const MODULE = {
  "sourceModuleId": "multi-account",
  "name": "Multi Account",
  "summary": "Client sessions, manual visible clients, account loading, main/summon routing, and mimic controls.",
  "capabilities": [
    "Session list and selected/main switching",
    "Manual visible client creation",
    "Plain account-file and encrypted-store load commands",
    "Main/summoner assignment",
    "Summon by friend-follow or private-room entry",
    "Mimic enable/source controls",
    "Movement, speech, action, and room-follow mimic toggles"
  ],
  "permissions": [
    "ui.panel",
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
      "id": "commands",
      "kind": "commands"
    }
  ]
};

export async function activate(api) {
  const { log, storage, events, session } = api;
  const disposers = [];
  const state = { activatedAt: new Date().toISOString() };
  await remember(storage, 'module', MODULE);
  await remember(storage, 'state', state);
  log.info(MODULE.name + ' premade module ready.');

  on(disposers, events, 'session.selected', async (event) => {
    state.selectedClientId = event?.clientId ?? null;
    await remember(storage, 'selectedClient', { clientId: state.selectedClientId });
  });
  async function recordClients(reason) {
    const clients = await session.getClients();
    await remember(storage, 'clients', { reason, selectedClientId: clients.selectedClientId, mainClientId: clients.mainClientId, clients: clients.clients });
  }
  await recordClients('activated');
  on(disposers, events, 'session.selected', () => recordClients('selection changed'));

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
