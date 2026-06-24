const MODULE = {
  "sourceModuleId": "present-catcher",
  "name": "Present Catcher",
  "summary": "Converted v3 present catcher controls for event presents, panic users, gift opening, and treasure fragments.",
  "capabilities": [
    "Live hammer and event-present target lists from parsed room objects",
    "Panic list using parsed room users",
    "Packet-backed walk, hammer collect, and present-use actions",
    "Gift opener controls for inventory tokens and present-open packets",
    "Treasure fragment request/trade packet controls"
  ],
  "permissions": [
    "ui.panel",
    "console.commands",
    "events.room",
    "events.packet",
    "engine.snapshot",
    "engine.control",
    "packet.read",
    "packet.inject",
    "actions.avatar",
    "actions.furni",
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
  const { log, storage, events, packets, avatar, furni } = api;
  const disposers = [];
  const state = { activatedAt: new Date().toISOString() };
  await remember(storage, 'module', MODULE);
  await remember(storage, 'state', state);
  log.info(MODULE.name + ' premade module ready.');

  const presentHeaders = new Set([65, 74, 78, 90, 93, 94, 1240, 1241, 3400, 3401, 3402, 3403, 3404, 3600, 3601, 3602, 3603, 3604]);
  let selectedHammer = null;
  let selectedPresent = null;
  on(disposers, events, 'runtime.snapshot', async (event) => {
    const snapshot = snapshotFromEvent(event);
    const items = floorItems(snapshot);
    const hammers = items.filter((item) => String(item?.className ?? item?.name ?? '').trim().toLowerCase() === 'toby_hammer');
    const presents = items.filter((item) => String(item?.className ?? item?.name ?? '').trim().toLowerCase().startsWith('anniv_present_gen'));
    selectedHammer = selectedHammer ? hammers.find((item) => objectId(item) === objectId(selectedHammer)) ?? hammers[0] ?? null : hammers[0] ?? null;
    selectedPresent = selectedPresent ? presents.find((item) => objectId(item) === objectId(selectedPresent)) ?? presents[0] ?? null : presents[0] ?? null;
    await remember(storage, 'presentTargets', {
      room: roomSummary(snapshot),
      ready: roomReady(snapshot),
      hammers: hammers.map(itemSummary).slice(0, 20),
      presents: presents.map(itemSummary).slice(0, 20),
      selectedHammer: itemSummary(selectedHammer),
      selectedPresent: itemSummary(selectedPresent),
    });
  });
  onPacket(disposers, packets, 'all', {}, async (packet) => {
    if (presentHeaders.has(Number(packet?.header))) await remember(storage, 'latestPresentPacket', packetSummary(packet));
    return packet.allow();
  });
  async function collectSelectedHammer(clientId) {
    const id = objectId(selectedHammer);
    const tile = tileOf(selectedHammer);
    if (!id || !tile) throw new Error('No selected toby_hammer with tile/object id.');
    await avatar.walkTo(tile.x, tile.y, id, { clientId });
    await delay(350);
    return furni.useFloorItem({ objectId: id, kind: 'floor' }, '0', { clientId });
  }
  async function useSelectedPresent(clientId) {
    const id = objectId(selectedPresent);
    const tile = tileOf(selectedPresent);
    if (!id || !tile) throw new Error('No selected anniv_present_gen* item with tile/object id.');
    const target = tileBeside(tile, tile);
    await avatar.walkTo(target.x, target.y, 0, { clientId });
    await delay(350);
    return furni.useFloorItem({ objectId: id, kind: 'floor' }, '0', { clientId });
  }
  async function refreshStrip(clientId) {
    return packets.send(clientId, { header: 65, bodyText: 'new' });
  }
  async function openPlacedObject(objectIdValue, clientId) {
    const id = Number(objectIdValue);
    if (!Number.isInteger(id) || id <= 0) throw new Error('openPlacedObject requires a placed object id.');
    return packets.send(clientId, { header: 78, bodyText: String(id) });
  }
  await remember(storage, 'availableActions', ['collectSelectedHammer(clientId)', 'useSelectedPresent(clientId)', 'refreshStrip(clientId)', 'openPlacedObject(objectId, clientId)']);
  await remember(storage, 'untestedLiveRoutes', ['anniversary event present timing', 'treasure fragment trade packet family 3400..3404']);

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

function floorItems(snapshot) {
  return [
    ...(snapshot?.roomObjects?.activeObjects ?? []),
    ...(snapshot?.roomObjects?.passiveObjects ?? []),
  ];
}

function tileOf(entity) {
  const x = Number(entity?.x);
  const y = Number(entity?.y);
  const direction = Number(entity?.direction ?? 0);
  if (Number.isFinite(x) && Number.isFinite(y)) return { x: Math.trunc(x), y: Math.trunc(y), direction: Number.isFinite(direction) ? Math.trunc(direction) : 0 };
  const match = String(entity?.position ?? '').match(/(-?\d+)\s*,\s*(-?\d+)/);
  return match ? { x: Number.parseInt(match[1], 10), y: Number.parseInt(match[2], 10), direction: 0 } : null;
}

function tileBeside(userTile, fallbackTile) {
  const candidates = [
    { x: userTile.x + 1, y: userTile.y },
    { x: userTile.x, y: userTile.y + 1 },
    { x: userTile.x - 1, y: userTile.y },
    { x: userTile.x, y: userTile.y - 1 },
  ];
  return candidates.find((tile) => tile.x !== fallbackTile.x || tile.y !== fallbackTile.y) ?? candidates[0] ?? fallbackTile;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function objectId(item) {
  const value = Number(item?.objectId ?? item?.id ?? item?.itemId);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function itemSummary(item) {
  if (!item) return null;
  const tile = item.tile ?? tileOf(item);
  return { key: item.key ?? null, kind: item.kind ?? null, id: objectId(item), objectId: item.objectId ?? null, itemId: item.itemId ?? null, className: item.className ?? item.name ?? null, name: item.name ?? null, ownerName: item.ownerName ?? null, tile, x: item.x ?? tile?.x ?? null, y: item.y ?? tile?.y ?? null, wallLocation: item.wallLocation ?? null, wall: item.wall ?? null, local: item.local ?? null, orientation: item.orientation ?? item.direction ?? null, state: item.state ?? null };
}

function packetSummary(packet) {
  return { clientId: packet?.clientId ?? null, direction: packet?.direction ?? null, header: packet?.header ?? null, packetName: packet?.packetName ?? 'UNKNOWN_HEADER', lineNumber: packet?.lineNumber ?? null, fields: packet?.decodedFields ?? [], bodyStatus: packet?.bodyStatus ?? null };
}
