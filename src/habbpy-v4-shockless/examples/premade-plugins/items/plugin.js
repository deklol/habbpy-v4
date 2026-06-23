const MODULE = {
  "sourceModuleId": "items",
  "name": "Items",
  "summary": "Searchable floor and wall item inspector with furnidata names and packet-backed wall rows.",
  "capabilities": [
    "Floor item table",
    "Wall item table",
    "ITEMS/UPDATEITEM/REMOVEITEM packet-backed wall fallback",
    "Search",
    "Selected item detail",
    "Furnidata names/descriptions"
  ],
  "permissions": [
    "ui.panel",
    "ui.overlay",
    "events.room",
    "engine.snapshot",
    "events.packet",
    "packet.read",
    "actions.furni",
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
    }
  ]
};

export async function activate(api) {
  const { log, storage, events, furni } = api;
  const disposers = [];
  const state = { activatedAt: new Date().toISOString() };
  await remember(storage, 'module', MODULE);
  await remember(storage, 'state', state);
  log.info(MODULE.name + ' premade module ready.');

  const itemsByKey = new Map();
  on(disposers, events, 'room.items', async (event) => {
    itemsByKey.clear();
    for (const item of event?.items ?? []) itemsByKey.set(item.key, item);
    await remember(storage, 'items', {
      room: event?.room ?? null,
      counts: event?.counts ?? null,
      floorCount: Array.isArray(event?.floorItems) ? event.floorItems.length : [...itemsByKey.values()].filter((item) => item.kind !== 'wall').length,
      wallCount: Array.isArray(event?.wallItems) ? event.wallItems.length : [...itemsByKey.values()].filter((item) => item.kind === 'wall').length,
      items: [...itemsByKey.values()].map(itemSummary).slice(0, 40),
      initial: event?.initial === true,
    });
  });
  for (const eventName of ['room.itemAdded', 'room.itemUpdated', 'room.itemRemoved', 'room.floorItemAdded', 'room.floorItemUpdated', 'room.floorItemRemoved', 'room.wallItemAdded', 'room.wallItemUpdated', 'room.wallItemRemoved']) {
    on(disposers, events, eventName, async (event) => {
      if (event?.item?.key && eventName.endsWith('Removed')) itemsByKey.delete(event.item.key);
      else if (event?.item?.key) itemsByKey.set(event.item.key, event.item);
      await remember(storage, 'lastItemEvent', { eventName, item: itemSummary(event?.item), previous: itemSummary(event?.previous), total: itemsByKey.size });
    });
  }
  await remember(storage, 'availableEvents', ['room.items', 'room.floorItemsLoaded', 'room.wallItemsLoaded', 'room.itemAdded/Updated/Removed', 'room.floorItemAdded/Updated/Removed', 'room.wallItemAdded/Updated/Removed']);
  async function findItems(selector, clientId) {
    return furni.findItems(selector, { clientId });
  }
  async function findItem(selector, clientId) {
    return furni.findItem(selector, { clientId });
  }
  async function moveFloorItem(selector, x, y, direction, clientId) {
    return furni.moveFloorItem(selector, x, y, direction, { clientId });
  }
  async function rotateFloorItem(selector, direction, clientId) {
    return furni.rotateFloorItem(selector, direction, { clientId });
  }
  async function pickupMatching(selector, clientId) {
    const matches = await furni.findItems(selector, { clientId });
    const results = [];
    for (const item of matches) results.push(await furni.pickupItem(item, { clientId }));
    return results;
  }
  await remember(storage, 'availableActions', ['findItems(selector, clientId)', 'findItem(selector, clientId)', 'moveFloorItem(selector, x, y, direction, clientId)', 'rotateFloorItem(selector, direction, clientId)', 'pickupMatching(selector, clientId)']);

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

function wallItems(snapshot) {
  return snapshot?.roomObjects?.wallItems ?? [];
}

function tileOf(entity) {
  const x = Number(entity?.x);
  const y = Number(entity?.y);
  const direction = Number(entity?.direction ?? 0);
  if (Number.isFinite(x) && Number.isFinite(y)) return { x: Math.trunc(x), y: Math.trunc(y), direction: Number.isFinite(direction) ? Math.trunc(direction) : 0 };
  const match = String(entity?.position ?? '').match(/(-?\d+)\s*,\s*(-?\d+)/);
  return match ? { x: Number.parseInt(match[1], 10), y: Number.parseInt(match[2], 10), direction: 0 } : null;
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
