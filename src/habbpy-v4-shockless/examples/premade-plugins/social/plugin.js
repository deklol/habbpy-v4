const MODULE = {
  "sourceModuleId": "social",
  "name": "Social",
  "summary": "Friends, badges, private messages, friend requests, visitors, and chat status.",
  "capabilities": [
    "Packet-backed friends list",
    "Friend search",
    "Packet-backed private messages",
    "Packet-backed friend requests",
    "Scoped private message relay command",
    "Scoped friend request relay command",
    "Friend request accept/decline controls",
    "Friend remove/follow controls",
    "Friend request refresh control",
    "Badge summary",
    "Visitors split",
    "Chat split",
    "Profile lookup"
  ],
  "permissions": [
    "ui.panel",
    "ui.status",
    "console.commands",
    "events.room",
    "engine.snapshot",
    "events.chat",
    "events.packet",
    "packet.read",
    "actions.social",
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
  const { log, storage, packets, social } = api;
  const disposers = [];
  const state = { activatedAt: new Date().toISOString() };
  await remember(storage, 'module', MODULE);
  await remember(storage, 'state', state);
  log.info(MODULE.name + ' premade module ready.');

  const friendsByName = new Map();
  onPacket(disposers, packets, 'server', {}, async (packet) => {
    if (packet.packetName && String(packet.packetName).toLowerCase().includes('messenger')) await remember(storage, 'latestMessengerPacket', packetSummary(packet));
    for (const field of packet.decodedFields ?? []) {
      if (/friend \d+ name/i.test(field.label)) friendsByName.set(String(field.value).toLowerCase(), { name: field.value, sourceLine: packet.lineNumber });
    }
    await remember(storage, 'friends', [...friendsByName.values()].slice(0, 50));
    return packet.allow();
  });
  async function addUser(name, clientId) {
    return social.addUser(name, { clientId });
  }
  async function message(accountId, message, recipient, clientId) {
    return social.message(accountId, message, { recipient, clientId });
  }
  async function refreshRequests(clientId) {
    return social.refreshRequests({ clientId });
  }
  async function acceptRequest(accountId, clientId) {
    return social.acceptRequest(accountId, { clientId });
  }
  async function declineRequest(accountId, clientId) {
    return social.declineRequest(accountId, { clientId });
  }
  async function followFriend(accountId, clientId) {
    return social.followFriend(accountId, { clientId });
  }
  await remember(storage, 'availableActions', ['addUser(name, clientId)', 'message(accountId, message, recipient, clientId)', 'refreshRequests(clientId)', 'acceptRequest(accountId, clientId)', 'declineRequest(accountId, clientId)', 'followFriend(accountId, clientId)']);

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

