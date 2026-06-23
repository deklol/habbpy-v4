const MODULE = {
  "sourceModuleId": "automation",
  "name": "Automation",
  "summary": "Automation tools for comfort, fishing, gardening, and wall items.",
  "capabilities": [
    "Auto-hide Bulletin Board after login",
    "Fishing plugin split",
    "Gardening plugin split",
    "Wall Mover plugin split",
    "Comfort toggles",
    "Fishing minigame relay helpers"
  ],
  "permissions": [
    "ui.panel",
    "ui.status",
    "console.commands",
    "events.room",
    "engine.snapshot",
    "actions.avatar",
    "actions.fishing",
    "actions.furni",
    "actions.plants",
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
  const { log, storage, events, furni } = api;
  const disposers = [];
  const state = { activatedAt: new Date().toISOString() };
  await remember(storage, 'module', MODULE);
  await remember(storage, 'state', state);
  log.info(MODULE.name + ' premade module ready.');

  on(disposers, events, 'runtime.snapshot', async (event) => {
    const snapshot = snapshotFromEvent(event);
    await remember(storage, 'automationTargets', {
      room: roomSummary(snapshot),
      plants: plantItems(snapshot).map(itemSummary).slice(0, 20),
      wallItems: wallItems(snapshot).map(itemSummary).slice(0, 20),
      users: snapshot?.userState?.users?.length ?? 0,
    });
  });
  await remember(storage, 'automationActions', ['Use plants.movePlant/waterPlant/harvestPlant for plant tasks', 'Use furni.findItems/moveFloorItem/rotateFloorItem/pickupItem for room object scripts', 'Use furni.moveWallItem/pickupWallItem for wall movement', 'Use avatar.walkTo/walkToItem/wave/dance for avatar actions']);

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

function itemSearchText(item) {
  return [item?.className, item?.name, item?.type, item?.state, item?.ownerName].join(' ').toLowerCase();
}

function plantItems(snapshot) {
  return floorItems(snapshot).filter((item) => /farm|garden|plant|flower|blossom|pumpkin|seed|compost|harvest|water/.test(itemSearchText(item)));
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
