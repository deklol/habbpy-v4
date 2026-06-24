const MODULE = {
  "sourceModuleId": "connection",
  "name": "Connection",
  "summary": "Client/profile import, session lifecycle, active profile, status, and traffic facts.",
  "capabilities": [
    "Session list and active session selection",
    "Compiled client import/build and Shockless profile registration",
    "Profile selection and launch",
    "Client state, traffic, crypto/status facts",
    "Lifecycle controls"
  ],
  "permissions": [
    "ui.panel",
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
  const { log, storage, events, packets } = api;
  const disposers = [];
  const state = { activatedAt: new Date().toISOString() };
  await remember(storage, 'module', MODULE);
  await remember(storage, 'state', state);
  log.info(MODULE.name + ' premade module ready.');

  on(disposers, events, 'session.selected', async (event) => {
    state.selectedClientId = event?.clientId ?? null;
    await remember(storage, 'selectedClient', { clientId: state.selectedClientId });
  });
  on(disposers, events, 'runtime.snapshot', async (event) => {
    const snapshot = snapshotFromEvent(event);
    await remember(storage, 'connection', {
      clientId: event?.clientId ?? null,
      roomReady: roomReady(snapshot),
      room: roomSummary(snapshot),
      userName: snapshot?.userState?.sessionUserName ?? null,
      fps: snapshot?.performanceStats?.rafPerSecond ?? snapshot?.performanceStats?.rafRate ?? null,
    });
  });
  onPacket(disposers, packets, 'all', {}, async (packet) => {
    await remember(storage, 'latestPacket', packetSummary(packet));
    return packet.allow();
  });

  return () => {
    for (const dispose of disposers) dispose();
  };
}

function on(disposers, events, eventName, handler) {
  disposers.push(events.on(eventName, handler));
}

function onPacket(disposers, packets, direction, filter, handler) {
  disposers.push(packets.on(direction, filter, handler));
}

async function remember(storage, key, value) {
  await storage.set(key, { value, updatedAt: new Date().toISOString() });
}

function snapshotFromEvent(event) {
  return event?.snapshot ?? event?.runtime ?? event ?? null;
}

function roomReady(snapshot) {
  return Boolean(snapshot?.roomReady?.ready ?? snapshot?.roomEntryState?.roomReady?.ready);
}

function roomSummary(snapshot) {
  return {
    id: snapshot?.room?.id ?? snapshot?.roomEntryState?.flatId ?? snapshot?.userState?.roomId ?? null,
    name: snapshot?.room?.name ?? snapshot?.userState?.roomName ?? null,
    owner: snapshot?.room?.owner ?? snapshot?.userState?.roomOwner ?? null,
    type: snapshot?.room?.type ?? snapshot?.userState?.roomType ?? null,
    ready: roomReady(snapshot),
  };
}

function packetSummary(packet) {
  return { clientId: packet?.clientId ?? null, direction: packet?.direction ?? null, header: packet?.header ?? null, packetName: packet?.packetName ?? 'UNKNOWN_HEADER', lineNumber: packet?.lineNumber ?? null, fields: packet?.decodedFields ?? [], bodyStatus: packet?.bodyStatus ?? null };
}
