const MODULE = {
  "sourceModuleId": "room",
  "name": "Room",
  "summary": "Room details, heightmap, users, furni, overlays, and chat tail.",
  "capabilities": [
    "Room info and owner/layout facts",
    "Private and public room entry",
    "Walk/stage click test controls",
    "Heightmap and compact map overlay",
    "Room users and status",
    "Floor and wall item summaries",
    "Room chat log"
  ],
  "permissions": [
    "ui.panel",
    "ui.overlay",
    "ui.status",
    "events.room",
    "engine.snapshot",
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
    },
    {
      "id": "status",
      "kind": "status"
    }
  ]
};

export async function activate(api) {
  const { log, storage, events } = api;
  const disposers = [];
  const state = { activatedAt: new Date().toISOString() };
  await remember(storage, 'module', MODULE);
  await remember(storage, 'state', state);
  log.info(MODULE.name + ' premade module ready.');

  for (const eventName of ['room.changed', 'room.ready']) {
    on(disposers, events, eventName, async (event) => {
      await remember(storage, 'room', { eventName, clientId: event?.clientId ?? null, room: event?.room ?? null });
    });
  }
  on(disposers, events, 'runtime.snapshot', async (event) => {
    const snapshot = snapshotFromEvent(event);
    await remember(storage, 'roomObjects', { room: roomSummary(snapshot), counts: roomObjectCounts(snapshot) });
  });

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

function roomObjectCounts(snapshot) {
  return {
    users: snapshot?.roomObjects?.counts?.users ?? snapshot?.userState?.roomUserCount ?? 0,
    floor: floorItems(snapshot).length,
    wall: wallItems(snapshot).length,
    plants: plantItems(snapshot).length,
    fishingAreas: fishingAreaItems(snapshot).length,
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

function fishingAreaItems(snapshot) {
  return floorItems(snapshot).filter((item) => String(item?.className ?? item?.name ?? '').trim().toLowerCase().endsWith('fish_area'));
}
