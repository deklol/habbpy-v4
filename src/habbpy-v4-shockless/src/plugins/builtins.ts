import type { PluginDefinition } from "../shared/plugin.js";
import { connectionPlugin } from "./connection/plugin.js";
import { pluginManagerPlugin } from "./plugin-manager/plugin.js";
import { settingsPlugin } from "./settings/plugin.js";
import { multiAccountPlugin } from "./multi-account/plugin.js";
import { infoPlugin } from "./info/plugin.js";
import { roomPlugin } from "./room/plugin.js";
import { userPlugin } from "./user/plugin.js";
import { itemsPlugin } from "./items/plugin.js";
import { inventoryPlugin } from "./inventory/plugin.js";
import { automationPlugin } from "./automation/plugin.js";
import { fishingPlugin } from "./fishing/plugin.js";
import { gardeningPlugin } from "./gardening/plugin.js";
import { presentCatcherPlugin } from "./present-catcher/plugin.js";
import { wallMoverPlugin } from "./wall-mover/plugin.js";
import { socialPlugin } from "./social/plugin.js";
import { visitorsPlugin } from "./visitors/plugin.js";
import { chatPlugin } from "./chat/plugin.js";
import { injectionPlugin } from "./injection/plugin.js";
import { packetLogPlugin } from "./packet-log/plugin.js";
import { devToolsPlugin } from "./dev-tools/plugin.js";
import { aboutPlugin } from "./about/plugin.js";

export const builtInPluginDefinitions: readonly PluginDefinition[] = [
  connectionPlugin,
  pluginManagerPlugin,
  settingsPlugin,
  multiAccountPlugin,
  infoPlugin,
  roomPlugin,
  userPlugin,
  itemsPlugin,
  inventoryPlugin,
  automationPlugin,
  fishingPlugin,
  gardeningPlugin,
  presentCatcherPlugin,
  wallMoverPlugin,
  socialPlugin,
  visitorsPlugin,
  chatPlugin,
  injectionPlugin,
  packetLogPlugin,
  devToolsPlugin,
  aboutPlugin,
];
