const MODULE = {
  "sourceModuleId": "chat",
  "name": "Chat",
  "summary": "Room chat send, runtime/packet chat history, room markers, and v3-style filters.",
  "capabilities": [
    "Send room chat",
    "Talk/whisper/shout/system filters",
    "Display clear",
    "Runtime chat history",
    "Packet-backed CHAT/CHAT_2/CHAT_3 fallback rows",
    "Room entry/clear markers from runtime room events"
  ],
  "permissions": [
    "ui.panel",
    "ui.status",
    "console.commands",
    "events.room",
    "engine.snapshot",
    "events.chat",
    "chat.send",
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
  const { log, storage, events, chat } = api;
  const disposers = [];
  const state = { activatedAt: new Date().toISOString() };
  await remember(storage, 'module', MODULE);
  await remember(storage, 'state', state);
  log.info(MODULE.name + ' premade module ready.');

  const chatLog = [];
  on(disposers, events, 'chat.message', async (event) => {
    chatLog.push({ clientId: event?.clientId ?? null, user: event?.user?.name ?? event?.name ?? null, text: event?.text ?? '', mode: event?.mode ?? null, at: new Date().toISOString() });
    await remember(storage, 'chat', chatLog.slice(-100));
  });
  async function say(message, clientId) {
    return chat.send(message, { clientId });
  }
  await remember(storage, 'availableActions', ['say(message, clientId)']);

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
