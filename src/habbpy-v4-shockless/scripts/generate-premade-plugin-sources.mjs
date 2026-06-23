import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { plugins } from "../src/plugins/registry.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(__dirname, "..");
const outputRoot = join(workspace, "examples", "premade-plugins");

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

await writeFile(
  join(outputRoot, "README.txt"),
  withFinalNewline([
    "# Premade Plugin Modules",
    "",
    "These folders are readable user-plugin versions of the built-in Habbpy v4 modules.",
    "They are shipped as source references and installable examples, not as replacements for the native built-in panels.",
    "",
    "To try one, open Plugin Manager, choose Install From Folder, and select one module folder such as `room` or `packet-log`.",
    "The installed plugin id is prefixed with `premade-` so it does not collide with the native module id.",
    "",
    "The generated code demonstrates the public plugin host API: session, runtime, room, chat, packet, and storage hooks.",
    "It intentionally avoids credentials, webhook values, local account files, and hardcoded Habbo client versions.",
  ]),
  "utf8",
);

for (const plugin of plugins.filter((entry) => entry.origin === "built-in")) {
  const root = join(outputRoot, plugin.id);
  await mkdir(root, { recursive: true });
  const manifest = manifestForPlugin(plugin);
  await writeFile(join(root, "habbpy.plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(join(root, "plugin.js"), pluginSourceFor(plugin, manifest), "utf8");
  await writeFile(join(root, "README.txt"), readmeFor(plugin, manifest), "utf8");
}

console.log(JSON.stringify({ ok: true, outputRoot: relativePath(outputRoot), count: plugins.filter((entry) => entry.origin === "built-in").length }, null, 2));

function manifestForPlugin(plugin) {
  const permissions = [...new Set([...(plugin.permissions ?? []), ...extraPermissionsFor(plugin), "storage"])];
  return {
    id: `premade-${plugin.id}`,
    name: `${plugin.name} Premade Module`,
    version: "1.0.0",
    author: "Habbpy v4",
    description: `Readable user-plugin source reference for the built-in ${plugin.name} module.`,
    entry: "plugin.js",
    icon: plugin.icon,
    category: plugin.category === "core" ? "developer" : plugin.category,
    permissions,
    surfaces: plugin.uiSurfaces.map((surface) => ({
      id: surface.id,
      kind: surface.kind,
      label: surface.label.toLowerCase().startsWith(plugin.name.toLowerCase()) ? surface.label : `${plugin.name} ${surface.label}`,
      enabledByDefault: surface.enabledByDefault,
      summary: surface.summary,
    })),
    commands: [],
    hotkeys: [],
  };
}

function extraPermissionsFor(plugin) {
  const permissions = [];
  if (["connection", "multi-account", "plugin-manager", "settings", "about", "dev-tools"].includes(plugin.id)) {
    permissions.push("events.session", "engine.snapshot");
  }
  if (["info", "room", "user", "items", "inventory", "visitors", "chat", "social", "automation", "fishing", "gardening", "present-catcher", "wall-mover"].includes(plugin.id)) {
    permissions.push("events.room", "engine.snapshot");
  }
  if (["chat", "social", "visitors"].includes(plugin.id)) {
    permissions.push("events.chat");
  }
  if (["packet-log", "info", "items", "inventory", "social", "fishing", "gardening", "present-catcher", "wall-mover"].includes(plugin.id)) {
    permissions.push("events.packet", "packet.read");
  }
  if (plugin.id === "chat") {
    permissions.push("chat.send");
  }
  if (plugin.id === "user") permissions.push("actions.avatar");
  if (plugin.id === "social") permissions.push("actions.social");
  if (plugin.id === "fishing") permissions.push("actions.fishing", "actions.avatar");
  if (plugin.id === "gardening") permissions.push("actions.plants");
  if (plugin.id === "present-catcher") permissions.push("actions.avatar", "actions.furni", "packet.inject");
  if (plugin.id === "items") permissions.push("actions.furni");
  if (plugin.id === "wall-mover") permissions.push("actions.furni");
  if (plugin.id === "automation") permissions.push("actions.avatar", "actions.fishing", "actions.furni", "actions.plants");
  if (plugin.id === "injection") permissions.push("actions.avatar", "actions.social", "actions.fishing", "actions.furni", "actions.plants");
  return permissions;
}

function pluginSourceFor(plugin, manifest) {
  const moduleData = {
    sourceModuleId: plugin.id,
    name: plugin.name,
    summary: plugin.summary,
    capabilities: plugin.capabilities,
    permissions: manifest.permissions,
    surfaces: manifest.surfaces.map((surface) => ({ id: surface.id, kind: surface.kind })),
  };
  return withFinalNewline([
    `const MODULE = ${JSON.stringify(moduleData, null, 2)};`,
    "",
    "export async function activate(api) {",
    `  const { ${apiGroupsFor(plugin.id).join(", ")} } = api;`,
    "  const disposers = [];",
    "  const state = { activatedAt: new Date().toISOString() };",
    "  await remember(storage, 'module', MODULE);",
    "  await remember(storage, 'state', state);",
    "  log.info(MODULE.name + ' premade module ready.');",
    "",
    ...moduleSourceLines(plugin.id),
    "",
    "  return () => {",
    "    for (const dispose of disposers) dispose();",
    "  };",
    "}",
    "",
    ...commonHelperLines(plugin.id),
  ]);
}

function apiGroupsFor(id) {
  const groups = new Set(["log", "storage"]);
  if (helperNamesFor(id).has("on")) groups.add("events");
  if (helperNamesFor(id).has("onPacket")) groups.add("packets");
  if (["plugin-manager", "multi-account"].includes(id)) groups.add("session");
  if (id === "chat") groups.add("chat");
  if (id === "user") groups.add("avatar");
  if (id === "social") groups.add("social");
  if (id === "fishing") groups.add("fishing");
  if (id === "gardening") groups.add("plants");
  if (id === "present-catcher") groups.add("avatar");
  if (["items", "automation", "injection", "present-catcher", "wall-mover"].includes(id)) groups.add("furni");
  return [...groups];
}

function moduleSourceLines(id) {
  const commonSession = [
    "  on(disposers, events, 'session.selected', async (event) => {",
    "    state.selectedClientId = event?.clientId ?? null;",
    "    await remember(storage, 'selectedClient', { clientId: state.selectedClientId });",
    "  });",
  ];
  switch (id) {
    case "connection":
      return [
        ...commonSession,
        "  on(disposers, events, 'runtime.snapshot', async (event) => {",
        "    const snapshot = snapshotFromEvent(event);",
        "    await remember(storage, 'connection', {",
        "      clientId: event?.clientId ?? null,",
        "      roomReady: roomReady(snapshot),",
        "      room: roomSummary(snapshot),",
        "      userName: snapshot?.userState?.sessionUserName ?? null,",
        "      fps: snapshot?.performanceStats?.rafPerSecond ?? snapshot?.performanceStats?.rafRate ?? null,",
        "    });",
        "  });",
        "  onPacket(disposers, packets, 'all', {}, async (packet) => {",
        "    await remember(storage, 'latestPacket', packetSummary(packet));",
        "    return packet.allow();",
        "  });",
      ];
    case "plugin-manager":
      return [
        "  const clients = await session.getClients().catch(() => null);",
        "  await remember(storage, 'pluginManagerExample', {",
        "    purpose: 'Lists plugin metadata and lets the host enable/disable plugins. User plugins cannot alter host plugin settings directly yet.',",
        "    selectedClientId: clients?.selectedClientId ?? null,",
        "    clientCount: Array.isArray(clients?.clients) ? clients.clients.length : 0,",
        "  });",
      ];
    case "settings":
      return [
        "  await remember(storage, 'settingsExample', {",
        "    purpose: 'Settings-style plugins should store plugin-scoped preferences in storage.',",
        "    examplePrefs: { enabled: true, hotkey: 'F1', autoRun: false },",
        "  });",
        "  const prefs = await storage.get('prefs', { enabled: true, hotkey: 'F1', autoRun: false });",
        "  log.info('Loaded settings prefs: ' + JSON.stringify(prefs));",
      ];
    case "multi-account":
      return [
        ...commonSession,
        "  async function recordClients(reason) {",
        "    const clients = await session.getClients();",
        "    await remember(storage, 'clients', { reason, selectedClientId: clients.selectedClientId, mainClientId: clients.mainClientId, clients: clients.clients });",
        "  }",
        "  await recordClients('activated');",
        "  on(disposers, events, 'session.selected', () => recordClients('selection changed'));",
      ];
    case "info":
      return [
        "  on(disposers, events, 'runtime.snapshot', async (event) => {",
        "    const snapshot = snapshotFromEvent(event);",
        "    await remember(storage, 'info', { clientId: event?.clientId ?? null, room: roomSummary(snapshot), user: snapshot?.userState?.sessionUserName ?? null, rights: snapshot?.userState?.rights ?? [] });",
        "  });",
        "  onPacket(disposers, packets, 'server', {}, async (packet) => {",
        "    if (['USERS', 'MessengerInit', 'Badges'].includes(packet.packetName)) await remember(storage, 'latestInfoPacket', packetSummary(packet));",
        "    return packet.allow();",
        "  });",
      ];
    case "room":
      return [
        "  for (const eventName of ['room.changed', 'room.ready']) {",
        "    on(disposers, events, eventName, async (event) => {",
        "      await remember(storage, 'room', { eventName, clientId: event?.clientId ?? null, room: event?.room ?? null });",
        "    });",
        "  }",
        "  on(disposers, events, 'runtime.snapshot', async (event) => {",
        "    const snapshot = snapshotFromEvent(event);",
        "    await remember(storage, 'roomObjects', { room: roomSummary(snapshot), counts: roomObjectCounts(snapshot) });",
        "  });",
      ];
    case "user":
      return [
        "  let selectedUser = null;",
        "  on(disposers, events, 'room.users', async (event) => {",
        "    selectedUser = Array.isArray(event?.users) ? event.users.find((user) => user?.isSelf) ?? event.users[0] ?? null : null;",
        "    await remember(storage, 'selectedUser', selectedUser);",
        "  });",
        "  async function walkTo(x, y, clientId) {",
        "    return avatar.walkTo(x, y, 0, { clientId });",
        "  }",
        "  async function walkToItem(selector, clientId) {",
        "    return avatar.walkToItem(selector, { clientId });",
        "  }",
        "  async function wave(clientId) {",
        "    return avatar.wave({ clientId });",
        "  }",
        "  async function dance(number = 1, clientId) {",
        "    return avatar.dance(number, { clientId });",
        "  }",
        "  async function carryDrink(clientId) {",
        "    return avatar.carryDrink({ clientId });",
        "  }",
        "  await remember(storage, 'availableActions', ['walkTo(x, y, clientId)', 'walkToItem(idOrName, clientId)', 'wave(clientId)', 'dance(number, clientId)', 'carryDrink(clientId)']);",
      ];
    case "items":
      return [
        "  const itemsByKey = new Map();",
        "  on(disposers, events, 'room.items', async (event) => {",
        "    itemsByKey.clear();",
        "    for (const item of event?.items ?? []) itemsByKey.set(item.key, item);",
        "    await remember(storage, 'items', {",
        "      room: event?.room ?? null,",
        "      counts: event?.counts ?? null,",
        "      floorCount: Array.isArray(event?.floorItems) ? event.floorItems.length : [...itemsByKey.values()].filter((item) => item.kind !== 'wall').length,",
        "      wallCount: Array.isArray(event?.wallItems) ? event.wallItems.length : [...itemsByKey.values()].filter((item) => item.kind === 'wall').length,",
        "      items: [...itemsByKey.values()].map(itemSummary).slice(0, 40),",
        "      initial: event?.initial === true,",
        "    });",
        "  });",
        "  for (const eventName of ['room.itemAdded', 'room.itemUpdated', 'room.itemRemoved', 'room.floorItemAdded', 'room.floorItemUpdated', 'room.floorItemRemoved', 'room.wallItemAdded', 'room.wallItemUpdated', 'room.wallItemRemoved']) {",
        "    on(disposers, events, eventName, async (event) => {",
        "      if (event?.item?.key && eventName.endsWith('Removed')) itemsByKey.delete(event.item.key);",
        "      else if (event?.item?.key) itemsByKey.set(event.item.key, event.item);",
        "      await remember(storage, 'lastItemEvent', { eventName, item: itemSummary(event?.item), previous: itemSummary(event?.previous), total: itemsByKey.size });",
        "    });",
        "  }",
        "  await remember(storage, 'availableEvents', ['room.items', 'room.floorItemsLoaded', 'room.wallItemsLoaded', 'room.itemAdded/Updated/Removed', 'room.floorItemAdded/Updated/Removed', 'room.wallItemAdded/Updated/Removed']);",
        "  async function findItems(selector, clientId) {",
        "    return furni.findItems(selector, { clientId });",
        "  }",
        "  async function findItem(selector, clientId) {",
        "    return furni.findItem(selector, { clientId });",
        "  }",
        "  async function moveFloorItem(selector, x, y, direction, clientId) {",
        "    return furni.moveFloorItem(selector, x, y, direction, { clientId });",
        "  }",
        "  async function rotateFloorItem(selector, direction, clientId) {",
        "    return furni.rotateFloorItem(selector, direction, { clientId });",
        "  }",
        "  async function pickupMatching(selector, clientId) {",
        "    const matches = await furni.findItems(selector, { clientId });",
        "    const results = [];",
        "    for (const item of matches) results.push(await furni.pickupItem(item, { clientId }));",
        "    return results;",
        "  }",
        "  await remember(storage, 'availableActions', ['findItems(selector, clientId)', 'findItem(selector, clientId)', 'moveFloorItem(selector, x, y, direction, clientId)', 'rotateFloorItem(selector, direction, clientId)', 'pickupMatching(selector, clientId)']);",
      ];
    case "inventory":
      return [
        "  on(disposers, events, 'runtime.snapshot', async (event) => {",
        "    const snapshot = snapshotFromEvent(event);",
        "    await remember(storage, 'inventory', {",
        "      available: Boolean(snapshot?.inventory),",
        "      totalCount: snapshot?.inventory?.totalCount ?? 0,",
        "      floorCount: snapshot?.inventory?.floorCount ?? 0,",
        "      wallCount: snapshot?.inventory?.wallCount ?? 0,",
        "      items: Array.isArray(snapshot?.inventory?.items) ? snapshot.inventory.items.slice(0, 30) : [],",
        "    });",
        "  });",
        "  onPacket(disposers, packets, 'server', { packetName: 'StripInfo' }, async (packet) => {",
        "    await remember(storage, 'latestInventoryPacket', packetSummary(packet));",
        "    return packet.allow();",
        "  });",
      ];
    case "automation":
      return [
        "  on(disposers, events, 'runtime.snapshot', async (event) => {",
        "    const snapshot = snapshotFromEvent(event);",
        "    await remember(storage, 'automationTargets', {",
        "      room: roomSummary(snapshot),",
        "      plants: plantItems(snapshot).map(itemSummary).slice(0, 20),",
        "      wallItems: wallItems(snapshot).map(itemSummary).slice(0, 20),",
        "      users: snapshot?.userState?.users?.length ?? 0,",
        "    });",
        "  });",
        "  await remember(storage, 'automationActions', ['Use plants.movePlant/waterPlant/harvestPlant for plant tasks', 'Use furni.findItems/moveFloorItem/rotateFloorItem/pickupItem for room object scripts', 'Use furni.moveWallItem/pickupWallItem for wall movement', 'Use avatar.walkTo/walkToItem/wave/dance for avatar actions']);",
      ];
    case "fishing":
      return [
        "  let selectedAreaId = null;",
        "  on(disposers, events, 'runtime.snapshot', async (event) => {",
        "    const snapshot = snapshotFromEvent(event);",
        "    const areas = fishingAreaItems(snapshot).map(itemSummary);",
        "    selectedAreaId = selectedAreaId && areas.some((area) => area?.id === selectedAreaId) ? selectedAreaId : areas[0]?.id ?? null;",
        "    const hostState = await fishing.getState().catch(() => null);",
        "    await remember(storage, 'fishingAreas', { room: roomSummary(snapshot), selectedAreaId, count: areas.length, areas, hostState });",
        "  });",
        "  onPacket(disposers, packets, 'all', {}, async (packet) => {",
        "    const text = [packet.packetName, packet.bodyText, packet.bodyAscii, packet.message].join(' ').toLowerCase();",
        "    if (text.includes('fish') || text.includes('derby') || text.includes('frenzy')) await remember(storage, 'latestFishingPacket', packetSummary(packet));",
        "    return packet.allow();",
        "  });",
        "  async function refreshFishingState(clientId) {",
        "    return fishing.getState({ clientId });",
        "  }",
        "  async function startSelectedArea(clientId) {",
        "    const state = await fishing.getState({ clientId });",
        "    if (state?.occupants && !state.occupants.safeToAutomate) throw new Error('Fishing room has other human occupants; refusing to automate.');",
        "    const areaId = selectedAreaId ?? state?.target?.id ?? state?.areas?.[0]?.id;",
        "    if (!areaId) throw new Error('No live fishing area id is available. Enter a fishing public room first.');",
        "    selectedAreaId = areaId;",
        "    await fishing.walkToArea(areaId, { clientId });",
        "    await delay(650);",
        "    return fishing.startFishing(areaId, { clientId });",
        "  }",
        "  async function walkToSelectedArea(clientId) {",
        "    const state = await fishing.getState({ clientId });",
        "    const areaId = selectedAreaId ?? state?.target?.id ?? state?.areas?.[0]?.id;",
        "    if (!areaId) throw new Error('No live fishing area id is available. Enter a fishing public room first.');",
        "    selectedAreaId = areaId;",
        "    return fishing.walkToArea(areaId, { clientId });",
        "  }",
        "  async function minigameLeft(clientId) {",
        "    return fishing.minigameInput('L', { clientId });",
        "  }",
        "  async function minigameRight(clientId) {",
        "    return fishing.minigameInput('R', { clientId });",
        "  }",
        "  async function registerDerby(clientId) {",
        "    return fishing.registerDerby({ clientId });",
        "  }",
        "  async function purchaseFishingProduct(clientId, productCode) {",
        "    if (!productCode) throw new Error('purchaseFishingProduct requires a product code from requestFishingData/client UI.');",
        "    return fishing.purchaseProduct(productCode, { clientId });",
        "  }",
        "  async function requestFishingData(clientId) {",
        "    await fishing.requestTokens({ clientId });",
        "    await fishing.requestProducts({ clientId });",
        "    await fishing.requestStats({ clientId });",
        "    await fishing.requestRodLevel({ clientId });",
        "    return fishing.requestFishopedia({ clientId });",
        "  }",
        "  await remember(storage, 'availableActions', ['refreshFishingState(clientId)', 'walkToSelectedArea(clientId)', 'startSelectedArea(clientId)', 'minigameLeft(clientId)', 'minigameRight(clientId)', 'registerDerby(clientId)', 'requestFishingData(clientId)', 'purchaseFishingProduct(clientId, productCode)']);",
      ];
    case "gardening":
      return [
        "  let selectedPlant = null;",
        "  let latestPlantPlan = null;",
        "  on(disposers, events, 'runtime.snapshot', async (event) => {",
        "    const snapshot = snapshotFromEvent(event);",
        "    const plantRows = plantItems(snapshot);",
        "    selectedPlant = selectedPlant ? plantRows.find((item) => objectId(item) === objectId(selectedPlant)) ?? plantRows[0] ?? null : plantRows[0] ?? null;",
        "    latestPlantPlan = selectedPlant ? plantCyclePlan(selectedPlant, selfUser(snapshot)) : null;",
        "    await remember(storage, 'plants', { room: roomSummary(snapshot), count: plantRows.length, selected: itemSummary(selectedPlant), plan: latestPlantPlan, plants: plantRows.map(itemSummary).slice(0, 25) });",
        "  });",
        "  async function movePlantToWorkTile(clientId) {",
        "    const plan = requirePlantPlan(latestPlantPlan);",
        "    return plants.movePlant(plan.objectId, plan.workingX, plan.workingY, plan.originalDirection, { clientId });",
        "  }",
        "  async function waterSelected(clientId) {",
        "    const plan = requirePlantPlan(latestPlantPlan);",
        "    return plants.waterPlant(plan.objectId, { clientId });",
        "  }",
        "  async function harvestSelected(clientId) {",
        "    const plan = requirePlantPlan(latestPlantPlan);",
        "    return plants.harvestPlant(plan.objectId, { clientId });",
        "  }",
        "  async function returnPlant(clientId) {",
        "    const plan = requirePlantPlan(latestPlantPlan);",
        "    return plants.movePlant(plan.objectId, plan.originalX, plan.originalY, plan.originalDirection, { clientId });",
        "  }",
        "  async function runPlantCycle(clientId) {",
        "    const plan = requirePlantPlan(latestPlantPlan);",
        "    await plants.movePlant(plan.objectId, plan.workingX, plan.workingY, plan.originalDirection, { clientId });",
        "    await delay(700);",
        "    await plants.waterPlant(plan.objectId, { clientId });",
        "    await delay(900);",
        "    await plants.harvestPlant(plan.objectId, { clientId });",
        "    await delay(900);",
        "    return plants.movePlant(plan.objectId, plan.originalX, plan.originalY, plan.originalDirection, { clientId });",
        "  }",
        "  await remember(storage, 'availableActions', ['movePlantToWorkTile(clientId)', 'waterSelected(clientId)', 'harvestSelected(clientId)', 'returnPlant(clientId)', 'runPlantCycle(clientId)']);",
      ];
    case "present-catcher":
      return [
        "  const presentHeaders = new Set([65, 74, 78, 90, 93, 94, 1240, 1241, 3400, 3401, 3402, 3403, 3404, 3600, 3601, 3602, 3603, 3604]);",
        "  let selectedHammer = null;",
        "  let selectedPresent = null;",
        "  on(disposers, events, 'runtime.snapshot', async (event) => {",
        "    const snapshot = snapshotFromEvent(event);",
        "    const items = floorItems(snapshot);",
        "    const hammers = items.filter((item) => String(item?.className ?? item?.name ?? '').trim().toLowerCase() === 'toby_hammer');",
        "    const presents = items.filter((item) => String(item?.className ?? item?.name ?? '').trim().toLowerCase().startsWith('anniv_present_gen'));",
        "    selectedHammer = selectedHammer ? hammers.find((item) => objectId(item) === objectId(selectedHammer)) ?? hammers[0] ?? null : hammers[0] ?? null;",
        "    selectedPresent = selectedPresent ? presents.find((item) => objectId(item) === objectId(selectedPresent)) ?? presents[0] ?? null : presents[0] ?? null;",
        "    await remember(storage, 'presentTargets', {",
        "      room: roomSummary(snapshot),",
        "      ready: roomReady(snapshot),",
        "      hammers: hammers.map(itemSummary).slice(0, 20),",
        "      presents: presents.map(itemSummary).slice(0, 20),",
        "      selectedHammer: itemSummary(selectedHammer),",
        "      selectedPresent: itemSummary(selectedPresent),",
        "    });",
        "  });",
        "  onPacket(disposers, packets, 'all', {}, async (packet) => {",
        "    if (presentHeaders.has(Number(packet?.header))) await remember(storage, 'latestPresentPacket', packetSummary(packet));",
        "    return packet.allow();",
        "  });",
        "  async function collectSelectedHammer(clientId) {",
        "    const id = objectId(selectedHammer);",
        "    const tile = tileOf(selectedHammer);",
        "    if (!id || !tile) throw new Error('No selected toby_hammer with tile/object id.');",
        "    await avatar.walkTo(tile.x, tile.y, id, { clientId });",
        "    await delay(350);",
        "    return furni.useFloorItem({ objectId: id, kind: 'floor' }, '0', { clientId });",
        "  }",
        "  async function useSelectedPresent(clientId) {",
        "    const id = objectId(selectedPresent);",
        "    const tile = tileOf(selectedPresent);",
        "    if (!id || !tile) throw new Error('No selected anniv_present_gen* item with tile/object id.');",
        "    const target = tileBeside(tile, tile);",
        "    await avatar.walkTo(target.x, target.y, 0, { clientId });",
        "    await delay(350);",
        "    return furni.useFloorItem({ objectId: id, kind: 'floor' }, '0', { clientId });",
        "  }",
        "  async function refreshStrip(clientId) {",
        "    return packets.send(clientId, { header: 65, bodyText: 'new' });",
        "  }",
        "  async function openPlacedObject(objectIdValue, clientId) {",
        "    const id = Number(objectIdValue);",
        "    if (!Number.isInteger(id) || id <= 0) throw new Error('openPlacedObject requires a placed object id.');",
        "    return packets.send(clientId, { header: 78, bodyText: String(id) });",
        "  }",
        "  await remember(storage, 'availableActions', ['collectSelectedHammer(clientId)', 'useSelectedPresent(clientId)', 'refreshStrip(clientId)', 'openPlacedObject(objectId, clientId)']);",
        "  await remember(storage, 'untestedLiveRoutes', ['anniversary event present timing', 'treasure fragment trade packet family 3400..3404']);",
      ];
    case "wall-mover":
      return [
        "  let selectedWallItem = null;",
        "  on(disposers, events, 'room.wallItemsLoaded', async (event) => {",
        "    const walls = event?.wallItems ?? event?.items ?? [];",
        "    selectedWallItem = selectedWallItem ? walls.find((item) => objectId(item) === objectId(selectedWallItem)) ?? walls[0] ?? null : walls[0] ?? null;",
        "    await remember(storage, 'wallItems', { room: event?.room ?? null, count: walls.length, selected: wallItemActionShape(selectedWallItem), items: walls.map(itemSummary).slice(0, 25) });",
        "  });",
        "  for (const eventName of ['room.wallItemAdded', 'room.wallItemUpdated']) {",
        "    on(disposers, events, eventName, async (event) => {",
        "      selectedWallItem = event?.item ?? selectedWallItem;",
        "      await remember(storage, 'lastWallItemEvent', { eventName, item: itemSummary(event?.item), selected: wallItemActionShape(selectedWallItem) });",
        "    });",
        "  }",
        "  on(disposers, events, 'room.wallItemRemoved', async (event) => {",
        "    if (objectId(event?.item) && objectId(event.item) === objectId(selectedWallItem)) selectedWallItem = null;",
        "    await remember(storage, 'lastWallItemEvent', { eventName: 'room.wallItemRemoved', item: itemSummary(event?.item), selected: wallItemActionShape(selectedWallItem) });",
        "  });",
        "  async function moveSelected(deltaX = 0, deltaY = 0, orientation, clientId) {",
        "    const action = wallMoveAction(selectedWallItem, deltaX, deltaY, orientation);",
        "    if (!action) throw new Error('No selected wall item with movable wall/local coordinates.');",
        "    return furni.moveWallItem(action, action, { clientId });",
        "  }",
        "  async function pickupSelected(clientId) {",
        "    const id = objectId(selectedWallItem);",
        "    if (!id) throw new Error('No selected wall item object id.');",
        "    return furni.pickupWallItem({ kind: 'wall', itemId: id }, { clientId });",
        "  }",
        "  await remember(storage, 'availableActions', ['moveSelected(dx, dy, orientation, clientId)', 'pickupSelected(clientId)', 'furni.moveWallItem(selector, location, options)', 'furni.pickupWallItem(selector, options)']);",
      ];
    case "social":
      return [
        "  const friendsByName = new Map();",
        "  onPacket(disposers, packets, 'server', {}, async (packet) => {",
        "    if (packet.packetName && String(packet.packetName).toLowerCase().includes('messenger')) await remember(storage, 'latestMessengerPacket', packetSummary(packet));",
        "    for (const field of packet.decodedFields ?? []) {",
        "      if (/friend \\d+ name/i.test(field.label)) friendsByName.set(String(field.value).toLowerCase(), { name: field.value, sourceLine: packet.lineNumber });",
        "    }",
        "    await remember(storage, 'friends', [...friendsByName.values()].slice(0, 50));",
        "    return packet.allow();",
        "  });",
        "  async function addUser(name, clientId) {",
        "    return social.addUser(name, { clientId });",
        "  }",
        "  async function message(accountId, message, recipient, clientId) {",
        "    return social.message(accountId, message, { recipient, clientId });",
        "  }",
        "  async function refreshRequests(clientId) {",
        "    return social.refreshRequests({ clientId });",
        "  }",
        "  async function acceptRequest(accountId, clientId) {",
        "    return social.acceptRequest(accountId, { clientId });",
        "  }",
        "  async function declineRequest(accountId, clientId) {",
        "    return social.declineRequest(accountId, { clientId });",
        "  }",
        "  async function followFriend(accountId, clientId) {",
        "    return social.followFriend(accountId, { clientId });",
        "  }",
        "  await remember(storage, 'availableActions', ['addUser(name, clientId)', 'message(accountId, message, recipient, clientId)', 'refreshRequests(clientId)', 'acceptRequest(accountId, clientId)', 'declineRequest(accountId, clientId)', 'followFriend(accountId, clientId)']);",
      ];
    case "visitors":
      return [
        "  const visitors = new Map();",
        "  on(disposers, events, 'room.users', async (event) => {",
        "    for (const user of event?.users ?? []) visitors.set(visitorKey(user), { ...user, lastSeenAt: new Date().toISOString(), present: true });",
        "    await remember(storage, 'visitors', [...visitors.values()]);",
        "  });",
        "  on(disposers, events, 'room.userJoined', async (event) => {",
        "    visitors.set(visitorKey(event?.user), { ...event?.user, present: true, joinedAt: new Date().toISOString() });",
        "    await remember(storage, 'visitors', [...visitors.values()]);",
        "  });",
        "  on(disposers, events, 'room.userLeft', async (event) => {",
        "    const key = visitorKey(event?.user);",
        "    visitors.set(key, { ...(visitors.get(key) ?? event?.user), present: false, leftAt: new Date().toISOString() });",
        "    await remember(storage, 'visitors', [...visitors.values()]);",
        "  });",
      ];
    case "chat":
      return [
        "  const chatLog = [];",
        "  on(disposers, events, 'chat.message', async (event) => {",
        "    chatLog.push({ clientId: event?.clientId ?? null, user: event?.user?.name ?? event?.name ?? null, text: event?.text ?? '', mode: event?.mode ?? null, at: new Date().toISOString() });",
        "    await remember(storage, 'chat', chatLog.slice(-100));",
        "  });",
        "  async function say(message, clientId) {",
        "    return chat.send(message, { clientId });",
        "  }",
        "  await remember(storage, 'availableActions', ['say(message, clientId)']);",
      ];
    case "injection":
      return [
        "  await remember(storage, 'mappedActions', {",
        "    avatar: 'avatar.walkToItem(idOrName, { clientId }) or avatar.wave({ clientId })',",
        "    social: 'social.addUser(name, { clientId }) or social.message(accountId, message, { clientId })',",
        "    fishing: 'fishing.getState({ clientId }); startFishing(areaId); minigameInput(L/R); requestTokens/requestProducts/requestStats/requestFishopedia/purchaseProduct',",
        "    plants: 'plants.movePlant(id, x, y, direction, { clientId }); waterPlant/harvestPlant after movement',",
        "    furni: 'furni.findItems(selector), moveFloorItem(selector, x, y, direction), rotateFloorItem(selector, direction), pickupItem(selector), moveWallItem(selector, location)',",
        "    rawPackets: 'packets.send(...) remains blocked until raw builders are validated.',",
        "  });",
        "  onPacket(disposers, packets, 'client', {}, (packet) => packet.allow());",
      ];
    case "packet-log":
      return [
        "  const recent = [];",
        "  onPacket(disposers, packets, 'all', {}, async (packet) => {",
        "    recent.push(packetSummary(packet));",
        "    await remember(storage, 'recentPackets', recent.slice(-200));",
        "    return packet.allow();",
        "  });",
      ];
    case "dev-tools":
      return [
        "  on(disposers, events, 'runtime.snapshot', async (event) => {",
        "    const snapshot = snapshotFromEvent(event);",
        "    await remember(storage, 'diagnostics', {",
        "      clientId: event?.clientId ?? null,",
        "      fps: snapshot?.performanceStats?.rafPerSecond ?? snapshot?.performanceStats?.rafRate ?? null,",
        "      worstRafMs: snapshot?.performanceStats?.worstRafDeltaMs ?? null,",
        "      frame: snapshot?.frame ?? null,",
        "      errors: snapshot?.errors ?? null,",
        "      windows: snapshot?.windowIds ?? [],",
        "    });",
        "  });",
      ];
    case "about":
      return [
        "  await remember(storage, 'about', {",
        "    module: MODULE.name,",
        "    sourceModuleId: MODULE.sourceModuleId,",
        "    summary: MODULE.summary,",
        "    capabilities: MODULE.capabilities,",
        "  });",
      ];
    default:
      throw new Error(`Missing module-specific premade implementation for ${id}.`);
  }
}

function commonHelperLines(id) {
  const helpers = [
    lines("on", [
      "function on(disposers, events, eventName, handler) {",
      "  disposers.push(events.on(eventName, handler));",
      "}",
    ]),
    lines("onPacket", [
      "function onPacket(disposers, packets, direction, filter, handler) {",
      "  disposers.push(packets.on(direction, filter, handler));",
      "}",
    ]),
    lines("remember", [
      "async function remember(storage, key, value) {",
      "  await storage.set(key, { value, updatedAt: new Date().toISOString() });",
      "}",
    ]),
    lines("snapshotFromEvent", [
      "function snapshotFromEvent(event) {",
      "  return event?.snapshot ?? event?.runtime ?? event ?? null;",
      "}",
    ]),
    lines("roomReady", [
      "function roomReady(snapshot) {",
      "  return Boolean(snapshot?.roomReady?.ready ?? snapshot?.roomEntryState?.roomReady?.ready);",
      "}",
    ]),
    lines("roomSummary", [
      "function roomSummary(snapshot) {",
      "  return {",
      "    id: snapshot?.room?.id ?? snapshot?.roomEntryState?.flatId ?? snapshot?.userState?.roomId ?? null,",
      "    name: snapshot?.room?.name ?? snapshot?.userState?.roomName ?? null,",
      "    owner: snapshot?.room?.owner ?? snapshot?.userState?.roomOwner ?? null,",
      "    type: snapshot?.room?.type ?? snapshot?.userState?.roomType ?? null,",
      "    ready: roomReady(snapshot),",
      "  };",
      "}",
    ]),
    lines("roomObjectCounts", [
      "function roomObjectCounts(snapshot) {",
      "  return {",
      "    users: snapshot?.roomObjects?.counts?.users ?? snapshot?.userState?.roomUserCount ?? 0,",
      "    floor: floorItems(snapshot).length,",
      "    wall: wallItems(snapshot).length,",
      "    plants: plantItems(snapshot).length,",
      "    fishingAreas: fishingAreaItems(snapshot).length,",
      "  };",
      "}",
    ]),
    lines("floorItems", [
      "function floorItems(snapshot) {",
      "  return [",
      "    ...(snapshot?.roomObjects?.activeObjects ?? []),",
      "    ...(snapshot?.roomObjects?.passiveObjects ?? []),",
      "  ];",
      "}",
    ]),
    lines("wallItems", [
      "function wallItems(snapshot) {",
      "  return snapshot?.roomObjects?.wallItems ?? [];",
      "}",
    ]),
    lines("itemSearchText", [
      "function itemSearchText(item) {",
      "  return [item?.className, item?.name, item?.type, item?.state, item?.ownerName].join(' ').toLowerCase();",
      "}",
    ]),
    lines("plantItems", [
      "function plantItems(snapshot) {",
      "  return floorItems(snapshot).filter((item) => /farm|garden|plant|flower|blossom|pumpkin|seed|compost|harvest|water/.test(itemSearchText(item)));",
      "}",
    ]),
    lines("selfUser", [
      "function selfUser(snapshot) {",
      "  const sessionName = String(snapshot?.userState?.sessionUserName ?? '').trim().toLowerCase();",
      "  const users = snapshot?.userState?.users ?? snapshot?.roomObjects?.users ?? [];",
      "  return users.find((user) => user?.isSelf) ?? users.find((user) => String(user?.name ?? user?.className ?? '').trim().toLowerCase() === sessionName) ?? users[0] ?? null;",
      "}",
    ]),
    lines("tileOf", [
      "function tileOf(entity) {",
      "  const x = Number(entity?.x);",
      "  const y = Number(entity?.y);",
      "  const direction = Number(entity?.direction ?? 0);",
      "  if (Number.isFinite(x) && Number.isFinite(y)) return { x: Math.trunc(x), y: Math.trunc(y), direction: Number.isFinite(direction) ? Math.trunc(direction) : 0 };",
      "  const match = String(entity?.position ?? '').match(/(-?\\d+)\\s*,\\s*(-?\\d+)/);",
      "  return match ? { x: Number.parseInt(match[1], 10), y: Number.parseInt(match[2], 10), direction: 0 } : null;",
      "}",
    ]),
    lines("plantCyclePlan", [
      "function plantCyclePlan(plant, user) {",
      "  const id = objectId(plant);",
      "  const original = tileOf(plant);",
      "  if (!id || !original) return null;",
      "  const userTile = tileOf(user);",
      "  const working = userTile ? tileBeside(userTile, original) : { x: original.x + 1, y: original.y };",
      "  return { objectId: id, originalX: original.x, originalY: original.y, originalDirection: original.direction, workingX: working.x, workingY: working.y };",
      "}",
    ]),
    lines("tileBeside", [
      "function tileBeside(userTile, fallbackTile) {",
      "  const candidates = [",
      "    { x: userTile.x + 1, y: userTile.y },",
      "    { x: userTile.x, y: userTile.y + 1 },",
      "    { x: userTile.x - 1, y: userTile.y },",
      "    { x: userTile.x, y: userTile.y - 1 },",
      "  ];",
      "  return candidates.find((tile) => tile.x !== fallbackTile.x || tile.y !== fallbackTile.y) ?? candidates[0] ?? fallbackTile;",
      "}",
    ]),
    lines("requirePlantPlan", [
      "function requirePlantPlan(plan) {",
      "  if (!plan?.objectId) throw new Error('No selected plant with tile and object id.');",
      "  return plan;",
      "}",
    ]),
    lines("delay", [
      "function delay(ms) {",
      "  return new Promise((resolve) => setTimeout(resolve, ms));",
      "}",
    ]),
    lines("fishingAreaItems", [
      "function fishingAreaItems(snapshot) {",
      "  return floorItems(snapshot).filter((item) => String(item?.className ?? item?.name ?? '').trim().toLowerCase().endsWith('fish_area'));",
      "}",
    ]),
    lines("objectId", [
      "function objectId(item) {",
      "  const value = Number(item?.objectId ?? item?.id ?? item?.itemId);",
      "  return Number.isInteger(value) && value > 0 ? value : null;",
      "}",
    ]),
    lines("itemSummary", [
      "function itemSummary(item) {",
      "  if (!item) return null;",
      "  const tile = item.tile ?? tileOf(item);",
      "  return { key: item.key ?? null, kind: item.kind ?? null, id: objectId(item), objectId: item.objectId ?? null, itemId: item.itemId ?? null, className: item.className ?? item.name ?? null, name: item.name ?? null, ownerName: item.ownerName ?? null, tile, x: item.x ?? tile?.x ?? null, y: item.y ?? tile?.y ?? null, wallLocation: item.wallLocation ?? null, wall: item.wall ?? null, local: item.local ?? null, orientation: item.orientation ?? item.direction ?? null, state: item.state ?? null };",
      "}",
    ]),
    lines("wallItemActionShape", [
      "function wallItemActionShape(item) {",
      "  const action = wallMoveAction(item, 0, 0);",
      "  return action ? { ...action, action: 'moveItem' } : itemSummary(item);",
      "}",
    ]),
    lines("wallMoveAction", [
      "function wallMoveAction(item, deltaX = 0, deltaY = 0, orientation) {",
      "  const id = objectId(item);",
      "  if (!id) return null;",
      "  const wall = parsePair(item?.wall);",
      "  const local = parsePair(item?.local);",
      "  if (!wall || !local) return null;",
      "  return {",
      "    action: 'moveItem',",
      "    itemId: id,",
      "    wallX: wall[0] + deltaX,",
      "    wallY: wall[1] + deltaY,",
      "    localX: local[0],",
      "    localY: local[1],",
      "    orientation: orientation || item?.orientation || item?.direction || 'l',",
      "    className: item?.className ?? item?.name,",
      "  };",
      "}",
    ]),
    lines("parsePair", [
      "function parsePair(value) {",
      "  if (Array.isArray(value) && value.length >= 2) return value.map(Number).slice(0, 2);",
      "  const parts = String(value ?? '').match(/-?\\d+/g)?.map(Number) ?? [];",
      "  return parts.length >= 2 ? parts.slice(0, 2) : null;",
      "}",
    ]),
    lines("packetSummary", [
      "function packetSummary(packet) {",
      "  return { clientId: packet?.clientId ?? null, direction: packet?.direction ?? null, header: packet?.header ?? null, packetName: packet?.packetName ?? 'UNKNOWN_HEADER', lineNumber: packet?.lineNumber ?? null, fields: packet?.decodedFields ?? [], bodyStatus: packet?.bodyStatus ?? null };",
      "}",
    ]),
    lines("visitorKey", [
      "function visitorKey(user) {",
      "  return String(user?.accountId ?? user?.id ?? user?.name ?? 'unknown').toLowerCase();",
      "}",
    ]),
  ];
  const needed = helperNamesFor(id);
  return helpers.flatMap((helper) => needed.has(helper.name) ? [...helper.lines, ""] : []);
}

function helperNamesFor(id) {
  const eventModules = new Set([
    "connection",
    "multi-account",
    "info",
    "room",
    "user",
    "items",
    "inventory",
    "automation",
    "fishing",
    "gardening",
    "present-catcher",
    "wall-mover",
    "visitors",
    "chat",
    "dev-tools",
  ]);
  const packetModules = new Set([
    "connection",
    "info",
    "inventory",
    "fishing",
    "present-catcher",
    "social",
    "injection",
    "packet-log",
  ]);
  const names = new Set(["remember"]);
  if (eventModules.has(id)) names.add("on");
  if (packetModules.has(id)) names.add("onPacket");
  for (const name of helperGroupsFor(id)) names.add(name);
  return names;
}

function helperGroupsFor(id) {
  switch (id) {
    case "connection":
      return ["snapshotFromEvent", "roomReady", "roomSummary", "packetSummary"];
    case "plugin-manager":
    case "settings":
    case "multi-account":
    case "user":
    case "chat":
    case "about":
      return [];
    case "info":
      return ["snapshotFromEvent", "roomReady", "roomSummary", "packetSummary"];
    case "room":
      return ["snapshotFromEvent", "roomReady", "roomSummary", "roomObjectCounts", "floorItems", "wallItems", "itemSearchText", "plantItems", "fishingAreaItems"];
    case "items":
      return ["snapshotFromEvent", "roomReady", "roomSummary", "floorItems", "wallItems", "tileOf", "objectId", "itemSummary"];
    case "inventory":
      return ["snapshotFromEvent", "packetSummary"];
    case "automation":
      return ["snapshotFromEvent", "roomReady", "roomSummary", "floorItems", "wallItems", "itemSearchText", "plantItems", "tileOf", "objectId", "itemSummary"];
    case "fishing":
      return ["snapshotFromEvent", "roomReady", "roomSummary", "floorItems", "fishingAreaItems", "tileOf", "objectId", "itemSummary", "packetSummary", "delay"];
    case "gardening":
      return ["snapshotFromEvent", "roomReady", "roomSummary", "floorItems", "itemSearchText", "plantItems", "selfUser", "tileOf", "plantCyclePlan", "tileBeside", "requirePlantPlan", "delay", "objectId", "itemSummary"];
    case "present-catcher":
      return ["snapshotFromEvent", "roomReady", "roomSummary", "floorItems", "tileOf", "tileBeside", "delay", "objectId", "itemSummary", "packetSummary"];
    case "wall-mover":
      return ["snapshotFromEvent", "roomReady", "roomSummary", "wallItems", "tileOf", "objectId", "itemSummary", "wallItemActionShape", "wallMoveAction", "parsePair"];
    case "social":
    case "packet-log":
      return ["packetSummary"];
    case "visitors":
      return ["visitorKey"];
    case "dev-tools":
      return ["snapshotFromEvent"];
    case "injection":
      return [];
    default:
      throw new Error(`Missing helper scope for ${id}.`);
  }
}

function lines(name, value) {
  return { name, lines: value };
}

function readmeFor(plugin, manifest) {
  return withFinalNewline([
    `# ${manifest.name}`,
    "",
    manifest.description,
    "",
    "This folder is a premade user-plugin source reference for the native built-in module.",
    "It does not replace the native panel; it shows how a third-party plugin can subscribe to the same public events and APIs.",
    "",
    "## Install",
    "",
    "1. Open Plugin Manager.",
    "2. Choose Install From Folder.",
    "3. Select this folder.",
    "4. Enable the installed plugin if needed.",
    "",
    "## Permissions",
    "",
    ...manifest.permissions.map((permission) => `- \`${permission}\``),
    "",
    "## Capabilities Mirrored From The Built-In Module",
    "",
    ...plugin.capabilities.map((capability) => `- ${capability}`),
    "",
    "## Notes",
    "",
    "- The plugin keeps state in plugin-scoped storage.",
    "- Packet hooks observe and allow packets; they do not mutate traffic.",
    "- Raw packet injection, custom React panels, and custom console commands remain reserved host phases.",
  ]);
}

function relativePath(path) {
  return path.replace(`${workspace}\\`, "").replaceAll("\\", "/");
}

function withFinalNewline(lines) {
  const output = [...lines];
  while (output.at(-1) === "") output.pop();
  return `${output.join("\n")}\n`;
}

