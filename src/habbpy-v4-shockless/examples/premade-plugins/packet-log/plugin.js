const MODULE = {
  "sourceModuleId": "packet-log",
  "name": "Packet Log",
  "summary": "Relay packet rows, decrypted body, and room-object inspector.",
  "capabilities": [
    "Relay log presence and packet counts",
    "Recent client/server header rows with v3 packet names",
    "Direction and session filters",
    "Display clear, export, wrap, and autoscroll",
    "Selected relay row detail",
    "Payload byte count, decrypted body, ASCII/hex, and decoded fields",
    "Room-object packet fields for objects, updates, adds, removes, plant data, and stuff data",
    "Full escaped v4 relay bodies with sensitive client payload redaction"
  ],
  "permissions": [
    "ui.panel",
    "ui.status",
    "packet.read",
    "events.packet",
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
  const { log, storage, packets } = api;
  const disposers = [];
  const state = { activatedAt: new Date().toISOString() };
  await remember(storage, 'module', MODULE);
  await remember(storage, 'state', state);
  log.info(MODULE.name + ' premade module ready.');

  const recent = [];
  onPacket(disposers, packets, 'all', {}, async (packet) => {
    recent.push(packetSummary(packet));
    await remember(storage, 'recentPackets', recent.slice(-200));
    return packet.allow();
  });

  return () => {
    for (const dispose of disposers) dispose();
  };
}

function onPacket(disposers, packets, direction, filter, handler) {
  disposers.push(packets.on(direction, filter, handler));
}

async function remember(storage, key, value) {
  await storage.set(key, { value, updatedAt: new Date().toISOString() });
}

function packetSummary(packet) {
  return { clientId: packet?.clientId ?? null, direction: packet?.direction ?? null, header: packet?.header ?? null, packetName: packet?.packetName ?? 'UNKNOWN_HEADER', lineNumber: packet?.lineNumber ?? null, fields: packet?.decodedFields ?? [], bodyStatus: packet?.bodyStatus ?? null };
}
