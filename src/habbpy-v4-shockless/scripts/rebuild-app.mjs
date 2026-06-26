import { readFileSync, writeFileSync } from "node:fs";

const orig = readFileSync("F:/habbpy-v4-shockless/src/renderer/ui/App.tsx", "utf8");
const lines = orig.split("\n");

const origImports = lines.slice(0, 94);
const componentCode = lines.slice(3932).join("\n");

const panels = [
  "AboutPanel", "DevToolsPanel", "AutomationPanel", "InventoryPanel",
  "VisitorsPanel", "ChatPanel", "WallMoverPanel", "RoomPanel",
  "ItemsPanel", "InfoPanel", "SocialPanel", "FishingPanel",
  "GardeningPanel", "ConnectionPanel", "PluginManagerPanel",
  "SettingsPanel", "UserPanel", "MultiAccountPanel",
  "PresentCatcherPanel", "InjectionPanel", "PacketLogPanel",
];

const panelImports = panels.map(p =>
  `import { ${p} } from "../../plugins/${p.replace('Panel','').toLowerCase().replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '').replace('plugin-manager','plugin-manager').replace('present-catcher','present-catcher').replace('multi-account','multi-account').replace('packet-log','packet-log').replace('wall-mover','wall-mover').replace('dev-tools','dev-tools')}/Panel";`
);

// Fix the kebab-case generation
const panelDirs = {
  AboutPanel: "about", DevToolsPanel: "dev-tools", AutomationPanel: "automation",
  InventoryPanel: "inventory", VisitorsPanel: "visitors", ChatPanel: "chat",
  WallMoverPanel: "wall-mover", RoomPanel: "room", ItemsPanel: "items",
  InfoPanel: "info", SocialPanel: "social", FishingPanel: "fishing",
  GardeningPanel: "gardening", ConnectionPanel: "connection",
  PluginManagerPanel: "plugin-manager", SettingsPanel: "settings",
  UserPanel: "user", MultiAccountPanel: "multi-account",
  PresentCatcherPanel: "present-catcher", InjectionPanel: "injection",
  PacketLogPanel: "packet-log",
};

const panelImportLines = Object.entries(panelDirs).map(([panel, dir]) =>
  `import { ${panel} } from "../../plugins/${dir}/Panel";`
);

const extraHeader = [
  ...panelImportLines,
  `import { UserPluginPanel } from "./UserPluginPanel";`,
  `import { TopBar } from "./TopBar";`,
  `import { BootSplash } from "./BootSplash";`,
  `import { IconRail } from "./IconRail";`,
  `import { RoomOverlays } from "./RoomOverlays";`,
  `import { encodeShockwaveBase64Int, formatShockwavePacketParts } from "../../shared/shockwavePacketText";`,
  `import type {`,
  `  AppPreferencesPatch, AppPreferencesState, ClientLibraryState, ClientRuntimeSummary,`,
  `  ClientSnapshot, ClientSessionList, ClientSessionSummary, ConsoleCommandStateSnapshot,`,
  `  ClientProfileSummary, EngineLaunchState, EngineLaunchSettingsPatch,`,
  `  FurniMetadataEntry, FurniMetadataSnapshot,`,
  `  FurniRelayAction, FishingRelayAction, GardeningRelayAction,`,
  `  OriginsUserLookupResult, ProfileImportProgress, ProfileImportStage,`,
  `  PluginPacketInput, RelayLogDeltaSnapshot, RelayLogEntry, RelayLogSnapshot,`,
  `  SocialRelayAction, MimicCategory, MimicStateSnapshot, UserRelayAction, WallMoverRelayAction,`,
  `} from "../../shared/window-api";`,
  `import {`,
  `  PluginIcon, labelCase, statusLabel, permissionLabel, originLabel,`,
  `  profileLine, clientSessionTitle, gameWebviewPartitionForClient,`,
  `  finiteNumber, chatEntryKey, chatEntryLabel, chatEntryKind,`,
  `  compactValue, commandArg, mimicCategoryOptions,`,
  `  withVisibleConsoleContext, uniqueUsefulNames, firstUsefulName,`,
  `  isTextEntryTarget, bindingKeyFromKeyboardEvent, normalizeShortcutKey,`,
  `  objectTitle, normalizeFurniClassName, furniInfoForClass, furniInfoForObject, furniDisplayName,`,
  `  isRelayBackedConsoleCommand, commandRefreshesEngineLaunch,`,
  `  objectMeta, wallObjectMeta, objectSearchText,`,
  `  isPlantLikeObject, isFishingAreaObject, isPresentCatcherHammerObject, isPresentCatcherPresentObject, isPresentCatcherGiftItem,`,
  `  presentCatcherPacketHeaders,`,
  `  objectNumericId, signedPair, wallOrientation, wallMoverLocation,`,
  `  itemRowTile, userTile, tileKey, objectIdText,`,
  `  gardeningFacingTilePriority, gardeningFallbackTilePriority,`,
  `  occupiedGardeningTiles, workingTileNearSelf, findCurrentPlantRow, adjacentTileForItem,`,
  `  latin1ByteArray, shockwaveVl64ByteArray, shockwaveOutgoingStringByteArray, decodeShockwaveVl64Text,`,
  `  injectionActionOptions, defaultInjectionDraft,`,
  `  injectionSnippetStorageKey, injectionHistoryStorageKey, userStoredLookStorageKey, automationPrefsStorageKey,`,
  `  injectionCommandLabel, cloneInjectionDraft, normalizeInjectionSnippet, normalizeInjectionSnippets,`,
  `  normalizeStoredUserLooks, loadStoredUserLooks, loadAutomationPrefs, writeClipboardText,`,
  `  injectionDraftToRuntimeAction, injectionDraftToUserRelayAction,`,
  `  clampRepeatCount, clampRepeatInterval, clampMultiAccountCount, clampMultiAccountConcurrency, delay,`,
  `  objectListSignature, userListSignature, inventorySignature, navigatorSignature,`,
  `  roomObjectsSignature, userStateSignature, chatHistorySignature, activeSpritesSignature,`,
  `  runtimeProbeScopesForPlugin, reuseStableRuntimeDetails,`,
  `  itemRowTitle, itemRowMeta, itemRowSearchText,`,
  `  userDisplayName, userPosition, userRowMeta,`,
  `  packetFieldMap, packetUsersFromEntries, packetUsersFromRelayLog,`,
  `  packetInfoStateFromEntries, packetInfoStateFromRelayLog,`,
  `  addPacketFriendsFromPrefix, addPacketPrivateMessagesFromPrefix, addPacketFriendRequestsFromPrefix,`,
  `  packetFriendFromPrefix, packetPrivateMessageFromPrefix, packetFriendRequestFromPrefix,`,
  `  packetFriendKey, packetPrivateMessageKey, packetFriendRequestKey, parsedCount,`,
  `  packetFriendSearchText, packetFriendMeta, packetFriendTitle,`,
  `  lookupTokenMatches, runtimeUserMatchesLookup, packetUserMatchesLookup,`,
  `  packetFriendMatchesLookup, packetFriendRequestMatchesLookup,`,
  `  parsePositiveSocialAccountId, packetFriendActionId, packetFriendRequestActionId,`,
  `  findPacketFriendForAction, findPacketFriendRequestForAction,`,
  `  runtimeLookupLine, packetProfileLookupLine, friendRequestLookupLine, originsLookupLine,`,
  `  packetChatEntriesFromEntries, packetChatEntriesFromRelayLog,`,
  `  packetFishingStateFromEntries, packetFishopediaEntryFromPrefix,`,
  `  packetChatRuntimeEntry, packetChatUserName,`,
  `  packetWallItemStateFromEntries, packetWallItemStateFromRelayLog,`,
  `  packetWallItemFromPrefix, packetWallItemRow,`,
  `  packetInventoryStateFromEntries, packetInventoryStateFromRelayLog,`,
  `  packetInventoryItemFromPrefix, packetInventoryKey,`,
  `  packetInventorySearchText, packetInventoryTitle, packetInventoryMeta,`,
  `  runtimeInventoryDisplayRow, packetInventoryDisplayRow,`,
  `  packetProfileIndexFromUsers, selectPacketProfileUser, packetProfileForRuntimeUser,`,
  `  latestPacketVisitorUsers, profileValue,`,
  `  isVisitorUser, visitorKeyFor, visitorEntryFor, visitorEntryForPacketUser,`,
  `  visitorSearchText, visitorMeta, inventoryKindLabel,`,
  `  relayEntryLabel, relayEntryV3Line, relayEntryDisplayName, relayEntrySearchText, relayPacketSummary,`,
  `  virtualPacketRowHeight, virtualPacketOverScan, virtualPacketRange,`,
  `  mergeRelayLogSnapshot, relayLogSnapshotForClient,`,
  `  clientPluginSnapshotForClient, clientPluginSnapshotMapFromSources, mergeClientSummaryIntoList,`,
  `  pluginHasPermission, requirePluginPermission,`,
  `  isDisabledPluginCleanupRequest, assertDisabledPluginCleanupRequest,`,
  `  pluginRoomKey, pluginRoomPayload, pluginRuntimeUserKey, pluginRuntimeUserPayload, pluginRuntimeUserKind,`,
  `  pluginRuntimeItemSignature, pluginRuntimeItemPayload,`,
  `  pluginRoomObjectRecords, pluginRoomObjectsPayload, dispatchPluginRoomItemEvent,`,
  `  pluginRoomOccupantsPayload, pluginRoomUsersPayload, pluginRelayPacketPayload, pluginChatPayload,`,
  `  pluginStorageKey, requestedPluginClientId,`,
  `  cleanPluginRightsList, pluginManagedClientRights, disabledManagedClientRights,`,
  `  matchingClientRights, clientRightsPayloadRights,`,
  `  cleanInteger, cleanPositiveInt, pluginWalkTargetFromSnapshot, pluginWalkTargetFromRow,`,
  `  pluginFindItemRows, pluginSelectorIsEmpty, pluginItemRowMatchesSelector,`,
  `  pluginResolveFloorItem, pluginResolveWallItem,`,
  `  pluginSelectorNumericId, pluginSelectorTile, pluginSelectorKind, pluginSelectorWallLocation,`,
  `  pluginWallMoveLocation, pluginFishingAreaRows, pluginFishingPayload, pluginFishingTarget,`,
  `  PROFILE_IMPORT_STAGES, PROFILE_IMPORT_STAGE_LABELS,`,
  `  profileImportStageEntry, profileImportStatusLabel, formatImportElapsed,`,
  `  type GameWebviewMount,`,
  `  type WallMoverLocation, type GardeningPhase, type GardeningJobState,`,
  `  type InjectionActionKind, type InjectionCommandDraft, type InjectionSnippet, type InjectionHistoryEntry,`,
  `  type PacketConsoleEntry, type PluginClientRightsOwners,`,
  `  type PacketProfileUser, type PacketProfileIndex,`,
  `  type PacketInfoFriend, type PacketInfoEffect, type PacketMessengerMessage, type PacketFriendRequest,`,
  `  type PacketInfoState, type PacketInventoryItem, type PacketInventoryState,`,
  `  type PacketWallItem, type PacketWallItemState, type PacketChatEntry,`,
  `  type PacketFishingCatch, type PacketFishopediaEntry, type PacketFishingState,`,
  `  type ClientPluginSnapshot, type InventoryDisplayRow,`,
  `  type VisitorEntry, type VisitorTrackerState, type RelayDerivedState,`,
  `  type UserPluginRoomUserCache, type UserPluginRoomObjectRecord, type UserPluginRoomObjectCache, type UserPluginChatCache,`,
  `  type ProfileImportUiState,`,
  `  emptyPacketProfileIndex, emptyPacketInfoState, emptyPacketInventoryState,`,
  `  emptyPacketWallItemState, emptyPacketFishingState,`,
  `  emptyVisitorState, emptyRelayDerivedState,`,
  `  emptyProfileImportUiState, pendingProfileImportUiState,`,
  `  profileImportUiWithProgress, profileImportUiFinished,`,
  `} from "./helpers";`,
  ``,
  `export type {`,
  `  GameWebviewMount, WallMoverLocation, GardeningPhase, GardeningJobState,`,
  `  InjectionActionKind, InjectionCommandDraft, InjectionSnippet, InjectionHistoryEntry,`,
  `  PacketConsoleEntry, PluginClientRightsOwners,`,
  `  PacketProfileUser, PacketProfileIndex,`,
  `  PacketInfoFriend, PacketInfoEffect, PacketMessengerMessage, PacketFriendRequest,`,
  `  PacketInfoState, PacketInventoryItem, PacketInventoryState,`,
  `  PacketWallItem, PacketWallItemState, PacketChatEntry,`,
  `  PacketFishingCatch, PacketFishopediaEntry, PacketFishingState,`,
  `  ClientPluginSnapshot, InventoryDisplayRow,`,
  `  VisitorEntry, VisitorTrackerState, RelayDerivedState,`,
  `  UserPluginRoomUserCache, UserPluginRoomObjectRecord, UserPluginRoomObjectCache, UserPluginChatCache,`,
  `  ProfileImportUiState,`,
  `} from "./helpers";`,
  `export {`,
  `  emptyPacketProfileIndex, emptyPacketInfoState, emptyPacketInventoryState,`,
  `  emptyPacketWallItemState, emptyPacketFishingState,`,
  `  emptyVisitorState, emptyRelayDerivedState,`,
  `  emptyProfileImportUiState, pendingProfileImportUiState,`,
  `  profileImportUiWithProgress, profileImportUiFinished,`,
  `  PROFILE_IMPORT_STAGES, PROFILE_IMPORT_STAGE_LABELS,`,
  `} from "./helpers";`,
];

const newLines = [...origImports, ...extraHeader];

let component = componentCode;

const replacements = [
  // BootSplash
  [/      <div className=\{`boot-splash \$\{booting \? "" : "boot-hide"\}`\} aria-hidden=\{!booting\}>[\s\S]*?      <\/div>\n/,
   `      <BootSplash booting={booting} />\n`],
  // TopBar
  [/        <header className="top-bar">[\s\S]*?        <\/header>\n/,
   `        <TopBar\n          desktopBridgeAvailable={desktopBridgeAvailable}\n          engineBusy={engineBusy}\n          profileImportRunning={profileImportRunning}\n          engineUrl={engineUrl}\n          engineLaunch={engineLaunch}\n          selectedProfile={selectedProfile}\n          clientSessions={clientSessions}\n          selectedClientSession={selectedClientSession}\n          selectedClientSnapshotLabel={state.engine.profileLabel}\n          engineLocation={state.engine.location}\n          engineEmbedded={state.engine.embedded}\n          clientSessionTitle={clientSessionTitle}\n          onRefresh={() => void refreshLibrary()}\n          onStop={() => void stopEngine()}\n          onStart={() => void startEngine()}\n          onSelectClientSession={(id) => void selectClientSession(id)}\n          onAddManualVisibleClient={() => void addManualVisibleClient()}\n        />\n`],
  // RoomOverlays
  [/          \{pluginEnabledById\.room !== false[\s\S]*?\} : null\)\n/,
   `          <RoomOverlays\n            roomPluginEnabled={pluginEnabledById.room !== false}\n            roomOverlayEnabled={Boolean(pluginSurfaceEnabledByPluginId.room?.overlay)}\n            devToolsPluginEnabled={pluginEnabledById["dev-tools"] !== false}\n            devToolsStatusEnabled={Boolean(pluginSurfaceEnabledByPluginId["dev-tools"]?.status)}\n            roomReady={roomReady}\n            privateRoomReady={privateRoomReady}\n            runtimeSnapshot={selectedRuntimeSnapshot}\n            gameZoom={gameZoom}\n            fps={state.engine.fps ?? selectedRuntimeSnapshot?.performanceStats?.rafPerSecond ?? null}\n            onZoomToggle={() => void setEmbeddedRoomZoom(gameZoom === 1 ? 2 : 1)}\n          />\n`],
  // IconRail (short match)
  [/        <nav className="icon-rail" aria-label="Plugins">[\s\S]*?        <\/nav>\n/,
   `        <IconRail\n          dockCollapsed={state.ui.dockCollapsed}\n          filteredPlugins={filteredPlugins}\n          pluginEnabledById={pluginEnabledById}\n          selectedPluginId={selectedPlugin.id}\n          PluginIcon={PluginIcon}\n          onToggleDock={() => dispatch({ type: "toggleDockCollapsed" })}\n          onSelectPlugin={(pluginId) => {\n            dispatch({ type: "selectPlugin", pluginId });\n            if (state.ui.dockCollapsed) dispatch({ type: "toggleDockCollapsed" });\n          }}\n        />\n`],
];

for (const [pattern, replacement] of replacements) {
  const before = component.length;
  component = component.replace(pattern, replacement);
  if (component.length === before) console.error("WARNING: replacement did not match: " + String(pattern).slice(0, 80));
}

// Panel replacements: each follows pattern {selectedPlugin.id === "X" ? (<div ...>...</div>) : null}
const panelReplacements = {
  about: [`            {selectedPlugin.id === "about" ? (\\n[\\s\\S]*?            \\) : null\\}`,
    `            {selectedPlugin.id === "about" ? (\n              <AboutPanel\n                appName={appInfo?.name ?? "Habbpy v4"}\n                appVersion={appInfo?.version ?? "-"}\n                appMode={compactValue(appInfo?.mode)}\n                profileLabel={selectedProfile?.label ?? "No profile selected"}\n                buildLabel={engineLaunch?.buildLabel ?? profileLine(selectedProfile)}\n                storageMode={selectedProfile?.storageMode ?? "-"}\n              />\n            ) : null}`],
  "dev-tools": [`            {selectedPlugin.id === "dev-tools" ? (\\n[\\s\\S]*?            \\) : null\\}`,
    `            {selectedPlugin.id === "dev-tools" ? (\n              <DevToolsPanel\n                engineUrl={engineUrl}\n                runtimeBusy={runtimeBusy}\n                runtimeSnapshot={selectedRuntimeSnapshot}\n                onRefresh={refreshRuntimeSnapshot}\n              />\n            ) : null}`],
  automation: [`            {selectedPlugin.id === "automation" ? (\\n[\\s\\S]*?            \\) : null\\}`,
    `            {selectedPlugin.id === "automation" ? (\n              <AutomationPanel\n                engineUrl={engineUrl}\n                runtimeBusy={runtimeBusy}\n                roomReady={roomReady}\n                autoHideBulletin={automationPrefs.autoHideBulletin}\n                windowCount={selectedRuntimeSnapshot?.windowIds.length ?? 0}\n                userCount={selectedRuntimeSnapshot?.roomObjects?.counts.users ?? 0}\n                fishAreaCount={fishingAreaRows.length}\n                plantCount={plantRows.length}\n                wallItemCount={wallMoverRows.length}\n                message={automationMessage}\n                onAutoHideChange={(enabled) => {\n                  setAutomationPrefs((current) => ({ ...current, autoHideBulletin: enabled }));\n                  setAutomationMessage(enabled ? "Auto-hide Bulletin is enabled." : "Auto-hide Bulletin is disabled.");\n                }}\n                onHideBulletin={() => void hideBulletinBoard("manual")}\n                onReadWindows={() => void refreshRuntimeSnapshot()}\n              />\n            ) : null}`],
  inventory: [`            {selectedPlugin.id === "inventory" ? (\\n[\\s\\S]*?            \\) : null\\}`,
    `            {selectedPlugin.id === "inventory" ? (\n              <InventoryPanel\n                engineUrl={engineUrl}\n                runtimeBusy={runtimeBusy}\n                inventoryFilter={inventoryFilter}\n                inventoryTotalCount={inventoryTotalCount}\n                inventoryRowCount={inventoryRowCount}\n                inventoryFloorCount={inventoryFloorCount}\n                inventoryWallCount={inventoryWallCount}\n                inventoryOpenState={compactValue(selectedRuntimeSnapshot?.inventory?.openState)}\n                filteredInventoryRows={filteredInventoryRows}\n                selectedInventoryRow={selectedInventoryRow}\n                inventoryRowsLength={inventoryRows.length}\n                inventoryNote={selectedRuntimeSnapshot?.inventory?.note ?? null}\n                onRequestHand={() => void runRuntimeAction({ kind: "requestInventory" })}\n                onSetFilter={setInventoryFilter}\n                onRead={() => void refreshRuntimeSnapshot(["inventory"])}\n                onSelectKey={setSelectedInventoryKey}\n              />\n            ) : null}`],
  visitors: [`            {selectedPlugin.id === "visitors" ? (\\n[\\s\\S]*?            \\) : null\\}`,
    `            {selectedPlugin.id === "visitors" ? (\n              <VisitorsPanel\n                engineUrl={engineUrl}\n                runtimeBusy={runtimeBusy}\n                visitorFilter={visitorFilter}\n                visitorLookupBusy={visitorLookupBusy}\n                visitorStateActiveKeysLength={visitorState.activeKeys.length}\n                visitorEntriesLength={visitorEntries.length}\n                filteredVisitorEntries={filteredVisitorEntries}\n                filteredVisitorEntriesLength={filteredVisitorEntries.length}\n                visitorRoomName={visitorRoomName}\n                missingVisitorAccountIds={missingVisitorAccountIds}\n                visitorPublicProfilesCount={Object.keys(visitorPublicProfiles).length}\n                visitorLookupMessage={visitorLookupMessage}\n                roomReady={roomReady}\n                onSetFilter={setVisitorFilter}\n                onRead={() => void refreshRuntimeSnapshot()}\n                onLookupIds={() => void lookupMissingVisitorProfiles()}\n              />\n            ) : null}`],
  chat: [`            {selectedPlugin.id === "chat" ? (\\n[\\s\\S]*?            \\) : null\\}`,
    `            {selectedPlugin.id === "chat" ? (\n              <ChatPanel\n                engineUrl={engineUrl}\n                runtimeBusy={runtimeBusy}\n                roomReady={roomReady}\n                chatDraft={chatDraft}\n                chatFilters={chatFilters}\n                visibleChatHistory={visibleChatHistory}\n                chatHistoryLength={chatHistory.length}\n                activeChatSourceHistoryLength={activeChatSourceHistory.length}\n                packetChatEntriesLength={packetChatEntries.length}\n                displayedCount={visibleChatHistory.length}\n                runtimeMessage={runtimeMessage}\n                chatListRef={chatListRef}\n                onSetChatDraft={setChatDraft}\n                onSetChatFilter={(kind, checked) => setChatFilters((current) => ({ ...current, [kind]: checked }))}\n                onSend={(message) => void runRuntimeAction({ kind: "sendChat", message })}\n                onClearDisplay={() => setChatClearOffset(chatHistory.length)}\n              />\n            ) : null}`],
  "wall-mover": [`            {selectedPlugin.id === "wall-mover" ? (\\n[\\s\\S]*?            \\) : null\\}`,
    `            {selectedPlugin.id === "wall-mover" ? (\n              <WallMoverPanel\n                engineUrl={engineUrl}\n                runtimeBusy={runtimeBusy}\n                desktopBridgeAvailable={desktopBridgeAvailable}\n                wallMoverMessage={wallMoverMessage}\n                rightsCount={selectedRuntimeSnapshot?.userState?.rightsCount ?? 0}\n                selectedItemId={selectedWallMoverItemId}\n                selectedClassName={compactValue(selectedWallMoverRow?.item.className ?? selectedWallMoverRow?.item.name)}\n                selectedOwnerName={compactValue(selectedWallMoverRow?.item.ownerName)}\n                selectedWallPos={compactValue(selectedWallMoverRow?.item.wall)}\n                selectedLocalPos={compactValue(selectedWallMoverRow?.item.local)}\n                selectedOrientation={compactValue(selectedWallMoverRow?.item.orientation ?? selectedWallMoverRow?.item.direction)}\n                wallMoverStep={wallMoverStep}\n                selectedLocation={selectedWallMoverLocation}\n                wallMoverRows={wallMoverRows}\n                selectedRow={selectedWallMoverRow}\n                itemTitle={(row) => itemRowTitle(row, furniMetadata)}\n                itemMeta={(item) => wallObjectMeta(item)}\n                onRefresh={() => void refreshRuntimeSnapshot()}\n                onSetStep={setWallMoverStep}\n                onPickup={() => void sendWallMoverPickup()}\n                onMove={(dx, dy, orientation) => void sendWallMoverMove(dx, dy, orientation)}\n                onSelectKey={setSelectedWallMoverKey}\n              />\n            ) : null}`],
  room: [`            {selectedPlugin.id === "room" ? (\\n[\\s\\S]*?            \\) : null\\}`,
    `            {selectedPlugin.id === "room" ? (\n              <RoomPanel\n                engineUrl={engineUrl}\n                runtimeBusy={runtimeBusy}\n                runtimeSnapshot={selectedRuntimeSnapshot}\n                privateRoomId={privateRoomId}\n                publicRoomQuery={publicRoomQuery}\n                roomStageClickX={roomStageClickX}\n                roomStageClickY={roomStageClickY}\n                runtimeMessage={runtimeMessage}\n                onRead={() => void refreshRuntimeSnapshot()}\n                onShowHotelView={() => void runRuntimeAction({ kind: "showHotelView" })}\n                onOpenNavigator={() => void runRuntimeAction({ kind: "openNavigator", view: "nav_pr" })}\n                onSetPrivateRoomId={setPrivateRoomId}\n                onEnterPrivateRoom={(flatId) => void runRuntimeAction({ kind: "enterPrivateRoom", flatId })}\n                onSetPublicRoomQuery={setPublicRoomQuery}\n                onEnterPublicRoom={(query) => void runRuntimeAction({ kind: "enterPublicRoom", query })}\n                onSetStageClickX={setRoomStageClickX}\n                onSetStageClickY={setRoomStageClickY}\n                onWalk={(x, y) => void runRuntimeAction({ kind: "stageClick", x, y })}\n              />\n            ) : null}`],
  items: [`            {selectedPlugin.id === "items" ? (\\n[\\s\\S]*?            \\) : null\\}`,
    `            {selectedPlugin.id === "items" ? (\n              <ItemsPanel\n                engineUrl={engineUrl}\n                runtimeBusy={runtimeBusy}\n                roomReady={roomReady}\n                itemFilter={itemFilter}\n                socialMessage={socialMessage}\n                activeObjectsCount={selectedRuntimeSnapshot?.roomObjects?.counts.activeObjects ?? 0}\n                passiveObjectsCount={selectedRuntimeSnapshot?.roomObjects?.counts.passiveObjects ?? 0}\n                wallCount={itemWallCount}\n                filteredCount={filteredItemRows.length}\n                selectedLabel={selectedItemRow?.label ?? "-"}\n                metadataEntryCount={furniMetadata ? furniMetadata.entryCount : null}\n                filteredItemRows={filteredItemRows}\n                selectedItemRow={selectedItemRow}\n                selectedItemMetadata={selectedItemMetadata}\n                itemTitle={(row) => itemRowTitle(row, furniMetadata)}\n                itemMeta={(row) => itemRowMeta(row, furniMetadata)}\n                itemDisplayName={(item) => furniDisplayName(furniMetadata, item)}\n                onSetFilter={setItemFilter}\n                onRead={() => void refreshRuntimeSnapshot()}\n                onSelectKey={setSelectedItemKey}\n              />\n            ) : null}`],
  info: [`            {selectedPlugin.id === "info" ? (\\n[\\s\\S]*?            \\) : null\\}`,
    `            {selectedPlugin.id === "info" ? (\n              <InfoPanel\n                engineUrl={engineUrl}\n                runtimeBusy={runtimeBusy}\n                runtimeSnapshot={selectedRuntimeSnapshot}\n                packetInfoState={packetInfoState}\n                inventoryTotalCount={inventoryTotalCount}\n                socialRequestCount={socialRequestCount}\n                socialMessageCount={socialMessageCount}\n                selectedUserAccountId={compactValue(selectedUser?.accountId)}\n                selectedUserBadgeCode={compactValue(selectedUser?.badgeCode)}\n                publicLookupName={publicLookupName}\n                publicLookupBusy={publicLookupBusy}\n                publicLookupResult={publicLookupResult}\n                selectedUserName={selectedUserName}\n                onRead={() => void refreshRuntimeSnapshot()}\n                onLookupPublicUser={() => void lookupPublicUser()}\n                onSetPublicLookupName={setPublicLookupName}\n              />\n            ) : null}`],
  social: [`            {selectedPlugin.id === "social" ? (\\n[\\s\\S]*?            \\) : null\\}`,
    `            {selectedPlugin.id === "social" ? (\n              <SocialPanel\n                engineUrl={engineUrl}\n                runtimeBusy={runtimeBusy}\n                desktopBridgeAvailable={desktopBridgeAvailable}\n                socialFriendFilter={socialFriendFilter}\n                packetInfoState={packetInfoState}\n                onlinePacketFriends={onlinePacketFriends}\n                filteredPacketFriends={filteredPacketFriends}\n                visiblePrivateMessages={visiblePrivateMessages}\n                visibleFriendRequests={visibleFriendRequests}\n                rightsCount={selectedRuntimeSnapshot?.userState?.rightsCount ?? 0}\n                sourceChatHistoryLength={sourceChatHistory.length}\n                packetChatEntriesLength={packetChatEntries.length}\n                roomUserCount={selectedRuntimeSnapshot?.userState?.roomUserCount ?? 0}\n                socialRequestCount={socialRequestCount}\n                socialMessageCount={socialMessageCount}\n                onSetFilter={setSocialFriendFilter}\n                onRead={() => void refreshRuntimeSnapshot()}\n                onSendSocialAction={(action, label) => void sendSocialAction(action as SocialRelayAction, label)}\n              />\n            ) : null}`],
  fishing: [`            {selectedPlugin.id === "fishing" ? (\\n[\\s\\S]*?            \\) : null\\}`,
    `            {selectedPlugin.id === "fishing" ? (\n              <FishingPanel\n                engineUrl={engineUrl}\n                runtimeBusy={runtimeBusy}\n                desktopBridgeAvailable={desktopBridgeAvailable}\n                roomReady={roomReady}\n                fishingMessage={fishingMessage}\n                packetFishingState={packetFishingState}\n                fishingAreaRows={fishingAreaRows}\n                selectedFishingAreaRow={selectedFishingAreaRow}\n                itemTitle={(row) => itemRowTitle(row, furniMetadata)}\n                itemMeta={(row) => itemRowMeta(row, furniMetadata)}\n                onStartFishing={() => void sendFishingStart()}\n                onSendAction={(action, label) => void sendFishingAction(action as FishingRelayAction, label)}\n                onRefresh={() => void refreshRuntimeSnapshot()}\n              />\n            ) : null}`],
  gardening: [`            {selectedPlugin.id === "gardening" ? (\\n[\\s\\S]*?            \\) : null\\}`,
    `            {selectedPlugin.id === "gardening" ? (\n              <GardeningPanel\n                engineUrl={engineUrl}\n                runtimeBusy={runtimeBusy}\n                desktopBridgeAvailable={desktopBridgeAvailable}\n                roomReady={roomReady}\n                gardeningRunning={gardeningRunning}\n                gardeningCycleSec={gardeningCycleSec}\n                gardeningMessage={gardeningMessage}\n                gardeningJob={gardeningJob}\n                runtimeSnapshot={selectedRuntimeSnapshot}\n                plantRows={plantRows}\n                selectedPlantRow={selectedPlantRow}\n                selfUser={selfUser}\n                itemTitle={(row) => itemRowTitle(row, furniMetadata)}\n                itemMeta={(row) => itemRowMeta(row, furniMetadata)}\n                onStartGardening={(mode) => void startGardening(mode)}\n                onStopGardening={stopGardening}\n                onSetCycleSec={setGardeningCycleSec}\n                onSelectPlant={setSelectedPlantKey}\n                onRefresh={() => void refreshRuntimeSnapshot()}\n              />\n            ) : null}`],
  connection: [`            {selectedPlugin.id === "connection" ? (\\n[\\s\\S]*?            \\) : null\\}`,
    `            {selectedPlugin.id === "connection" ? (\n              <ConnectionPanel\n                desktopBridgeAvailable={desktopBridgeAvailable}\n                engineBusy={engineBusy}\n                profileImportRunning={profileImportRunning}\n                libraryState={libraryState}\n                bridgeMessage={bridgeMessage}\n                engineLaunch={engineLaunch}\n                relaySessionId={relaySessionId}\n                selectedRuntimeSnapshot={selectedRuntimeSnapshot}\n                selectedClientRelayLog={selectedClientRelayLog}\n                latestClientPacket={latestClientPacket}\n                latestServerPacket={latestServerPacket}\n                selectedClientSnapshot={selectedClientSnapshot}\n                selectedClientSession={selectedClientSession}\n                selectedClientId={selectedClientId}\n                packetProfileUsersLength={packetProfileUsers.length}\n                packetFriendsLength={packetInfoState.friends.length}\n                packetFriendRequestsLength={packetInfoState.friendRequests.length}\n                packetPrivateMessagesLength={packetInfoState.privateMessages.length}\n                packetChatEntriesLength={packetChatEntries.length}\n                packetInventoryTotalCount={packetInventoryState.totalCount}\n                packetWallItemCount={packetWallItemState.itemCount}\n                relayEncryptionState={relayEncryptionState}\n                relayClientModes={relayClientModes}\n                relayServerModes={relayServerModes}\n                relayBodyLoggingState={relayBodyLoggingState}\n                runtimeTitle={compactValue(selectedRuntimeSnapshot?.title)}\n                runtimeVersion={compactValue(selectedRuntimeSnapshot?.scriptBundle?.runtimeVersion)}\n                runtimePresentation={engineLaunch?.settings?.resizablePresentation ? "responsive" : "fixed-stage"}\n                runtimeFps={compactValue(runtimeFps(selectedRuntimeSnapshot))}\n                runtimeTicks={compactValue(runtimeTickRate(selectedRuntimeSnapshot))}\n                runtimeScripts={compactValue(selectedRuntimeSnapshot?.scriptBundle?.executableScripts)}\n                runtimeFields={compactValue(selectedRuntimeSnapshot?.editableFields.length)}\n                runtimeWindows={compactValue(selectedRuntimeSnapshot?.windowIds.length)}\n                onImportClient={() => void importClientReference()}\n                onSelectClientProfile={(profileRoot) => void selectClientProfile(profileRoot)}\n                profileLine={profileLine}\n                statusLabel={statusLabel}\n                compactValue={compactValue}\n                relayPacketSummary={relayPacketSummary}\n              />\n            ) : null}`],
  "plugin-manager": [`            {selectedPlugin.id === "plugin-manager" ? (\\n[\\s\\S]*?            \\) : null\\}`,
    `            {selectedPlugin.id === "plugin-manager" ? (\n              <PluginManagerPanel\n                desktopBridgeAvailable={desktopBridgeAvailable}\n                pluginRegistryState={pluginRegistryState}\n                availablePlugins={availablePlugins}\n                pluginEnabledById={pluginEnabledById}\n                pinnedPluginIds={pinnedPluginIds}\n                pluginSurfaceEnabledByPluginId={pluginSurfaceEnabledByPluginId}\n                PluginIcon={PluginIcon}\n                compactValue={compactValue}\n                originLabel={originLabel}\n                labelCase={labelCase}\n                statusLabel={statusLabel}\n                permissionLabel={permissionLabel}\n                pluginManagerMessage={pluginManagerMessage}\n                newPluginId={newPluginId}\n                newPluginName={newPluginName}\n                onReloadPlugins={() => void reloadPlugins()}\n                onOpenPluginsFolder={() => void openPluginsFolder()}\n                onInstallPluginFromFolder={() => void installPluginFromFolder()}\n                onNewPluginIdChange={setNewPluginId}\n                onNewPluginNameChange={setNewPluginName}\n                onCreatePluginFromTemplate={(id, name) => void createPluginFromTemplate({ id, name })}\n                onSetPluginEnabled={(pluginId, enabled) => void setPluginEnabled(pluginId, enabled)}\n                onSetPluginSurfaceEnabled={(pluginId, surfaceId, enabled) => void setPluginSurfaceEnabled(pluginId, surfaceId, enabled)}\n              />\n            ) : null}`],
  settings: [`            {selectedPlugin.id === "settings" ? (\\n[\\s\\S]*?            \\) : null\\}`,
    `            {selectedPlugin.id === "settings" ? (\n              <SettingsPanel\n                desktopBridgeAvailable={desktopBridgeAvailable}\n                engineLaunch={engineLaunch}\n                engineBusy={engineBusy}\n                settingsBusy={engineBusy}\n                appPreferences={appPreferences}\n                consoleCommandState={consoleCommandState}\n                versionCheckDraft={versionCheckDraft}\n                packetFilters={packetFilters}\n                multiAccountFile={multiAccountFile}\n                multiAccountCount={multiAccountCount}\n                multiAccountConcurrency={multiAccountConcurrency}\n                multiAccountKeyEnv={multiAccountKeyEnv}\n                multiAccountSummonTarget={multiAccountSummonTarget}\n                multiAccountLoadMode={multiAccountLoadMode}\n                settingsBindKey={settingsBindKey}\n                settingsBindCommand={settingsBindCommand}\n                onUpdateEngineLaunchSettings={(patch, msg) => void updateEngineLaunchSettings(patch, msg)}\n                onSetVersionCheckDraft={setVersionCheckDraft}\n                onApplyVersionCheckBuild={applyVersionCheckBuild}\n                onUpdateHardwareAccelerationPreference={updateHardwareAccelerationPreference}\n                onSetSettingsBindKey={setSettingsBindKey}\n                onSetSettingsBindCommand={setSettingsBindCommand}\n                onRunMultiAccountCommand={(cmd) => void runMultiAccountCommand(cmd)}\n                onSetPacketFilters={(setter) => setPacketFilters(setter as any)}\n                onUpdateAppPreferencePatch={(patch, msg) => void updateAppPreferencePatch(patch, msg)}\n                onSetMultiAccountFile={setMultiAccountFile}\n                onSetMultiAccountCount={setMultiAccountCount}\n                onSetMultiAccountConcurrency={setMultiAccountConcurrency}\n                onSetMultiAccountKeyEnv={setMultiAccountKeyEnv}\n                onSetMultiAccountSummonTarget={setMultiAccountSummonTarget}\n                onSetMultiAccountLoadMode={(mode) => setMultiAccountLoadMode(mode)}\n                onSaveSessionDefaultPreferences={() => void saveSessionDefaultPreferences()}\n                commandArg={commandArg}\n                clampMultiAccountCount={clampMultiAccountCount}\n                clampMultiAccountConcurrency={clampMultiAccountConcurrency}\n              />\n            ) : null}`],
  user: [`            {selectedPlugin.id === "user" ? (\\n[\\s\\S]*?            \\) : null\\}`,
    `            {selectedPlugin.id === "user" ? (\n              <UserPanel\n                engineUrl={engineUrl}\n                runtimeBusy={runtimeBusy}\n                desktopBridgeAvailable={desktopBridgeAvailable}\n                runtimeSnapshot={selectedRuntimeSnapshot}\n                userRows={userRows}\n                selectedUser={selectedUser}\n                selectedUserKey={selectedUserKey}\n                selectedUserName={selectedUserName}\n                selectedUserAccountId={compactValue(selectedUser?.accountId)}\n                selectedUserIndex={compactValue(selectedUser?.roomIndex ?? selectedUser?.rowId)}\n                selectedUserGender={compactValue(selectedUser?.gender)}\n                selectedUserType={compactValue(selectedUser?.type ?? selectedUser?.objectClass)}\n                selectedUserBadgeCode={compactValue(selectedUser?.badgeCode)}\n                selectedUserMotto={compactValue(selectedUser?.motto)}\n                selectedUserPosition={compactValue(selectedUser?.position)}\n                selectedUserFigure={compactValue(selectedUser?.figure)}\n                selectedUserPoolFigure={compactValue(selectedUser?.poolFigure)}\n                selectedUserSpriteCount={compactValue(selectedUser?.spriteCount)}\n                selectedPacketProfileUser={selectedPacketProfileUser}\n                engineUserNameLabels={engineUserNameLabels}\n                userStoredLooks={userStoredLooks}\n                selectedStoredUserLook={selectedStoredUserLook}\n                userToolMessage={userToolMessage}\n                onSetSelectedUserKey={setSelectedUserKey}\n                onRefresh={() => void refreshRuntimeSnapshot()}\n                onCopyUserValue={(value) => void copyUserValue(value)}\n                onCopySelectedUserProfile={() => void copySelectedUserProfile()}\n                onStoreSelectedUserLook={() => void storeSelectedUserLook()}\n                onCopyStoredUserLook={() => void copyStoredUserLook()}\n                onClearStoredUserLooks={clearStoredUserLooks}\n                onSetSelectedStoredUserLook={setSelectedStoredUserLook}\n                onSendUserAction={(action, label) => void sendUserAction(action as UserRelayAction, label)}\n                onSetEngineUserNameLabels={setEngineUserNameLabels}\n                onRunRuntimeAction={(action) => void runRuntimeAction(action as EngineRuntimeAction)}\n                compactValue={compactValue}\n                userDisplayName={userDisplayName}\n                userRowMeta={userRowMeta}\n                runtimeRoomName={runtimeRoomName}\n                runtimeRoomOwner={runtimeRoomOwner}\n              />\n            ) : null}`],
  "multi-account": [`            {selectedPlugin.id === "multi-account" ? (\\n[\\s\\S]*?            \\) : null\\}`,
    `            {selectedPlugin.id === "multi-account" ? (\n              <MultiAccountPanel\n                desktopBridgeAvailable={desktopBridgeAvailable}\n                clientSessions={clientSessions}\n                selectedClientSession={selectedClientSession}\n                selectedClientId={selectedClientId}\n                mimicState={mimicState}\n                mimicCategories={mimicCategories}\n                multiAccountFile={multiAccountFile}\n                multiAccountCount={multiAccountCount}\n                multiAccountConcurrency={multiAccountConcurrency}\n                multiAccountKeyEnv={multiAccountKeyEnv}\n                multiAccountSummonTarget={multiAccountSummonTarget}\n                multiAccountLoadMode={multiAccountLoadMode}\n                multiAccountMessage={multiAccountMessage}\n                onSelectClient={(id) => void selectClientSession(id)}\n                onMainClient={(id) => void runMultiAccountCommand("main " + id)}\n                onStopClient={(id) => void runMultiAccountCommand("stop " + id)}\n                onRenameClient={(id, label) => void renameClientSession(id, label)}\n                onOpenMultiAccountPanel={() => void openMultiAccountPanel()}\n                onAddManualVisibleClient={() => void addManualVisibleClient()}\n                onRunMultiAccountCommand={(cmd) => void runMultiAccountCommand(cmd)}\n                onSetMultiAccountFile={setMultiAccountFile}\n                onSetMultiAccountCount={setMultiAccountCount}\n                onSetMultiAccountConcurrency={setMultiAccountConcurrency}\n                onSetMultiAccountKeyEnv={setMultiAccountKeyEnv}\n                onSetMultiAccountSummonTarget={setMultiAccountSummonTarget}\n                onSetMultiAccountLoadMode={(mode) => setMultiAccountLoadMode(mode)}\n                compactValue={compactValue}\n                clientSessionTitle={clientSessionTitle}\n                commandArg={commandArg}\n                clampMultiAccountCount={clampMultiAccountCount}\n                clampMultiAccountConcurrency={clampMultiAccountConcurrency}\n              />\n            ) : null}`],
  "present-catcher": [`            {selectedPlugin.id === "present-catcher" ? (\\n[\\s\\S]*?            \\) : null\\}`,
    `            {selectedPlugin.id === "present-catcher" ? (\n              <PresentCatcherPanel\n                engineUrl={engineUrl}\n                runtimeBusy={runtimeBusy}\n                desktopBridgeAvailable={desktopBridgeAvailable}\n                roomReady={roomReady}\n                presentCatcherTab={presentCatcherTab}\n                presentCatcherRunning={presentCatcherRunning}\n                presentCatcherMessage={presentCatcherMessage}\n                presentCatcherPanicNames={presentCatcherPanicNames}\n                presentCatcherPanicDraft={presentCatcherPanicDraft}\n                presentCatcherGiftClass={presentCatcherGiftClass}\n                selectedPresentGiftKey={selectedPresentGiftKey}\n                selectedPresentGiftRow={selectedPresentGiftRow}\n                presentPlaceX={presentPlaceX}\n                presentPlaceY={presentPlaceY}\n                presentPlaceDirection={presentPlaceDirection}\n                presentOpenObjectId={presentOpenObjectId}\n                presentFragmentEvent={presentFragmentEvent}\n                presentFragmentSlotId={presentFragmentSlotId}\n                presentFragmentTradeTarget={presentFragmentTradeTarget}\n                hammerRows={presentHammerRows}\n                presentRows={presentRows}\n                giftRows={presentGiftRows}\n                packetRows={presentCatcherPacketRows}\n                userRows={userRows}\n                furniMetadata={furniMetadata}\n                relayLog={relayLog}\n                runtimeSnapshot={selectedRuntimeSnapshot}\n                onToggleRunning={() => setPresentCatcherRunning((prev) => !prev)}\n                onStopPresentCatcher={() => setPresentCatcherRunning(false)}\n                onRunPresentCatcherStep={(auto) => void runPresentCatcherStep(auto)}\n                onRefreshRuntimeSnapshot={(scopes) => void refreshRuntimeSnapshot(scopes as EngineRuntimeSnapshotScope[])}\n                onSetPresentCatcherTab={setPresentCatcherTab}\n                onSetPresentCatcherPanicDraft={setPresentCatcherPanicDraft}\n                onSetPresentCatcherPanicNames={setPresentCatcherPanicNames}\n                onSetPresentCatcherGiftClass={setPresentCatcherGiftClass}\n                onSetSelectedPresentGiftKey={setSelectedPresentGiftKey}\n                onSetPresentPlaceX={setPresentPlaceX}\n                onSetPresentPlaceY={setPresentPlaceY}\n                onSetPresentPlaceDirection={setPresentPlaceDirection}\n                onSetPresentOpenObjectId={setPresentOpenObjectId}\n                onSetPresentFragmentEvent={setPresentFragmentEvent}\n                onSetPresentFragmentSlotId={setPresentFragmentSlotId}\n                onSetPresentFragmentTradeTarget={setPresentFragmentTradeTarget}\n                onUsePresentCatcherFloorItem={(objectId, className) => void usePresentCatcherFloorItem(objectId, className)}\n                onRequestPresentCatcherInventory={() => void requestPresentCatcherInventory()}\n                onPlaceSelectedPresentGift={() => void placeSelectedPresentGift()}\n                onSendPresentCatcherPacket={(packet, label) => void sendPresentCatcherPacket(packet, label)}\n                onOpenPresentObject={() => void openPresentObject()}\n                onSendPresentFragmentPacket={(kind) => void sendPresentFragmentPacket(kind as Parameters<typeof sendPresentFragmentPacket>[0])}\n                compactValue={compactValue}\n                labelCase={labelCase}\n                isPresentCatcherHammerObject={isPresentCatcherHammerObject}\n                itemRowTitle={(row) => itemRowTitle(row, furniMetadata)}\n                itemRowMeta={(row) => itemRowMeta(row, furniMetadata)}\n                userDisplayName={userDisplayName}\n                pluginRuntimeUserKey={pluginRuntimeUserKey}\n                runtimeRoomName={runtimeRoomName}\n                relayEntryPlain={relayEntryPlain}\n              />\n            ) : null}`],
  injection: [`            {selectedPlugin.id === "injection" ? (\\n[\\s\\S]*?            \\) : null\\}`,
    `            {selectedPlugin.id === "injection" ? (\n              <InjectionPanel\n                injectionDraft={injectionDraft}\n                injectionRepeatCount={injectionRepeatCount}\n                injectionRepeatInterval={injectionRepeatInterval}\n                injectionMessage={injectionMessage}\n                injectionSnippets={injectionSnippets}\n                selectedInjectionSnippetId={selectedInjectionSnippetId}\n                selectedInjectionSnippet={selectedInjectionSnippet}\n                injectionHistory={injectionHistory}\n                injectionFileInputRef={injectionFileInputRef}\n                injectionActionOptions={injectionActionOptions}\n                onUpdateInjectionDraft={updateInjectionDraft}\n                onSetInjectionRepeatCount={setInjectionRepeatCount}\n                onSetInjectionRepeatInterval={setInjectionRepeatInterval}\n                onExecuteInjectionCommand={(command, label) => void executeInjectionCommand(command, label)}\n                onAddInjectionSnippet={() => void addInjectionSnippet()}\n                onImportInjectionSnippets={(file) => void importInjectionSnippets(file)}\n                onExportInjectionSnippets={exportInjectionSnippets}\n                onSetInjectionSnippets={setInjectionSnippets as any}\n                onSetSelectedInjectionSnippetId={setSelectedInjectionSnippetId}\n                onSetInjectionMessage={setInjectionMessage}\n                onLoadInjectionSnippet={(snippet) => void loadInjectionSnippet(snippet)}\n                onSetInjectionHistory={setInjectionHistory as any}\n                compactValue={compactValue}\n                clampRepeatCount={clampRepeatCount}\n              />\n            ) : null}`],
  "packet-log": [`            {selectedPlugin.id === "packet-log" ? (\\n[\\s\\S]*?            \\) : null\\}`,
    `            {selectedPlugin.id === "packet-log" ? (\n              <PacketLogPanel\n                desktopBridgeAvailable={desktopBridgeAvailable}\n                packetFilters={packetFilters}\n                packetClientChoices={packetClientChoices}\n                packetSessionChoices={packetSessionChoices}\n                packetListRef={packetListRef}\n                handlePacketListScroll={handlePacketListScroll}\n                visiblePacketEntries={visiblePacketEntries}\n                renderedPacketEntries={renderedPacketEntries}\n                selectedPacketEntry={selectedPacketEntry}\n                packetVirtualRange={packetVirtualRange}\n                selectedRuntimeSnapshot={selectedRuntimeSnapshot}\n                relayLog={relayLog}\n                packetEntries={packetEntries}\n                packetExportMessage={packetExportMessage}\n                onRefreshRelayLog={() => void refreshRelayLog()}\n                onExportVisiblePacketLog={() => void exportVisiblePacketLog()}\n                onSetPacketClearOffset={setPacketClearOffset}\n                onSetSelectedPacketKey={setSelectedPacketKey}\n                onSetPacketExportMessage={setPacketExportMessage}\n                onSetPacketFilters={(setter) => setPacketFilters(setter as any)}\n              />\n            ) : null}`],
};

for (const [key, [pattern, replacement]] of Object.entries(panelReplacements)) {
  const before = component.length;
  component = component.replace(new RegExp(pattern), replacement);
  if (component.length === before) console.error("WARNING: panel " + key + " did not match");
}

// UserPluginPanel (selectedPlugin.origin === "user")
component = component.replace(
  /            \{selectedPlugin\.origin === "user" \? \(\n[\s\S]*?            \) : null\}/,
  `            {selectedPlugin.origin === "user" ? (\n              <UserPluginPanel\n                selectedPlugin={selectedPlugin}\n                desktopBridgeAvailable={desktopBridgeAvailable}\n                pluginSurfaceEnabledByPluginId={pluginSurfaceEnabledByPluginId}\n                onOpenPluginsFolder={() => void openPluginsFolder()}\n                onReloadPlugins={() => void reloadPlugins()}\n              />\n            ) : null}`
);

const output = newLines.join("\n") + "\n" + component;
writeFileSync("src/renderer/ui/App.tsx", output);
console.log("done: " + output.split("\n").length + " lines");
