import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { PluginManager } from "../src/main/pluginManager";

function withTempAppData(name: string, run: (appData: string) => void): void {
  const appData = mkdtempSync(join(tmpdir(), name));
  try {
    run(appData);
  } finally {
    rmSync(appData, { recursive: true, force: true });
  }
}

function writePluginFixture(root: string, id = "fixture-plugin"): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "habbpy.plugin.json"),
    `${JSON.stringify(
      {
        id,
        name: "Fixture Plugin",
        version: "0.1.0",
        author: "Local test",
        description: "Fixture plugin.",
        entry: "plugin.js",
        icon: "terminal",
        category: "developer",
        permissions: ["ui.panel", "console.commands"],
        surfaces: [
          {
            id: "panel",
            kind: "panel",
            label: "Fixture Panel",
            enabledByDefault: true,
            summary: "Fixture plugin panel.",
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  writeFileSync(join(root, "plugin.js"), "export function activate() { return { dispose() {} }; }\n", "utf8");
}

test("plugin manager keeps core tabs pinned and enabled", () => {
  withTempAppData("habbpy-v4-plugin-core-", (appData) => {
    const manager = new PluginManager(appData);
    const state = manager.state();

    assert.ok(state.pinnedPluginIds.includes("plugin-manager"));
    assert.ok(state.pinnedPluginIds.includes("settings"));
    assert.equal(state.enabledById["plugin-manager"], true);
    assert.equal(state.enabledById.settings, true);

    const next = manager.setPluginEnabled("plugin-manager", false);
    assert.equal(next.enabledById["plugin-manager"], true);
    assert.match(next.message, /pinned/i);
  });
});

test("plugin manager creates enabled user plugins from the local template", () => {
  withTempAppData("habbpy-v4-plugin-template-", (appData) => {
    const manager = new PluginManager(appData);
    const result = manager.createFromTemplate({ id: "local-toolkit", name: "Local Toolkit" });

    assert.equal(result.ok, true);
    assert.equal(result.state.enabledById["local-toolkit"], true);
    assert.ok(existsSync(join(manager.userPluginRoot(), "local-toolkit", "habbpy.plugin.json")));
    assert.ok(existsSync(join(manager.userPluginRoot(), "local-toolkit", "plugin.js")));

    const created = result.state.plugins.find((plugin) => plugin.id === "local-toolkit");
    assert.ok(created);
    assert.equal(created.origin, "user");
    assert.equal(created.status, "ready");
    assert.equal(created.permissions?.includes("ui.panel"), true);

    const relayPolicy = manager.relayPolicy();
    assert.ok(relayPolicy.grants.some((grant) => grant.pluginId === "local-toolkit" && grant.permissions.includes("packet.read")));

    const disabled = manager.setPluginEnabled("local-toolkit", false);
    assert.equal(disabled.enabledById["local-toolkit"], false);
    assert.equal(manager.relayPolicy().grants.some((grant) => grant.pluginId === "local-toolkit"), false);
  });
});

test("plugin manager installs valid folders and refuses obvious private files", () => {
  withTempAppData("habbpy-v4-plugin-install-", (appData) => {
    const fixtureParent = mkdtempSync(join(tmpdir(), "habbpy-v4-plugin-source-"));
    try {
      const validRoot = join(fixtureParent, "valid-plugin");
      writePluginFixture(validRoot);

      const manager = new PluginManager(appData);
      const installed = manager.installFromFolder(validRoot);
      assert.equal(installed.ok, true);
      assert.equal(installed.state.enabledById["fixture-plugin"], true);
      assert.ok(existsSync(join(manager.userPluginRoot(), "fixture-plugin", "plugin.js")));

      const privateRoot = join(fixtureParent, "private-plugin");
      writePluginFixture(privateRoot, "private-fixture");
      writeFileSync(join(privateRoot, "webhook-token.txt"), "local test placeholder\n", "utf8");
      const refused = manager.installFromFolder(privateRoot);
      assert.equal(refused.ok, false);
      assert.match(refused.message, /credential|webhook/i);
    } finally {
      rmSync(fixtureParent, { recursive: true, force: true });
    }
  });
});

test("plugin manager installs the welcome message example plugin", () => {
  withTempAppData("habbpy-v4-plugin-example-", (appData) => {
    const manager = new PluginManager(appData);
    const result = manager.installFromFolder(resolve("examples/plugins/welcome-message"));

    assert.equal(result.ok, true);
    assert.equal(result.state.enabledById["welcome-message"], true);
    const plugin = result.state.plugins.find((entry) => entry.id === "welcome-message");
    assert.ok(plugin);
    assert.equal(plugin.origin, "user");
    assert.equal(plugin.permissions?.includes("events.room"), true);
    assert.equal(plugin.permissions?.includes("chat.send"), true);
    assert.equal(plugin.permissions?.includes("packet.inject"), false);
  });
});

test("plugin manager installs the chooser/furni client rights example plugin", () => {
  withTempAppData("habbpy-v4-plugin-chooser-rights-", (appData) => {
    const manager = new PluginManager(appData);
    const result = manager.installFromFolder(resolve("examples/plugins/chooser-furni-permissions"));

    assert.equal(result.ok, true);
    assert.equal(result.state.enabledById["chooser-furni-permissions"], true);
    const plugin = result.state.plugins.find((entry) => entry.id === "chooser-furni-permissions");
    assert.ok(plugin);
    assert.equal(plugin.origin, "user");
    assert.equal(plugin.permissions?.includes("client.rights"), true);
    assert.equal(plugin.permissions?.includes("packet.inject"), false);
  });
});

test("plugin manager installs premade module source plugins", () => {
  withTempAppData("habbpy-v4-plugin-premade-", (appData) => {
    const manager = new PluginManager(appData);
    const result = manager.installFromFolder(resolve("examples/premade-plugins/room"));

    assert.equal(result.ok, true);
    assert.equal(result.state.enabledById["premade-room"], true);
    const plugin = result.state.plugins.find((entry) => entry.id === "premade-room");
    assert.ok(plugin);
    assert.equal(plugin.origin, "user");
    assert.equal(plugin.permissions?.includes("events.room"), true);
    assert.equal(plugin.permissions?.includes("engine.snapshot"), true);
  });
});

test("plugin manager installs premade modules with explicit action permissions", () => {
  withTempAppData("habbpy-v4-plugin-premade-actions-", (appData) => {
    const manager = new PluginManager(appData);
    for (const moduleId of ["user", "items", "fishing", "gardening", "wall-mover", "social"]) {
      const result = manager.installFromFolder(resolve("examples/premade-plugins", moduleId));
      assert.equal(result.ok, true, result.message);
    }

    const state = manager.state();
    assert.equal(state.plugins.find((entry) => entry.id === "premade-user")?.permissions?.includes("actions.avatar"), true);
    assert.equal(state.plugins.find((entry) => entry.id === "premade-fishing")?.permissions?.includes("actions.fishing"), true);
    assert.equal(state.plugins.find((entry) => entry.id === "premade-fishing")?.permissions?.includes("actions.avatar"), true);
    assert.equal(state.plugins.find((entry) => entry.id === "premade-items")?.permissions?.includes("actions.furni"), true);
    assert.equal(state.plugins.find((entry) => entry.id === "premade-gardening")?.permissions?.includes("actions.plants"), true);
    assert.equal(state.plugins.find((entry) => entry.id === "premade-wall-mover")?.permissions?.includes("actions.furni"), true);
    assert.equal(state.plugins.find((entry) => entry.id === "premade-wall-mover")?.permissions?.includes("actions.wallItems"), false);
    assert.equal(state.plugins.find((entry) => entry.id === "premade-social")?.permissions?.includes("actions.social"), true);
  });
});

test("generated premade modules use explicit host APIs instead of blanket action wrappers", () => {
  const user = readFileSync(resolve("examples/premade-plugins/user/plugin.js"), "utf8");
  const fishing = readFileSync(resolve("examples/premade-plugins/fishing/plugin.js"), "utf8");
  const gardening = readFileSync(resolve("examples/premade-plugins/gardening/plugin.js"), "utf8");
  const items = readFileSync(resolve("examples/premade-plugins/items/plugin.js"), "utf8");
  const wallMover = readFileSync(resolve("examples/premade-plugins/wall-mover/plugin.js"), "utf8");
  const social = readFileSync(resolve("examples/premade-plugins/social/plugin.js"), "utf8");
  const combined = [user, fishing, gardening, items, wallMover, social].join("\n");

  assert.match(user, /avatar\.walkToItem/);
  assert.match(fishing, /fishing\.getState/);
  assert.match(fishing, /fishing\.walkToArea/);
  assert.match(fishing, /fishing\.startFishing/);
  assert.match(fishing, /fishing\.minigameInput/);
  assert.match(fishing, /fishing\.purchaseProduct/);
  assert.match(fishing, /endsWith\('fish_area'\)/);
  assert.match(gardening, /plants\.movePlant/);
  assert.match(gardening, /plants\.waterPlant/);
  assert.match(gardening, /plants\.harvestPlant/);
  assert.match(items, /furni\.findItems/);
  assert.match(items, /furni\.pickupItem/);
  assert.match(wallMover, /furni\.moveWallItem/);
  assert.match(wallMover, /furni\.pickupWallItem/);
  assert.match(social, /social\.addUser/);
  assert.doesNotMatch(combined, /habbpy\.|actions\.user|actions\.gardening|actions\.wallMover/);
  assert.doesNotMatch(fishing, /plantCyclePlan|wallMoveAction|wallItemActionShape/);
});

test("plugin manager ignores underscored source-pack folders", () => {
  withTempAppData("habbpy-v4-plugin-source-pack-", (appData) => {
    const manager = new PluginManager(appData);
    mkdirSync(join(manager.userPluginRoot(), "_premade-modules", "room"), { recursive: true });
    writeFileSync(join(manager.userPluginRoot(), "_premade-modules", "room", "README.md"), "source reference only\n", "utf8");

    const state = manager.state();
    assert.equal(state.loadErrors.some((error) => error.sourcePath.includes("_premade-modules")), false);
  });
});
