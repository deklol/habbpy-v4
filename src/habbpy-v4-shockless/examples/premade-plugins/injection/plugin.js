const MODULE = {
  "sourceModuleId": "injection",
  "name": "Injection",
  "summary": "Mapped command editor for chat, room, window, and user actions.",
  "capabilities": [
    "Mapped command editor",
    "Saved snippets",
    "Recent command history",
    "Finite repeat for mapped actions",
    "User Wave/Dance/Stop/Carry actions",
    "v3 raw packet snippets imported for review"
  ],
  "permissions": [
    "ui.panel",
    "console.commands",
    "actions.avatar",
    "actions.social",
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
      "id": "commands",
      "kind": "commands"
    }
  ]
};

export async function activate(api) {
  const { log, storage, packets, furni } = api;
  const disposers = [];
  const state = { activatedAt: new Date().toISOString() };
  await remember(storage, 'module', MODULE);
  await remember(storage, 'state', state);
  log.info(MODULE.name + ' premade module ready.');

  await remember(storage, 'mappedActions', {
    avatar: 'avatar.walkToItem(idOrName, { clientId }) or avatar.wave({ clientId })',
    social: 'social.addUser(name, { clientId }) or social.message(accountId, message, { clientId })',
    fishing: 'fishing.getState({ clientId }); startFishing(areaId); minigameInput(L/R); requestTokens/requestProducts/requestStats/requestFishopedia/purchaseProduct',
    plants: 'plants.movePlant(id, x, y, direction, { clientId }); waterPlant/harvestPlant after movement',
    furni: 'furni.findItems(selector), moveFloorItem(selector, x, y, direction), rotateFloorItem(selector, direction), pickupItem(selector), moveWallItem(selector, location)',
    rawPackets: 'packets.send(...) remains blocked until raw builders are validated.',
  });
  onPacket(disposers, packets, 'client', {}, (packet) => packet.allow());

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
