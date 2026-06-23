const MODULE = {
  "sourceModuleId": "wall-mover",
  "name": "Wall Mover",
  "summary": "Wall item selector and mover controls.",
  "capabilities": [
    "Live wall item selector",
    "Packet-backed wall item fallback",
    "Target, owner, wall/local/orientation fields",
    "Step, move pad, flip, and pickup controls",
    "Rights-aware move readiness"
  ],
  "permissions": [
    "ui.panel",
    "console.commands",
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
      "id": "commands",
      "kind": "commands"
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

  let selectedWallItem = null;
  on(disposers, events, 'room.wallItemsLoaded', async (event) => {
    const walls = event?.wallItems ?? event?.items ?? [];
    selectedWallItem = selectedWallItem ? walls.find((item) => objectId(item) === objectId(selectedWallItem)) ?? walls[0] ?? null : walls[0] ?? null;
    await remember(storage, 'wallItems', { room: event?.room ?? null, count: walls.length, selected: wallItemActionShape(selectedWallItem), items: walls.map(itemSummary).slice(0, 25) });
  });
  for (const eventName of ['room.wallItemAdded', 'room.wallItemUpdated']) {
    on(disposers, events, eventName, async (event) => {
      selectedWallItem = event?.item ?? selectedWallItem;
      await remember(storage, 'lastWallItemEvent', { eventName, item: itemSummary(event?.item), selected: wallItemActionShape(selectedWallItem) });
    });
  }
  on(disposers, events, 'room.wallItemRemoved', async (event) => {
    if (objectId(event?.item) && objectId(event.item) === objectId(selectedWallItem)) selectedWallItem = null;
    await remember(storage, 'lastWallItemEvent', { eventName: 'room.wallItemRemoved', item: itemSummary(event?.item), selected: wallItemActionShape(selectedWallItem) });
  });
  async function moveSelected(deltaX = 0, deltaY = 0, orientation, clientId) {
    const action = wallMoveAction(selectedWallItem, deltaX, deltaY, orientation);
    if (!action) throw new Error('No selected wall item with movable wall/local coordinates.');
    return furni.moveWallItem(action, action, { clientId });
  }
  async function pickupSelected(clientId) {
    const id = objectId(selectedWallItem);
    if (!id) throw new Error('No selected wall item object id.');
    return furni.pickupWallItem({ kind: 'wall', itemId: id }, { clientId });
  }
  await remember(storage, 'availableActions', ['moveSelected(dx, dy, orientation, clientId)', 'pickupSelected(clientId)', 'furni.moveWallItem(selector, location, options)', 'furni.pickupWallItem(selector, options)']);

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

function wallItemActionShape(item) {
  const action = wallMoveAction(item, 0, 0);
  return action ? { ...action, action: 'moveItem' } : itemSummary(item);
}

function wallMoveAction(item, deltaX = 0, deltaY = 0, orientation) {
  const id = objectId(item);
  if (!id) return null;
  const wall = parsePair(item?.wall);
  const local = parsePair(item?.local);
  if (!wall || !local) return null;
  return {
    action: 'moveItem',
    itemId: id,
    wallX: wall[0] + deltaX,
    wallY: wall[1] + deltaY,
    localX: local[0],
    localY: local[1],
    orientation: orientation || item?.orientation || item?.direction || 'l',
    className: item?.className ?? item?.name,
  };
}

function parsePair(value) {
  if (Array.isArray(value) && value.length >= 2) return value.map(Number).slice(0, 2);
  const parts = String(value ?? '').match(/-?\d+/g)?.map(Number) ?? [];
  return parts.length >= 2 ? parts.slice(0, 2) : null;
}
