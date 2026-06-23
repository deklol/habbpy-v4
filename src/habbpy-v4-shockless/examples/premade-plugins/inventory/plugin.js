const MODULE = {
  "sourceModuleId": "inventory",
  "name": "Inventory",
  "summary": "Inventory request, packet-backed item list, search, counts, and item details.",
  "capabilities": [
    "Inventory request",
    "STRIPINFO_2 packet-backed item list",
    "REMOVESTRIPITEM packet removals",
    "Inventory search",
    "Floor/wall counts",
    "Selected item detail"
  ],
  "permissions": [
    "ui.panel",
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
    await remember(storage, 'inventory', {
      available: Boolean(snapshot?.inventory),
      totalCount: snapshot?.inventory?.totalCount ?? 0,
      floorCount: snapshot?.inventory?.floorCount ?? 0,
      wallCount: snapshot?.inventory?.wallCount ?? 0,
      items: Array.isArray(snapshot?.inventory?.items) ? snapshot.inventory.items.slice(0, 30) : [],
    });
  });
  onPacket(disposers, packets, 'server', { packetName: 'StripInfo' }, async (packet) => {
    await remember(storage, 'latestInventoryPacket', packetSummary(packet));
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

function packetSummary(packet) {
  return { clientId: packet?.clientId ?? null, direction: packet?.direction ?? null, header: packet?.header ?? null, packetName: packet?.packetName ?? 'UNKNOWN_HEADER', lineNumber: packet?.lineNumber ?? null, fields: packet?.decodedFields ?? [], bodyStatus: packet?.bodyStatus ?? null };
}

