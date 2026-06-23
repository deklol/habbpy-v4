const MODULE = {
  "sourceModuleId": "info",
  "name": "Info",
  "summary": "Account, room, inventory, rights, badges, effects, and profile lookup.",
  "capabilities": [
    "Account and room summary",
    "Official Origins public user lookup",
    "Inventory and rights counts",
    "Rights list",
    "Packet-backed friend, badge, preference, and status-effect summaries"
  ],
  "permissions": [
    "ui.panel",
    "ui.status",
    "console.commands",
    "events.room",
    "engine.snapshot",
    "events.packet",
    "packet.read",
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

  on(disposers, events, 'runtime.snapshot', async (event) => {
    const snapshot = snapshotFromEvent(event);
    await remember(storage, 'info', { clientId: event?.clientId ?? null, room: roomSummary(snapshot), user: snapshot?.userState?.sessionUserName ?? null, rights: snapshot?.userState?.rights ?? [] });
  });
  onPacket(disposers, packets, 'server', {}, async (packet) => {
    if (['USERS', 'MessengerInit', 'Badges'].includes(packet.packetName)) await remember(storage, 'latestInfoPacket', packetSummary(packet));
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

