const MODULE = {
  "sourceModuleId": "fishing",
  "name": "Fishing",
  "summary": "Fishing room candidates, safe start/derby actions, and packet-backed catch, token, minigame, frenzy, and Fishopedia state.",
  "capabilities": [
    "Live room prerequisite, fishing-area candidate rows, and walk-to-area movement",
    "Validated start fishing, minigame input, derby register, token, stats, rod, products, and Fishopedia relay actions",
    "Packet-backed catches, golden catches, XP, token balance, and level",
    "Packet-backed minigame status/pin values and frenzy notifications",
    "Packet-backed Fishopedia snapshot/update rows"
  ],
  "permissions": [
    "ui.panel",
    "console.commands",
    "events.room",
    "engine.snapshot",
    "events.packet",
    "packet.read",
    "actions.fishing",
    "actions.avatar",
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
  const { log, storage, events, packets, fishing } = api;
  const disposers = [];
  const state = { activatedAt: new Date().toISOString() };
  await remember(storage, 'module', MODULE);
  await remember(storage, 'state', state);
  log.info(MODULE.name + ' premade module ready.');

  let selectedAreaId = null;
  on(disposers, events, 'runtime.snapshot', async (event) => {
    const snapshot = snapshotFromEvent(event);
    const areas = fishingAreaItems(snapshot).map(itemSummary);
    selectedAreaId = selectedAreaId && areas.some((area) => area?.id === selectedAreaId) ? selectedAreaId : areas[0]?.id ?? null;
    const hostState = await fishing.getState().catch(() => null);
    await remember(storage, 'fishingAreas', { room: roomSummary(snapshot), selectedAreaId, count: areas.length, areas, hostState });
  });
  onPacket(disposers, packets, 'all', {}, async (packet) => {
    const text = [packet.packetName, packet.bodyText, packet.bodyAscii, packet.message].join(' ').toLowerCase();
    if (text.includes('fish') || text.includes('derby') || text.includes('frenzy')) await remember(storage, 'latestFishingPacket', packetSummary(packet));
    return packet.allow();
  });
  async function refreshFishingState(clientId) {
    return fishing.getState({ clientId });
  }
  async function startSelectedArea(clientId) {
    const state = await fishing.getState({ clientId });
    if (state?.occupants && !state.occupants.safeToAutomate) throw new Error('Fishing room has other human occupants; refusing to automate.');
    const areaId = selectedAreaId ?? state?.target?.id ?? state?.areas?.[0]?.id;
    if (!areaId) throw new Error('No live fishing area id is available. Enter a fishing public room first.');
    selectedAreaId = areaId;
    await fishing.walkToArea(areaId, { clientId });
    await delay(650);
    return fishing.startFishing(areaId, { clientId });
  }
  async function walkToSelectedArea(clientId) {
    const state = await fishing.getState({ clientId });
    const areaId = selectedAreaId ?? state?.target?.id ?? state?.areas?.[0]?.id;
    if (!areaId) throw new Error('No live fishing area id is available. Enter a fishing public room first.');
    selectedAreaId = areaId;
    return fishing.walkToArea(areaId, { clientId });
  }
  async function minigameLeft(clientId) {
    return fishing.minigameInput('L', { clientId });
  }
  async function minigameRight(clientId) {
    return fishing.minigameInput('R', { clientId });
  }
  async function registerDerby(clientId) {
    return fishing.registerDerby({ clientId });
  }
  async function purchaseFishingProduct(clientId, productCode) {
    if (!productCode) throw new Error('purchaseFishingProduct requires a product code from requestFishingData/client UI.');
    return fishing.purchaseProduct(productCode, { clientId });
  }
  async function requestFishingData(clientId) {
    await fishing.requestTokens({ clientId });
    await fishing.requestProducts({ clientId });
    await fishing.requestStats({ clientId });
    await fishing.requestRodLevel({ clientId });
    return fishing.requestFishopedia({ clientId });
  }
  await remember(storage, 'availableActions', ['refreshFishingState(clientId)', 'walkToSelectedArea(clientId)', 'startSelectedArea(clientId)', 'minigameLeft(clientId)', 'minigameRight(clientId)', 'registerDerby(clientId)', 'requestFishingData(clientId)', 'purchaseFishingProduct(clientId, productCode)']);

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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fishingAreaItems(snapshot) {
  return floorItems(snapshot).filter((item) => String(item?.className ?? item?.name ?? '').trim().toLowerCase().endsWith('fish_area'));
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

