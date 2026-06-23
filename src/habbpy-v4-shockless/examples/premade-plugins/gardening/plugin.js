const MODULE = {
  "sourceModuleId": "gardening",
  "name": "Gardening",
  "summary": "Gardening controls, live plant candidates, packet actions, and cycle state.",
  "capabilities": [
    "Start Gardening and Compost All use the v3 move/action/return packet flow through the local relay",
    "Live plant-like room object candidate list",
    "Current target plant detail from room rows",
    "Current cycle phase, original tile, working tile, attempts, completed, and queued counts",
    "Tracked room and room-cycle controls documented until visit helpers exist"
  ],
  "permissions": [
    "ui.panel",
    "console.commands",
    "events.room",
    "engine.snapshot",
    "events.packet",
    "packet.read",
    "actions.plants",
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
  const { log, storage, events, plants } = api;
  const disposers = [];
  const state = { activatedAt: new Date().toISOString() };
  await remember(storage, 'module', MODULE);
  await remember(storage, 'state', state);
  log.info(MODULE.name + ' premade module ready.');

  let selectedPlant = null;
  let latestPlantPlan = null;
  on(disposers, events, 'runtime.snapshot', async (event) => {
    const snapshot = snapshotFromEvent(event);
    const plantRows = plantItems(snapshot);
    selectedPlant = selectedPlant ? plantRows.find((item) => objectId(item) === objectId(selectedPlant)) ?? plantRows[0] ?? null : plantRows[0] ?? null;
    latestPlantPlan = selectedPlant ? plantCyclePlan(selectedPlant, selfUser(snapshot)) : null;
    await remember(storage, 'plants', { room: roomSummary(snapshot), count: plantRows.length, selected: itemSummary(selectedPlant), plan: latestPlantPlan, plants: plantRows.map(itemSummary).slice(0, 25) });
  });
  async function movePlantToWorkTile(clientId) {
    const plan = requirePlantPlan(latestPlantPlan);
    return plants.movePlant(plan.objectId, plan.workingX, plan.workingY, plan.originalDirection, { clientId });
  }
  async function waterSelected(clientId) {
    const plan = requirePlantPlan(latestPlantPlan);
    return plants.waterPlant(plan.objectId, { clientId });
  }
  async function harvestSelected(clientId) {
    const plan = requirePlantPlan(latestPlantPlan);
    return plants.harvestPlant(plan.objectId, { clientId });
  }
  async function returnPlant(clientId) {
    const plan = requirePlantPlan(latestPlantPlan);
    return plants.movePlant(plan.objectId, plan.originalX, plan.originalY, plan.originalDirection, { clientId });
  }
  async function runPlantCycle(clientId) {
    const plan = requirePlantPlan(latestPlantPlan);
    await plants.movePlant(plan.objectId, plan.workingX, plan.workingY, plan.originalDirection, { clientId });
    await delay(700);
    await plants.waterPlant(plan.objectId, { clientId });
    await delay(900);
    await plants.harvestPlant(plan.objectId, { clientId });
    await delay(900);
    return plants.movePlant(plan.objectId, plan.originalX, plan.originalY, plan.originalDirection, { clientId });
  }
  await remember(storage, 'availableActions', ['movePlantToWorkTile(clientId)', 'waterSelected(clientId)', 'harvestSelected(clientId)', 'returnPlant(clientId)', 'runPlantCycle(clientId)']);

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

function itemSearchText(item) {
  return [item?.className, item?.name, item?.type, item?.state, item?.ownerName].join(' ').toLowerCase();
}

function plantItems(snapshot) {
  return floorItems(snapshot).filter((item) => /farm|garden|plant|flower|blossom|pumpkin|seed|compost|harvest|water/.test(itemSearchText(item)));
}

function selfUser(snapshot) {
  const sessionName = String(snapshot?.userState?.sessionUserName ?? '').trim().toLowerCase();
  const users = snapshot?.userState?.users ?? snapshot?.roomObjects?.users ?? [];
  return users.find((user) => user?.isSelf) ?? users.find((user) => String(user?.name ?? user?.className ?? '').trim().toLowerCase() === sessionName) ?? users[0] ?? null;
}

function tileOf(entity) {
  const x = Number(entity?.x);
  const y = Number(entity?.y);
  const direction = Number(entity?.direction ?? 0);
  if (Number.isFinite(x) && Number.isFinite(y)) return { x: Math.trunc(x), y: Math.trunc(y), direction: Number.isFinite(direction) ? Math.trunc(direction) : 0 };
  const match = String(entity?.position ?? '').match(/(-?\d+)\s*,\s*(-?\d+)/);
  return match ? { x: Number.parseInt(match[1], 10), y: Number.parseInt(match[2], 10), direction: 0 } : null;
}

function plantCyclePlan(plant, user) {
  const id = objectId(plant);
  const original = tileOf(plant);
  if (!id || !original) return null;
  const userTile = tileOf(user);
  const working = userTile ? tileBeside(userTile, original) : { x: original.x + 1, y: original.y };
  return { objectId: id, originalX: original.x, originalY: original.y, originalDirection: original.direction, workingX: working.x, workingY: working.y };
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

function requirePlantPlan(plan) {
  if (!plan?.objectId) throw new Error('No selected plant with tile and object id.');
  return plan;
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

