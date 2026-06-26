import {
  Activity,
  Bot,
  CircleAlert,
  Command,
  Copy,
  FolderInput,
  Hammer,
  Info,
  List,
  Map,
  MessageSquare,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plug,
  Plus,
  RefreshCw,
  Sofa,
  Square,
  Terminal,
  Trash2,
  User,
  Wrench,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useReducer, useRef, useState, type UIEvent } from "react";
import { initialAppState } from "../../core/sampleState";
import { shellReducer } from "../../core/shellStore";
import {
  compactRuntimeValue,
  runtimeFps,
  runtimeItemRows,
  runtimeLocation,
  runtimeRoomId,
  runtimeRoomName,
  runtimeRoomOwner,
  runtimeRoomProp,
  runtimeRoomType,
  runtimeTickRate,
  summarizeRuntimeSnapshot,
  type RuntimeItemRow,
} from "../../engine-adapter/shocklessSessionAdapter";
import {
  readEngineRuntimeSnapshot,
  runEngineRuntimeAction,
  type EngineRuntimeAction,
  type EngineRuntimeSnapshot,
  type EngineRuntimeSnapshotScope,
  type EngineWebviewElement,
  type EngineRuntimeActionResult,
  type RuntimeChatEntry,
  type RuntimeInventoryItemSummary,
  type RuntimeObjectSummary,
  type RuntimeUserSummary,
} from "../engineRuntime";
import { RendererUserPluginHost, type UserPluginHostRequest } from "../userPluginHost";
import { getPluginById, plugins } from "../../plugins/registry";
import type { PluginDefinition, PluginPermission, PluginRegistryState } from "../../shared/plugin";
import { parseConsoleCommand, redactConsoleCommandInput, type ConsoleRendererAction } from "../../shared/consoleCommand";
import {
  PluginIcon,
  labelCase,
  statusLabel,
  permissionLabel,
  originLabel,
  profileLine,
  clientSessionTitle,
  gameWebviewPartitionForClient,
  finiteNumber,
  chatEntryKey,
  chatEntryLabel,
  chatEntryKind,
  compactValue,
  commandArg,
  mimicCategoryOptions,
  withVisibleConsoleContext,
  uniqueUsefulNames,
  firstUsefulName,
  isTextEntryTarget,
  bindingKeyFromKeyboardEvent,
  normalizeShortcutKey,
  objectTitle,
  normalizeFurniClassName,
  furniInfoForClass,
  furniInfoForObject,
  furniDisplayName,
  isRelayBackedConsoleCommand,
  commandRefreshesEngineLaunch,
  objectMeta,
  wallObjectMeta,
  objectSearchText,
  isPlantLikeObject,
  isFishingAreaObject,
  isPresentCatcherHammerObject,
  isPresentCatcherPresentObject,
  isPresentCatcherGiftItem,
  presentCatcherPacketHeaders,
  objectNumericId,
  signedPair,
  wallOrientation,
  wallMoverLocation,
  itemRowTile,
  userTile,
  gardeningFacingTilePriority,
  gardeningFallbackTilePriority,
  tileKey,
  objectIdText,
  occupiedGardeningTiles,
  workingTileNearSelf,
  findCurrentPlantRow,
  adjacentTileForItem,
  latin1ByteArray,
  shockwaveVl64ByteArray,
  shockwaveOutgoingStringByteArray,
  decodeShockwaveVl64Text,
  injectionActionOptions,
  defaultInjectionDraft,
  injectionSnippetStorageKey,
  injectionHistoryStorageKey,
  userStoredLookStorageKey,
  automationPrefsStorageKey,
  injectionCommandLabel,
  cloneInjectionDraft,
  normalizeInjectionSnippet,
  normalizeInjectionSnippets,
  normalizeStoredUserLooks,
  loadStoredUserLooks,
  loadAutomationPrefs,
  writeClipboardText,
  injectionDraftToRuntimeAction,
  injectionDraftToUserRelayAction,
  clampRepeatCount,
  clampRepeatInterval,
  clampMultiAccountCount,
  clampMultiAccountConcurrency,
  delay,
  objectListSignature,
  userListSignature,
  inventorySignature,
  navigatorSignature,
  roomObjectsSignature,
  userStateSignature,
  chatHistorySignature,
  activeSpritesSignature,
  runtimeProbeScopesForPlugin,
  reuseStableRuntimeDetails,
  itemRowTitle,
  itemRowMeta,
  itemRowSearchText,
  userDisplayName,
  userPosition,
  userRowMeta,
  packetFieldMap,
  packetUsersFromEntries,
  packetProfileUserCache,
  packetUsersFromRelayLog,
  packetInfoStateFromEntries,
  packetInfoStateCache,
  packetInfoStateFromRelayLog,
  addPacketFriendsFromPrefix,
  addPacketPrivateMessagesFromPrefix,
  addPacketFriendRequestsFromPrefix,
  packetFriendFromPrefix,
  packetPrivateMessageFromPrefix,
  packetFriendRequestFromPrefix,
  packetFriendKey,
  packetPrivateMessageKey,
  packetFriendRequestKey,
  parsedCount,
  packetFriendSearchText,
  packetFriendMeta,
  packetFriendTitle,
  lookupTokenMatches,
  runtimeUserMatchesLookup,
  packetUserMatchesLookup,
  packetFriendMatchesLookup,
  packetFriendRequestMatchesLookup,
  parsePositiveSocialAccountId,
  packetFriendActionId,
  packetFriendRequestActionId,
  findPacketFriendForAction,
  findPacketFriendRequestForAction,
  runtimeLookupLine,
  packetProfileLookupLine,
  friendRequestLookupLine,
  originsLookupLine,
  packetChatEntriesFromEntries,
  packetChatEntriesCache,
  packetChatEntriesFromRelayLog,
  packetFishingStateFromEntries,
  packetFishopediaEntryFromPrefix,
  packetChatRuntimeEntry,
  packetChatUserName,
  packetWallItemStateFromEntries,
  packetWallItemStateCache,
  packetWallItemStateFromRelayLog,
  packetWallItemFromPrefix,
  packetWallItemRow,
  packetInventoryStateFromEntries,
  packetInventoryStateCache,
  packetInventoryStateFromRelayLog,
  packetInventoryItemFromPrefix,
  packetInventoryKey,
  packetInventorySearchText,
  packetInventoryTitle,
  packetInventoryMeta,
  runtimeInventoryDisplayRow,
  packetInventoryDisplayRow,
  packetProfileIndexFromUsers,
  selectPacketProfileUser,
  packetProfileForRuntimeUser,
  latestPacketVisitorUsers,
  profileValue,
  isVisitorUser,
  visitorKeyFor,
  visitorEntryFor,
  visitorEntryForPacketUser,
  visitorSearchText,
  visitorMeta,
  inventoryKindLabel,
  relayEntryLabel,
  relayEntryV3Line,
  relayEntryDisplayName,
  relayEntrySearchText,
  relayPacketSummary,
  PACKET_ROW_HEIGHT,
  PACKET_OVERSCAN_ROWS,
  virtualPacketRange,
  PACKET_CONSOLE_ROW_HEIGHT,
  PACKET_CONSOLE_RENDER_ROWS,
  PACKET_CONSOLE_OVERSCAN_ROWS,
  mergeRelayLogSnapshot,
  relayLogSnapshotForClient,
  clientPluginSnapshotForClient,
  clientPluginSnapshotMapFromSources,
  mergeClientSummaryIntoList,
  pluginHasPermission,
  requirePluginPermission,
  isDisabledPluginCleanupRequest,
  assertDisabledPluginCleanupRequest,
  pluginRoomKey,
  pluginRoomPayload,
  pluginRuntimeUserKey,
  pluginRuntimeUserPayload,
  pluginRuntimeUserKind,
  pluginRuntimeItemSignature,
  pluginRuntimeItemPayload,
  pluginRoomObjectRecords,
  pluginRoomObjectsPayload,
  dispatchPluginRoomItemEvent,
  pluginRoomOccupantsPayload,
  pluginRoomUsersPayload,
  pluginRelayPacketPayload,
  pluginChatPayload,
  pluginStorageKey,
  requestedPluginClientId,
  cleanPluginRightsList,
  pluginManagedClientRights,
  disabledManagedClientRights,
  matchingClientRights,
  clientRightsPayloadRights,
  cleanInteger,
  cleanPositiveInt,
  pluginWalkTargetFromSnapshot,
  pluginWalkTargetFromRow,
  pluginFindItemRows,
  pluginSelectorIsEmpty,
  pluginItemRowMatchesSelector,
  pluginResolveFloorItem,
  pluginResolveWallItem,
  pluginSelectorNumericId,
  pluginSelectorTile,
  pluginSelectorKind,
  pluginSelectorWallLocation,
  pluginWallMoveLocation,
  pluginFishingAreaRows,
  pluginFishingAreaTarget,
  pluginFishingAreaPayload,
  pluginFishingAreaTarget as pluginFishingTarget,
  pluginFishingAreaPayload as pluginFishingPayload,
  PROFILE_IMPORT_STAGES,
  PROFILE_IMPORT_STAGE_LABELS,
  profileImportStageEntry,
  profileImportStatusLabel,
  formatImportElapsed,
  type GameWebviewMount,
  type ItemRow,
  type WallMoverLocation,
  type GardeningPhase,
  type GardeningJobState,
  type InjectionActionKind,
  type InjectionCommandDraft,
  type InjectionSnippet,
  type InjectionHistoryEntry,
  type PacketConsoleEntry,
  type PluginClientRightsOwners,
  type PacketProfileUser,
  type PacketProfileIndex,
  type PacketInfoFriend,
  type PacketInfoEffect,
  type PacketMessengerMessage,
  type PacketFriendRequest,
  type PacketInfoState,
  type PacketInventoryItem,
  type PacketInventoryState,
  type PacketWallItem,
  type PacketWallItemState,
  type PacketChatEntry,
  type PacketFishingCatch,
  type PacketFishopediaEntry,
  type PacketFishingState,
  type ClientPluginSnapshot,
  type InventoryDisplayRow,
  type VisitorEntry,
  type VisitorTrackerState,
  type RelayDerivedState,
  type UserPluginRoomUserCache,
  type UserPluginRoomObjectRecord,
  type UserPluginRoomObjectCache,
  type UserPluginChatCache,
  type ProfileImportUiState,
  emptyPacketProfileIndex,
  emptyPacketInfoState,
  emptyPacketInventoryState,
  emptyPacketWallItemState,
  emptyPacketFishingState,
  emptyVisitorState,
  emptyRelayDerivedState,
  emptyProfileImportUiState,
  pendingProfileImportUiState,
  profileImportUiWithProgress,
  profileImportUiFinished,
  relayModeSummary,
  packetClientMatches,
  normalizePacketClientFilter,
  relayEntryPlain,
  relayEncryptionSummary,
  relayDerivedStateFromSnapshot,
  relayBodyLoggingSummary,
  updateClientRightOwners,
  removeClientRightOwners,
} from "./helpers";
import { AboutPanel } from "../../plugins/about/Panel";
import { DevToolsPanel } from "../../plugins/dev-tools/Panel";
import { AutomationPanel } from "../../plugins/automation/Panel";
import { InventoryPanel } from "../../plugins/inventory/Panel";
import { VisitorsPanel } from "../../plugins/visitors/Panel";
import { ChatPanel } from "../../plugins/chat/Panel";
import { WallMoverPanel } from "../../plugins/wall-mover/Panel";
import { RoomPanel } from "../../plugins/room/Panel";
import { ItemsPanel } from "../../plugins/items/Panel";
import { InfoPanel } from "../../plugins/info/Panel";
import { SocialPanel } from "../../plugins/social/Panel";
import { FishingPanel } from "../../plugins/fishing/Panel";
import { GardeningPanel } from "../../plugins/gardening/Panel";
import { ConnectionPanel } from "../../plugins/connection/Panel";
import { PluginManagerPanel } from "../../plugins/plugin-manager/Panel";
import { SettingsPanel } from "../../plugins/settings/Panel";
import { UserPanel } from "../../plugins/user/Panel";
import { MultiAccountPanel } from "../../plugins/multi-account/Panel";
import { PresentCatcherPanel } from "../../plugins/present-catcher/Panel";
import { InjectionPanel } from "../../plugins/injection/Panel";
import { PacketLogPanel } from "../../plugins/packet-log/Panel";
import { UserPluginPanel } from "./UserPluginPanel";
import { TopBar } from "./TopBar";
import { BootSplash } from "./BootSplash";
import { IconRail } from "./IconRail";
import { RoomOverlays } from "./RoomOverlays";
import { ImporterWorkspace } from "./ImporterWorkspace";
import { encodeShockwaveBase64Int, formatShockwavePacketParts } from "../../shared/shockwavePacketText";
import type {
  AppPreferencesPatch,
  AppPreferencesState,
  ClientLibraryState,
  ClientRuntimeSummary,
  ClientSnapshot,
  ClientSessionList,
  ClientSessionSummary,
  ConsoleCommandStateSnapshot,
  ClientProfileSummary,
  EngineLaunchState,
  EngineLaunchSettingsPatch,
  FurniMetadataEntry,
  FurniMetadataSnapshot,
  FurniRelayAction,
  FishingRelayAction,
  GardeningRelayAction,
  OriginsUserLookupResult,
  ProfileImportProgress,
  ProfileImportStage,
  PluginPacketInput,
  RelayLogDeltaSnapshot,
  RelayLogEntry,
  RelayLogSnapshot,
  SocialRelayAction,
  MimicCategory,
  MimicStateSnapshot,
  UserRelayAction,
  WallMoverRelayAction,
} from "../../shared/window-api";
// Re-export types that panels import from App.tsx (now defined in helpers.tsx)
export type {
  GameWebviewMount,
  WallMoverLocation,
  GardeningPhase,
  GardeningJobState,
  InjectionActionKind,
  InjectionCommandDraft,
  InjectionSnippet,
  InjectionHistoryEntry,
  PacketConsoleEntry,
  PluginClientRightsOwners,
  PacketProfileUser,
  PacketProfileIndex,
  PacketInfoFriend,
  PacketInfoEffect,
  PacketMessengerMessage,
  PacketFriendRequest,
  PacketInfoState,
  PacketInventoryItem,
  PacketInventoryState,
  PacketWallItem,
  PacketWallItemState,
  PacketChatEntry,
  PacketFishingCatch,
  PacketFishopediaEntry,
  PacketFishingState,
  ClientPluginSnapshot,
  InventoryDisplayRow,
  VisitorEntry,
  VisitorTrackerState,
  RelayDerivedState,
  UserPluginRoomUserCache,
  UserPluginRoomObjectRecord,
  UserPluginRoomObjectCache,
  UserPluginChatCache,
  ProfileImportUiState,
} from "./helpers";
export {
  emptyPacketProfileIndex,
  emptyPacketInfoState,
  emptyPacketInventoryState,
  emptyPacketWallItemState,
  emptyPacketFishingState,
  emptyVisitorState,
  emptyRelayDerivedState,
  emptyProfileImportUiState,
  pendingProfileImportUiState,
  profileImportUiWithProgress,
  profileImportUiFinished,
  PROFILE_IMPORT_STAGES,
  PROFILE_IMPORT_STAGE_LABELS,
} from "./helpers";


export function App() {
  const [state, dispatch] = useReducer(shellReducer, initialAppState);
  const [booting, setBooting] = useState(true);
  const [query, setQuery] = useState("");
  const [appInfo, setAppInfo] = useState<{ readonly name: string; readonly version: string; readonly mode: "desktop" | "browser-preview" } | null>(null);
  const [appPreferences, setAppPreferences] = useState<AppPreferencesState | null>(null);
  const [pluginRegistryState, setPluginRegistryState] = useState<PluginRegistryState | null>(null);
  const [pluginManagerMessage, setPluginManagerMessage] = useState("");
  const [newPluginId, setNewPluginId] = useState("my-plugin");
  const [newPluginName, setNewPluginName] = useState("My Plugin");
  const [settingsBindKey, setSettingsBindKey] = useState("F1");
  const [settingsBindCommand, setSettingsBindCommand] = useState("mimic status");
  const [libraryState, setLibraryState] = useState<ClientLibraryState | null>(null);
  const [clientSessions, setClientSessions] = useState<ClientSessionList | null>(null);
  const [selectedClientSnapshot, setSelectedClientSnapshot] = useState<ClientSnapshot | null>(null);
  const [engineLaunch, setEngineLaunch] = useState<EngineLaunchState | null>(null);
  const [relayLog, setRelayLog] = useState<RelayLogSnapshot | null>(null);
  const [furniMetadata, setFurniMetadata] = useState<FurniMetadataSnapshot | null>(null);
  const [engineBusy, setEngineBusy] = useState(false);
  const [profileImportUi, setProfileImportUi] = useState<ProfileImportUiState>(emptyProfileImportUiState);
  const [profileImportNow, setProfileImportNow] = useState(() => Date.now());
  const [versionCheckDraft, setVersionCheckDraft] = useState("");
  const [bridgeMessage, setBridgeMessage] = useState("");
  const [runtimeSnapshot, setRuntimeSnapshot] = useState<EngineRuntimeSnapshot | null>(null);
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [runtimeMessage, setRuntimeMessage] = useState("");
  const [privateRoomId, setPrivateRoomId] = useState("");
  const [chatDraft, setChatDraft] = useState("");
  const [chatClearOffset, setChatClearOffset] = useState(0);
  const [chatRoomMarkers, setChatRoomMarkers] = useState<RuntimeChatEntry[]>([]);
  const [chatFilters, setChatFilters] = useState({
    talk: true,
    whisper: true,
    shout: true,
    system: true,
    autoscroll: true,
  });
  const [packetFilters, setPacketFilters] = useState({
    client: true,
    server: true,
    relay: true,
    wrap: true,
    autoscroll: true,
    clientSession: "All",
    session: "All",
    search: "",
  });
  const [packetClearOffset, setPacketClearOffset] = useState(0);
  const [selectedPacketKey, setSelectedPacketKey] = useState("");
  const [packetExportMessage, setPacketExportMessage] = useState("");
  const [packetConsoleOpen, setPacketConsoleOpen] = useState(false);
  const [packetConsoleQuery, setPacketConsoleQuery] = useState("");
  const [packetConsoleClientFilter, setPacketConsoleClientFilter] = useState("All");
  const [packetConsoleInput, setPacketConsoleInput] = useState("");
  const [packetConsoleEntries, setPacketConsoleEntries] = useState<PacketConsoleEntry[]>([]);
  const [consoleCommandState, setConsoleCommandState] = useState<ConsoleCommandStateSnapshot | null>(null);
  const [mimicState, setMimicState] = useState<MimicStateSnapshot | null>(null);
  const [multiAccountFile, setMultiAccountFile] = useState("multiclient-accounts.txt");
  const [multiAccountCount, setMultiAccountCount] = useState("3");
  const [multiAccountConcurrency, setMultiAccountConcurrency] = useState("2");
  const [multiAccountKeyEnv, setMultiAccountKeyEnv] = useState("HABBPY_V4_ACCOUNT_STORE_KEY");
  const [multiAccountSummonTarget, setMultiAccountSummonTarget] = useState("headless");
  const [multiAccountLoadMode, setMultiAccountLoadMode] = useState<"headless" | "visible">("headless");
  const [multiAccountMessage, setMultiAccountMessage] = useState("");
  const [packetConsoleHistoryIndex, setPacketConsoleHistoryIndex] = useState<number | null>(null);
  const [packetListScrollTop, setPacketListScrollTop] = useState(0);
  const [packetConsoleScrollTop, setPacketConsoleScrollTop] = useState(0);
  const [socialFriendFilter, setSocialFriendFilter] = useState("");
  const [inventoryFilter, setInventoryFilter] = useState("");
  const [selectedInventoryKey, setSelectedInventoryKey] = useState("");
  const [gameZoom, setGameZoom] = useState<1 | 2>(1);
  const [injectionDraft, setInjectionDraft] = useState<InjectionCommandDraft>(defaultInjectionDraft);
  const [injectionRepeatCount, setInjectionRepeatCount] = useState("1");
  const [injectionRepeatInterval, setInjectionRepeatInterval] = useState("1000");
  const [injectionSnippets, setInjectionSnippets] = useState<InjectionSnippet[]>([]);
  const [selectedInjectionSnippetId, setSelectedInjectionSnippetId] = useState("");
  const [injectionHistory, setInjectionHistory] = useState<InjectionHistoryEntry[]>([]);
  const [injectionMessage, setInjectionMessage] = useState("");
  const [visitorFilter, setVisitorFilter] = useState("");
  const [visitorState, setVisitorState] = useState<VisitorTrackerState>(emptyVisitorState);
  const [itemFilter, setItemFilter] = useState("");
  const [selectedItemKey, setSelectedItemKey] = useState("");
  const [publicRoomQuery, setPublicRoomQuery] = useState("");
  const [roomStageClickX, setRoomStageClickX] = useState("480");
  const [roomStageClickY, setRoomStageClickY] = useState("270");
  const [selectedPlantKey, setSelectedPlantKey] = useState("");
  const [gardeningCycleSec, setGardeningCycleSec] = useState("600");
  const [gardeningJob, setGardeningJob] = useState<GardeningJobState | null>(null);
  const [gardeningRunning, setGardeningRunning] = useState(false);
  const [fishingMessage, setFishingMessage] = useState("");
  const [gardeningMessage, setGardeningMessage] = useState("");
  const [presentCatcherRunning, setPresentCatcherRunning] = useState(false);
  const [presentCatcherMessage, setPresentCatcherMessage] = useState("");
  const [presentCatcherTab, setPresentCatcherTab] = useState<"catcher" | "gifts" | "fragments">("catcher");
  const [presentCatcherPanicDraft, setPresentCatcherPanicDraft] = useState("");
  const [presentCatcherPanicNames, setPresentCatcherPanicNames] = useState<string[]>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem("habbpy-v4:present-catcher:panic-names") ?? "[]");
      return Array.isArray(parsed) ? parsed.map((entry) => String(entry).trim()).filter(Boolean) : [];
    } catch {
      return [];
    }
  });
  const [presentCatcherGiftClass, setPresentCatcherGiftClass] = useState("balloon");
  const [selectedPresentGiftKey, setSelectedPresentGiftKey] = useState("");
  const [presentPlaceX, setPresentPlaceX] = useState("");
  const [presentPlaceY, setPresentPlaceY] = useState("");
  const [presentPlaceDirection, setPresentPlaceDirection] = useState("2");
  const [presentOpenObjectId, setPresentOpenObjectId] = useState("");
  const [presentFragmentEvent, setPresentFragmentEvent] = useState("second_anniversary");
  const [presentFragmentSlotId, setPresentFragmentSlotId] = useState("");
  const [presentFragmentTradeTarget, setPresentFragmentTradeTarget] = useState("");
  const [selectedWallMoverKey, setSelectedWallMoverKey] = useState("");
  const [wallMoverStep, setWallMoverStep] = useState("1");
  const [wallMoverMessage, setWallMoverMessage] = useState("");
  const [selectedUserKey, setSelectedUserKey] = useState("");
  const [engineUserNameLabels, setEngineUserNameLabels] = useState(false);
  const [userStoredLooks, setUserStoredLooks] = useState<string[]>(loadStoredUserLooks);
  const [selectedStoredUserLook, setSelectedStoredUserLook] = useState("");
  const [userToolMessage, setUserToolMessage] = useState("");
  const [automationPrefs, setAutomationPrefs] = useState(loadAutomationPrefs);
  const [automationMessage, setAutomationMessage] = useState("");
  const [socialMessage, setSocialMessage] = useState("");
  const [publicLookupName, setPublicLookupName] = useState("");
  const [publicLookupBusy, setPublicLookupBusy] = useState(false);
  const [publicLookupResult, setPublicLookupResult] = useState<OriginsUserLookupResult | null>(null);
  const [visitorLookupBusy, setVisitorLookupBusy] = useState(false);
  const [visitorLookupMessage, setVisitorLookupMessage] = useState("");
  const [visitorPublicProfiles, setVisitorPublicProfiles] = useState<Readonly<Record<string, OriginsUserLookupResult>>>({});
  const webviewRef = useRef<EngineWebviewElement | null>(null);
  const gameWebviewRefs = useRef<globalThis.Map<number, EngineWebviewElement>>(new globalThis.Map());
  const gameWebviewRefCallbacks = useRef<globalThis.Map<number, (element: Element | null) => void>>(new globalThis.Map());
  const runtimeSnapshotRef = useRef<EngineRuntimeSnapshot | null>(null);
  const relayLogRef = useRef<RelayLogSnapshot | null>(null);
  const clientSessionsRef = useRef<ClientSessionList | null>(null);
  const selectedClientIdRef = useRef(1);
  const selectedRuntimeSnapshotRef = useRef<EngineRuntimeSnapshot | null>(null);
  const userPluginHostRef = useRef<RendererUserPluginHost | null>(null);
  const userPluginRequestHandlerRef = useRef<(plugin: PluginDefinition, request: UserPluginHostRequest) => Promise<unknown>>(
    async () => {
      throw new Error("Plugin host is not ready.");
    },
  );
  const userPluginLogHandlerRef = useRef<(plugin: PluginDefinition, level: "info" | "warning" | "error", message: string) => void>(() => undefined);
  const userPluginRoomUsersRef = useRef<UserPluginRoomUserCache | null>(null);
  const userPluginRoomObjectsRef = useRef<UserPluginRoomObjectCache | null>(null);
  const userPluginChatRef = useRef<UserPluginChatCache | null>(null);
  const userPluginPacketCursorRef = useRef<{ readonly logPath: string | null; readonly lineNumber: number; readonly initialized: boolean }>({
    logPath: null,
    lineNumber: 0,
    initialized: false,
  });
  const chatListRef = useRef<HTMLDivElement | null>(null);
  const packetListRef = useRef<HTMLDivElement | null>(null);
  const packetListScrollFrameRef = useRef<number | null>(null);
  const packetConsoleListRef = useRef<HTMLDivElement | null>(null);
  const packetConsolePacketListRef = useRef<HTMLDivElement | null>(null);
  const packetConsoleScrollFrameRef = useRef<number | null>(null);
  const injectionFileInputRef = useRef<HTMLInputElement | null>(null);
  const lastChatRoomMarkerKeyRef = useRef("");
  const lastAutoHideBulletinKeyRef = useRef("");
  const presentCatcherActionInFlightRef = useRef(false);
  const visibleLoginSubmittedRef = useRef<Set<string>>(new Set());
  const visibleLoginInFlightRef = useRef<Set<string>>(new Set());
  const visibleLoginWarnedRef = useRef<Set<string>>(new Set());
  const pluginClientRightsOwnersRef = useRef<PluginClientRightsOwners>(new globalThis.Map());
  const managedRuntimeCleanupInFlightRef = useRef(false);
  const preferenceDefaultsAppliedRef = useRef(false);
  const completedImportRefreshRef = useRef("");
  const [gameWebviewMountEpoch, setGameWebviewMountEpoch] = useState(0);
  const [mountedVisibleClientIds, setMountedVisibleClientIds] = useState<ReadonlySet<number>>(() => new globalThis.Set([1]));

  const availablePlugins = pluginRegistryState?.plugins ?? plugins;
  const pluginEnabledById = pluginRegistryState?.enabledById ?? state.plugins.enabledById;
  const disabledRuntimeManagedClientRights = useMemo(
    () => disabledManagedClientRights(availablePlugins, pluginEnabledById),
    [availablePlugins, pluginEnabledById],
  );
  const pluginSurfaceEnabledByPluginId = pluginRegistryState?.uiSurfaceEnabledByPluginId ?? state.plugins.uiSurfaceEnabledByPluginId;
  const pinnedPluginIds = useMemo(
    () => new Set(pluginRegistryState?.pinnedPluginIds ?? ["connection", "plugin-manager", "settings"]),
    [pluginRegistryState?.pinnedPluginIds],
  );

  const railPlugins = useMemo(() => {
    return availablePlugins.filter((plugin) => pinnedPluginIds.has(plugin.id) || pluginEnabledById[plugin.id] !== false);
  }, [availablePlugins, pinnedPluginIds, pluginEnabledById]);

  const filteredPlugins = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return railPlugins;
    return railPlugins.filter((plugin) => {
      const text = [plugin.name, plugin.category, plugin.summary, ...plugin.capabilities].join(" ").toLowerCase();
      return text.includes(normalized);
    });
  }, [query, railPlugins]);
  const savedSelectedPlugin = availablePlugins.find((plugin) => plugin.id === state.selectedPluginId) ?? getPluginById(state.selectedPluginId) ?? availablePlugins[0] ?? plugins[0];
  const selectedPlugin = filteredPlugins.some((plugin) => plugin.id === savedSelectedPlugin.id)
    ? savedSelectedPlugin
    : filteredPlugins[0] ?? savedSelectedPlugin;
  const selectedProfile =
    libraryState?.profiles.find((profile) => profile.profileRoot === libraryState.selectedProfileRoot) ??
    engineLaunch?.profile ??
    null;
  const selectedClientSession =
    clientSessions?.sessions.find((session) => session.id === clientSessions.selectedClientId) ??
    clientSessions?.sessions.find((session) => session.selected) ??
    clientSessions?.sessions[0] ??
    null;
  const selectedClientId = selectedClientSession?.id ?? selectedClientSnapshot?.selectedClientId ?? clientSessions?.selectedClientId ?? 1;
  const selectedClientIsVisible = selectedClientSession?.visible !== false;
  const selectedClientEngineUrl =
    selectedClientSession && selectedClientIsVisible && selectedClientSession.status === "running"
      ? selectedClientSession.embeddedUrl ?? ""
      : "";
  const engineUrl = selectedClientSession
    ? selectedClientIsVisible
      ? selectedClientEngineUrl || (selectedClientId === 1 ? engineLaunch?.embeddedUrl ?? "" : "")
      : ""
    : engineLaunch?.embeddedUrl ?? "";
  const availableVisibleGameViews = useMemo(() => {
    const byClientId = new globalThis.Map<number, GameWebviewMount>();
    for (const session of clientSessions?.sessions ?? []) {
      if (!session.visible || session.headless || session.status !== "running") continue;
      const url = session.embeddedUrl || (session.id === 1 ? engineLaunch?.embeddedUrl ?? "" : "");
      if (!url) continue;
      byClientId.set(session.id, {
        id: session.id,
        label: session.label,
        url,
        partition: gameWebviewPartitionForClient(session.id),
      });
    }
    if (engineLaunch?.embeddedUrl && !byClientId.has(1)) {
      byClientId.set(1, {
        id: 1,
        label: clientSessions?.sessions.find((session) => session.id === 1)?.label ?? "Main",
        url: engineLaunch.embeddedUrl,
        partition: gameWebviewPartitionForClient(1),
      });
    }
    return [...byClientId.values()].sort((left, right) => left.id - right.id);
  }, [clientSessions?.sessions, engineLaunch?.embeddedUrl]);
  const availableVisibleGameViewKey = availableVisibleGameViews.map((view) => `${view.id}:${view.url}`).join("|");
  const mountedVisibleGameViews = useMemo(
    () =>
      availableVisibleGameViews.filter(
        (view) => mountedVisibleClientIds.has(view.id) || (view.id === selectedClientId && selectedClientIsVisible),
      ),
    [availableVisibleGameViews, mountedVisibleClientIds, selectedClientId, selectedClientIsVisible],
  );
  const hasMountedVisibleGameViews = mountedVisibleGameViews.length > 0;
  const selectedRuntimeSnapshot = selectedClientIsVisible ? runtimeSnapshot : null;
  const roomReady = Boolean(selectedRuntimeSnapshot?.roomReady?.ready ?? selectedRuntimeSnapshot?.roomEntryState?.roomReady?.ready);
  const privateRoomReady = roomReady && runtimeRoomType(selectedRuntimeSnapshot) === "private";
  const desktopBridgeAvailable = Boolean(window.habbpyV4);
  const profileImportRunning = profileImportUi.running;
  const profileImportElapsedMs =
    profileImportRunning && profileImportUi.startedAt
      ? Math.max(0, profileImportNow - profileImportUi.startedAt)
      : profileImportUi.latest?.elapsedMs ?? (profileImportUi.startedAt ? Math.max(0, profileImportNow - profileImportUi.startedAt) : 0);
  const mainMimicSourceId = clientSessions?.mainClientId ?? 1;
  const mainClientSession = clientSessions?.sessions.find((session) => session.id === mainMimicSourceId) ?? null;
  const mimicSourceSession = clientSessions?.sessions.find((session) => session.id === mimicState?.sourceClientId) ?? null;
  const mimicTargetSessions = (clientSessions?.sessions ?? []).filter((session) => mimicState?.targetClientIds.includes(session.id));
  const packetEntries = relayLog?.entries ?? [];
  useEffect(() => {
    clientSessionsRef.current = clientSessions;
  }, [clientSessions]);
  useEffect(() => {
    selectedClientIdRef.current = selectedClientId;
  }, [selectedClientId]);
  useEffect(() => {
    selectedRuntimeSnapshotRef.current = selectedRuntimeSnapshot;
  }, [selectedRuntimeSnapshot]);
  const clientPluginSnapshotsById = useMemo(
    () =>
      clientPluginSnapshotMapFromSources({
        relayLog,
        sessions: clientSessions?.sessions ?? [],
        selectedClientId,
        selectedRuntimeSnapshot,
        selectedClientSnapshot,
      }),
    [clientSessions?.sessions, relayLog, selectedClientId, selectedClientSnapshot, selectedRuntimeSnapshot],
  );
  const selectedClientPluginSnapshot = clientPluginSnapshotsById.get(selectedClientId) ?? null;
  const selectedClientRelayLog = selectedClientPluginSnapshot?.relay ?? null;
  const packetPanelActive = selectedPlugin.id === "packet-log";
  const relayDerivedState = useMemo(() => relayDerivedStateFromSnapshot(selectedClientRelayLog), [selectedClientRelayLog]);
  const packetInfoState = selectedClientPluginSnapshot?.packetInfo ?? emptyPacketInfoState;
  const packetInventoryState = selectedClientPluginSnapshot?.packetInventory ?? emptyPacketInventoryState;
  const packetWallItemState = selectedClientPluginSnapshot?.packetWallItems ?? emptyPacketWallItemState;
  const packetFishingState = selectedClientPluginSnapshot?.packetFishing ?? emptyPacketFishingState;
  const latestClientPacket = relayDerivedState.latestClientPacket;
  const latestServerPacket = relayDerivedState.latestServerPacket;
  const relaySessionId = compactValue(relayDerivedState.latestSessionId);
  const relayEncryptionState = relayEncryptionSummary(relayDerivedState);
  const relayBodyLoggingState = relayBodyLoggingSummary(relayDerivedState);
  const relayClientModes = relayModeSummary(relayDerivedState.clientModes);
  const relayServerModes = relayModeSummary(relayDerivedState.serverModes);
  const userRows = selectedRuntimeSnapshot?.userState?.users ?? [];
  const selectedUser = userRows.find((user) => user.rowId === selectedUserKey) ?? userRows[0] ?? null;
  const selectedUserName = userDisplayName(selectedUser, selectedRuntimeSnapshot?.userState?.sessionUserName);
  const selfUser = useMemo(() => {
    const sessionName = String(selectedRuntimeSnapshot?.userState?.sessionUserName ?? "").trim().toLowerCase();
    if (!sessionName) return selectedUser;
    return userRows.find((user) => userDisplayName(user, selectedRuntimeSnapshot?.userState?.sessionUserName).trim().toLowerCase() === sessionName) ?? selectedUser;
  }, [selectedRuntimeSnapshot?.userState?.sessionUserName, selectedUser, userRows]);
  const packetProfileUsers = selectedClientPluginSnapshot?.profileUsers ?? [];
  const packetProfileIndex = selectedClientPluginSnapshot?.profileIndex ?? emptyPacketProfileIndex;
  const visibleActiveAccountNames = useMemo(
    () =>
      uniqueUsefulNames([
        selectedRuntimeSnapshot?.userState?.sessionUserName,
        selectedClientSession?.username,
        selectedClientSnapshot?.client?.username,
        selectedClientSnapshot?.runtime?.userName,
        userRows.find((user) => user.rowId === "0") ? userDisplayName(userRows.find((user) => user.rowId === "0") ?? null, selectedRuntimeSnapshot?.userState?.sessionUserName) : null,
      ]),
    [
      selectedClientSession?.username,
      selectedClientSnapshot?.client?.username,
      selectedClientSnapshot?.runtime?.userName,
      selectedRuntimeSnapshot?.userState?.sessionUserName,
      userRows,
    ],
  );
  const selectedPacketProfileUser = useMemo(
    () => selectPacketProfileUser(packetProfileIndex, selectedUserName, selectedUser),
    [packetProfileIndex, selectedUser, selectedUserName],
  );
  const packetChatEntries = selectedClientPluginSnapshot?.packetChatEntries ?? [];
  const packetChatHistory = useMemo(
    () =>
      packetChatEntries.map((entry) =>
        packetChatRuntimeEntry(entry, packetProfileIndex, userRows, selectedRuntimeSnapshot?.userState?.sessionUserName),
      ),
    [packetChatEntries, packetProfileIndex, selectedRuntimeSnapshot?.userState?.sessionUserName, userRows],
  );
  const filteredPacketFriends = useMemo(() => {
    const normalized = socialFriendFilter.trim().toLowerCase();
    if (!normalized) return packetInfoState.friends;
    return packetInfoState.friends.filter((friend) => packetFriendSearchText(friend).includes(normalized));
  }, [packetInfoState.friends, socialFriendFilter]);
  const onlinePacketFriends = packetInfoState.friends.filter((friend) => friend.online).length;
  const socialRequestCount = packetInfoState.friendRequests.length > 0
    ? String(packetInfoState.friendRequests.length)
    : packetInfoState.messengerRequestCount;
  const socialMessageCount = packetInfoState.privateMessages.length > 0
    ? String(packetInfoState.privateMessages.length)
    : packetInfoState.messengerMessageCount;
  const visiblePrivateMessages = packetInfoState.privateMessages.slice(-6).reverse();
  const visibleFriendRequests = packetInfoState.friendRequests.slice(-6).reverse();
  const runtimeInventoryItems = selectedRuntimeSnapshot?.inventory?.items ?? [];
  const runtimeInventoryRows = useMemo(
    () => runtimeInventoryItems.map((item) => runtimeInventoryDisplayRow(item, furniMetadata)),
    [furniMetadata, runtimeInventoryItems],
  );
  const packetInventoryRows = useMemo(
    () => packetInventoryState.items.map((item) => packetInventoryDisplayRow(item, furniMetadata)),
    [furniMetadata, packetInventoryState.items],
  );
  const inventoryUsesPacketRows = runtimeInventoryRows.length === 0 && packetInventoryRows.length > 0;
  const inventoryRows = inventoryUsesPacketRows ? packetInventoryRows : runtimeInventoryRows;
  const filteredInventoryRows = useMemo(() => {
    const normalized = inventoryFilter.trim().toLowerCase();
    if (!normalized) return inventoryRows;
    return inventoryRows.filter((row) => row.searchText.includes(normalized));
  }, [inventoryFilter, inventoryRows]);
  const selectedInventoryRow = filteredInventoryRows.find((row) => row.key === selectedInventoryKey) ?? filteredInventoryRows[0] ?? null;
  const inventoryTotalCount = inventoryUsesPacketRows
    ? packetInventoryState.totalCount
    : selectedRuntimeSnapshot?.inventory?.totalCount ?? selectedRuntimeSnapshot?.inventory?.itemCount ?? packetInventoryState.totalCount;
  const inventoryRowCount = inventoryUsesPacketRows ? packetInventoryState.totalCount : selectedRuntimeSnapshot?.inventory?.itemCount ?? runtimeInventoryRows.length;
  const inventoryFloorCount = inventoryUsesPacketRows ? packetInventoryState.floorCount : selectedRuntimeSnapshot?.inventory?.floorCount ?? 0;
  const inventoryWallCount = inventoryUsesPacketRows ? packetInventoryState.wallCount : selectedRuntimeSnapshot?.inventory?.wallCount ?? 0;
  const selectedUserAccountId = profileValue(selectedUser?.accountId, selectedPacketProfileUser?.accountId);
  const selectedUserIndex = profileValue(selectedUser?.roomIndex, selectedPacketProfileUser?.index);
  const selectedUserGender = profileValue(selectedUser?.gender, selectedPacketProfileUser?.gender);
  const selectedUserType = profileValue(selectedUser?.userType ?? selectedUser?.objectClass ?? selectedUser?.className, selectedPacketProfileUser?.userType);
  const selectedUserBadgeCode = profileValue(selectedUser?.badgeCode, selectedPacketProfileUser?.badgeCode);
  const selectedUserMotto = profileValue(selectedUser?.motto, selectedPacketProfileUser?.motto);
  const selectedUserPosition = profileValue(userPosition(selectedUser), selectedPacketProfileUser?.position);
  const selectedUserFigure = profileValue(selectedUser?.figure, selectedPacketProfileUser?.figure);
  const selectedUserPoolFigure = profileValue(selectedUser?.poolFigure, selectedPacketProfileUser?.poolFigure);
  const activeStoredUserLook = selectedStoredUserLook || userStoredLooks[0] || "";
  const sourceChatHistory = selectedRuntimeSnapshot?.chatHistory ?? [];
  const activeChatSourceHistory = sourceChatHistory.length > 0 ? sourceChatHistory : packetChatHistory;
  const chatHistory = useMemo(() => [...chatRoomMarkers, ...activeChatSourceHistory], [activeChatSourceHistory, chatRoomMarkers]);
  const visibleChatHistory = chatHistory
    .slice(Math.min(chatClearOffset, chatHistory.length))
    .filter((entry) => chatFilters[chatEntryKind(entry)]);
  const visitorRoomKey = roomReady ? `${runtimeRoomType(selectedRuntimeSnapshot)}:${runtimeRoomId(selectedRuntimeSnapshot)}` : "";
  const visitorRoomName = roomReady ? runtimeRoomName(selectedRuntimeSnapshot) : "-";
  const visitorEntries = useMemo(
    () =>
      Object.values(visitorState.entries).sort((left, right) => {
        if (left.current !== right.current) return left.current ? -1 : 1;
        return left.name.localeCompare(right.name);
      }),
    [visitorState.entries],
  );
  const enrichedVisitorEntries = useMemo(
    () =>
      visitorEntries.map((entry) => {
        if (entry.accountId !== "-") return entry;
        const profile = visitorPublicProfiles[entry.name.trim().toLowerCase()];
        if (!profile?.ok || !profile.id) return entry;
        return {
          ...entry,
          accountId: profile.id,
          sourceKeys: [...entry.sourceKeys, "official-origins-public-api"],
        };
      }),
    [visitorEntries, visitorPublicProfiles],
  );
  const filteredVisitorEntries = useMemo(() => {
    const normalized = visitorFilter.trim().toLowerCase();
    if (!normalized) return enrichedVisitorEntries;
    return enrichedVisitorEntries.filter((entry) => visitorSearchText(entry).includes(normalized));
  }, [enrichedVisitorEntries, visitorFilter]);
  const missingVisitorAccountIds = enrichedVisitorEntries.filter((entry) => entry.accountId === "-").length;
  const runtimeSourceItemRows = useMemo<readonly ItemRow[]>(() => runtimeItemRows(selectedRuntimeSnapshot), [selectedRuntimeSnapshot?.roomObjects]);
  const packetWallItemRows = useMemo<readonly ItemRow[]>(
    () => packetWallItemState.items.map((item) => packetWallItemRow(item)),
    [packetWallItemState.items],
  );
  const runtimeWallItemRows = runtimeSourceItemRows.filter((row) => row.kind === "wall");
  const itemRows = useMemo<readonly ItemRow[]>(() => {
    if (runtimeWallItemRows.length > 0 || packetWallItemRows.length === 0) return runtimeSourceItemRows;
    return [...runtimeSourceItemRows, ...packetWallItemRows];
  }, [packetWallItemRows, runtimeSourceItemRows, runtimeWallItemRows.length]);
  const filteredItemRows = useMemo(() => {
    const normalized = itemFilter.trim().toLowerCase();
    if (!normalized) return itemRows;
    return itemRows.filter((row) => itemRowSearchText(row, furniMetadata).includes(normalized));
  }, [furniMetadata, itemFilter, itemRows]);
  const selectedItemRow = itemRows.find((row) => row.key === selectedItemKey) ?? filteredItemRows[0] ?? null;
  const selectedItemMetadata = furniInfoForObject(furniMetadata, selectedItemRow?.item);
  const itemWallCount =
    runtimeWallItemRows.length > 0
      ? selectedRuntimeSnapshot?.roomObjects?.counts.wallItems ?? runtimeWallItemRows.length
      : packetWallItemState.itemCount;
  const fishingAreaRows = useMemo(() => itemRows.filter((row) => row.kind !== "wall" && isFishingAreaObject(row.item)), [itemRows]);
  const selectedFishingAreaRow = fishingAreaRows[0] ?? null;
  const plantRows = useMemo(() => itemRows.filter((row) => row.kind !== "wall" && isPlantLikeObject(row.item)), [itemRows]);
  const selectedPlantRow = plantRows.find((row) => row.key === selectedPlantKey) ?? plantRows[0] ?? null;
  const presentHammerRows = useMemo(() => itemRows.filter((row) => row.kind !== "wall" && isPresentCatcherHammerObject(row.item)), [itemRows]);
  const presentRows = useMemo(() => itemRows.filter((row) => row.kind !== "wall" && isPresentCatcherPresentObject(row.item)), [itemRows]);
  const presentGiftRows = useMemo(
    () => (selectedRuntimeSnapshot?.inventory?.items ?? []).filter((row) => isPresentCatcherGiftItem(row, presentCatcherGiftClass)),
    [presentCatcherGiftClass, selectedRuntimeSnapshot?.inventory?.items],
  );
  const selectedPresentGiftRow = presentGiftRows.find((row) => row.rowId === selectedPresentGiftKey) ?? presentGiftRows[0] ?? null;
  const presentCatcherPacketRows = useMemo(
    () =>
      (relayLog?.entries ?? [])
        .filter((entry) => (entry.clientId === null || entry.clientId === selectedClientId) && entry.header !== null && presentCatcherPacketHeaders.has(entry.header))
        .slice(-14),
    [relayLog?.entries, selectedClientId],
  );
  const wallMoverRows = useMemo(() => itemRows.filter((row) => row.kind === "wall"), [itemRows]);
  const selectedWallMoverRow = wallMoverRows.find((row) => row.key === selectedWallMoverKey) ?? wallMoverRows[0] ?? null;
  const selectedWallMoverLocation = wallMoverLocation(selectedWallMoverRow?.item);
  const selectedWallMoverItemId = objectNumericId(selectedWallMoverRow?.item);
  const deferredPacketSearch = useDeferredValue(packetFilters.search);
  const deferredPacketConsoleQuery = useDeferredValue(packetConsoleQuery);
  const packetSessionChoices = relayDerivedState.sessionChoices;
  const packetClientChoices = useMemo(() => {
    const choices = new globalThis.Map<string, string>();
    for (const session of clientSessions?.sessions ?? []) {
      choices.set(String(session.id), `client${session.id} ${session.label}`);
    }
    for (const entry of packetEntries) {
      if (entry.clientId === null) continue;
      choices.set(String(entry.clientId), `client${entry.clientId} ${entry.clientLabel ?? ""}`.trim());
    }
    return [
      { value: "All", label: "All clients" },
      ...[...choices.entries()]
        .sort((left, right) => Number(left[0]) - Number(right[0]))
        .map(([value, label]) => ({ value, label })),
    ];
  }, [clientSessions?.sessions, packetEntries]);
  const visiblePacketEntries = useMemo(() => {
    if (!packetPanelActive) return [];
    const offset = Math.min(packetClearOffset, packetEntries.length);
    const search = deferredPacketSearch.trim().toLowerCase();
    return packetEntries.slice(offset).filter((entry) => {
      if (entry.direction === "CLIENT" && !packetFilters.client) return false;
      if (entry.direction === "SERVER" && !packetFilters.server) return false;
      if (entry.direction === "RELAY" && !packetFilters.relay) return false;
      if (!packetClientMatches(entry, packetFilters.clientSession)) return false;
      if (packetFilters.session !== "All" && entry.sessionId !== packetFilters.session) return false;
      if (search && !relayEntrySearchText(entry).includes(search)) return false;
      return true;
    });
  }, [deferredPacketSearch, packetClearOffset, packetEntries, packetFilters.client, packetFilters.clientSession, packetFilters.relay, packetFilters.server, packetFilters.session, packetPanelActive]);
  const packetConsolePacketEntries = useMemo(() => {
    if (!packetConsoleOpen) return [];
    const offset = Math.min(packetClearOffset, packetEntries.length);
    const search = deferredPacketConsoleQuery.trim().toLowerCase();
    return packetEntries.slice(offset).filter((entry) => {
      if (!packetClientMatches(entry, packetConsoleClientFilter)) return false;
      if (!search) return true;
      return relayEntrySearchText(entry).includes(search);
    });
  }, [deferredPacketConsoleQuery, packetClearOffset, packetConsoleClientFilter, packetConsoleOpen, packetEntries]);
  const packetVirtualRange = useMemo(
    () => virtualPacketRange(visiblePacketEntries.length, packetListScrollTop),
    [packetListScrollTop, visiblePacketEntries.length],
  );
  const renderedPacketEntries = useMemo(
    () => visiblePacketEntries.slice(packetVirtualRange.start, packetVirtualRange.end),
    [packetVirtualRange.end, packetVirtualRange.start, visiblePacketEntries],
  );
  const packetConsoleVirtualRange = useMemo(
    () =>
      virtualPacketRange(
        packetConsolePacketEntries.length,
        packetConsoleScrollTop,
        PACKET_CONSOLE_ROW_HEIGHT,
        PACKET_CONSOLE_RENDER_ROWS,
        PACKET_CONSOLE_OVERSCAN_ROWS,
      ),
    [packetConsolePacketEntries.length, packetConsoleScrollTop],
  );
  const renderedPacketConsoleEntries = useMemo(
    () => packetConsolePacketEntries.slice(packetConsoleVirtualRange.start, packetConsoleVirtualRange.end),
    [packetConsolePacketEntries, packetConsoleVirtualRange.end, packetConsoleVirtualRange.start],
  );
  const selectedPacketEntry = packetPanelActive
    ? packetEntries.find((entry) => entry.id === selectedPacketKey) ?? visiblePacketEntries[visiblePacketEntries.length - 1] ?? null
    : null;
  const handlePacketListScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const nextScrollTop = event.currentTarget.scrollTop;
    if (packetListScrollFrameRef.current !== null) window.cancelAnimationFrame(packetListScrollFrameRef.current);
    packetListScrollFrameRef.current = window.requestAnimationFrame(() => {
      packetListScrollFrameRef.current = null;
      startTransition(() => {
        setPacketListScrollTop(nextScrollTop);
      });
    });
  }, []);
  const handlePacketConsoleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const nextScrollTop = event.currentTarget.scrollTop;
    if (packetConsoleScrollFrameRef.current !== null) window.cancelAnimationFrame(packetConsoleScrollFrameRef.current);
    packetConsoleScrollFrameRef.current = window.requestAnimationFrame(() => {
      packetConsoleScrollFrameRef.current = null;
      startTransition(() => {
        setPacketConsoleScrollTop(nextScrollTop);
      });
    });
  }, []);
  const selectedInjectionSnippet = injectionSnippets.find((snippet) => snippet.id === selectedInjectionSnippetId) ?? null;

  const applyEngineLaunch = useCallback((launch: EngineLaunchState) => {
    setEngineLaunch(launch);
    dispatch({
      type: "mergeEngineStatus",
      status: {
        running: launch.status === "running",
        embedded: Boolean(launch.embeddedUrl),
        profileLabel: launch.profile ? profileLine(launch.profile) : "No Shockless profile attached",
        buildLabel: launch.buildLabel,
        location:
          launch.status === "running"
            ? "Shockless embedded"
            : launch.status === "ready"
              ? "Shockless ready"
              : launch.status === "error"
                ? "Embed error"
                : "Shell preview",
      },
    });
  }, []);

  const appendTimeline = useCallback((severity: "info" | "success" | "warning" | "error", message: string) => {
    dispatch({
      type: "appendTimeline",
      entry: {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        time: new Date().toLocaleTimeString(),
        severity,
        message,
      },
    });
  }, []);

  const updateAppPreferencePatch = useCallback(
    async (patch: AppPreferencesPatch, message: string, severity: "success" | "warning" = "success") => {
      if (!window.habbpyV4?.setAppPreferences) return;
      const next = await window.habbpyV4.setAppPreferences(patch);
      setAppPreferences(next);
      setBridgeMessage(message);
      appendTimeline(severity, message);
    },
    [appendTimeline],
  );

  const updateHardwareAccelerationPreference = useCallback(
    async (enabled: boolean) => {
      const restartRequired = enabled !== (appPreferences?.hardwareAccelerationActive ?? true);
      const restartNote = restartRequired ? " Restart Habbpy v4 to apply it." : "";
      await updateAppPreferencePatch(
        { hardwareAcceleration: enabled },
        `Hardware acceleration preference ${enabled ? "enabled" : "disabled"}.${restartNote}`,
        restartRequired ? "warning" : "success",
      );
    },
    [appPreferences?.hardwareAccelerationActive, updateAppPreferencePatch],
  );

  const saveSessionDefaultPreferences = useCallback(async () => {
    const patch: AppPreferencesPatch = {
      defaultAccountFile: multiAccountFile,
      defaultAccountCount: clampMultiAccountCount(multiAccountCount),
      defaultAccountConcurrency: clampMultiAccountConcurrency(multiAccountConcurrency),
      defaultAccountKeyEnv: multiAccountKeyEnv,
      defaultSummonTarget: multiAccountSummonTarget,
      defaultLoadMode: multiAccountLoadMode,
      autoSubmitVisibleLogin: appPreferences?.autoSubmitVisibleLogin !== false,
    };
    await updateAppPreferencePatch(patch, "Session defaults saved.");
  }, [
    appPreferences?.autoSubmitVisibleLogin,
    multiAccountConcurrency,
    multiAccountCount,
    multiAccountFile,
    multiAccountKeyEnv,
    multiAccountLoadMode,
    multiAccountSummonTarget,
    updateAppPreferencePatch,
  ]);

  const openMultiAccountPanel = useCallback(() => {
    dispatch({ type: "selectPlugin", pluginId: "multi-account" });
    if (state.ui.dockCollapsed) dispatch({ type: "toggleDockCollapsed" });
    setMultiAccountMessage("Choose Load Visible to start another switchable client, or Load Headless for background clients.");
    appendTimeline("info", "Opened Multi Account controls.");
  }, [appendTimeline, state.ui.dockCollapsed]);

  const refreshClientSessions = useCallback(async () => {
    if (!window.habbpyV4) return null;
    const sessions = await window.habbpyV4.getClientSessions();
    setClientSessions(sessions);
    return sessions;
  }, []);

  const refreshSelectedClientSnapshot = useCallback(async (clientId?: number, options: { readonly updateSelectedSnapshot?: boolean } = {}) => {
    if (!window.habbpyV4?.getClientSnapshot) return null;
    const snapshot = await window.habbpyV4.getClientSnapshot(clientId);
    const shouldUpdateSelectedSnapshot =
      options.updateSelectedSnapshot !== false &&
      (clientId === undefined || clientId === selectedClientIdRef.current);
    if (shouldUpdateSelectedSnapshot) setSelectedClientSnapshot(snapshot);
    setClientSessions((current) => mergeClientSummaryIntoList(current, snapshot));
    return snapshot;
  }, []);

  const refreshConsoleCommandState = useCallback(async () => {
    if (!window.habbpyV4?.getConsoleCommandState) return null;
    const snapshot = await window.habbpyV4.getConsoleCommandState();
    setConsoleCommandState(snapshot);
    return snapshot;
  }, []);

  const refreshMimicState = useCallback(async () => {
    if (!window.habbpyV4?.getMimicState) return null;
    const snapshot = await window.habbpyV4.getMimicState();
    setMimicState(snapshot);
    return snapshot;
  }, []);

  const selectClientSession = useCallback(
    async (clientId: number) => {
      if (!window.habbpyV4) return;
      const sessions = await window.habbpyV4.selectClientSession(clientId);
      setClientSessions(sessions);
      const launch = await window.habbpyV4.getEngineLaunchState().catch(() => null);
      if (launch) applyEngineLaunch(launch);
      void refreshSelectedClientSnapshot(clientId);
      void refreshMimicState();
      appendTimeline(sessions.selectedClientId === clientId ? "success" : "warning", sessions.message);
    },
    [appendTimeline, applyEngineLaunch, refreshMimicState, refreshSelectedClientSnapshot],
  );

  const setGameWebviewElement = useCallback((clientId: number, element: Element | null) => {
    const webview = element as EngineWebviewElement | null;
    const current = gameWebviewRefs.current.get(clientId) ?? null;
    if (webview) {
      if (current === webview) return;
      gameWebviewRefs.current.set(clientId, webview);
      setGameWebviewMountEpoch((epoch) => epoch + 1);
      return;
    }
    if (current) {
      gameWebviewRefs.current.delete(clientId);
      setGameWebviewMountEpoch((epoch) => epoch + 1);
    }
  }, []);

  const gameWebviewRefForClient = useCallback(
    (clientId: number) => {
      const current = gameWebviewRefCallbacks.current.get(clientId);
      if (current) return current;
      const callback = (element: Element | null) => setGameWebviewElement(clientId, element);
      gameWebviewRefCallbacks.current.set(clientId, callback);
      return callback;
    },
    [setGameWebviewElement],
  );

  const waitForVisibleClientWebview = useCallback(
    async (clientId: number): Promise<EngineWebviewElement | null> => {
      setMountedVisibleClientIds((current) => (current.has(clientId) ? current : new globalThis.Set([...current, clientId])));
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const webview = gameWebviewRefs.current.get(clientId);
        if (webview) return webview;
        await delay(250);
      }
      return null;
    },
    [],
  );

  useEffect(() => {
    if (availableVisibleGameViews.length === 0) return;
    setMountedVisibleClientIds((current) => {
      let changed = false;
      const next = new globalThis.Set(current);
      for (const view of availableVisibleGameViews) {
        if (next.has(view.id)) continue;
        next.add(view.id);
        changed = true;
      }
      return changed ? next : current;
    });
  }, [availableVisibleGameViewKey, availableVisibleGameViews]);

  useEffect(() => {
    const availableIds = new globalThis.Set(availableVisibleGameViews.map((view) => view.id));
    setMountedVisibleClientIds((current) => {
      const next = new globalThis.Set([...current].filter((clientId) => availableIds.has(clientId)));
      return next.size === current.size && [...next].every((clientId) => current.has(clientId)) ? current : next;
    });
  }, [availableVisibleGameViewKey, availableVisibleGameViews]);

  useEffect(() => {
    webviewRef.current = gameWebviewRefs.current.get(selectedClientId) ?? null;
  }, [gameWebviewMountEpoch, mountedVisibleGameViews, selectedClientId]);

  const applyRuntimeSnapshot = useCallback((snapshot: EngineRuntimeSnapshot) => {
    const stableSnapshot = reuseStableRuntimeDetails(runtimeSnapshotRef.current, snapshot);
    runtimeSnapshotRef.current = stableSnapshot;
    const summary = summarizeRuntimeSnapshot(stableSnapshot);
    startTransition(() => {
      setRuntimeSnapshot(stableSnapshot);
      dispatch({
        type: "mergeEngineStatus",
        status: summary.engine,
      });
      dispatch({
        type: "mergeRoomSummary",
        room: summary.room,
      });
      dispatch({
        type: "mergeAccountSummary",
        account: summary.account,
      });
    });
  }, []);

  const refreshRuntimeSnapshot = useCallback(async (scopes: readonly EngineRuntimeSnapshotScope[] = ["full"]) => {
    const webview = webviewRef.current;
    if (!webview || !engineUrl) return null;
    const snapshot = await readEngineRuntimeSnapshot(webview, scopes);
    applyRuntimeSnapshot(snapshot);
    return snapshot;
  }, [applyRuntimeSnapshot, engineUrl, selectedClientId]);

  const refreshRelayLog = useCallback(async () => {
    if (!window.habbpyV4) return null;
    const current = relayLogRef.current;
    const snapshot = current
      ? await window.habbpyV4.getRelayLogDeltaSnapshot(current.logPath, current.totalLines)
      : await window.habbpyV4.getRelayLogSnapshot();
    let nextSnapshot: RelayLogSnapshot | null = null;
    setRelayLog((current) => {
      const merged = mergeRelayLogSnapshot(current, snapshot);
      if (current === merged) {
        nextSnapshot = current;
        return current;
      }
      relayLogRef.current = merged;
      nextSnapshot = merged;
      return merged;
    });
    return nextSnapshot ?? relayLogRef.current;
  }, []);

  const refreshFurniMetadata = useCallback(async () => {
    if (!window.habbpyV4) return null;
    const snapshot = await window.habbpyV4.getFurniMetadataSnapshot();
    setFurniMetadata(snapshot);
    return snapshot;
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.code !== "Backquote" && event.key !== "`") return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (isTextEntryTarget(event.target)) return;
      event.preventDefault();
      setPacketConsoleOpen((open) => !open);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    void refreshConsoleCommandState();
  }, [refreshConsoleCommandState]);

  useEffect(() => {
    void refreshMimicState();
  }, [refreshMimicState]);

  useEffect(() => {
    localStorage.setItem("habbpy-v4:present-catcher:panic-names", JSON.stringify(presentCatcherPanicNames));
  }, [presentCatcherPanicNames]);

  useEffect(() => {
    if (!desktopBridgeAvailable) return;
    void refreshSelectedClientSnapshot(clientSessions?.selectedClientId);
  }, [clientSessions?.selectedClientId, desktopBridgeAvailable, refreshSelectedClientSnapshot]);

  useEffect(() => {
    if (!packetConsoleOpen) return;
    void refreshRelayLog();
    void refreshConsoleCommandState();
  }, [packetConsoleOpen, refreshConsoleCommandState, refreshRelayLog]);

  useEffect(() => {
    if (!desktopBridgeAvailable) return;
    if (selectedPlugin.id !== "multi-account" && !packetConsoleOpen && !mimicState?.enabled) return;
    const timer = window.setInterval(() => {
      void refreshMimicState();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [desktopBridgeAvailable, mimicState?.enabled, packetConsoleOpen, refreshMimicState, selectedPlugin.id]);

  useEffect(() => {
    relayLogRef.current = relayLog;
  }, [relayLog]);

  useEffect(
    () => () => {
      if (packetListScrollFrameRef.current !== null) window.cancelAnimationFrame(packetListScrollFrameRef.current);
      if (packetConsoleScrollFrameRef.current !== null) window.cancelAnimationFrame(packetConsoleScrollFrameRef.current);
    },
    [],
  );

  const exportVisiblePacketLog = useCallback(() => {
    if (visiblePacketEntries.length === 0) {
      setPacketExportMessage("No visible packet rows to export.");
      return;
    }
    const body = visiblePacketEntries.map((entry) => relayEntryPlain(entry, relayLog?.updatedAt)).join("\n");
    const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `habbpy-v4-packets-${stamp}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
    setPacketExportMessage(`Prepared export for ${visiblePacketEntries.length} visible rows.`);
  }, [relayLog?.updatedAt, visiblePacketEntries]);

  const runRuntimeAction = useCallback(
    async (action: EngineRuntimeAction) => {
      const webview = webviewRef.current;
      if (!webview || !engineUrl) {
        setRuntimeMessage("Start the embedded client before using actions.");
        return;
      }
      setRuntimeBusy(true);
      try {
        const result = await runEngineRuntimeAction(webview, action);
        setRuntimeMessage(result.message);
        appendTimeline(result.ok ? "success" : "warning", result.message);
        await refreshRuntimeSnapshot();
      } finally {
        setRuntimeBusy(false);
      }
    },
    [appendTimeline, engineUrl, refreshRuntimeSnapshot, selectedClientId],
  );

  const setEmbeddedRoomZoom = useCallback(
    async (scale: 1 | 2) => {
      const normalized = scale === 2 ? 2 : 1;
      const webview = webviewRef.current;
      if (!webview || !engineUrl) {
        if (normalized === 1) setGameZoom(1);
        setRuntimeMessage("Start the embedded client before using room zoom.");
        return;
      }
      setRuntimeBusy(true);
      try {
        const result = await runEngineRuntimeAction(webview, { kind: "setRoomStageZoom", scale: normalized });
        setRuntimeMessage(result.message);
        appendTimeline(result.ok ? "success" : "warning", result.message);
        if (result.ok) setGameZoom(normalized);
        await refreshRuntimeSnapshot();
      } finally {
        setRuntimeBusy(false);
      }
    },
    [appendTimeline, engineUrl, refreshRuntimeSnapshot, selectedClientId],
  );

  useEffect(() => {
    if (!privateRoomReady && gameZoom !== 1) void setEmbeddedRoomZoom(1);
  }, [gameZoom, privateRoomReady, setEmbeddedRoomZoom]);

  const sendGardeningAction = useCallback(
    async (action: GardeningRelayAction, label: string, clientId?: number) => {
      if (!window.habbpyV4) {
        const message = "Run the Electron shell before sending Gardening packets.";
        setGardeningMessage(message);
        return { ok: false, message };
      }
      const targetClientId = clientId ?? selectedClientId;
      const result = await window.habbpyV4.sendGardeningRelayAction(action, targetClientId);
      setGardeningMessage(result.message);
      appendTimeline(result.ok ? "success" : "warning", `${label}: ${result.message}`);
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    },
    [appendTimeline, refreshRelayLog, refreshRuntimeSnapshot, selectedClientId],
  );

  const sendFishingAction = useCallback(
    async (action: FishingRelayAction, label: string, clientId?: number) => {
      if (!window.habbpyV4) {
        const message = "Run the Electron shell before sending Fishing packets.";
        setFishingMessage(message);
        appendTimeline("warning", message);
        return { ok: false, message };
      }
      const targetClientId = clientId ?? selectedClientId;
      const result = await window.habbpyV4.sendFishingRelayAction(action, targetClientId);
      setFishingMessage(result.message);
      appendTimeline(result.ok ? "success" : "warning", `${label}: ${result.message}`);
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    },
    [appendTimeline, refreshRelayLog, refreshRuntimeSnapshot, selectedClientId],
  );

  const sendFishingStart = useCallback(async () => {
    const areaId = objectNumericId(selectedFishingAreaRow?.item);
    if (areaId === null) {
      const message = "Enter a fishing room and select a parsed fishing area first.";
      setFishingMessage(message);
      appendTimeline("warning", message);
      return;
    }
    await sendFishingAction({ action: "startFishing", areaId }, `Fishing start ${areaId}`);
  }, [appendTimeline, selectedFishingAreaRow, sendFishingAction]);

  const sendPresentCatcherPacket = useCallback(
    async (packet: PluginPacketInput, label: string) => {
      if (!window.habbpyV4) {
        const message = "Run the Electron shell before sending Present Catcher packets.";
        setPresentCatcherMessage(message);
        appendTimeline("warning", message);
        return { ok: false, message };
      }
      const result = await window.habbpyV4.sendPluginPacket(packet, selectedClientId);
      setPresentCatcherMessage(result.message);
      appendTimeline(result.ok ? "success" : "warning", `${label}: ${result.message}`);
      await Promise.all([refreshRuntimeSnapshot(["core", "room", "inventory"]).catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    },
    [appendTimeline, refreshRelayLog, refreshRuntimeSnapshot, selectedClientId],
  );

  const usePresentCatcherFloorItem = useCallback(
    async (row: ItemRow, mode: "hammer" | "present") => {
      if (!window.habbpyV4) {
        const message = "Run the Electron shell before using Present Catcher actions.";
        setPresentCatcherMessage(message);
        appendTimeline("warning", message);
        return { ok: false, message };
      }
      const objectId = objectNumericId(row.item);
      const tile = itemRowTile(row);
      if (objectId === null || !tile) {
        const message = "Selected target is missing a numeric object id or tile.";
        setPresentCatcherMessage(message);
        appendTimeline("warning", message);
        return { ok: false, message };
      }

      const moveTarget = mode === "hammer"
        ? { x: tile.x, y: tile.y, furniId: objectId }
        : { ...(adjacentTileForItem(row, itemRows, userRows, selfUser) ?? { x: tile.x, y: tile.y + 1 }), furniId: 0 };
      const move = await window.habbpyV4.sendRoomRelayAction(
        { action: "move", x: moveTarget.x, y: moveTarget.y, furniId: moveTarget.furniId },
        selectedClientId,
      );
      appendTimeline(move.ok ? "success" : "warning", `Present Catcher move: ${move.message}`);
      if (!move.ok) {
        setPresentCatcherMessage(move.message);
        await refreshRelayLog().catch(() => null);
        return move;
      }

      await new Promise((resolve) => window.setTimeout(resolve, 350));
      const used = await window.habbpyV4.sendFurniRelayAction({ action: "useFloorItem", objectId, value: "0" }, selectedClientId);
      setPresentCatcherMessage(used.message);
      appendTimeline(used.ok ? "success" : "warning", `${mode === "hammer" ? "Collect Hammer" : "Use Present"}: ${used.message}`);
      await Promise.all([refreshRuntimeSnapshot(["core", "room", "inventory"]).catch(() => null), refreshRelayLog().catch(() => null)]);
      return used;
    },
    [appendTimeline, itemRows, refreshRelayLog, refreshRuntimeSnapshot, selectedClientId, selfUser, userRows],
  );

  const runPresentCatcherStep = useCallback(
    async (auto = false) => {
      if (presentCatcherActionInFlightRef.current) return;
      const panicSet = new Set(presentCatcherPanicNames.map((name) => name.trim().toLowerCase()).filter(Boolean));
      const panicHit = userRows.find((user) => panicSet.has(userDisplayName(user, selectedRuntimeSnapshot?.userState?.sessionUserName).trim().toLowerCase()));
      if (panicHit) {
        setPresentCatcherRunning(false);
        const name = userDisplayName(panicHit, selectedRuntimeSnapshot?.userState?.sessionUserName);
        await sendPresentCatcherPacket({ header: 53 }, `Panic leave for ${name}`);
        setPresentCatcherMessage(`Stopped because panic user ${name} is in the room.`);
        return;
      }
      const target = presentHammerRows[0] ? { row: presentHammerRows[0], mode: "hammer" as const } : presentRows[0] ? { row: presentRows[0], mode: "present" as const } : null;
      if (!target) {
        setPresentCatcherMessage(auto ? "Watching current room; no hammers or event presents parsed." : "No hammers or event presents parsed in this room.");
        return;
      }
      presentCatcherActionInFlightRef.current = true;
      try {
        await usePresentCatcherFloorItem(target.row, target.mode);
      } finally {
        presentCatcherActionInFlightRef.current = false;
      }
    },
    [
      presentCatcherPanicNames,
      presentHammerRows,
      presentRows,
      selectedRuntimeSnapshot?.userState?.sessionUserName,
      sendPresentCatcherPacket,
      usePresentCatcherFloorItem,
      userRows,
    ],
  );

  useEffect(() => {
    if (!presentCatcherRunning) return;
    let cancelled = false;
    let timer = 0;
    const tick = async () => {
      if (cancelled) return;
      await runPresentCatcherStep(true).catch((error) => {
        setPresentCatcherMessage(error instanceof Error ? error.message : String(error));
        appendTimeline("warning", `Present Catcher: ${error instanceof Error ? error.message : String(error)}`);
      });
      if (!cancelled) timer = window.setTimeout(tick, 1800);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [appendTimeline, presentCatcherRunning, runPresentCatcherStep]);

  const requestPresentCatcherInventory = useCallback(async () => {
    await runRuntimeAction({ kind: "requestInventory" });
    await refreshRuntimeSnapshot(["core", "inventory"]).catch(() => null);
  }, [refreshRuntimeSnapshot, runRuntimeAction]);

  const placeSelectedPresentGift = useCallback(async () => {
    const item = selectedPresentGiftRow;
    const token = compactValue(item?.itemId ?? item?.rowId).trim();
    if (!item || !token || token === "-") {
      const message = "Select an inventory gift token first.";
      setPresentCatcherMessage(message);
      appendTimeline("warning", message);
      return;
    }
    try {
      const selfTile = userTile(selfUser);
      const x = cleanInteger(presentPlaceX, selfTile ? selfTile.x + 1 : 0);
      const y = cleanInteger(presentPlaceY, selfTile ? selfTile.y : 0);
      const direction = cleanInteger(presentPlaceDirection, 2);
      setPresentPlaceX(String(x));
      setPresentPlaceY(String(y));
      setPresentPlaceDirection(String(direction));
      const bodyBytes = [...latin1ByteArray(token), ...shockwaveVl64ByteArray(x), ...shockwaveVl64ByteArray(y), ...shockwaveVl64ByteArray(direction)];
      const result = await sendPresentCatcherPacket({ header: 90, bodyBytes }, `Place gift ${token}`);
      const decodedId = decodeShockwaveVl64Text(token);
      const fallbackId = finiteNumber(item.objectId ?? item.slotId ?? item.itemId);
      const openId = decodedId !== null ? Math.abs(decodedId) : fallbackId !== null ? Math.trunc(Math.abs(fallbackId)) : null;
      if (result.ok && openId) setPresentOpenObjectId(String(openId));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPresentCatcherMessage(message);
      appendTimeline("warning", `Present gift place: ${message}`);
    }
  }, [
    appendTimeline,
    presentPlaceDirection,
    presentPlaceX,
    presentPlaceY,
    selectedPresentGiftRow,
    selfUser,
    sendPresentCatcherPacket,
  ]);

  const openPresentObject = useCallback(async () => {
    const objectId = cleanPositiveInt(presentOpenObjectId, 0);
    if (!objectId) {
      const message = "Enter a placed present object id first.";
      setPresentCatcherMessage(message);
      appendTimeline("warning", message);
      return;
    }
    await sendPresentCatcherPacket({ header: 78, bodyText: String(objectId) }, `Open present ${objectId}`);
  }, [appendTimeline, presentOpenObjectId, sendPresentCatcherPacket]);

  const sendPresentFragmentPacket = useCallback(
    async (kind: "request" | "backpack" | "trade" | "add" | "accept" | "cancel") => {
      const eventName = presentFragmentEvent.trim() || "second_anniversary";
      if (kind === "request") {
        await sendPresentCatcherPacket({ header: 3400, bodyBytes: shockwaveOutgoingStringByteArray(eventName) }, `Request fragments ${eventName}`);
        return;
      }
      if (kind === "backpack") {
        await sendPresentCatcherPacket({ header: 1240 }, "Request backpack");
        return;
      }
      if (kind === "trade") {
        const target = presentFragmentTradeTarget.trim();
        if (!target) {
          setPresentCatcherMessage("Enter a receiver room index before opening a fragment trade.");
          return;
        }
        await sendPresentCatcherPacket(
          { header: 3403, bodyBytes: [...shockwaveOutgoingStringByteArray(eventName), ...shockwaveOutgoingStringByteArray(target)] },
          `Trade fragments with ${target}`,
        );
        return;
      }
      if (kind === "add") {
        const slotId = cleanPositiveInt(presentFragmentSlotId, 0);
        if (!slotId) {
          setPresentCatcherMessage("Enter a fragment slot id before adding a fragment.");
          return;
        }
        await sendPresentCatcherPacket({ header: 3404, bodyBytes: shockwaveVl64ByteArray(slotId) }, `Add fragment slot ${slotId}`);
        return;
      }
      if (kind === "accept") {
        await sendPresentCatcherPacket({ header: 3402, bodyBytes: shockwaveVl64ByteArray(1) }, "Accept fragment trade");
        return;
      }
      await sendPresentCatcherPacket({ header: 3401 }, "Cancel fragment trade");
    },
    [presentFragmentEvent, presentFragmentSlotId, presentFragmentTradeTarget, sendPresentCatcherPacket],
  );

  const sendUserAction = useCallback(
    async (action: UserRelayAction, label: string, clientId?: number) => {
      if (!window.habbpyV4) {
        const message = "Run the Electron shell before sending User packets.";
        setRuntimeMessage(message);
        return;
      }
      setRuntimeBusy(true);
      try {
        const targetClientId = clientId ?? selectedClientId;
        const result = await window.habbpyV4.sendUserRelayAction(action, targetClientId);
        setRuntimeMessage(result.message);
        appendTimeline(result.ok ? "success" : "warning", `${label}: ${result.message}`);
        await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      } finally {
        setRuntimeBusy(false);
      }
    },
    [appendTimeline, refreshRelayLog, refreshRuntimeSnapshot, selectedClientId],
  );

  const sendSocialAction = useCallback(
    async (action: SocialRelayAction, label: string, clientId?: number) => {
      if (!window.habbpyV4) {
        const message = "Run the Electron shell before sending Social packets.";
        setSocialMessage(message);
        appendTimeline("warning", message);
        return { ok: false, message };
      }
      const targetClientId = clientId ?? selectedClientId;
      const result = await window.habbpyV4.sendSocialRelayAction(action, targetClientId);
      setSocialMessage(result.message);
      appendTimeline(result.ok ? "success" : "warning", `${label}: ${result.message}`);
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    },
    [appendTimeline, refreshRelayLog, refreshRuntimeSnapshot, selectedClientId],
  );

  const sendWallMoverAction = useCallback(
    async (action: WallMoverRelayAction, label: string, clientId?: number) => {
      if (!window.habbpyV4) {
        const message = "Run the Electron shell before sending Wall Mover packets.";
        setWallMoverMessage(message);
        appendTimeline("warning", message);
        return { ok: false, message };
      }
      const targetClientId = clientId ?? selectedClientId;
      const result = await window.habbpyV4.sendWallMoverRelayAction(action, targetClientId);
      setWallMoverMessage(result.message);
      appendTimeline(result.ok ? "success" : "warning", `${label}: ${result.message}`);
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    },
    [appendTimeline, refreshRelayLog, refreshRuntimeSnapshot, selectedClientId],
  );

  const sendWallMoverMove = useCallback(
    async (dx: number, dy: number, orientationOverride?: "l" | "r") => {
      const row = selectedWallMoverRow;
      const itemId = objectNumericId(row?.item);
      const location = wallMoverLocation(row?.item);
      const step = Math.max(1, Math.min(50, Math.trunc(Number.parseInt(wallMoverStep, 10) || 1)));
      setWallMoverStep(String(step));
      if (!row || itemId === null || !location) {
        const message = "Select a wall item with parsed wall/local coordinates first.";
        setWallMoverMessage(message);
        appendTimeline("warning", message);
        return;
      }
      const orientation = orientationOverride ?? location.orientation;
      const action: WallMoverRelayAction = {
        action: "moveItem",
        itemId,
        wallX: location.wallX,
        wallY: location.wallY,
        localX: location.localX + dx * step,
        localY: location.localY + dy * step,
        orientation,
        className: compactValue(row.item.className ?? row.item.name),
      };
      await sendWallMoverAction(action, `Wall move item ${itemId}`);
    },
    [appendTimeline, selectedWallMoverRow, sendWallMoverAction, wallMoverStep],
  );

  const sendWallMoverPickup = useCallback(async () => {
    const row = selectedWallMoverRow;
    const itemId = objectNumericId(row?.item);
    if (!row || itemId === null) {
      const message = "Select a wall item before pickup.";
      setWallMoverMessage(message);
      appendTimeline("warning", message);
      return;
    }
    await sendWallMoverAction(
      {
        action: "pickup",
        itemId,
        className: compactValue(row.item.className ?? row.item.name),
      },
      `Wall pickup item ${itemId}`,
    );
  }, [appendTimeline, selectedWallMoverRow, sendWallMoverAction]);

  const startGardeningJobForRow = useCallback(
    async (row: ItemRow, queue: readonly string[], mode: "cycle" | "compost", completed: number) => {
      const objectId = objectNumericId(row.item);
      const tile = itemRowTile(row);
      const working = workingTileNearSelf(selfUser, row, itemRows, userRows);
      if (objectId === null || !tile || !working) {
        setGardeningJob({
          plantKey: row.key,
          objectId: objectId ?? -1,
          originalX: tile?.x ?? 0,
          originalY: tile?.y ?? 0,
          originalDirection: tile?.direction ?? 0,
          workingX: working?.x ?? 0,
          workingY: working?.y ?? 0,
          phase: "failed",
          mode,
          queue,
          sentAt: Date.now(),
          moveAttempts: 0,
          actionAttempts: 0,
          completed,
          note: "Plant id, current tile, or avatar tile is missing from room data.",
          baselineState: compactValue(row.item.state),
        });
        return;
      }
      const sent = await sendGardeningAction(
        { action: "move", objectId, x: working.x, y: working.y, direction: tile.direction },
        `Move plant ${objectId}`,
      );
      setGardeningJob({
        plantKey: row.key,
        objectId,
        originalX: tile.x,
        originalY: tile.y,
        originalDirection: tile.direction,
        workingX: working.x,
        workingY: working.y,
        phase: sent.ok ? "move_out" : "failed",
        mode,
        queue,
        sentAt: Date.now(),
        moveAttempts: 1,
        actionAttempts: 0,
        completed,
        note: sent.ok ? `Moving ${objectId} to ${working.x},${working.y}.` : sent.message,
        baselineState: compactValue(row.item.state),
      });
      setGardeningRunning(sent.ok);
    },
    [itemRows, selfUser, sendGardeningAction, userRows],
  );

  const startGardening = useCallback(
    async (mode: "cycle" | "compost") => {
      if (!roomReady) {
        setGardeningMessage("Enter Codex Test Lab before starting Gardening.");
        return;
      }
      const ordered = selectedPlantRow ? [selectedPlantRow, ...plantRows.filter((row) => row.key !== selectedPlantRow.key)] : plantRows;
      const first = ordered[0];
      if (!first) {
        setGardeningMessage("No plant-like room objects are available.");
        return;
      }
      setGardeningRunning(true);
      const cycleSec = Math.max(30, Math.trunc(finiteNumber(gardeningCycleSec) ?? 600));
      setGardeningCycleSec(String(cycleSec));
      setGardeningMessage(`${mode === "compost" ? "Compost All" : "Gardening"} started for ${ordered.length} plant(s).`);
      await startGardeningJobForRow(first, ordered.slice(1).map((row) => row.key), mode, 0);
    },
    [gardeningCycleSec, plantRows, roomReady, selectedPlantRow, startGardeningJobForRow],
  );

  const stopGardening = useCallback(() => {
    setGardeningRunning(false);
    setGardeningJob((current) => (current ? { ...current, phase: "idle", note: "Stopped by user." } : null));
    setGardeningMessage("Gardening stopped.");
  }, []);

  useEffect(() => {
    if (!gardeningRunning || !gardeningJob || gardeningJob.phase === "idle" || gardeningJob.phase === "failed") return;
    const timeout = window.setTimeout(() => {
      void (async () => {
        const now = Date.now();
        const elapsed = now - gardeningJob.sentAt;
        const currentRow = findCurrentPlantRow(plantRows, gardeningJob.objectId);
        const currentTile = itemRowTile(currentRow);
        const currentState = compactValue(currentRow?.item.state);
        const atWorking = currentTile?.x === gardeningJob.workingX && currentTile?.y === gardeningJob.workingY;
        const atOriginal = currentTile?.x === gardeningJob.originalX && currentTile?.y === gardeningJob.originalY;

        if (!currentRow || !currentTile) {
          setGardeningJob((current) => current && current.objectId === gardeningJob.objectId ? { ...current, phase: "failed", note: "Plant disappeared from room objects." } : current);
          setGardeningRunning(false);
          return;
        }

        if (gardeningJob.phase === "move_out") {
          if (atWorking && elapsed >= 350) {
            const nextAction = gardeningJob.mode === "compost" ? "compost" : "water";
            const sent = await sendGardeningAction({ action: nextAction, objectId: gardeningJob.objectId }, `${nextAction} plant ${gardeningJob.objectId}`);
            setGardeningJob((current) =>
              current && current.objectId === gardeningJob.objectId
                ? {
                    ...current,
                    phase: sent.ok ? nextAction : "failed",
                    sentAt: Date.now(),
                    actionAttempts: 1,
                    baselineState: currentState,
                    note: sent.ok ? `${nextAction} sent for ${gardeningJob.objectId}.` : sent.message,
                  }
                : current,
            );
            if (!sent.ok) setGardeningRunning(false);
            return;
          }
          if (elapsed >= 3000) {
            if (gardeningJob.moveAttempts >= 3) {
              setGardeningJob((current) => current && current.objectId === gardeningJob.objectId ? { ...current, phase: "failed", note: "Move out failed after 3 attempts." } : current);
              setGardeningRunning(false);
              return;
            }
            const sent = await sendGardeningAction(
              { action: "move", objectId: gardeningJob.objectId, x: gardeningJob.workingX, y: gardeningJob.workingY, direction: gardeningJob.originalDirection },
              `Retry move plant ${gardeningJob.objectId}`,
            );
            setGardeningJob((current) =>
              current && current.objectId === gardeningJob.objectId
                ? { ...current, sentAt: Date.now(), moveAttempts: current.moveAttempts + 1, note: sent.message }
                : current,
            );
          }
          return;
        }

        if (gardeningJob.phase === "compost" || gardeningJob.phase === "water" || gardeningJob.phase === "harvest") {
          const changed = currentState !== gardeningJob.baselineState;
          const actionTimeout = gardeningJob.phase === "compost" ? 2000 : 2500;
          const shouldProceed =
            changed ||
            (gardeningJob.phase === "compost" && elapsed >= actionTimeout) ||
            (gardeningJob.phase === "water" && elapsed >= actionTimeout && gardeningJob.actionAttempts >= 2) ||
            (gardeningJob.phase === "harvest" && elapsed >= actionTimeout && gardeningJob.actionAttempts >= 2);

          if (gardeningJob.phase === "water" && (changed || elapsed >= actionTimeout)) {
            if (!changed && gardeningJob.actionAttempts < 2) {
              const sent = await sendGardeningAction({ action: "water", objectId: gardeningJob.objectId }, `Retry water plant ${gardeningJob.objectId}`);
              setGardeningJob((current) =>
                current && current.objectId === gardeningJob.objectId
                  ? { ...current, sentAt: Date.now(), actionAttempts: current.actionAttempts + 1, note: sent.message }
                  : current,
              );
              return;
            }
            const sent = await sendGardeningAction({ action: "harvest", objectId: gardeningJob.objectId }, `Harvest plant ${gardeningJob.objectId}`);
            setGardeningJob((current) =>
              current && current.objectId === gardeningJob.objectId
                ? {
                    ...current,
                    phase: sent.ok ? "harvest" : "failed",
                    sentAt: Date.now(),
                    actionAttempts: 1,
                    baselineState: currentState,
                    note: sent.ok ? `Harvest sent for ${gardeningJob.objectId}.` : sent.message,
                  }
                : current,
            );
            if (!sent.ok) setGardeningRunning(false);
            return;
          }

          if (shouldProceed) {
            const sent = await sendGardeningAction(
              {
                action: "move",
                objectId: gardeningJob.objectId,
                x: gardeningJob.originalX,
                y: gardeningJob.originalY,
                direction: gardeningJob.originalDirection,
              },
              `Return plant ${gardeningJob.objectId}`,
            );
            setGardeningJob((current) =>
              current && current.objectId === gardeningJob.objectId
                ? {
                    ...current,
                    phase: sent.ok ? "return" : "failed",
                    sentAt: Date.now(),
                    moveAttempts: 1,
                    note: sent.ok ? `Returning ${gardeningJob.objectId} to ${gardeningJob.originalX},${gardeningJob.originalY}.` : sent.message,
                  }
                : current,
            );
            if (!sent.ok) setGardeningRunning(false);
          } else if (elapsed >= actionTimeout && gardeningJob.actionAttempts < 2) {
            const sent = await sendGardeningAction(
              { action: gardeningJob.phase, objectId: gardeningJob.objectId },
              `Retry ${gardeningJob.phase} plant ${gardeningJob.objectId}`,
            );
            setGardeningJob((current) =>
              current && current.objectId === gardeningJob.objectId
                ? { ...current, sentAt: Date.now(), actionAttempts: current.actionAttempts + 1, note: sent.message }
                : current,
            );
          }
          return;
        }

        if (gardeningJob.phase === "return") {
          if (atOriginal) {
            const nextKey = gardeningJob.queue[0];
            const nextRow = nextKey ? plantRows.find((row) => row.key === nextKey) : null;
            if (nextRow) {
              await startGardeningJobForRow(nextRow, gardeningJob.queue.slice(1), gardeningJob.mode, gardeningJob.completed + 1);
            } else {
              setGardeningJob((current) =>
                current && current.objectId === gardeningJob.objectId
                  ? { ...current, phase: "complete", completed: current.completed + 1, note: "Cycle complete; all queued plants returned." }
                  : current,
              );
              setGardeningRunning(false);
              setGardeningMessage(`Gardening cycle complete. Completed ${gardeningJob.completed + 1} plant(s).`);
            }
            return;
          }
          if (elapsed >= 3000) {
            if (gardeningJob.moveAttempts >= 3) {
              setGardeningJob((current) => current && current.objectId === gardeningJob.objectId ? { ...current, phase: "failed", note: "Return failed after 3 attempts." } : current);
              setGardeningRunning(false);
              return;
            }
            const sent = await sendGardeningAction(
              {
                action: "move",
                objectId: gardeningJob.objectId,
                x: gardeningJob.originalX,
                y: gardeningJob.originalY,
                direction: gardeningJob.originalDirection,
              },
              `Retry return plant ${gardeningJob.objectId}`,
            );
            setGardeningJob((current) =>
              current && current.objectId === gardeningJob.objectId
                ? { ...current, sentAt: Date.now(), moveAttempts: current.moveAttempts + 1, note: sent.message }
                : current,
            );
          }
        }
      })();
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [gardeningJob, gardeningRunning, plantRows, sendGardeningAction, startGardeningJobForRow]);

  const appendPacketConsole = useCallback((kind: PacketConsoleEntry["kind"], text: string) => {
    setPacketConsoleEntries((current) => {
      const next = [
        ...current,
        {
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          time: new Date().toLocaleTimeString(),
          kind,
          text,
        },
      ];
      return next.length > 200 ? next.slice(-200) : next;
    });
  }, []);

  const executeConsoleRendererActions = useCallback(
    async (actions: readonly ConsoleRendererAction[], output: (kind: PacketConsoleEntry["kind"], text: string) => void = appendPacketConsole) => {
      if (actions.length === 0) return;
      setRuntimeBusy(true);
      try {
        for (const action of actions) {
          if (action.kind === "enterPrivateRoom") {
            const webview = await waitForVisibleClientWebview(action.clientId);
            if (!webview) {
              output("warning", `client${action.clientId}: visible runtime did not mount for room entry.`);
              continue;
            }
            const result = await runEngineRuntimeAction(webview, {
              kind: "enterPrivateRoom",
              flatId: action.flatId,
              waitUntilReady: action.reason !== "summon",
              timeoutMs: action.reason === "summon" ? 15000 : undefined,
            });
            output(result.ok ? "success" : "warning", `client${action.clientId}: ${result.message}`);
            if (result.ok) {
              const snapshot = await readEngineRuntimeSnapshot(webview, ["core", "room"]).catch(() => null);
              if (snapshot && action.clientId === selectedClientIdRef.current) applyRuntimeSnapshot(snapshot);
            }
            await refreshSelectedClientSnapshot(action.clientId, { updateSelectedSnapshot: action.clientId === selectedClientIdRef.current }).catch(() => null);
            await refreshClientSessions().catch(() => null);
          }
        }
      } finally {
        setRuntimeBusy(false);
      }
    },
    [
      appendPacketConsole,
      applyRuntimeSnapshot,
      refreshClientSessions,
      refreshSelectedClientSnapshot,
      waitForVisibleClientWebview,
    ],
  );

  const runMultiAccountCommand = useCallback(
    async (input: string): Promise<void> => {
      if (!window.habbpyV4?.runConsoleCommand) {
        setMultiAccountMessage("Desktop bridge is not available.");
        return;
      }
      const busInput = withVisibleConsoleContext(input, selectedClientIsVisible ? selectedRuntimeSnapshot : null, visibleActiveAccountNames);
      const result = await window.habbpyV4.runConsoleCommand(busInput);
      const actionCount = result.rendererActions?.length ?? 0;
      const message = [result.lines.join("\n"), actionCount > 0 ? `${actionCount} visible runtime action(s) queued.` : ""].filter(Boolean).join("\n");
      setMultiAccountMessage(message);
      appendTimeline(result.ok ? "success" : "warning", message || redactConsoleCommandInput(input));
      await refreshConsoleCommandState().catch(() => null);
      const sessions = await refreshClientSessions().catch(() => null);
      await refreshMimicState().catch(() => null);
      const nextSelectedClientId = sessions?.selectedClientId ?? clientSessions?.selectedClientId;
      await refreshSelectedClientSnapshot(nextSelectedClientId).catch(() => null);
      if (actionCount > 0) {
        await executeConsoleRendererActions(result.rendererActions ?? [], (kind, text) => {
          appendTimeline(kind === "success" ? "success" : kind === "error" ? "error" : "warning", text);
          setMultiAccountMessage((current) => `${current}\n${text}`.trim());
        });
      }
      if (commandRefreshesEngineLaunch(result.command?.command ?? "", result.command?.args[0] ?? "")) {
        const launch = await window.habbpyV4.getEngineLaunchState().catch(() => null);
        if (launch) applyEngineLaunch(launch);
      }
    },
    [
      appendTimeline,
      applyEngineLaunch,
      clientSessions?.selectedClientId,
      executeConsoleRendererActions,
      refreshClientSessions,
      refreshConsoleCommandState,
      refreshMimicState,
      refreshSelectedClientSnapshot,
      selectedClientIsVisible,
      selectedRuntimeSnapshot,
      visibleActiveAccountNames,
    ],
  );

  const addManualVisibleClient = useCallback(async () => {
    openMultiAccountPanel();
    await runMultiAccountCommand("newclient");
  }, [openMultiAccountPanel, runMultiAccountCommand]);

  const consoleBindingMap = useMemo(
    () => new globalThis.Map((consoleCommandState?.bindings ?? []).map((binding) => [binding.key, binding.command] as const)),
    [consoleCommandState?.bindings],
  );

  useEffect(() => {
    if (consoleBindingMap.size === 0 || !window.habbpyV4?.runConsoleBinding) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (isTextEntryTarget(event.target)) return;
      const key = bindingKeyFromKeyboardEvent(event);
      if (!key || key === "Backquote") return;
      const boundCommand = consoleBindingMap.get(key);
      if (!boundCommand) return;
      event.preventDefault();
      setPacketConsoleOpen(true);
      appendPacketConsole("command", `[${key}] ${redactConsoleCommandInput(boundCommand)}`);
      void (async () => {
        const result = await window.habbpyV4?.runConsoleBinding?.(key);
        if (!result) return;
        for (const line of result.lines) appendPacketConsole(result.level, line);
        await refreshConsoleCommandState().catch(() => null);
        await refreshClientSessions().catch(() => null);
        await refreshSelectedClientSnapshot(result.targetClientIds?.[0] ?? clientSessions?.selectedClientId).catch(() => null);
        if ((result.rendererActions?.length ?? 0) > 0) {
          await executeConsoleRendererActions(result.rendererActions ?? []);
        }
        if (commandRefreshesEngineLaunch(result.command?.command ?? "", result.command?.args[0] ?? "")) {
          const launch = await window.habbpyV4?.getEngineLaunchState().catch(() => null);
          if (launch) applyEngineLaunch(launch);
        }
      })();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    appendPacketConsole,
    applyEngineLaunch,
    clientSessions?.selectedClientId,
    consoleBindingMap,
    executeConsoleRendererActions,
    refreshClientSessions,
    refreshConsoleCommandState,
    refreshSelectedClientSnapshot,
  ]);

  const runConsoleRuntimeAction = useCallback(
    async (action: EngineRuntimeAction): Promise<EngineRuntimeActionResult> => {
      const webview = webviewRef.current;
      if (!webview || !engineUrl) return { ok: false, message: "Start the embedded client first." };
      setRuntimeBusy(true);
      try {
        const result = await runEngineRuntimeAction(webview, action);
        setRuntimeMessage(result.message);
        appendTimeline(result.ok ? "success" : "warning", result.message);
        await refreshRuntimeSnapshot();
        return result;
      } finally {
        setRuntimeBusy(false);
      }
    },
    [appendTimeline, engineUrl, refreshRuntimeSnapshot, selectedClientId],
  );

  useEffect(() => {
    if (disabledRuntimeManagedClientRights.length === 0) return;
    if (!engineUrl || !selectedRuntimeSnapshot?.userState) return;
    const rights = matchingClientRights(selectedRuntimeSnapshot.userState.rights, disabledRuntimeManagedClientRights);
    if (rights.length === 0) return;
    if (managedRuntimeCleanupInFlightRef.current) return;
    managedRuntimeCleanupInFlightRef.current = true;
    void runConsoleRuntimeAction({
      kind: "clientRights",
      mode: "remove",
      rights,
    }).then((result) => {
      if (!result.ok) return;
      for (const plugin of availablePlugins) {
        if (pluginEnabledById[plugin.id] !== false) continue;
        removeClientRightOwners(pluginClientRightsOwnersRef.current, selectedClientId, plugin.id, rights);
      }
    }).finally(() => {
      managedRuntimeCleanupInFlightRef.current = false;
    });
  }, [availablePlugins, disabledRuntimeManagedClientRights, engineUrl, pluginEnabledById, runConsoleRuntimeAction, selectedClientId, selectedRuntimeSnapshot?.userState]);

  userPluginLogHandlerRef.current = (plugin, level, message) => {
    const severity = level === "error" ? "error" : level === "warning" ? "warning" : "info";
    appendTimeline(severity, `${plugin.name}: ${message}`);
  };

  userPluginRequestHandlerRef.current = async (plugin, request) => {
    const args = request.args && typeof request.args === "object" ? (request.args as Record<string, unknown>) : {};
    const pluginEnabled = pluginEnabledById[plugin.id] !== false;
    if (!pluginEnabled) assertDisabledPluginCleanupRequest(plugin, request.api, args);
    const fullSnapshotForClient = async (clientId: number): Promise<EngineRuntimeSnapshot | null> => {
      if (clientId === selectedClientIdRef.current) return selectedRuntimeSnapshotRef.current;
      return null;
    };
    const runtimeSummaryForClient = async (clientId: number): Promise<ClientRuntimeSummary | null> => {
      const cached = clientPluginSnapshotsById.get(clientId)?.runtimeSummary;
      if (cached) return cached;
      const snapshot = await window.habbpyV4?.getClientSnapshot(clientId);
      return snapshot?.runtime ?? null;
    };
    if (request.api === "storage.get") {
      requirePluginPermission(plugin, ["storage"]);
      const raw = localStorage.getItem(pluginStorageKey(plugin.id, args.key));
      if (raw === null) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    }
    if (request.api === "storage.set") {
      requirePluginPermission(plugin, ["storage"]);
      localStorage.setItem(pluginStorageKey(plugin.id, args.key), JSON.stringify(args.value ?? null));
      return true;
    }
    if (request.api === "storage.delete") {
      requirePluginPermission(plugin, ["storage"]);
      localStorage.removeItem(pluginStorageKey(plugin.id, args.key));
      return true;
    }
    if (request.api === "engine.getSnapshot") {
      requirePluginPermission(plugin, ["engine.snapshot"]);
      const requestedClientId = requestedPluginClientId(args, selectedClientIdRef.current);
      if (requestedClientId === selectedClientIdRef.current) return selectedRuntimeSnapshotRef.current;
      const snapshot = await window.habbpyV4?.getClientSnapshot(requestedClientId);
      return snapshot?.runtime ?? null;
    }
    if (request.api === "session.getClients") {
      requirePluginPermission(plugin, ["events.session"]);
      return {
        selectedClientId: clientSessionsRef.current?.selectedClientId ?? selectedClientIdRef.current,
        mainClientId: clientSessionsRef.current?.mainClientId ?? 1,
        clients: clientSessionsRef.current?.sessions ?? [],
      };
    }
    if (
      request.api === "client.getRights" ||
      request.api === "client.setRights" ||
      request.api === "client.grantRights" ||
      request.api === "client.removeRights" ||
      request.api === "client.enableChooserCommands"
    ) {
      requirePluginPermission(plugin, ["client.rights"]);
      const targetClientId = requestedPluginClientId(args, selectedClientIdRef.current);
      if (targetClientId !== selectedClientIdRef.current) {
        throw new Error("Client rights APIs currently target the selected visible runtime.");
      }
      const mode: "get" | "set" | "grant" | "remove" =
        request.api === "client.getRights" ? "get" :
        request.api === "client.setRights" ? "set" :
        request.api === "client.removeRights" ? "remove" :
        "grant";
      const rights = request.api === "client.enableChooserCommands"
        ? ["fuse_habbo_chooser", "fuse_furni_chooser"]
        : cleanPluginRightsList(args.rights);
      if (mode !== "get" && rights.length === 0) {
        throw new Error(`${request.api} requires at least one right.`);
      }
      const result = await runConsoleRuntimeAction({ kind: "clientRights", mode, rights });
      if (!result.ok) throw new Error(result.message);
      updateClientRightOwners(pluginClientRightsOwnersRef.current, plugin, targetClientId, mode, rights, result);
      if (mode !== "get") await refreshRuntimeSnapshot().catch(() => null);
      return result;
    }
    if (request.api === "chat.send") {
      requirePluginPermission(plugin, ["chat.send"]);
      const message = String(args.message ?? "").trim();
      if (!message) throw new Error("chat.send requires a non-empty message.");
      if (message.length > 240) throw new Error("chat.send messages are limited to 240 characters.");
      const targetClientId = requestedPluginClientId(args, selectedClientIdRef.current);
      if (targetClientId !== selectedClientIdRef.current) {
        throw new Error("chat.send can only target the selected visible client until validated relay chat packets are enabled.");
      }
      const result = await runConsoleRuntimeAction({ kind: "sendChat", message });
      if (!result.ok) throw new Error(result.message);
      return result;
    }
    if (request.api === "stage.click") {
      requirePluginPermission(plugin, ["engine.control"]);
      const targetClientId = requestedPluginClientId(args, selectedClientIdRef.current);
      if (targetClientId !== selectedClientIdRef.current) {
        throw new Error("Stage clicks can only target the selected visible client.");
      }
      const result = await runConsoleRuntimeAction({
        kind: "stageClick",
        x: cleanInteger(args.x, 0),
        y: cleanInteger(args.y, 0),
      });
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "avatar.walkTo") {
      requirePluginPermission(plugin, ["actions.avatar"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for avatar movement.");
      const options = args.options && typeof args.options === "object" ? (args.options as Record<string, unknown>) : {};
      const result = await window.habbpyV4.sendRoomRelayAction(
        {
          action: "move",
          x: cleanInteger(args.x, 0),
          y: cleanInteger(args.y, 0),
          furniId: cleanInteger(args.furniId ?? options.furniId, 0),
        },
        requestedPluginClientId(args, selectedClientIdRef.current),
      );
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "avatar.walkToItem") {
      requirePluginPermission(plugin, ["actions.avatar"]);
      requirePluginPermission(plugin, ["engine.snapshot"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for avatar movement.");
      const target = pluginWalkTargetFromSnapshot(selectedRuntimeSnapshotRef.current, args.selector, furniMetadata);
      if (!target) throw new Error("avatar.walkToItem could not resolve a floor item by id, name, class, or search text.");
      const options = args.options && typeof args.options === "object" ? (args.options as Record<string, unknown>) : {};
      const furniId = options.useFurniId === false ? 0 : cleanInteger(options.furniId ?? args.furniId, target.furniId);
      const result = await window.habbpyV4.sendRoomRelayAction(
        { action: "move", x: target.x, y: target.y, furniId },
        requestedPluginClientId(args, selectedClientIdRef.current),
      );
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return { ...result, target };
    }
    if (request.api === "rooms.enterPrivateRoom") {
      requirePluginPermission(plugin, ["engine.control"]);
      const targetClientId = requestedPluginClientId(args, selectedClientIdRef.current);
      if (targetClientId !== selectedClientIdRef.current) {
        throw new Error("Private room entry through plugin engine control can only target the selected visible client.");
      }
      const flatId = String(args.flatId ?? "").trim();
      const result = await runConsoleRuntimeAction({ kind: "enterPrivateRoom", flatId: flatId || undefined, waitUntilReady: true });
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "rooms.enterPublicRoom") {
      requirePluginPermission(plugin, ["engine.control"]);
      const targetClientId = requestedPluginClientId(args, selectedClientIdRef.current);
      if (targetClientId !== selectedClientIdRef.current) {
        throw new Error("Public room entry through plugin engine control can only target the selected visible client.");
      }
      const result = await runConsoleRuntimeAction({ kind: "enterPublicRoom", query: String(args.query ?? "").trim() || undefined });
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "navigator.open") {
      requirePluginPermission(plugin, ["engine.control"]);
      const targetClientId = requestedPluginClientId(args, selectedClientIdRef.current);
      if (targetClientId !== selectedClientIdRef.current) {
        throw new Error("Navigator control can only target the selected visible client.");
      }
      const result = await runConsoleRuntimeAction({ kind: "openNavigator", view: String(args.view ?? "nav_pr") });
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "windows.clickElement") {
      requirePluginPermission(plugin, ["engine.control"]);
      const targetClientId = requestedPluginClientId(args, selectedClientIdRef.current);
      if (targetClientId !== selectedClientIdRef.current) {
        throw new Error("Window element clicks can only target the selected visible client.");
      }
      const windowId = String(args.windowId ?? "").trim();
      const elementId = String(args.elementId ?? "").trim();
      if (!windowId || !elementId) throw new Error("windows.clickElement requires windowId and elementId.");
      const result = await runConsoleRuntimeAction({ kind: "clickWindowElement", windowId, elementId });
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "avatar.wave") {
      requirePluginPermission(plugin, ["actions.avatar"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for user action.");
      const result = await window.habbpyV4.sendUserRelayAction({ action: "wave" }, requestedPluginClientId(args, selectedClientIdRef.current));
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "avatar.dance") {
      requirePluginPermission(plugin, ["actions.avatar"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for user action.");
      const result = await window.habbpyV4.sendUserRelayAction({ action: "dance", number: cleanPositiveInt(args.number, 1) }, requestedPluginClientId(args, selectedClientIdRef.current));
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "avatar.stopDance") {
      requirePluginPermission(plugin, ["actions.avatar"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for user action.");
      const result = await window.habbpyV4.sendUserRelayAction({ action: "stopDance" }, requestedPluginClientId(args, selectedClientIdRef.current));
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "avatar.hcDance") {
      requirePluginPermission(plugin, ["actions.avatar"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for user action.");
      const result = await window.habbpyV4.sendUserRelayAction({ action: "hcdance", number: cleanPositiveInt(args.number, 1) }, requestedPluginClientId(args, selectedClientIdRef.current));
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "avatar.carryDrink") {
      requirePluginPermission(plugin, ["actions.avatar"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for user action.");
      const result = await window.habbpyV4.sendUserRelayAction({ action: "carryDrink" }, requestedPluginClientId(args, selectedClientIdRef.current));
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "avatar.applyLook") {
      requirePluginPermission(plugin, ["actions.avatar"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for user action.");
      const figure = String(args.figure ?? "").trim();
      if (!figure) throw new Error("avatar.applyLook requires a figure string.");
      const result = await window.habbpyV4.sendUserRelayAction({ action: "applyLook", figure }, requestedPluginClientId(args, selectedClientIdRef.current));
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "social.message") {
      requirePluginPermission(plugin, ["actions.social"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for social message.");
      const result = await window.habbpyV4.sendSocialRelayAction(
        { action: "message", accountId: cleanPositiveInt(args.accountId, 0), message: String(args.message ?? ""), recipient: String(args.options && typeof args.options === "object" ? (args.options as Record<string, unknown>).recipient ?? "" : "") },
        requestedPluginClientId(args, selectedClientIdRef.current),
      );
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "social.addUser") {
      requirePluginPermission(plugin, ["actions.social"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for friend request.");
      const result = await window.habbpyV4.sendSocialRelayAction({ action: "addUser", name: String(args.name ?? "") }, requestedPluginClientId(args, selectedClientIdRef.current));
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "social.refreshRequests") {
      requirePluginPermission(plugin, ["actions.social"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for friend requests.");
      const result = await window.habbpyV4.sendSocialRelayAction({ action: "refreshFriendRequests" }, requestedPluginClientId(args, selectedClientIdRef.current));
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "social.acceptRequest" || request.api === "social.declineRequest" || request.api === "social.removeFriend" || request.api === "social.followFriend") {
      requirePluginPermission(plugin, ["actions.social"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for social action.");
      const accountId = cleanPositiveInt(args.accountId, 0);
      const socialAction: SocialRelayAction =
        request.api === "social.acceptRequest" ? { action: "acceptRequest", accountId } :
        request.api === "social.declineRequest" ? { action: "declineRequest", accountId } :
        request.api === "social.removeFriend" ? { action: "removeFriend", accountId } :
        { action: "followFriend", accountId };
      const result = await window.habbpyV4.sendSocialRelayAction(socialAction, requestedPluginClientId(args, selectedClientIdRef.current));
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "plants.movePlant") {
      requirePluginPermission(plugin, ["actions.plants"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for plant movement.");
      const result = await window.habbpyV4.sendGardeningRelayAction(
        { action: "move", objectId: cleanPositiveInt(args.objectId, 0), x: cleanInteger(args.x, 0), y: cleanInteger(args.y, 0), direction: cleanInteger(args.direction, 0) },
        requestedPluginClientId(args, selectedClientIdRef.current),
      );
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "plants.waterPlant" || request.api === "plants.harvestPlant" || request.api === "plants.compostPlant") {
      requirePluginPermission(plugin, ["actions.plants"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for plant action.");
      const action = request.api === "plants.waterPlant" ? "water" : request.api === "plants.harvestPlant" ? "harvest" : "compost";
      const result = await window.habbpyV4.sendGardeningRelayAction({ action, objectId: cleanPositiveInt(args.objectId, 0) }, requestedPluginClientId(args, selectedClientIdRef.current));
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "wallItems.moveItem") {
      requirePluginPermission(plugin, ["actions.wallItems"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for wall item movement.");
      const item = args.item && typeof args.item === "object" ? args.item as Record<string, unknown> : {};
      const result = await window.habbpyV4.sendWallMoverRelayAction(
        {
          action: "moveItem",
          itemId: cleanPositiveInt(item.itemId, 0),
          wallX: cleanInteger(item.wallX, 0),
          wallY: cleanInteger(item.wallY, 0),
          localX: cleanInteger(item.localX, 0),
          localY: cleanInteger(item.localY, 0),
          orientation: item.orientation === "r" ? "r" : "l",
          className: typeof item.className === "string" ? item.className : undefined,
        },
        requestedPluginClientId(args, selectedClientIdRef.current),
      );
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "wallItems.pickupItem") {
      requirePluginPermission(plugin, ["actions.wallItems"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for wall item pickup.");
      const result = await window.habbpyV4.sendWallMoverRelayAction({ action: "pickup", itemId: cleanPositiveInt(args.itemId, 0) }, requestedPluginClientId(args, selectedClientIdRef.current));
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "furni.findItems" || request.api === "furni.findItem") {
      requirePluginPermission(plugin, ["engine.snapshot"]);
      const options = args.options && typeof args.options === "object" ? (args.options as Record<string, unknown>) : {};
      const requestedKind = String(args.kind ?? options.kind ?? "all").trim().toLowerCase();
      const kind = requestedKind === "floor" || requestedKind === "wall" ? requestedKind : "all";
      const targetClientId = requestedPluginClientId(args, selectedClientIdRef.current);
      const snapshot = await fullSnapshotForClient(targetClientId);
      if (!snapshot) throw new Error("furni.findItems needs the target client to be the selected rendered client so room object rows are available.");
      const rows = pluginFindItemRows(snapshot, args.selector, furniMetadata, kind);
      const items = rows.map((row) => pluginRuntimeItemPayload(row, furniMetadata));
      return request.api === "furni.findItem" ? items[0] ?? null : items;
    }
    if (request.api === "furni.moveFloorItem" || request.api === "furni.rotateFloorItem") {
      requirePluginPermission(plugin, ["actions.furni"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for furni movement.");
      const targetClientId = requestedPluginClientId(args, selectedClientIdRef.current);
      const selector = args.selector ?? args.objectId ?? args.item;
      const directId = pluginSelectorNumericId(selector);
      const selectorTile = pluginSelectorTile(selector);
      const directX = finiteNumber(request.api === "furni.rotateFloorItem" ? selectorTile?.x : args.x ?? selectorTile?.x);
      const directY = finiteNumber(request.api === "furni.rotateFloorItem" ? selectorTile?.y : args.y ?? selectorTile?.y);
      const directDirection = finiteNumber(args.direction ?? selectorTile?.direction);
      const needsSnapshot = !directId || directX === null || directY === null || directDirection === null;
      if (needsSnapshot) requirePluginPermission(plugin, ["engine.snapshot"]);
      const snapshot = needsSnapshot ? await fullSnapshotForClient(targetClientId) : null;
      const resolved = snapshot ? pluginResolveFloorItem(snapshot, selector, furniMetadata) : null;
      const objectId = directId ?? resolved?.id ?? null;
      if (!objectId) throw new Error(`${request.api} needs a floor item id or a selector that resolves to a floor item.`);
      const xValue = finiteNumber(directX ?? resolved?.tile.x);
      const yValue = finiteNumber(directY ?? resolved?.tile.y);
      const directionValue = finiteNumber(directDirection ?? resolved?.tile.direction);
      if (xValue === null || yValue === null) throw new Error(`${request.api} needs target tile x/y or a selector with a parsed tile.`);
      if (directionValue === null) throw new Error(`${request.api} needs a direction or a selector with current direction.`);
      const action: FurniRelayAction = {
        action: request.api === "furni.rotateFloorItem" ? "rotateFloorItem" : "moveFloorItem",
        objectId,
        x: Math.trunc(xValue),
        y: Math.trunc(yValue),
        direction: Math.trunc(directionValue),
        className: compactValue(resolved?.row.item.className),
      };
      const result = await window.habbpyV4.sendFurniRelayAction(action, targetClientId);
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return { ...result, item: resolved ? pluginRuntimeItemPayload(resolved.row, furniMetadata) : null };
    }
    if (request.api === "furni.pickupFloorItem") {
      requirePluginPermission(plugin, ["actions.furni"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for furni pickup.");
      const targetClientId = requestedPluginClientId(args, selectedClientIdRef.current);
      const selector = args.selector ?? args.objectId ?? args.item;
      const directId = pluginSelectorNumericId(selector);
      if (!directId) requirePluginPermission(plugin, ["engine.snapshot"]);
      const snapshot = directId ? null : await fullSnapshotForClient(targetClientId);
      const resolved = snapshot ? pluginResolveFloorItem(snapshot, selector, furniMetadata) : null;
      const objectId = directId ?? resolved?.id ?? null;
      if (!objectId) throw new Error("furni.pickupFloorItem needs a floor item id or a selector that resolves to a floor item.");
      const result = await window.habbpyV4.sendFurniRelayAction(
        { action: "pickupFloorItem", objectId, className: compactValue(resolved?.row.item.className) },
        targetClientId,
      );
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return { ...result, item: resolved ? pluginRuntimeItemPayload(resolved.row, furniMetadata) : null };
    }
    if (request.api === "furni.useFloorItem") {
      requirePluginPermission(plugin, ["actions.furni"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for furni use.");
      const targetClientId = requestedPluginClientId(args, selectedClientIdRef.current);
      const selector = args.selector ?? args.objectId ?? args.item;
      const directId = pluginSelectorNumericId(selector);
      if (!directId) requirePluginPermission(plugin, ["engine.snapshot"]);
      const snapshot = directId ? null : await fullSnapshotForClient(targetClientId);
      const resolved = snapshot ? pluginResolveFloorItem(snapshot, selector, furniMetadata) : null;
      const objectId = directId ?? resolved?.id ?? null;
      if (!objectId) throw new Error("furni.useFloorItem needs a floor item id or a selector that resolves to a floor item.");
      const result = await window.habbpyV4.sendFurniRelayAction(
        { action: "useFloorItem", objectId, value: String(args.value ?? "0"), className: compactValue(resolved?.row.item.className) },
        targetClientId,
      );
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return { ...result, item: resolved ? pluginRuntimeItemPayload(resolved.row, furniMetadata) : null };
    }
    if (request.api === "furni.moveWallItem") {
      requirePluginPermission(plugin, ["actions.furni"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for wall furni movement.");
      const targetClientId = requestedPluginClientId(args, selectedClientIdRef.current);
      const selector = args.selector ?? args.item ?? args.itemId;
      const directId = pluginSelectorNumericId(selector);
      const directLocation = pluginSelectorWallLocation(selector, args.location);
      if (!directId || !directLocation) requirePluginPermission(plugin, ["engine.snapshot"]);
      const snapshot = directId && directLocation ? null : await fullSnapshotForClient(targetClientId);
      const resolved = snapshot ? pluginResolveWallItem(snapshot, selector, furniMetadata) : null;
      const itemId = directId ?? resolved?.id ?? null;
      const location = directLocation ?? (resolved ? pluginWallMoveLocation(resolved.location, args.location) : null);
      if (!itemId) throw new Error("furni.moveWallItem needs a wall item id or a selector that resolves to a wall item.");
      if (!location) throw new Error("furni.moveWallItem needs wall/local/orientation coordinates or a selected wall item with parsed coordinates.");
      const result = await window.habbpyV4.sendFurniRelayAction(
        {
          action: "moveWallItem",
          itemId,
          wallX: location.wallX,
          wallY: location.wallY,
          localX: location.localX,
          localY: location.localY,
          orientation: location.orientation,
          className: compactValue(resolved?.row.item.className),
        },
        targetClientId,
      );
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return { ...result, item: resolved ? pluginRuntimeItemPayload(resolved.row, furniMetadata) : null };
    }
    if (request.api === "furni.pickupWallItem") {
      requirePluginPermission(plugin, ["actions.furni"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for wall furni pickup.");
      const targetClientId = requestedPluginClientId(args, selectedClientIdRef.current);
      const selector = args.selector ?? args.itemId ?? args.item;
      const directId = pluginSelectorNumericId(selector);
      if (!directId) requirePluginPermission(plugin, ["engine.snapshot"]);
      const snapshot = directId ? null : await fullSnapshotForClient(targetClientId);
      const resolved = snapshot ? pluginResolveWallItem(snapshot, selector, furniMetadata) : null;
      const itemId = directId ?? resolved?.id ?? null;
      if (!itemId) throw new Error("furni.pickupWallItem needs a wall item id or a selector that resolves to a wall item.");
      const result = await window.habbpyV4.sendFurniRelayAction(
        { action: "pickupWallItem", itemId, className: compactValue(resolved?.row.item.className) },
        targetClientId,
      );
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return { ...result, item: resolved ? pluginRuntimeItemPayload(resolved.row, furniMetadata) : null };
    }
    if (request.api === "furni.pickupItem") {
      requirePluginPermission(plugin, ["actions.furni"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for furni pickup.");
      const targetClientId = requestedPluginClientId(args, selectedClientIdRef.current);
      const selector = args.selector ?? args.itemId ?? args.objectId ?? args.item;
      const kind = pluginSelectorKind(selector);
      if (kind === "floor") {
        const objectId = pluginSelectorNumericId(selector);
        if (!objectId) requirePluginPermission(plugin, ["engine.snapshot"]);
        const resolved = objectId ? null : pluginResolveFloorItem(await fullSnapshotForClient(targetClientId), selector, furniMetadata);
        const id = objectId ?? resolved?.id ?? null;
        if (!id) throw new Error("furni.pickupItem could not resolve a floor item id.");
        const result = await window.habbpyV4.sendFurniRelayAction({ action: "pickupFloorItem", objectId: id }, targetClientId);
        await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
        return { ...result, item: resolved ? pluginRuntimeItemPayload(resolved.row, furniMetadata) : null };
      }
      if (kind === "wall") {
        const itemId = pluginSelectorNumericId(selector);
        if (!itemId) requirePluginPermission(plugin, ["engine.snapshot"]);
        const resolved = itemId ? null : pluginResolveWallItem(await fullSnapshotForClient(targetClientId), selector, furniMetadata);
        const id = itemId ?? resolved?.id ?? null;
        if (!id) throw new Error("furni.pickupItem could not resolve a wall item id.");
        const result = await window.habbpyV4.sendFurniRelayAction({ action: "pickupWallItem", itemId: id }, targetClientId);
        await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
        return { ...result, item: resolved ? pluginRuntimeItemPayload(resolved.row, furniMetadata) : null };
      }
      requirePluginPermission(plugin, ["engine.snapshot"]);
      const snapshot = await fullSnapshotForClient(targetClientId);
      const row = pluginFindItemRows(snapshot, selector, furniMetadata, "all")[0];
      if (!row) throw new Error("furni.pickupItem needs item kind or a selector that resolves to a live room item.");
      const id = objectNumericId(row.item);
      if (!id) throw new Error("furni.pickupItem resolved item has no numeric id.");
      const action: FurniRelayAction = row.kind === "wall" ? { action: "pickupWallItem", itemId: id } : { action: "pickupFloorItem", objectId: id };
      const result = await window.habbpyV4.sendFurniRelayAction(action, targetClientId);
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return { ...result, item: pluginRuntimeItemPayload(row, furniMetadata) };
    }
    if (request.api === "fishing.getState") {
      requirePluginPermission(plugin, ["engine.snapshot"]);
      const targetClientId = requestedPluginClientId(args, selectedClientIdRef.current);
      const snapshot = await fullSnapshotForClient(targetClientId);
      const runtimeSummary = await runtimeSummaryForClient(targetClientId);
      const pluginSnapshot = clientPluginSnapshotsById.get(targetClientId);
      const rows = pluginFishingAreaRows(snapshot, furniMetadata);
      const target = pluginFishingAreaTarget(snapshot, args.areaId, furniMetadata);
      return {
        roomReady: snapshot ? Boolean(snapshot.roomReady?.ready ?? snapshot.roomEntryState?.roomReady?.ready) : runtimeSummary?.roomReady ?? false,
        selectedClientId: selectedClientIdRef.current,
        clientId: targetClientId,
        hasFullRuntimeSnapshot: Boolean(snapshot),
        userCount: snapshot?.userState?.roomUserCount ?? snapshot?.roomObjects?.counts.users ?? runtimeSummary?.userCount ?? null,
        occupants: pluginRoomOccupantsPayload(snapshot),
        target: target?.area ?? null,
        walkTarget: target ? { x: target.x, y: target.y, furniId: target.furniId, label: target.label } : null,
        areas: rows.map((row) => pluginFishingAreaPayload(row, furniMetadata)),
        packet: pluginSnapshot?.packetFishing ?? null,
      };
    }
    if (request.api === "fishing.walkToArea") {
      requirePluginPermission(plugin, ["actions.fishing"]);
      requirePluginPermission(plugin, ["actions.avatar"]);
      requirePluginPermission(plugin, ["engine.snapshot"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for Fishing movement.");
      const targetClientId = requestedPluginClientId(args, selectedClientIdRef.current);
      const snapshot = await fullSnapshotForClient(targetClientId);
      if (!snapshot) throw new Error("fishing.walkToArea needs the target client to be the selected rendered client so room object tiles are available.");
      const target = pluginFishingAreaTarget(snapshot, args.areaId, furniMetadata);
      if (!target) throw new Error("fishing.walkToArea could not resolve a parsed fishing area with tile coordinates.");
      const result = await window.habbpyV4.sendRoomRelayAction(
        { action: "move", x: target.x, y: target.y, furniId: target.furniId },
        targetClientId,
      );
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return { ...result, target };
    }
    if (request.api === "fishing.startFishing") {
      requirePluginPermission(plugin, ["actions.fishing"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for Fishing action.");
      const result = await window.habbpyV4.sendFishingRelayAction(
        { action: "startFishing", areaId: cleanPositiveInt(args.areaId, 0) },
        requestedPluginClientId(args, selectedClientIdRef.current),
      );
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "fishing.minigameInput") {
      requirePluginPermission(plugin, ["actions.fishing"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for Fishing action.");
      const direction = String(args.direction ?? "").trim().toUpperCase();
      if (direction !== "L" && direction !== "R") throw new Error("fishing.minigameInput direction must be L or R.");
      const result = await window.habbpyV4.sendFishingRelayAction(
        { action: "minigameInput", direction },
        requestedPluginClientId(args, selectedClientIdRef.current),
      );
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "fishing.purchaseProduct") {
      requirePluginPermission(plugin, ["actions.fishing"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for Fishing action.");
      const productCode = String(args.productCode ?? args.code ?? "").trim();
      const result = await window.habbpyV4.sendFishingRelayAction(
        { action: "purchaseProduct", productCode },
        requestedPluginClientId(args, selectedClientIdRef.current),
      );
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (
      request.api === "fishing.registerDerby" ||
      request.api === "fishing.requestTokens" ||
      request.api === "fishing.requestProducts" ||
      request.api === "fishing.requestRodLevel" ||
      request.api === "fishing.requestStats" ||
      request.api === "fishing.requestFishopedia"
    ) {
      requirePluginPermission(plugin, ["actions.fishing"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for Fishing action.");
      const action: FishingRelayAction =
        request.api === "fishing.registerDerby" ? { action: "registerDerby" } :
        request.api === "fishing.requestTokens" ? { action: "requestTokens" } :
        request.api === "fishing.requestProducts" ? { action: "requestProducts" } :
        request.api === "fishing.requestRodLevel" ? { action: "requestRodLevel" } :
        request.api === "fishing.requestStats" ? { action: "requestStats" } :
        { action: "requestFishopedia" };
      const result = await window.habbpyV4.sendFishingRelayAction(action, requestedPluginClientId(args, selectedClientIdRef.current));
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "packets.send") {
      requirePluginPermission(plugin, ["packet.inject"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for packet send.");
      const result = await window.habbpyV4.sendPluginPacket(args.packet as PluginPacketInput, requestedPluginClientId(args, selectedClientIdRef.current));
      await refreshRelayLog().catch(() => null);
      return result;
    }
    if (request.api === "console.registerCommand") {
      requirePluginPermission(plugin, ["console.commands"]);
      return { ok: false, message: "Plugin console command registration is reserved for the command registry phase." };
    }
    if (request.api === "ui.registerPanel") {
      requirePluginPermission(plugin, ["ui.panel"]);
      return { ok: false, message: "Plugin-rendered custom panels are reserved for the panel renderer phase." };
    }
    throw new Error(`Unknown plugin host API: ${request.api}`);
  };

  useEffect(() => {
    if (!window.habbpyV4?.readPluginEntrySource) return undefined;
    const host = new RendererUserPluginHost({
      readEntrySource: (pluginId) => window.habbpyV4!.readPluginEntrySource(pluginId),
      handleRequest: (plugin, request) => userPluginRequestHandlerRef.current(plugin, request),
      log: (plugin, level, message) => userPluginLogHandlerRef.current(plugin, level, message),
    });
    userPluginHostRef.current = host;
    return () => {
      host.dispose();
      if (userPluginHostRef.current === host) userPluginHostRef.current = null;
    };
  }, []);

  useEffect(() => {
    userPluginHostRef.current?.sync(availablePlugins, pluginEnabledById);
  }, [availablePlugins, pluginEnabledById]);

  useEffect(() => {
    userPluginHostRef.current?.dispatchEvent("session.selected", {
      clientId: selectedClientId,
      session: selectedClientSession,
      mainClientId: clientSessions?.mainClientId ?? 1,
    });
  }, [clientSessions?.mainClientId, selectedClientId, selectedClientSession]);

  useEffect(() => {
    if (!selectedRuntimeSnapshot) return;
    userPluginHostRef.current?.dispatchEvent("runtime.snapshot", {
      clientId: selectedClientId,
      room: pluginRoomPayload(selectedRuntimeSnapshot),
      snapshot: selectedRuntimeSnapshot,
    });
  }, [selectedClientId, selectedRuntimeSnapshot]);

  useEffect(() => {
    const host = userPluginHostRef.current;
    const snapshot = selectedRuntimeSnapshot;
    const currentRoomKey = pluginRoomKey(snapshot);
    if (!host || !snapshot || !roomReady || !currentRoomKey) {
      userPluginRoomUsersRef.current = null;
      return;
    }
    const sessionName = snapshot.userState?.sessionUserName ?? null;
    const usersByKey = new globalThis.Map<string, ReturnType<typeof pluginRuntimeUserPayload>>();
    for (const user of snapshot.userState?.users ?? []) {
      usersByKey.set(pluginRuntimeUserKey(user, sessionName), pluginRuntimeUserPayload(user, sessionName));
    }
    const room = pluginRoomPayload(snapshot);
    const previous = userPluginRoomUsersRef.current;
    if (!previous || previous.roomKey !== currentRoomKey) {
      userPluginRoomUsersRef.current = { roomKey: currentRoomKey, usersByKey };
      host.dispatchEvent("room.changed", { clientId: selectedClientId, room });
      host.dispatchEvent("room.ready", { clientId: selectedClientId, room });
      host.dispatchEvent("room.users", { ...pluginRoomUsersPayload(snapshot, selectedClientId), initial: true });
      return;
    }
    for (const [key, user] of usersByKey) {
      if (previous.usersByKey.has(key)) continue;
      host.dispatchEvent("room.userJoined", { clientId: selectedClientId, room, user, initial: false });
    }
    for (const [key, user] of previous.usersByKey) {
      if (usersByKey.has(key)) continue;
      host.dispatchEvent("room.userLeft", { clientId: selectedClientId, room, user });
    }
    userPluginRoomUsersRef.current = { roomKey: currentRoomKey, usersByKey };
  }, [roomReady, selectedClientId, selectedRuntimeSnapshot]);

  useEffect(() => {
    const host = userPluginHostRef.current;
    const snapshot = selectedRuntimeSnapshot;
    const currentRoomKey = pluginRoomKey(snapshot);
    if (!host || !snapshot || !roomReady || !currentRoomKey) {
      userPluginRoomObjectsRef.current = null;
      return;
    }

    const room = pluginRoomPayload(snapshot);
    const itemsByKey = pluginRoomObjectRecords(snapshot, furniMetadata);
    const objectPayload = pluginRoomObjectsPayload(snapshot, selectedClientId, furniMetadata);
    const previous = userPluginRoomObjectsRef.current;
    if (!previous || previous.roomKey !== currentRoomKey) {
      userPluginRoomObjectsRef.current = { roomKey: currentRoomKey, itemsByKey };
      host.dispatchEvent("room.items", { ...objectPayload, initial: true });
      host.dispatchEvent("room.floorItemsLoaded", {
        clientId: selectedClientId,
        room,
        items: objectPayload.floorItems,
        floorItems: objectPayload.floorItems,
        initial: true,
      });
      host.dispatchEvent("room.wallItemsLoaded", {
        clientId: selectedClientId,
        room,
        items: objectPayload.wallItems,
        wallItems: objectPayload.wallItems,
        initial: true,
      });
      return;
    }

    let changed = false;
    for (const [key, record] of itemsByKey) {
      const previousRecord = previous.itemsByKey.get(key);
      if (!previousRecord) {
        changed = true;
        dispatchPluginRoomItemEvent(host, "Added", selectedClientId, room, record.payload);
        continue;
      }
      if (previousRecord.signature !== record.signature) {
        changed = true;
        dispatchPluginRoomItemEvent(host, "Updated", selectedClientId, room, record.payload, previousRecord.payload);
      }
    }
    for (const [key, previousRecord] of previous.itemsByKey) {
      if (itemsByKey.has(key)) continue;
      changed = true;
      dispatchPluginRoomItemEvent(host, "Removed", selectedClientId, room, previousRecord.payload);
    }
    if (changed) {
      host.dispatchEvent("room.items", { ...objectPayload, initial: false });
    }
    userPluginRoomObjectsRef.current = { roomKey: currentRoomKey, itemsByKey };
  }, [furniMetadata, roomReady, selectedClientId, selectedRuntimeSnapshot]);

  useEffect(() => {
    const host = userPluginHostRef.current;
    const snapshot = selectedRuntimeSnapshot;
    const currentRoomKey = pluginRoomKey(snapshot);
    if (!host || !snapshot || !currentRoomKey) {
      userPluginChatRef.current = null;
      return;
    }
    const room = pluginRoomPayload(snapshot);
    const entriesByKey = new globalThis.Map<string, RuntimeChatEntry>();
    for (let index = 0; index < chatHistory.length; index += 1) {
      const entry = chatHistory[index]!;
      entriesByKey.set(chatEntryKey(entry, index), entry);
    }
    const previous = userPluginChatRef.current;
    if (!previous || previous.roomKey !== currentRoomKey) {
      userPluginChatRef.current = { roomKey: currentRoomKey, keys: new globalThis.Set(entriesByKey.keys()) };
      return;
    }
    for (const [key, entry] of entriesByKey) {
      if (previous.keys.has(key)) continue;
      host.dispatchEvent("chat.message", pluginChatPayload(entry, selectedClientId, room));
    }
    userPluginChatRef.current = { roomKey: currentRoomKey, keys: new globalThis.Set(entriesByKey.keys()) };
  }, [chatHistory, selectedClientId, selectedRuntimeSnapshot]);

  useEffect(() => {
    const host = userPluginHostRef.current;
    if (!host || !relayLog) return;
    const cursor = userPluginPacketCursorRef.current;
    if (!cursor.initialized || cursor.logPath !== relayLog.logPath) {
      userPluginPacketCursorRef.current = {
        logPath: relayLog.logPath,
        lineNumber: relayLog.totalLines,
        initialized: true,
      };
      return;
    }
    let nextLineNumber = cursor.lineNumber;
    for (const entry of relayLog.entries) {
      if (entry.lineNumber <= cursor.lineNumber || entry.header === null) continue;
      nextLineNumber = Math.max(nextLineNumber, entry.lineNumber);
      const packet = pluginRelayPacketPayload(entry, relayLog.updatedAt);
      host.dispatchEvent("packet", packet);
      if (packet.direction === "client" || packet.direction === "server") {
        host.dispatchEvent(`packet.${packet.direction}`, packet);
      }
    }
    if (nextLineNumber !== cursor.lineNumber) {
      userPluginPacketCursorRef.current = {
        logPath: relayLog.logPath,
        lineNumber: nextLineNumber,
        initialized: true,
      };
    }
  }, [relayLog]);

  const executePacketConsoleCommand = useCallback(async () => {
    const raw = packetConsoleInput.trim();
    if (!raw) return;
    setPacketConsoleInput("");
    setPacketConsoleHistoryIndex(null);
    appendPacketConsole("command", redactConsoleCommandInput(raw));

    let commandInput = raw.replace(/^\//, "");
    let commandParts = commandInput.split(/\s+/).filter(Boolean);
    let command = (commandParts[0] ?? "").toLowerCase();
    let parts: readonly string[] = commandParts.slice(1);
    let rest = commandInput.slice(commandParts[0]?.length ?? 0).trim();
    let targetClientIds: readonly number[] = [clientSessions?.selectedClientId ?? 1];
    if (window.habbpyV4?.runConsoleCommand) {
      const busInput = withVisibleConsoleContext(raw, selectedClientIsVisible ? selectedRuntimeSnapshot : null, visibleActiveAccountNames);
      const busResult = await window.habbpyV4.runConsoleCommand(busInput);
      await refreshConsoleCommandState().catch(() => null);
      for (const line of busResult.lines) appendPacketConsole(busResult.level, line);
      if (busResult.handled) {
        await refreshClientSessions().catch(() => null);
        await refreshSelectedClientSnapshot(busResult.targetClientIds?.[0] ?? clientSessions?.selectedClientId).catch(() => null);
        if ((busResult.rendererActions?.length ?? 0) > 0) {
          await executeConsoleRendererActions(busResult.rendererActions ?? []);
        }
        if (commandRefreshesEngineLaunch(busResult.command?.command ?? "", busResult.command?.args[0] ?? "")) {
          const launch = await window.habbpyV4.getEngineLaunchState().catch(() => null);
          if (launch) applyEngineLaunch(launch);
        }
        return;
      }
      if (!busResult.ok) return;
      const busCommand = busResult.command?.command ?? "";
      const relayBackedCommand = isRelayBackedConsoleCommand(busCommand);
      if ((busResult.targetClientIds?.length ?? 0) !== 1 && !relayBackedCommand) {
        appendPacketConsole("warning", "This command needs exactly one target client in the current single-view phase.");
        return;
      }
      if (!relayBackedCommand && busResult.targetClientIds?.[0] !== (clientSessions?.selectedClientId ?? 1)) {
        appendPacketConsole("warning", `client${busResult.targetClientIds?.[0] ?? "-"} is not the selected visible client yet.`);
        return;
      }
      if (!relayBackedCommand && !selectedClientIsVisible) {
        appendPacketConsole("warning", `client${clientSessions?.selectedClientId ?? 1} is headless; this command needs a visible runtime.`);
        return;
      }
      commandInput = busResult.passthroughInput ?? busResult.command?.inputWithoutTarget ?? commandInput;
      commandParts = busResult.command ? [busResult.command.command, ...busResult.command.args] : commandInput.split(/\s+/).filter(Boolean);
      command = busResult.command?.command ?? (commandParts[0] ?? "").toLowerCase();
      parts = busResult.command?.args ?? commandParts.slice(1);
      rest = parts.join(" ");
      targetClientIds = busResult.targetClientIds ?? targetClientIds;
    }
    const runtime = selectedRuntimeSnapshot;
    const refreshSelectedRuntime = async () => (selectedClientIsVisible ? await refreshRuntimeSnapshot().catch(() => null) : null);
    const sendSocialToTargets = async (action: SocialRelayAction, label: string) => {
      for (const clientId of targetClientIds) {
        const result = await sendSocialAction(action, label, clientId);
        const prefix = targetClientIds.length > 1 ? `client${clientId}: ` : "";
        appendPacketConsole(result.ok ? "success" : "warning", `${prefix}${result.message}`);
      }
    };

    if (command === "help" || command === "?") {
      appendPacketConsole(
        "info",
        "commands: help, clear, packets <filter|all|selected|client id>, list, select <id>, newclient, load <file> <count> --headless, mimic status|on|off|source <id>, enterroom <flat-id>, room, user, lookup <name>, rooms <query>, say <message>, input [client] <message>, wave, dance <1-4>, carrydrink, message <user|id> <message>, adduser <name>, requests, accept <request>, decline <request>, follow <friend>, removefriend <friend>, walk <x> <y>, fps [limit], perf, gpu",
      );
      return;
    }
    if (command === "clear") {
      setPacketConsoleEntries([]);
      return;
    }
    if (command === "packets" || command === "filter") {
      const mode = (parts[0] ?? "").toLowerCase();
      if (mode === "all" || mode === "clients") {
        setPacketConsoleClientFilter("All");
        appendPacketConsole("success", "packet client filter set to all clients");
        return;
      }
      if (mode === "selected") {
        const selected = String(clientSessions?.selectedClientId ?? 1);
        setPacketConsoleClientFilter(selected);
        appendPacketConsole("success", `packet client filter set to client${selected}`);
        return;
      }
      if (mode === "client" || mode === "c") {
        const nextClient = normalizePacketClientFilter(parts[1] ?? "All", packetClientChoices);
        setPacketConsoleClientFilter(nextClient);
        appendPacketConsole("success", nextClient === "All" ? "packet client filter set to all clients" : `packet client filter set to client${nextClient}`);
        return;
      }
      if (/^(?:client)?\d+$/i.test(parts[0] ?? "")) {
        const nextClient = normalizePacketClientFilter(parts[0] ?? "All", packetClientChoices);
        setPacketConsoleClientFilter(nextClient);
        appendPacketConsole("success", nextClient === "All" ? "packet client filter set to all clients" : `packet client filter set to client${nextClient}`);
        return;
      }
      setPacketConsoleQuery(rest);
      appendPacketConsole("success", rest ? `packet filter set to "${rest}"` : "packet filter cleared");
      return;
    }
    if (command === "say" || command === "chat") {
      if (!rest) {
        appendPacketConsole("warning", "usage: say <message>");
        return;
      }
      const result = await runConsoleRuntimeAction({ kind: "sendChat", message: rest });
      appendPacketConsole(result.ok ? "success" : "warning", result.message);
      return;
    }
    if (command === "message" || command === "msg" || command === "pm") {
      const target = parts[0] ?? "";
      const message = rest.slice(target.length).trim();
      if (!target || !message) {
        appendPacketConsole("warning", "usage: message <friend-name-or-account-id> <message>");
        return;
      }
      if (!window.habbpyV4) {
        appendPacketConsole("warning", "desktop bridge unavailable for private message");
        return;
      }
      let accountId = Number.parseInt(target, 10);
      const normalizedTarget = target.toLowerCase();
      if (!Number.isInteger(accountId) || accountId <= 0) {
        const runtimeUser = userRows.find((entry) =>
          runtimeUserMatchesLookup(entry, normalizedTarget, target, selectedRuntimeSnapshot?.userState?.sessionUserName),
        );
        const packetUser =
          packetProfileIndex.byName.get(normalizedTarget) ??
          packetProfileIndex.byAccountId.get(target) ??
          packetProfileIndex.users.find((entry) => packetUserMatchesLookup(entry, normalizedTarget, target));
        const friend = packetInfoState.friends.find(
          (entry) => packetFriendMatchesLookup(entry, normalizedTarget, target),
        );
        const request = packetInfoState.friendRequests.find(
          (entry) => packetFriendRequestMatchesLookup(entry, normalizedTarget, target),
        );
        for (const candidate of [runtimeUser?.accountId, packetUser?.accountId, friend?.accountId, request?.accountId]) {
          const resolvedId = Number.parseInt(compactValue(candidate), 10);
          if (Number.isInteger(resolvedId) && resolvedId > 0) {
            accountId = resolvedId;
            break;
          }
        }
      }
      if (!Number.isInteger(accountId) || accountId <= 0) {
        const lookup = await window.habbpyV4.lookupOriginsUser(target);
        const lookupId = Number.parseInt(lookup.id, 10);
        if (Number.isInteger(lookupId) && lookupId > 0) {
          accountId = lookupId;
        } else {
          appendPacketConsole("warning", `message target needs a numeric account id or parsed friend row; lookup id=${lookup.id || "-"}`);
          return;
        }
      }
      await sendSocialToTargets({ action: "message", accountId, recipient: target, message }, "Private message");
      return;
    }
    if (command === "adduser" || command === "friend") {
      const name = rest.trim();
      if (!name) {
        appendPacketConsole("warning", "usage: adduser <habbo-name>");
        return;
      }
      if (!window.habbpyV4) {
        appendPacketConsole("warning", "desktop bridge unavailable for friend request");
        return;
      }
      await sendSocialToTargets({ action: "addUser", name }, `Friend request ${name}`);
      return;
    }
    if (command === "requests" || command === "friendrequests" || command === "refreshrequests") {
      await sendSocialToTargets({ action: "refreshFriendRequests" }, "Refresh friend requests");
      return;
    }
    if (command === "accept" || command === "acceptfriend") {
      const target = rest.trim();
      const request = findPacketFriendRequestForAction(packetInfoState.friendRequests, target);
      if (!request) {
        appendPacketConsole("warning", target ? `friend request not found: ${target}` : "usage: accept <request-name-or-account-id>");
        return;
      }
      const accountId = packetFriendRequestActionId(request);
      if (accountId === null) {
        appendPacketConsole("warning", `friend request ${request.name} has no numeric account id`);
        return;
      }
      await sendSocialToTargets({ action: "acceptRequest", accountId }, `Accept request ${request.name}`);
      return;
    }
    if (command === "decline" || command === "declinefriend") {
      const target = rest.trim();
      const request = findPacketFriendRequestForAction(packetInfoState.friendRequests, target);
      if (!request) {
        appendPacketConsole("warning", target ? `friend request not found: ${target}` : "usage: decline <request-name-or-account-id>");
        return;
      }
      const accountId = packetFriendRequestActionId(request);
      if (accountId === null) {
        appendPacketConsole("warning", `friend request ${request.name} has no numeric account id`);
        return;
      }
      await sendSocialToTargets({ action: "declineRequest", accountId }, `Decline request ${request.name}`);
      return;
    }
    if (command === "follow" || command === "followfriend") {
      const target = rest.trim();
      if (!target) {
        appendPacketConsole("warning", "usage: follow <friend-name-or-account-id>");
        return;
      }
      const friend = findPacketFriendForAction(packetInfoState.friends, target);
      const accountId = parsePositiveSocialAccountId(target) ?? (friend ? packetFriendActionId(friend) : null);
      if (accountId === null) {
        appendPacketConsole("warning", `friend not found with numeric account id: ${target}`);
        return;
      }
      await sendSocialToTargets(
        { action: "followFriend", accountId, name: friend?.name ?? target },
        `Follow friend ${friend?.name ?? target}`,
      );
      return;
    }
    if (command === "removefriend" || command === "unfriend") {
      const target = rest.trim();
      if (!target) {
        appendPacketConsole("warning", "usage: removefriend <friend-name-or-account-id>");
        return;
      }
      const friend = findPacketFriendForAction(packetInfoState.friends, target);
      const accountId = parsePositiveSocialAccountId(target) ?? (friend ? packetFriendActionId(friend) : null);
      if (accountId === null) {
        appendPacketConsole("warning", `friend not found with numeric account id: ${target}`);
        return;
      }
      await sendSocialToTargets(
        { action: "removeFriend", accountId, name: friend?.name ?? target },
        `Remove friend ${friend?.name ?? target}`,
      );
      return;
    }
    if (command === "walk" || command === "stageclick") {
      const x = Number(parts[0]);
      const y = Number(parts[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        appendPacketConsole("warning", "usage: walk <stage-x> <stage-y>");
        return;
      }
      const result = await runConsoleRuntimeAction({ kind: "stageClick", x, y });
      appendPacketConsole(result.ok ? "success" : "warning", result.message);
      return;
    }
    if (command === "room") {
      const snapshot = (await refreshSelectedRuntime()) ?? runtime;
      appendPacketConsole(
        "info",
        `room=${runtimeRoomName(snapshot)} id=${runtimeRoomId(snapshot)} type=${runtimeRoomType(snapshot)} ready=${compactValue(snapshot?.roomReady?.ready ?? snapshot?.roomEntryState?.roomReady?.ready)} users=${compactValue(snapshot?.userState?.roomUserCount ?? snapshot?.roomReady?.roomLikeSpriteCount)}`,
      );
      return;
    }
    if (command === "user") {
      appendPacketConsole(
        "info",
        `user=${selectedUserName} account=${selectedUserAccountId} pos=${selectedUserPosition} figure=${selectedUserFigure}`,
      );
      return;
    }
    if (command === "lookup") {
      const name = rest || selectedUserName;
      if (!name || name === "-") {
        appendPacketConsole("warning", "usage: lookup <habbo-name>");
        return;
      }
      if (!window.habbpyV4) {
        appendPacketConsole("warning", "desktop bridge unavailable for Origins public lookup");
        return;
      }
      const rawToken = name.trim();
      const normalizedToken = rawToken.toLowerCase();
      const snapshot = (await refreshSelectedRuntime()) ?? runtime;
      const runtimeMatches: RuntimeUserSummary[] = [];
      const seenRuntimeUsers = new Set<string>();
      for (const user of [...(snapshot?.userState?.users ?? []), ...(snapshot?.roomObjects?.users ?? [])]) {
        if (!runtimeUserMatchesLookup(user, normalizedToken, rawToken, snapshot?.userState?.sessionUserName)) continue;
        const key = [
          compactValue(user.accountId),
          compactValue(user.roomIndex ?? user.rowId),
          userDisplayName(user, snapshot?.userState?.sessionUserName).toLowerCase(),
        ].join(":");
        if (seenRuntimeUsers.has(key)) continue;
        seenRuntimeUsers.add(key);
        runtimeMatches.push(user);
      }
      const packetMatches: PacketProfileUser[] = [];
      const seenPacketUsers = new Set<string>();
      for (const user of packetProfileIndex.users) {
        if (!packetUserMatchesLookup(user, normalizedToken, rawToken)) continue;
        const key = [compactValue(user.accountId), compactValue(user.index), user.name.toLowerCase()].join(":");
        if (seenPacketUsers.has(key)) continue;
        seenPacketUsers.add(key);
        packetMatches.push(user);
      }
      const friendMatches = packetInfoState.friends.filter((entry) => packetFriendMatchesLookup(entry, normalizedToken, rawToken));
      const requestMatches = packetInfoState.friendRequests.filter((entry) => packetFriendRequestMatchesLookup(entry, normalizedToken, rawToken));
      const localAccountIds = new Set<string>();
      for (const user of runtimeMatches) {
        const accountIdValue = compactValue(user.accountId);
        if (accountIdValue !== "-") localAccountIds.add(accountIdValue);
      }
      for (const user of packetMatches) {
        if (user.accountId !== "-") localAccountIds.add(user.accountId);
      }
      for (const friend of friendMatches) {
        if (friend.accountId !== "-") localAccountIds.add(friend.accountId);
      }
      for (const request of requestMatches) {
        if (request.accountId !== "-") localAccountIds.add(request.accountId);
      }
      for (const user of runtimeMatches.slice(0, 3)) appendPacketConsole("info", runtimeLookupLine(user, snapshot));
      for (const user of packetMatches.slice(-3)) appendPacketConsole("info", packetProfileLookupLine(user));
      for (const friend of friendMatches.slice(0, 3)) {
        appendPacketConsole("info", `friend: ${packetFriendTitle(friend)} / ${packetFriendMeta(friend)} / line=${friend.sourceLine}`);
      }
      for (const request of requestMatches.slice(0, 3)) appendPacketConsole("info", friendRequestLookupLine(request));
      const recentMessages = localAccountIds.size > 0
        ? packetInfoState.privateMessages.filter((entry) => localAccountIds.has(entry.senderAccountId)).slice(-3)
        : [];
      for (const message of recentMessages) {
        appendPacketConsole(
          "info",
          `private message: from=${message.senderAccountId} sent=${compactValue(message.sentAt)} text=${compactValue(message.text)} line=${message.sourceLine}`,
        );
      }
      if (runtimeMatches.length === 0 && packetMatches.length === 0 && friendMatches.length === 0 && requestMatches.length === 0) {
        appendPacketConsole("info", `in-game: no runtime, USERS, friend, or request match for ${rawToken}`);
      }
      const result = await window.habbpyV4.lookupOriginsUser(name);
      appendPacketConsole(result.ok ? "success" : "warning", originsLookupLine(result, name));
      return;
    }
    if (command === "rooms") {
      const opened = await runConsoleRuntimeAction({ kind: "openNavigator", view: "nav_pr" });
      const snapshot = (await refreshSelectedRuntime()) ?? runtime;
      const query = rest.toLowerCase();
      const rooms = (snapshot?.navigator?.publicRoomNodes ?? [])
        .filter((entry) => !query || [entry.name, entry.unitStrId, entry.id, entry.port].some((value) => String(value ?? "").toLowerCase().includes(query)))
        .slice(0, 6);
      if (rooms.length === 0) {
        appendPacketConsole(opened.ok ? "warning" : "error", opened.ok ? "no matching public rooms loaded yet" : opened.message);
        return;
      }
      appendPacketConsole("success", rooms.map((entry) => `${compactValue(entry.name)} id=${compactValue(entry.id)} unit=${compactValue(entry.unitStrId)}`).join(" | "));
      return;
    }
    if (command === "fps" || command === "perf") {
      const snapshot = (await refreshSelectedRuntime()) ?? runtime;
      const stats = snapshot?.performanceStats;
      appendPacketConsole(
        "info",
        `fps=${compactValue(stats?.rafPerSecond ?? stats?.rafRate)} tempo=${compactValue(stats?.frameTempo)} director=${compactValue(stats?.directorTicksPerSecond ?? stats?.directorTickRate)} worstRafMs=${compactValue(finiteNumber(stats?.worstRafDeltaMs))}`,
      );
      if (command === "fps" && parts[0]) {
        appendPacketConsole("warning", "runtime FPS limit changes are not available yet.");
      }
      return;
    }
    if (command === "gpu") {
      const active = appPreferences?.hardwareAccelerationActive ?? true;
      const preferred = appPreferences?.hardwareAcceleration ?? true;
      const switches = appPreferences?.gpuLaunchSwitches.join(", ") || "none";
      const restart = appPreferences?.hardwareAccelerationRestartRequired ? " restart required" : " active";
      appendPacketConsole(
        appPreferences?.hardwareAccelerationRestartRequired ? "warning" : "info",
        `hardwareAcceleration=${active ? "on" : "off"} preference=${preferred ? "on" : "off"} state=${restart} launchSwitches=${switches}`,
      );
      return;
    }

    appendPacketConsole("warning", `unknown command "${command}". type help`);
  }, [
    appendPacketConsole,
    appPreferences,
    applyEngineLaunch,
    clientSessions?.selectedClientId,
    executeConsoleRendererActions,
    packetConsoleInput,
    packetInfoState.friendRequests,
    packetInfoState.friends,
    packetInfoState.privateMessages,
    packetClientChoices,
    packetProfileIndex,
    refreshRelayLog,
    refreshClientSessions,
    refreshConsoleCommandState,
    refreshSelectedClientSnapshot,
    refreshRuntimeSnapshot,
    runConsoleRuntimeAction,
    sendSocialAction,
    selectedClientIsVisible,
    selectedRuntimeSnapshot,
    selectedUserAccountId,
    selectedUserFigure,
    selectedUserName,
    selectedUserPosition,
    visibleActiveAccountNames,
    userRows,
  ]);

  const hideBulletinBoard = useCallback(
    async (mode: "auto" | "manual") => {
      const webview = webviewRef.current;
      if (!webview || !engineUrl) {
        const message = "Start the embedded client before hiding the Bulletin Board.";
        setAutomationMessage(message);
        if (mode === "manual") appendTimeline("warning", message);
        return;
      }
      if (mode === "manual") setRuntimeBusy(true);
      try {
        const result = await runEngineRuntimeAction(webview, { kind: "hideBulletinBoard" });
        const message = mode === "auto" ? `Auto-hide Bulletin: ${result.message}` : result.message;
        setAutomationMessage(message);
        if (result.ok && result.result && typeof result.result === "object" && "closed" in result.result && (result.result as { closed?: unknown }).closed === false) {
          return;
        }
        appendTimeline(result.ok ? "success" : "warning", message);
        await refreshRuntimeSnapshot();
      } finally {
        if (mode === "manual") setRuntimeBusy(false);
      }
    },
    [appendTimeline, engineUrl, refreshRuntimeSnapshot, selectedClientId],
  );

  const copyUserValue = useCallback(
    async (label: string, value: unknown) => {
      const text = compactValue(value);
      if (text === "-") {
        const message = `${label} is not exposed by the current room user data.`;
        setUserToolMessage(message);
        appendTimeline("warning", message);
        return;
      }
      const copied = await writeClipboardText(text);
      const message = copied ? `Copied ${label}.` : `Clipboard is unavailable for ${label}.`;
      setUserToolMessage(message);
      appendTimeline(copied ? "success" : "warning", message);
    },
    [appendTimeline],
  );

  const lookupPublicUser = useCallback(async () => {
    const name = publicLookupName.trim() || selectedUserName;
    if (!name || name === "-") {
      setPublicLookupResult({
        ok: false,
        query: "",
        source: "official-origins-public-api",
        id: "",
        name: "",
        figureString: "",
        motto: "",
        memberSince: "",
        profileVisible: null,
        selectedBadges: [],
        message: "Enter a Habbo name to look up.",
      });
      return;
    }
    if (!window.habbpyV4) {
      setPublicLookupResult({
        ok: false,
        query: name,
        source: "official-origins-public-api",
        id: "",
        name,
        figureString: "",
        motto: "",
        memberSince: "",
        profileVisible: null,
        selectedBadges: [],
        message: "Desktop bridge is not available in browser preview.",
      });
      return;
    }
    setPublicLookupBusy(true);
    try {
      const result = await window.habbpyV4.lookupOriginsUser(name);
      setPublicLookupResult(result);
      if (!publicLookupName.trim() && result.name) setPublicLookupName(result.name);
      appendTimeline(result.ok ? "success" : "warning", result.message);
    } finally {
      setPublicLookupBusy(false);
    }
  }, [appendTimeline, publicLookupName, selectedUserName]);

  const lookupMissingVisitorProfiles = useCallback(async () => {
    const missing = filteredVisitorEntries
      .filter((entry) => entry.accountId === "-" && entry.name && entry.name !== "-")
      .map((entry) => entry.name.trim())
      .filter(Boolean);
    const uniqueNames = [...new Set(missing.map((name) => name.toLowerCase()))]
      .map((lowerName) => missing.find((name) => name.toLowerCase() === lowerName) ?? lowerName);

    if (uniqueNames.length === 0) {
      const message = "No visitors need public profile lookup.";
      setVisitorLookupMessage(message);
      appendTimeline("info", message);
      return;
    }
    if (!window.habbpyV4) {
      const message = "Desktop bridge is not available for public visitor lookup.";
      setVisitorLookupMessage(message);
      appendTimeline("warning", message);
      return;
    }

    setVisitorLookupBusy(true);
    let found = 0;
    try {
      const updates: Record<string, OriginsUserLookupResult> = {};
      for (const name of uniqueNames) {
        const result = await window.habbpyV4.lookupOriginsUser(name);
        updates[name.toLowerCase()] = result;
        if (result.ok && result.id) found += 1;
      }
      setVisitorPublicProfiles((current) => ({ ...current, ...updates }));
      const message = `Public lookup checked ${uniqueNames.length} visitor${uniqueNames.length === 1 ? "" : "s"}; ${found} id${found === 1 ? "" : "s"} found.`;
      setVisitorLookupMessage(message);
      appendTimeline(found > 0 ? "success" : "warning", message);
    } finally {
      setVisitorLookupBusy(false);
    }
  }, [appendTimeline, filteredVisitorEntries]);

  const copySelectedUserProfile = useCallback(async () => {
    if (!selectedUser) {
      const message = "No room user is selected.";
      setUserToolMessage(message);
      appendTimeline("warning", message);
      return;
    }
    const profile = [
      `Name: ${selectedUserName}`,
      `Account: ${selectedUserAccountId}`,
      `Index: ${selectedUserIndex}`,
      `Gender: ${selectedUserGender}`,
      `Type: ${selectedUserType}`,
      `Badge: ${selectedUserBadgeCode}`,
      `Motto: ${selectedUserMotto}`,
      `Position: ${selectedUserPosition}`,
      `Direction: ${compactValue(selectedUser.direction)}`,
      `Figure: ${selectedUserFigure}`,
      `PH Figure: ${selectedUserPoolFigure}`,
    ].join("\n");
    const copied = await writeClipboardText(profile);
    const message = copied ? "Copied selected user profile snapshot." : "Clipboard is unavailable for the profile snapshot.";
    setUserToolMessage(message);
    appendTimeline(copied ? "success" : "warning", message);
  }, [
    appendTimeline,
    selectedUser,
    selectedUserAccountId,
    selectedUserBadgeCode,
    selectedUserFigure,
    selectedUserGender,
    selectedUserIndex,
    selectedUserMotto,
    selectedUserName,
    selectedUserPoolFigure,
    selectedUserPosition,
    selectedUserType,
  ]);

  const storeSelectedUserLook = useCallback(() => {
    if (!selectedUser || selectedUserFigure === "-") {
      const message = "Selected user figure is not exposed by the current room data.";
      setUserToolMessage(message);
      appendTimeline("warning", message);
      return;
    }
    setUserStoredLooks((current) => [selectedUserFigure, ...current.filter((entry) => entry !== selectedUserFigure)].slice(0, 20));
    setSelectedStoredUserLook(selectedUserFigure);
    const message = `Stored parsed look for ${selectedUserName}.`;
    setUserToolMessage(message);
    appendTimeline("success", message);
  }, [appendTimeline, selectedUser, selectedUserFigure, selectedUserName]);

  const copyStoredUserLook = useCallback(async () => {
    const look = activeStoredUserLook.trim();
    if (!look) {
      const message = "No stored user look is available.";
      setUserToolMessage(message);
      appendTimeline("warning", message);
      return;
    }
    const copied = await writeClipboardText(look);
    const message = copied ? "Copied stored user look." : "Clipboard is unavailable for the stored look.";
    setUserToolMessage(message);
    appendTimeline(copied ? "success" : "warning", message);
  }, [activeStoredUserLook, appendTimeline]);

  const clearStoredUserLooks = useCallback(() => {
    setUserStoredLooks([]);
    setSelectedStoredUserLook("");
    setUserToolMessage("Stored user looks cleared.");
  }, []);

  const updateInjectionDraft = useCallback(
    <K extends keyof InjectionCommandDraft>(key: K, value: InjectionCommandDraft[K]) => {
      setInjectionDraft((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const pushInjectionHistory = useCallback((entry: Omit<InjectionHistoryEntry, "id" | "time">) => {
    setInjectionHistory((current) =>
      [
        {
          ...entry,
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          time: new Date().toLocaleTimeString(),
        },
        ...current,
      ].slice(0, 50),
    );
  }, []);

  const executeInjectionCommand = useCallback(
    async (command: InjectionCommandDraft, label = injectionCommandLabel(command)) => {
      const userRelayAction = injectionDraftToUserRelayAction(command);
      if (userRelayAction) {
        if (!window.habbpyV4) {
          const message = "Run the Electron shell before using packet-backed User commands.";
          setInjectionMessage(message);
          pushInjectionHistory({ label, status: "warning", message });
          appendTimeline("warning", message);
          return;
        }
        const repeatCount = clampRepeatCount(injectionRepeatCount);
        const repeatInterval = clampRepeatInterval(injectionRepeatInterval);
        setRuntimeBusy(true);
        let lastResult: Awaited<ReturnType<NonNullable<typeof window.habbpyV4>["sendUserRelayAction"]>> = {
          ok: false,
          message: "Command did not run.",
        };
        try {
          for (let index = 0; index < repeatCount; index += 1) {
            lastResult = await window.habbpyV4.sendUserRelayAction(userRelayAction, selectedClientId);
            if (!lastResult.ok) break;
            if (index < repeatCount - 1) await delay(repeatInterval);
          }
          const message = repeatCount > 1 ? `${lastResult.message} (${repeatCount} requested)` : lastResult.message;
          setInjectionMessage(message);
          setRuntimeMessage(message);
          pushInjectionHistory({ label, status: lastResult.ok ? "success" : "warning", message });
          appendTimeline(lastResult.ok ? "success" : "warning", `${label}: ${message}`);
          await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setInjectionMessage(message);
          pushInjectionHistory({ label, status: "error", message });
          appendTimeline("error", message);
        } finally {
          setRuntimeBusy(false);
        }
        return;
      }

      const built = injectionDraftToRuntimeAction(command);
      if (built.blocked || !built.action) {
        const message = built.blocked ?? "Command is not runnable.";
        setInjectionMessage(message);
        pushInjectionHistory({ label, status: command.actionKind === "rawPacketBlocked" ? "blocked" : "warning", message });
        appendTimeline("warning", message);
        return;
      }
      const webview = webviewRef.current;
      if (!webview || !engineUrl) {
        const message = "Start the embedded client before using commands.";
        setInjectionMessage(message);
        pushInjectionHistory({ label, status: "warning", message });
        appendTimeline("warning", message);
        return;
      }
      const repeatCount = clampRepeatCount(injectionRepeatCount);
      const repeatInterval = clampRepeatInterval(injectionRepeatInterval);
      setRuntimeBusy(true);
      let lastResult: EngineRuntimeActionResult = { ok: false, message: "Command did not run." };
      try {
        for (let index = 0; index < repeatCount; index += 1) {
          lastResult = await runEngineRuntimeAction(webview, built.action);
          if (!lastResult.ok) break;
          if (index < repeatCount - 1) await delay(repeatInterval);
        }
        const message = repeatCount > 1 ? `${lastResult.message} (${repeatCount} requested)` : lastResult.message;
        setInjectionMessage(message);
        setRuntimeMessage(message);
        pushInjectionHistory({ label, status: lastResult.ok ? "success" : "warning", message });
        appendTimeline(lastResult.ok ? "success" : "warning", message);
        await refreshRuntimeSnapshot();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setInjectionMessage(message);
        pushInjectionHistory({ label, status: "error", message });
        appendTimeline("error", message);
      } finally {
        setRuntimeBusy(false);
      }
    },
    [
      appendTimeline,
      engineUrl,
      injectionRepeatCount,
      injectionRepeatInterval,
      pushInjectionHistory,
      refreshRelayLog,
      refreshRuntimeSnapshot,
      selectedClientId,
    ],
  );

  const addInjectionSnippet = useCallback(() => {
    const command = cloneInjectionDraft(injectionDraft);
    const label = injectionCommandLabel(command);
    const snippet: InjectionSnippet = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      label,
      command,
      createdAt: new Date().toISOString(),
    };
    setInjectionSnippets((current) => [snippet, ...current.filter((entry) => entry.label !== label)].slice(0, 50));
    setSelectedInjectionSnippetId(snippet.id);
    setInjectionMessage(`Saved snippet: ${label}`);
  }, [injectionDraft]);

  const loadInjectionSnippet = useCallback((snippet: InjectionSnippet) => {
    setInjectionDraft(cloneInjectionDraft(snippet.command));
    setSelectedInjectionSnippetId(snippet.id);
    setInjectionMessage(`Loaded snippet: ${snippet.label}`);
  }, []);

  const exportInjectionSnippets = useCallback(() => {
    if (injectionSnippets.length === 0) {
      setInjectionMessage("No saved snippets to export.");
      return;
    }
    const blob = new Blob([`${JSON.stringify(injectionSnippets, null, 2)}\n`], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `habbpy-v4-injection-snippets-${stamp}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setInjectionMessage(`Prepared export for ${injectionSnippets.length} snippets.`);
  }, [injectionSnippets]);

  const importInjectionSnippets = useCallback(async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text());
      const loaded = normalizeInjectionSnippets(parsed);
      if (loaded.length === 0) {
        setInjectionMessage("Snippet file did not contain supported v4 or v3 entries.");
        return;
      }
      setInjectionSnippets((current) => [...loaded, ...current].slice(0, 50));
      setSelectedInjectionSnippetId(loaded[0]?.id ?? "");
      setInjectionMessage(`Loaded ${loaded.length} snippets.`);
    } catch (error) {
      setInjectionMessage(error instanceof Error ? `Load failed: ${error.message}` : "Load failed.");
    }
  }, []);

  const refreshLibrary = useCallback(async () => {
    if (!window.habbpyV4) {
      setBridgeMessage("Run the Electron shell to import or embed a Shockless client.");
      return;
    }
    setAppInfo(await window.habbpyV4.getAppInfo());
    setAppPreferences(await window.habbpyV4.getAppPreferences());
    setPluginRegistryState(await window.habbpyV4.getPluginRegistryState());
    const nextLibrary = await window.habbpyV4.getClientLibraryState();
    setLibraryState(nextLibrary);
    setBridgeMessage(nextLibrary.message);
    applyEngineLaunch(await window.habbpyV4.getEngineLaunchState());
    await refreshClientSessions();
    void refreshFurniMetadata();
  }, [applyEngineLaunch, refreshClientSessions, refreshFurniMetadata]);

  const refreshPluginRegistry = useCallback(async () => {
    if (!window.habbpyV4?.getPluginRegistryState) return;
    const next = await window.habbpyV4.getPluginRegistryState();
    setPluginRegistryState(next);
    setPluginManagerMessage(next.message);
  }, []);

  useEffect(() => {
    if (!appPreferences || preferenceDefaultsAppliedRef.current) return;
    preferenceDefaultsAppliedRef.current = true;
    setPacketFilters((current) => ({
      ...current,
      wrap: appPreferences.packetOutputWrap,
      autoscroll: appPreferences.packetOutputAutoScroll,
    }));
    setMultiAccountFile(appPreferences.defaultAccountFile);
    setMultiAccountCount(String(appPreferences.defaultAccountCount));
    setMultiAccountConcurrency(String(appPreferences.defaultAccountConcurrency));
    setMultiAccountKeyEnv(appPreferences.defaultAccountKeyEnv);
    setMultiAccountSummonTarget(appPreferences.defaultSummonTarget);
    setMultiAccountLoadMode(appPreferences.defaultLoadMode);
  }, [appPreferences]);

  const setPluginEnabled = useCallback(
    async (plugin: PluginDefinition, enabled: boolean) => {
      if (!window.habbpyV4?.setPluginEnabled) {
        dispatch({ type: "setPluginEnabled", pluginId: plugin.id, enabled });
        return;
      }
      const next = await window.habbpyV4.setPluginEnabled(plugin.id, enabled);
      setPluginRegistryState(next);
      setPluginManagerMessage(next.message);
      appendTimeline(enabled ? "success" : "info", next.message);
    },
    [appendTimeline],
  );

  const setPluginSurfaceEnabled = useCallback(
    async (pluginId: string, surfaceId: string, enabled: boolean) => {
      if (!window.habbpyV4?.setPluginSurfaceEnabled) {
        dispatch({ type: "setPluginUiSurfaceEnabled", pluginId, surfaceId, enabled });
        return;
      }
      const next = await window.habbpyV4.setPluginSurfaceEnabled(pluginId, surfaceId, enabled);
      setPluginRegistryState(next);
      setPluginManagerMessage(next.message);
      appendTimeline("info", next.message);
    },
    [appendTimeline],
  );

  const reloadPlugins = useCallback(async () => {
    if (!window.habbpyV4?.reloadPlugins) return;
    const next = await window.habbpyV4.reloadPlugins();
    setPluginRegistryState(next);
    setPluginManagerMessage(next.message);
    appendTimeline("success", next.message);
  }, [appendTimeline]);

  const openPluginsFolder = useCallback(async () => {
    if (!window.habbpyV4?.openPluginsFolder) return;
    const result = await window.habbpyV4.openPluginsFolder();
    setPluginRegistryState(result.state);
    setPluginManagerMessage(result.message);
    appendTimeline(result.ok ? "success" : "warning", result.message);
  }, [appendTimeline]);

  const createPluginFromTemplate = useCallback(async () => {
    if (!window.habbpyV4?.createPluginFromTemplate) return;
    const result = await window.habbpyV4.createPluginFromTemplate({ id: newPluginId, name: newPluginName });
    setPluginRegistryState(result.state);
    setPluginManagerMessage(result.message);
    appendTimeline(result.ok ? "success" : "warning", result.message);
  }, [appendTimeline, newPluginId, newPluginName]);

  const installPluginFromFolder = useCallback(async () => {
    if (!window.habbpyV4?.installPluginFromFolder) return;
    const result = await window.habbpyV4.installPluginFromFolder();
    setPluginRegistryState(result.state);
    setPluginManagerMessage(result.message);
    appendTimeline(result.ok ? "success" : "warning", result.message);
  }, [appendTimeline]);

  const importClientReference = useCallback(async () => {
    if (!window.habbpyV4) return;
    setProfileImportUi(pendingProfileImportUiState());
    setEngineBusy(true);
    try {
      const nextLibrary = await window.habbpyV4.importClientReference();
      setLibraryState(nextLibrary);
      setBridgeMessage(nextLibrary.message);
      applyEngineLaunch(await window.habbpyV4.getEngineLaunchState());
      await refreshClientSessions();
      setProfileImportUi((current) => profileImportUiFinished(current, nextLibrary.message, false));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Import/build failed.";
      setBridgeMessage(message);
      setProfileImportUi((current) => profileImportUiFinished(current, message, true));
    } finally {
      setEngineBusy(false);
    }
  }, [applyEngineLaunch, refreshClientSessions]);

  const selectClientProfile = useCallback(
    async (profileRoot: string) => {
      if (!window.habbpyV4) return;
      const nextLibrary = await window.habbpyV4.setActiveClientProfile(profileRoot);
      setLibraryState(nextLibrary);
      setBridgeMessage(nextLibrary.message);
      applyEngineLaunch(await window.habbpyV4.getEngineLaunchState());
      await refreshClientSessions();
    },
    [applyEngineLaunch, refreshClientSessions],
  );

  const startEngine = useCallback(async () => {
    if (!window.habbpyV4) {
      setBridgeMessage("Run npm run electron:dev to use embedded Shockless.");
      return;
    }
    setEngineBusy(true);
    try {
      applyEngineLaunch(await window.habbpyV4.startEmbeddedEngine());
      await refreshClientSessions();
    } finally {
      setEngineBusy(false);
    }
  }, [applyEngineLaunch, refreshClientSessions]);

  const stopEngine = useCallback(async () => {
    if (!window.habbpyV4) return;
    setEngineBusy(true);
    try {
      applyEngineLaunch(await window.habbpyV4.stopEmbeddedEngine());
      await refreshClientSessions();
    } finally {
      setEngineBusy(false);
    }
  }, [applyEngineLaunch, refreshClientSessions]);

  const updateEngineLaunchSettings = useCallback(
    async (patch: EngineLaunchSettingsPatch, message = "Launch settings updated.") => {
      if (!window.habbpyV4?.setEngineLaunchSettings) return;
      setEngineBusy(true);
      try {
        const launch = await window.habbpyV4.setEngineLaunchSettings(patch);
        applyEngineLaunch(launch);
        await refreshClientSessions();
        setBridgeMessage(message);
        appendTimeline("success", message);
      } finally {
        setEngineBusy(false);
      }
    },
    [appendTimeline, applyEngineLaunch, refreshClientSessions],
  );

  const applyVersionCheckBuild = useCallback(() => {
    const trimmed = versionCheckDraft.trim();
    if (!trimmed) {
      void updateEngineLaunchSettings({ versionCheckBuild: null }, "Version check override cleared; profile/default value will be used.");
      return;
    }
    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== trimmed) {
      setBridgeMessage("Version check build must be a positive integer, or blank for auto/profile default.");
      appendTimeline("warning", "Invalid version check build override.");
      return;
    }
    void updateEngineLaunchSettings({ versionCheckBuild: parsed }, `Version check override set to ${parsed}.`);
  }, [appendTimeline, updateEngineLaunchSettings, versionCheckDraft]);

  useEffect(() => {
    const timer = window.setTimeout(() => setBooting(false), 5000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (railPlugins.some((plugin) => plugin.id === state.selectedPluginId)) return;
    dispatch({ type: "selectPlugin", pluginId: "plugin-manager" });
  }, [railPlugins, state.selectedPluginId]);

  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary]);

  useEffect(() => {
    const value = engineLaunch?.settings?.versionCheckBuild ?? selectedProfile?.versionCheckBuild ?? null;
    setVersionCheckDraft(value ? String(value) : "");
  }, [engineLaunch?.settings?.versionCheckBuild, selectedProfile?.id, selectedProfile?.versionCheckBuild]);

  useEffect(() => {
    const latest = profileImportUi.latest;
    const completed =
      latest?.stage === "validate-profile" &&
      (latest.state === "done" || latest.state === "warning") &&
      latest.jobId !== completedImportRefreshRef.current;
    if (!completed) return;
    completedImportRefreshRef.current = latest.jobId;
    void refreshLibrary();
  }, [profileImportUi.latest, refreshLibrary]);

  useEffect(() => {
    const unsubscribe = window.habbpyV4?.onProfileImportProgress?.((progress) => {
      startTransition(() => {
        setProfileImportUi((current) => profileImportUiWithProgress(current, progress));
      });
    });
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    if (!profileImportRunning) return;
    setProfileImportNow(Date.now());
    const timer = window.setInterval(() => setProfileImportNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [profileImportRunning]);

  useEffect(() => {
    try {
      setInjectionSnippets(normalizeInjectionSnippets(JSON.parse(window.localStorage.getItem(injectionSnippetStorageKey) || "[]")));
      const parsedHistory = JSON.parse(window.localStorage.getItem(injectionHistoryStorageKey) || "[]");
      setInjectionHistory(Array.isArray(parsedHistory) ? parsedHistory.slice(0, 50) : []);
    } catch {
      setInjectionSnippets([]);
      setInjectionHistory([]);
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(injectionSnippetStorageKey, JSON.stringify(injectionSnippets.slice(0, 50)));
    } catch {
      // Local browser storage is optional; snippets still work in memory.
    }
  }, [injectionSnippets]);

  useEffect(() => {
    try {
      window.localStorage.setItem(injectionHistoryStorageKey, JSON.stringify(injectionHistory.slice(0, 50)));
    } catch {
      // Local browser storage is optional; history still works in memory.
    }
  }, [injectionHistory]);

  useEffect(() => {
    if (!selectedStoredUserLook && userStoredLooks.length > 0) {
      setSelectedStoredUserLook(userStoredLooks[0]);
    }
  }, [selectedStoredUserLook, userStoredLooks]);

  useEffect(() => {
    try {
      window.localStorage.setItem(userStoredLookStorageKey, JSON.stringify(userStoredLooks.slice(0, 20)));
    } catch {
      // Local browser storage is optional; stored looks still work in memory.
    }
  }, [userStoredLooks]);

  useEffect(() => {
    try {
      window.localStorage.setItem(automationPrefsStorageKey, JSON.stringify(automationPrefs));
    } catch {
      // Local browser storage is optional; automation preferences still work in memory.
    }
  }, [automationPrefs]);

  useEffect(() => {
    if (!window.habbpyV4) return;
    const active =
      packetConsoleOpen ||
      selectedPlugin.id === "connection" ||
      selectedPlugin.id === "packet-log" ||
      selectedPlugin.id === "automation" ||
      selectedPlugin.id === "chat" ||
      selectedPlugin.id === "dev-tools" ||
      selectedPlugin.id === "fishing" ||
      selectedPlugin.id === "gardening" ||
      selectedPlugin.id === "info" ||
      selectedPlugin.id === "inventory" ||
      selectedPlugin.id === "items" ||
      selectedPlugin.id === "present-catcher" ||
      selectedPlugin.id === "social" ||
      selectedPlugin.id === "user" ||
      selectedPlugin.id === "visitors" ||
      selectedPlugin.id === "wall-mover";
    if (!active) return;
    let cancelled = false;
    let inFlight = false;
    const readLog = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        await refreshRelayLog();
      } catch {
        if (!cancelled) {
          relayLogRef.current = null;
          setRelayLog(null);
        }
      } finally {
        inFlight = false;
      }
    };
    void readLog();
    const interval = window.setInterval(() => void readLog(), 2500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [packetConsoleOpen, refreshRelayLog, selectedPlugin.id]);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview || !engineUrl) return;
    let cancelled = false;
    let inFlight = false;
    const scopes = runtimeProbeScopesForPlugin(selectedPlugin.id);

    const readRuntimeProbe = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const probe = await readEngineRuntimeSnapshot(webview, scopes);
        if (cancelled) return;
        applyRuntimeSnapshot(probe);
      } catch {
        if (!cancelled) {
          dispatch({
            type: "mergeEngineStatus",
            status: {
              location: "Shockless loading",
            },
          });
        }
      } finally {
        inFlight = false;
      }
    };

    const onLoad = () => void readRuntimeProbe();
    webview.addEventListener("did-finish-load", onLoad);
    const interval = window.setInterval(() => void readRuntimeProbe(), 2500);
    void readRuntimeProbe();

    return () => {
      cancelled = true;
      webview.removeEventListener("did-finish-load", onLoad);
      window.clearInterval(interval);
    };
  }, [applyRuntimeSnapshot, engineUrl, selectedClientId, selectedPlugin.id]);

  useEffect(() => {
    if (appPreferences?.autoSubmitVisibleLogin === false) return;
    const submitBridge = window.habbpyV4?.submitVisibleClientLogin;
    if (!submitBridge) return;
    let cancelled = false;
    const timers: number[] = [];
    const listenerCleanups: Array<() => void> = [];
    const sessionById = new globalThis.Map((clientSessions?.sessions ?? []).map((session) => [session.id, session]));

    const submitVisibleLogin = async (view: GameWebviewMount) => {
      const loginKey = `${view.id}:${view.url}`;
      if (cancelled || view.id === 1 || visibleLoginSubmittedRef.current.has(loginKey) || visibleLoginInFlightRef.current.has(loginKey)) return;
      const session = sessionById.get(view.id);
      if (!session?.visible || session.headless || session.status !== "running") return;
      const webview = gameWebviewRefs.current.get(view.id);
      if (!webview) return;
      if (typeof webview.getWebContentsId !== "function") return;
      const webContentsId = Number(webview.getWebContentsId());
      if (!Number.isFinite(webContentsId) || webContentsId <= 0) return;
      visibleLoginInFlightRef.current.add(loginKey);
      try {
        const result = await submitBridge(view.id, webContentsId);
        if (!result || cancelled) return;
        if (result.ok) {
          visibleLoginSubmittedRef.current.add(loginKey);
          visibleLoginWarnedRef.current.delete(loginKey);
          appendTimeline("success", result.message);
          await refreshClientSessions().catch(() => null);
          await refreshSelectedClientSnapshot(view.id).catch(() => null);
          return;
        }
        if (!visibleLoginWarnedRef.current.has(loginKey)) {
          visibleLoginWarnedRef.current.add(loginKey);
          appendTimeline("warning", result.message);
        }
      } finally {
        visibleLoginInFlightRef.current.delete(loginKey);
      }
    };

    for (const view of mountedVisibleGameViews) {
      if (view.id === 1) continue;
      const webview = gameWebviewRefs.current.get(view.id);
      if (!webview) continue;
      const onLoad = () => {
        const timer = window.setTimeout(() => void submitVisibleLogin(view), 750);
        timers.push(timer);
      };
      webview.addEventListener("did-finish-load", onLoad);
      listenerCleanups.push(() => webview.removeEventListener("did-finish-load", onLoad));
      timers.push(window.setTimeout(() => void submitVisibleLogin(view), 750));
      timers.push(window.setInterval(() => void submitVisibleLogin(view), 5000));
    }

    return () => {
      cancelled = true;
      for (const cleanup of listenerCleanups) cleanup();
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [
    appendTimeline,
    appPreferences?.autoSubmitVisibleLogin,
    clientSessions?.sessions,
    gameWebviewMountEpoch,
    mountedVisibleGameViews,
    refreshClientSessions,
    refreshSelectedClientSnapshot,
  ]);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview || !engineUrl || !engineUserNameLabels || !selectedClientIsVisible) return;
    let cancelled = false;
    let inFlight = false;
    let applied = false;
    let attempts = 0;
    let interval: number | null = null;
    const applyNameLabels = async () => {
      if (cancelled || inFlight || applied) return;
      attempts += 1;
      inFlight = true;
      try {
        const result = await runEngineRuntimeAction(webview, { kind: "setUserNameLabels", enabled: true });
        if (!cancelled && result.ok) {
          applied = true;
          setRuntimeMessage(result.message);
          if (interval !== null) {
            window.clearInterval(interval);
            interval = null;
          }
        }
      } finally {
        inFlight = false;
      }
      if (attempts >= 20 && interval !== null) {
        window.clearInterval(interval);
        interval = null;
      }
    };
    const onLoad = () => {
      applied = false;
      attempts = 0;
      window.setTimeout(() => void applyNameLabels(), 750);
    };
    webview.addEventListener("did-finish-load", onLoad);
    const timer = window.setTimeout(() => void applyNameLabels(), 1200);
    interval = window.setInterval(() => void applyNameLabels(), 1000);
    return () => {
      cancelled = true;
      webview.removeEventListener("did-finish-load", onLoad);
      window.clearTimeout(timer);
      if (interval !== null) window.clearInterval(interval);
    };
  }, [engineUrl, engineUserNameLabels, selectedClientId, selectedClientIsVisible]);

  useEffect(() => {
    if (!selectedRuntimeSnapshot) return;
    const nextKey = roomReady
      ? `room:${runtimeRoomType(selectedRuntimeSnapshot)}:${runtimeRoomId(selectedRuntimeSnapshot)}:${runtimeRoomName(selectedRuntimeSnapshot)}`
      : engineUrl
        ? "not-ready"
        : "stopped";
    const previousKey = lastChatRoomMarkerKeyRef.current;
    if (previousKey === nextKey) return;
    lastChatRoomMarkerKeyRef.current = nextKey;

    const markerText = roomReady
      ? `Entered room: ${runtimeRoomName(selectedRuntimeSnapshot)}`
      : previousKey.startsWith("room:")
        ? "Room cleared."
        : "";
    if (!markerText) return;

    const marker: RuntimeChatEntry = {
      index: Date.now(),
      timestamp: new Date().toLocaleTimeString(),
      userName: "Room",
      chatMode: "system",
      text: markerText,
    };
    setChatRoomMarkers((current) => [...current.slice(-99), marker]);
  }, [engineUrl, roomReady, selectedRuntimeSnapshot]);

  useEffect(() => {
    if (!automationPrefs.autoHideBulletin || !selectedRuntimeSnapshot || !engineUrl) return;
    const bulletinWindows = selectedRuntimeSnapshot.windowIds.filter((id) => /bulletin|welcome|news/i.test(id));
    if (bulletinWindows.length === 0) return;
    const nextKey = `${engineUrl}:${bulletinWindows.join("|")}`;
    if (lastAutoHideBulletinKeyRef.current === nextKey) return;
    lastAutoHideBulletinKeyRef.current = nextKey;
    void hideBulletinBoard("auto");
  }, [automationPrefs.autoHideBulletin, engineUrl, hideBulletinBoard, selectedRuntimeSnapshot]);

  useEffect(() => {
    if (selectedPlugin.id !== "chat" || !chatFilters.autoscroll) return;
    const list = chatListRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [chatFilters.autoscroll, selectedPlugin.id, visibleChatHistory.length]);

  useEffect(() => {
    if (selectedPlugin.id !== "packet-log" || !packetFilters.autoscroll) return;
    const list = packetListRef.current;
    if (list) {
      list.scrollTop = list.scrollHeight;
      startTransition(() => {
        setPacketListScrollTop(list.scrollTop);
      });
    }
  }, [packetFilters.autoscroll, selectedPlugin.id, visiblePacketEntries.length]);

  useEffect(() => {
    if (!packetConsoleOpen) return;
    const list = packetConsoleListRef.current;
    if (list) list.scrollTop = list.scrollHeight;
    const packetList = packetConsolePacketListRef.current;
    if (packetList) {
      packetList.scrollTop = packetList.scrollHeight;
      startTransition(() => {
        setPacketConsoleScrollTop(packetList.scrollTop);
      });
    }
  }, [packetConsoleEntries.length, packetConsoleOpen, packetConsolePacketEntries.length]);

  useEffect(() => {
    const sourceUsers = selectedRuntimeSnapshot?.userState?.users ?? [];
    const packetVisitors = latestPacketVisitorUsers(packetProfileUsers);
    setVisitorState((current) => {
      if (!roomReady || !visitorRoomKey) {
        if (current.roomKey === "" && Object.keys(current.entries).length === 0) return current;
        return emptyVisitorState;
      }

      const sameRoom = current.roomKey === visitorRoomKey;
      const previousActive = sameRoom ? new Set(current.activeKeys) : new Set<string>();
      const nextActive = new Set<string>();
      const nextEntries: Record<string, VisitorEntry> = sameRoom ? { ...current.entries } : {};
      const now = new Date().toLocaleTimeString();
      const matchedPacketKeys = new Set<string>();

      for (const user of sourceUsers.filter(isVisitorUser)) {
        const packetUser = packetProfileForRuntimeUser(packetProfileIndex, user, selectedRuntimeSnapshot?.userState?.sessionUserName);
        if (packetUser) {
          const packetAccountId = compactValue(packetUser.accountId);
          matchedPacketKeys.add(packetAccountId !== "-" ? `id:${packetAccountId}` : `name:${packetUser.name.trim().toLowerCase()}`);
        }
        const key = visitorKeyFor(user, selectedRuntimeSnapshot?.userState?.sessionUserName, packetUser);
        nextActive.add(key);
        const previous = nextEntries[key];
        const reentered = Boolean(previous) && !previousActive.has(key);
        nextEntries[key] = {
          ...visitorEntryFor(user, selectedRuntimeSnapshot?.userState?.sessionUserName, now, previous, packetUser),
          visits: previous ? previous.visits + (reentered ? 1 : 0) : 1,
          entered: previous && !reentered ? previous.entered : now,
        };
      }

      for (const packetUser of packetVisitors) {
        const packetAccountId = compactValue(packetUser.accountId);
        const packetKey = packetAccountId !== "-" ? `id:${packetAccountId}` : `name:${packetUser.name.trim().toLowerCase()}`;
        if (matchedPacketKeys.has(packetKey)) continue;
        nextActive.add(packetKey);
        const previous = nextEntries[packetKey];
        const reentered = Boolean(previous) && !previousActive.has(packetKey);
        nextEntries[packetKey] = {
          ...visitorEntryForPacketUser(packetUser, now, previous),
          visits: previous ? previous.visits + (reentered ? 1 : 0) : 1,
          entered: previous && !reentered ? previous.entered : now,
        };
      }

      for (const key of previousActive) {
        if (!nextActive.has(key) && nextEntries[key]?.current) {
          nextEntries[key] = {
            ...nextEntries[key],
            current: false,
            left: now,
          };
        }
      }

      return {
        roomKey: visitorRoomKey,
        activeKeys: [...nextActive],
        entries: nextEntries,
      };
    });
  }, [packetProfileIndex, packetProfileUsers, roomReady, selectedRuntimeSnapshot?.userState?.sessionUserName, selectedRuntimeSnapshot?.userState?.users, visitorRoomKey]);

  return (
    <main className={`app-shell ${state.ui.dockCollapsed ? "dock-collapsed" : ""}`}>
      <BootSplash booting={booting} />

      <section className="game-region" aria-label="Embedded Shockless game area">
        <TopBar
          desktopBridgeAvailable={desktopBridgeAvailable}
          engineBusy={engineBusy}
          profileImportRunning={profileImportRunning}
          engineUrl={engineUrl}
          engineLaunch={engineLaunch}
          selectedProfile={selectedProfile}
          clientSessions={clientSessions}
          selectedClientSession={selectedClientSession}
          selectedClientSnapshotLabel={state.engine.profileLabel}
          engineLocation={state.engine.location}
          engineEmbedded={state.engine.embedded}
          clientSessionTitle={clientSessionTitle}
          onRefresh={() => void refreshLibrary()}
          onStop={() => void stopEngine()}
          onStart={() => void startEngine()}
          onSelectClientSession={(id) => void selectClientSession(id)}
          onAddManualVisibleClient={() => void addManualVisibleClient()}
        />

        <div className={`game-frame ${hasMountedVisibleGameViews ? "embedded" : ""}`}>
          <div className="game-toolbar">
            <span>GameHost</span>
            <span>{state.engine.profileLabel}</span>
          </div>
          <div className="game-stage">
            {hasMountedVisibleGameViews ? (
              <div className="game-webview-stack">
                {mountedVisibleGameViews.map((view) => {
                  const active = view.id === selectedClientId && Boolean(engineUrl) && view.url === engineUrl;
                  return (
                    <div
                      key={`client-${view.id}`}
                      className={`game-webview-zoom-surface ${active ? "active" : "inactive"}`}
                      aria-hidden={!active}
                      data-client-id={view.id}
                      data-client-label={view.label}
                    >
                      <webview
                        ref={gameWebviewRefForClient(view.id)}
                        className="game-webview"
                        src={view.url}
                        partition={view.partition}
                        webpreferences="contextIsolation=yes,nodeIntegration=no"
                      />
                    </div>
                  );
                })}
                {!engineUrl ? (
                  <div className="game-placeholder game-placeholder-overlay">
                    {selectedClientSession && !selectedClientIsVisible ? (
                      <div className="hotel-card">
                        <img className="hotel-avatar" src="./img/avatar.png" alt="" aria-hidden="true" />
                        <div>
                          <strong>Headless client selected</strong>
                          <p>client{selectedClientId} is headless; select a visible session to render a game view.</p>
                        </div>
                      </div>
                    ) : (
                      <ImporterWorkspace
                        bridgeAvailable={desktopBridgeAvailable}
                        bridgeMessage={bridgeMessage}
                        engineBusy={engineBusy || profileImportRunning}
                        settingsBusy={engineBusy && !profileImportRunning}
                        engineLaunch={engineLaunch}
                        elapsedMs={profileImportElapsedMs}
                        importState={profileImportUi}
                        profiles={libraryState?.profiles ?? []}
                        selectedProfile={selectedProfile}
                        onImport={() => void importClientReference()}
                        onRefresh={() => void refreshLibrary()}
                        onStart={() => void startEngine()}
                        onSetCustomHotelView={(enabled) => void updateEngineLaunchSettings({ customHotelView: enabled }, `Custom hotel view ${enabled ? "enabled" : "disabled"}.`)}
                        onSetResizablePresentation={(enabled) => void updateEngineLaunchSettings({ resizablePresentation: enabled }, `Responsive stage resize ${enabled ? "enabled" : "disabled"}.`)}
                        onSetVersionCheckBuild={applyVersionCheckBuild}
                        versionCheckDraft={versionCheckDraft}
                        onVersionCheckDraftChange={setVersionCheckDraft}
                      />
                    )}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="game-placeholder">
                {selectedClientSession && !selectedClientIsVisible ? (
                  <div className="hotel-card">
                    <img className="hotel-avatar" src="./img/avatar.png" alt="" aria-hidden="true" />
                    <div>
                      <strong>Headless client selected</strong>
                      <p>client{selectedClientId} is headless; select a visible session to render a game view.</p>
                    </div>
                  </div>
                ) : (
                  <ImporterWorkspace
                    bridgeAvailable={desktopBridgeAvailable}
                    bridgeMessage={bridgeMessage}
                    engineBusy={engineBusy || profileImportRunning}
                    settingsBusy={engineBusy && !profileImportRunning}
                    engineLaunch={engineLaunch}
                    elapsedMs={profileImportElapsedMs}
                    importState={profileImportUi}
                    profiles={libraryState?.profiles ?? []}
                    selectedProfile={selectedProfile}
                    onImport={() => void importClientReference()}
                    onRefresh={() => void refreshLibrary()}
                    onStart={() => void startEngine()}
                    onSetCustomHotelView={(enabled) => void updateEngineLaunchSettings({ customHotelView: enabled }, `Custom hotel view ${enabled ? "enabled" : "disabled"}.`)}
                    onSetResizablePresentation={(enabled) => void updateEngineLaunchSettings({ resizablePresentation: enabled }, `Responsive stage resize ${enabled ? "enabled" : "disabled"}.`)}
                    onSetVersionCheckBuild={applyVersionCheckBuild}
                    versionCheckDraft={versionCheckDraft}
                    onVersionCheckDraftChange={setVersionCheckDraft}
                  />
                )}
              </div>
            )}
          </div>
          {packetConsoleOpen ? (
            <div className="packet-console" aria-label="Packet log console">
              <div className="packet-console-header">
                <div>
                  <Terminal size={14} />
                  <strong>Packet Log</strong>
                  <span>{compactValue(packetConsolePacketEntries.length)} rows</span>
                  <span>{packetConsoleClientFilter === "All" ? "all clients" : `client${packetConsoleClientFilter}`}</span>
                  {packetConsoleQuery ? <span>filter: {packetConsoleQuery}</span> : null}
                </div>
                <select
                  className="packet-console-client-select"
                  value={packetConsoleClientFilter}
                  onChange={(event) => setPacketConsoleClientFilter(event.currentTarget.value)}
                  aria-label="Packet console client filter"
                >
                  {packetClientChoices.map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {choice.label}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => setPacketConsoleOpen(false)} aria-label="Close packet log console">
                  `
                </button>
              </div>
              <div className="packet-console-list" ref={packetConsoleListRef}>
                {packetConsoleEntries.slice(-80).map((entry) => (
                  <div className={`packet-console-output ${entry.kind}`} key={entry.id}>
                    <span>{entry.time}</span>
                    <strong>{entry.kind === "command" ? ">" : statusLabel(entry.kind)}</strong>
                    <small>{entry.text}</small>
                  </div>
                ))}
                {packetConsolePacketEntries.length > 0 ? (
                  <div className="packet-console-packet-list" ref={packetConsolePacketListRef} onScroll={handlePacketConsoleScroll}>
                    <div className="packet-console-packet-space" style={{ height: packetConsoleVirtualRange.height }}>
                      <div
                        className="packet-console-packet-window"
                        style={{ transform: `translateY(${packetConsoleVirtualRange.top}px)` }}
                      >
                        {renderedPacketConsoleEntries.map((entry) => (
                          <code className={`packet-console-packet-row packet-${entry.direction.toLowerCase()}`} key={entry.id}>
                            {relayEntryV3Line(entry, relayLog?.updatedAt)}
                          </code>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
                {packetConsolePacketEntries.length === 0 ? (
                  <div className="packet-console-empty">
                    {packetEntries.length === 0 ? "Start the embedded client to create relay rows." : "No packets match this filter."}
                  </div>
                ) : null}
              </div>
              <div className="packet-console-input-row">
                <span>`</span>
                <input
                  value={packetConsoleInput}
                  onChange={(event) => setPacketConsoleInput(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void executePacketConsoleCommand();
                      return;
                    }
                    if (event.key === "ArrowUp") {
                      const history = consoleCommandState?.history ?? [];
                      if (history.length === 0) return;
                      event.preventDefault();
                      const nextIndex = packetConsoleHistoryIndex === null
                        ? history.length - 1
                        : Math.max(0, packetConsoleHistoryIndex - 1);
                      setPacketConsoleHistoryIndex(nextIndex);
                      setPacketConsoleInput(history[nextIndex] ?? "");
                      return;
                    }
                    if (event.key === "ArrowDown") {
                      const history = consoleCommandState?.history ?? [];
                      if (history.length === 0 || packetConsoleHistoryIndex === null) return;
                      event.preventDefault();
                      const nextIndex = packetConsoleHistoryIndex + 1;
                      if (nextIndex >= history.length) {
                        setPacketConsoleHistoryIndex(null);
                        setPacketConsoleInput("");
                      } else {
                        setPacketConsoleHistoryIndex(nextIndex);
                        setPacketConsoleInput(history[nextIndex] ?? "");
                      }
                    }
                  }}
                  placeholder="help / alias bringall summon all / bind F1 bringall / packets client 2"
                  aria-label="Packet console command"
                />
              </div>
            </div>
          ) : null}
          <RoomOverlays
            roomPluginEnabled={pluginEnabledById.room !== false}
            roomOverlayEnabled={Boolean(pluginSurfaceEnabledByPluginId.room?.overlay)}
            devToolsPluginEnabled={pluginEnabledById["dev-tools"] !== false}
            devToolsStatusEnabled={Boolean(pluginSurfaceEnabledByPluginId["dev-tools"]?.status)}
            roomReady={roomReady}
            privateRoomReady={privateRoomReady}
            runtimeSnapshot={selectedRuntimeSnapshot}
            gameZoom={gameZoom}
            fps={state.engine.fps ?? selectedRuntimeSnapshot?.performanceStats?.currentFps ?? selectedRuntimeSnapshot?.performanceStats?.rafPerSecond ?? null}
            onCloseRoomOverlay={() => void setPluginSurfaceEnabled("room", "overlay", false)}
            onCloseFpsOverlay={() => void setPluginSurfaceEnabled("dev-tools", "status", false)}
            onZoomToggle={() => void setEmbeddedRoomZoom(gameZoom === 1 ? 2 : 1)}
          />
        </div>
      </section>

      <aside className="plugin-dock" aria-label="Plugin dock" data-selected-plugin={selectedPlugin.id}>
        <IconRail
          dockCollapsed={state.ui.dockCollapsed}
          filteredPlugins={filteredPlugins}
          pluginEnabledById={pluginEnabledById}
          selectedPluginId={selectedPlugin.id}
          PluginIcon={PluginIcon}
          onToggleDock={() => dispatch({ type: "toggleDockCollapsed" })}
          onSelectPlugin={(pluginId) => {
            // Toggle: clicking the icon of the already-open panel closes it; clicking any
            // other icon (or while closed) opens that panel. Previously a click only ever
            // opened/switched, so the open tab could never be closed by its own icon.
            if (!state.ui.dockCollapsed && selectedPlugin.id === pluginId) {
              dispatch({ type: "toggleDockCollapsed" });
            } else {
              dispatch({ type: "selectPlugin", pluginId });
              if (state.ui.dockCollapsed) dispatch({ type: "toggleDockCollapsed" });
            }
          }}
        />

        {!state.ui.dockCollapsed ? (
          <section className="plugin-panel" aria-label={`${selectedPlugin.name} panel`}>
            <div className="panel-title">
              <div className="panel-icon">
                <PluginIcon plugin={selectedPlugin} />
              </div>
              <div>
                <h2>{selectedPlugin.name}</h2>
                <p>{labelCase(selectedPlugin.category)}</p>
              </div>
            </div>

            {selectedPlugin.id === "connection" ? (
              <ConnectionPanel
                desktopBridgeAvailable={desktopBridgeAvailable}
                engineBusy={engineBusy}
                profileImportRunning={profileImportRunning}
                libraryState={libraryState}
                bridgeMessage={bridgeMessage}
                engineLaunch={engineLaunch}
                relaySessionId={relaySessionId}
                selectedRuntimeSnapshot={selectedRuntimeSnapshot}
                selectedClientRelayLog={selectedClientRelayLog}
                latestClientPacket={latestClientPacket}
                latestServerPacket={latestServerPacket}
                selectedClientSnapshot={selectedClientSnapshot}
                selectedClientSession={selectedClientSession}
                selectedClientId={selectedClientId}
                packetProfileUsers={packetProfileUsers}
                packetInfoState={packetInfoState}
                packetChatEntries={packetChatEntries}
                packetInventoryState={packetInventoryState}
                packetWallItemState={packetWallItemState}
                relayEncryptionState={relayEncryptionState}
                relayClientModes={relayClientModes}
                relayServerModes={relayServerModes}
                relayBodyLoggingState={relayBodyLoggingState}
                onImportClientReference={() => void importClientReference()}
                onSelectClientProfile={(root) => void selectClientProfile(root)}
              />
            ) : null}

            {selectedPlugin.id === "plugin-manager" ? (
              <PluginManagerPanel
                desktopBridgeAvailable={desktopBridgeAvailable}
                pluginRegistryState={pluginRegistryState}
                availablePlugins={availablePlugins}
                pluginEnabledById={pluginEnabledById}
                pluginSurfaceEnabledByPluginId={pluginSurfaceEnabledByPluginId}
                pinnedPluginIds={pinnedPluginIds}
                pluginManagerMessage={pluginManagerMessage}
                newPluginId={newPluginId}
                newPluginName={newPluginName}
                onReloadPlugins={() => void reloadPlugins()}
                onOpenPluginsFolder={() => void openPluginsFolder()}
                onInstallPluginFromFolder={() => void installPluginFromFolder()}
                onSetNewPluginId={setNewPluginId}
                onSetNewPluginName={setNewPluginName}
                onCreatePluginFromTemplate={() => void createPluginFromTemplate()}
                onSetPluginEnabled={(plugin, enabled) => void setPluginEnabled(plugin, enabled)}
                onSetPluginSurfaceEnabled={(pluginId, surfaceId, enabled) => void setPluginSurfaceEnabled(pluginId, surfaceId, enabled)}
              />
            ) : null}

            {selectedPlugin.id === "settings" ? (
              <SettingsPanel
                desktopBridgeAvailable={desktopBridgeAvailable}
                engineBusy={engineBusy}
                engineLaunch={engineLaunch}
                versionCheckDraft={versionCheckDraft}
                appPreferences={appPreferences}
                settingsBindKey={settingsBindKey}
                settingsBindCommand={settingsBindCommand}
                consoleCommandState={consoleCommandState}
                packetFilters={packetFilters}
                multiAccountFile={multiAccountFile}
                multiAccountCount={multiAccountCount}
                multiAccountConcurrency={multiAccountConcurrency}
                multiAccountKeyEnv={multiAccountKeyEnv}
                multiAccountSummonTarget={multiAccountSummonTarget}
                multiAccountLoadMode={multiAccountLoadMode}
                onUpdateEngineLaunchSettings={(patch, message) => void updateEngineLaunchSettings(patch, message)}
                onSetVersionCheckDraft={setVersionCheckDraft}
                onApplyVersionCheckBuild={applyVersionCheckBuild}
                onUpdateHardwareAccelerationPreference={(enabled) => void updateHardwareAccelerationPreference(enabled)}
                onSetSettingsBindKey={setSettingsBindKey}
                onSetSettingsBindCommand={setSettingsBindCommand}
                onRunMultiAccountCommand={(cmd) => void runMultiAccountCommand(cmd)}
                onSetPacketFilters={setPacketFilters as any}
                onUpdateAppPreferencePatch={(patch, message) => void updateAppPreferencePatch(patch, message)}
                onSetMultiAccountFile={setMultiAccountFile}
                onSetMultiAccountCount={setMultiAccountCount}
                onSetMultiAccountConcurrency={setMultiAccountConcurrency}
                onSetMultiAccountKeyEnv={setMultiAccountKeyEnv}
                onSetMultiAccountSummonTarget={setMultiAccountSummonTarget}
                onSetMultiAccountLoadMode={setMultiAccountLoadMode}
                onSaveSessionDefaultPreferences={() => void saveSessionDefaultPreferences()}
              />
            ) : null}

            {selectedPlugin.origin === "user" ? (
              <UserPluginPanel
                selectedPlugin={selectedPlugin}
                pluginSurfaceEnabledByPluginId={pluginSurfaceEnabledByPluginId}
                desktopBridgeAvailable={desktopBridgeAvailable}
                onOpenPluginsFolder={() => void openPluginsFolder()}
                onReloadPlugins={() => void reloadPlugins()}
              />
            ) : null}

            {selectedPlugin.id === "multi-account" ? (
              <MultiAccountPanel
                desktopBridgeAvailable={desktopBridgeAvailable}
                selectedClientId={selectedClientId}
                selectedClientSession={selectedClientSession}
                clientSessions={clientSessions}
                mainClientSession={mainClientSession}
                multiAccountFile={multiAccountFile}
                multiAccountCount={multiAccountCount}
                multiAccountConcurrency={multiAccountConcurrency}
                multiAccountKeyEnv={multiAccountKeyEnv}
                multiAccountSummonTarget={multiAccountSummonTarget}
                mimicState={mimicState}
                mimicSourceSession={mimicSourceSession}
                mimicTargetSessions={mimicTargetSessions}
                mainMimicSourceId={mainMimicSourceId}
                multiAccountMessage={multiAccountMessage}
                onSelectClientSession={(id) => void selectClientSession(id)}
                onRunMultiAccountCommand={(cmd) => void runMultiAccountCommand(cmd)}
                onRefreshClientSessions={refreshClientSessions}
                onRefreshMimicState={refreshMimicState}
                onSetMultiAccountFile={setMultiAccountFile}
                onSetMultiAccountCount={setMultiAccountCount}
                onSetMultiAccountConcurrency={setMultiAccountConcurrency}
                onSetMultiAccountKeyEnv={setMultiAccountKeyEnv}
                onSetMultiAccountSummonTarget={setMultiAccountSummonTarget}
              />
            ) : null}

            {selectedPlugin.id === "info" ? (
              <InfoPanel
                engineUrl={engineUrl}
                runtimeBusy={runtimeBusy}
                runtimeSnapshot={selectedRuntimeSnapshot}
                packetInfoState={packetInfoState}
                inventoryTotalCount={inventoryTotalCount}
                socialRequestCount={socialRequestCount}
                socialMessageCount={socialMessageCount}
                selectedUserAccountId={compactValue(selectedUser?.accountId)}
                selectedUserBadgeCode={compactValue(selectedUser?.badgeCode)}
                publicLookupName={publicLookupName}
                publicLookupBusy={publicLookupBusy}
                publicLookupResult={publicLookupResult}
                selectedUserName={selectedUserName}
                onRead={() => void refreshRuntimeSnapshot()}
                onLookupPublicUser={() => void lookupPublicUser()}
                onSetPublicLookupName={setPublicLookupName}
              />
            ) : null}

            {selectedPlugin.id === "room" ? (
              <RoomPanel
                engineUrl={engineUrl}
                runtimeBusy={runtimeBusy}
                runtimeSnapshot={selectedRuntimeSnapshot}
                privateRoomId={privateRoomId}
                publicRoomQuery={publicRoomQuery}
                roomStageClickX={roomStageClickX}
                roomStageClickY={roomStageClickY}
                runtimeMessage={runtimeMessage}
                onRead={() => void refreshRuntimeSnapshot()}
                onShowHotelView={() => void runRuntimeAction({ kind: "showHotelView" })}
                onOpenNavigator={() => void runRuntimeAction({ kind: "openNavigator", view: "nav_pr" })}
                onSetPrivateRoomId={setPrivateRoomId}
                onEnterPrivateRoom={(flatId) => void runRuntimeAction({ kind: "enterPrivateRoom", flatId })}
                onSetPublicRoomQuery={setPublicRoomQuery}
                onEnterPublicRoom={(query) => void runRuntimeAction({ kind: "enterPublicRoom", query })}
                onSetStageClickX={setRoomStageClickX}
                onSetStageClickY={setRoomStageClickY}
                onWalk={(x, y) => void runRuntimeAction({ kind: "stageClick", x, y })}
              />
            ) : null}

            {selectedPlugin.id === "user" ? (
              <UserPanel
                engineUrl={engineUrl}
                runtimeBusy={runtimeBusy}
                selectedRuntimeSnapshot={selectedRuntimeSnapshot}
                selectedUser={selectedUser}
                userRows={userRows}
                selectedUserName={selectedUserName}
                selectedUserAccountId={selectedUserAccountId}
                selectedUserIndex={selectedUserIndex}
                selectedUserGender={selectedUserGender}
                selectedUserType={selectedUserType}
                selectedUserBadgeCode={selectedUserBadgeCode}
                selectedUserMotto={selectedUserMotto}
                selectedUserPosition={selectedUserPosition}
                selectedUserFigure={selectedUserFigure}
                selectedUserPoolFigure={selectedUserPoolFigure}
                userToolMessage={userToolMessage}
                activeStoredUserLook={activeStoredUserLook}
                userStoredLooks={userStoredLooks}
                engineUserNameLabels={engineUserNameLabels}
                onSetSelectedUserKey={setSelectedUserKey}
                onRefresh={() => void refreshRuntimeSnapshot()}
                onCopyUserValue={(label, value) => void copyUserValue(label, value)}
                onCopySelectedUserProfile={() => void copySelectedUserProfile()}
                onStoreSelectedUserLook={storeSelectedUserLook}
                onCopyStoredUserLook={() => void copyStoredUserLook()}
                onSetSelectedStoredUserLook={setSelectedStoredUserLook}
                onClearStoredUserLooks={clearStoredUserLooks}
                onSendUserAction={(action, label) => void sendUserAction(action as UserRelayAction, label)}
                onSetEngineUserNameLabels={setEngineUserNameLabels}
                onRunRuntimeAction={(action) => void runRuntimeAction(action as EngineRuntimeAction)}
              />
            ) : null}

            {selectedPlugin.id === "items" ? (
              <ItemsPanel
                engineUrl={engineUrl}
                runtimeBusy={runtimeBusy}
                roomReady={roomReady}
                itemFilter={itemFilter}
                socialMessage={socialMessage}
                activeObjectsCount={selectedRuntimeSnapshot?.roomObjects?.counts.activeObjects ?? 0}
                passiveObjectsCount={selectedRuntimeSnapshot?.roomObjects?.counts.passiveObjects ?? 0}
                wallCount={itemWallCount}
                filteredCount={filteredItemRows.length}
                selectedLabel={selectedItemRow?.label ?? "-"}
                metadataEntryCount={furniMetadata ? furniMetadata.entryCount : null}
                filteredItemRows={filteredItemRows}
                selectedItemRow={selectedItemRow}
                selectedItemMetadata={selectedItemMetadata}
                itemTitle={(row) => itemRowTitle(row, furniMetadata)}
                itemMeta={(row) => itemRowMeta(row, furniMetadata)}
                itemDisplayName={(item) => furniDisplayName(furniMetadata, item)}
                onSetFilter={setItemFilter}
                onRead={() => void refreshRuntimeSnapshot()}
                onSelectKey={setSelectedItemKey}
              />
            ) : null}

            {selectedPlugin.id === "inventory" ? (
              <InventoryPanel
                engineUrl={engineUrl}
                runtimeBusy={runtimeBusy}
                inventoryFilter={inventoryFilter}
                inventoryTotalCount={inventoryTotalCount}
                inventoryRowCount={inventoryRowCount}
                inventoryFloorCount={inventoryFloorCount}
                inventoryWallCount={inventoryWallCount}
                inventoryOpenState={compactValue(selectedRuntimeSnapshot?.inventory?.openState)}
                filteredInventoryRows={filteredInventoryRows}
                selectedInventoryRow={selectedInventoryRow}
                inventoryRowsLength={inventoryRows.length}
                inventoryNote={selectedRuntimeSnapshot?.inventory?.note ?? null}
                onRequestHand={() => void runRuntimeAction({ kind: "requestInventory" })}
                onSetFilter={setInventoryFilter}
                onRead={() => void refreshRuntimeSnapshot(["inventory"])}
                onSelectKey={setSelectedInventoryKey}
              />
            ) : null}

            {selectedPlugin.id === "social" ? (
              <SocialPanel
                engineUrl={engineUrl}
                runtimeBusy={runtimeBusy}
                desktopBridgeAvailable={desktopBridgeAvailable}
                socialFriendFilter={socialFriendFilter}
                packetInfoState={packetInfoState}
                onlinePacketFriends={onlinePacketFriends}
                filteredPacketFriends={filteredPacketFriends}
                visiblePrivateMessages={visiblePrivateMessages}
                visibleFriendRequests={visibleFriendRequests}
                rightsCount={selectedRuntimeSnapshot?.userState?.rightsCount ?? 0}
                sourceChatHistoryLength={sourceChatHistory.length}
                packetChatEntriesLength={packetChatEntries.length}
                roomUserCount={selectedRuntimeSnapshot?.userState?.roomUserCount ?? 0}
                socialRequestCount={socialRequestCount}
                socialMessageCount={socialMessageCount}
                onSetFilter={setSocialFriendFilter}
                onRead={() => void refreshRuntimeSnapshot()}
                onSendSocialAction={(action, label) => void sendSocialAction(action as SocialRelayAction, label)}
              />
            ) : null}

            {selectedPlugin.id === "visitors" ? (
              <VisitorsPanel
                engineUrl={engineUrl}
                runtimeBusy={runtimeBusy}
                visitorFilter={visitorFilter}
                visitorLookupBusy={visitorLookupBusy}
                visitorStateActiveKeysLength={visitorState.activeKeys.length}
                visitorEntriesLength={visitorEntries.length}
                filteredVisitorEntries={filteredVisitorEntries}
                filteredVisitorEntriesLength={filteredVisitorEntries.length}
                visitorRoomName={visitorRoomName}
                missingVisitorAccountIds={missingVisitorAccountIds}
                visitorPublicProfilesCount={Object.keys(visitorPublicProfiles).length}
                visitorLookupMessage={visitorLookupMessage}
                roomReady={roomReady}
                onSetFilter={setVisitorFilter}
                onRead={() => void refreshRuntimeSnapshot()}
                onLookupIds={() => void lookupMissingVisitorProfiles()}
              />
            ) : null}

            {selectedPlugin.id === "chat" ? (
              <ChatPanel
                engineUrl={engineUrl}
                runtimeBusy={runtimeBusy}
                roomReady={roomReady}
                chatDraft={chatDraft}
                chatFilters={chatFilters}
                visibleChatHistory={visibleChatHistory}
                chatHistoryLength={chatHistory.length}
                activeChatSourceHistoryLength={activeChatSourceHistory.length}
                packetChatEntriesLength={packetChatEntries.length}
                displayedCount={visibleChatHistory.length}
                runtimeMessage={runtimeMessage}
                chatListRef={chatListRef}
                onSetChatDraft={setChatDraft}
                onSetChatFilter={(kind, checked) => setChatFilters((current) => ({ ...current, [kind]: checked }))}
                onSend={(message) => void runRuntimeAction({ kind: "sendChat", message })}
                onClearDisplay={() => setChatClearOffset(chatHistory.length)}
              />
            ) : null}

            {selectedPlugin.id === "automation" ? (
              <AutomationPanel
                engineUrl={engineUrl}
                runtimeBusy={runtimeBusy}
                roomReady={roomReady}
                autoHideBulletin={automationPrefs.autoHideBulletin}
                windowCount={selectedRuntimeSnapshot?.windowIds.length ?? 0}
                userCount={selectedRuntimeSnapshot?.roomObjects?.counts.users ?? 0}
                fishAreaCount={fishingAreaRows.length}
                plantCount={plantRows.length}
                wallItemCount={wallMoverRows.length}
                message={automationMessage}
                onAutoHideChange={(enabled) => {
                  setAutomationPrefs((current) => ({ ...current, autoHideBulletin: enabled }));
                  setAutomationMessage(enabled ? "Auto-hide Bulletin is enabled." : "Auto-hide Bulletin is disabled.");
                }}
                onHideBulletin={() => void hideBulletinBoard("manual")}
                onReadWindows={() => void refreshRuntimeSnapshot()}
              />
            ) : null}

            {selectedPlugin.id === "fishing" ? (
              <FishingPanel
                engineUrl={engineUrl}
                runtimeBusy={runtimeBusy}
                desktopBridgeAvailable={desktopBridgeAvailable}
                roomReady={roomReady}
                fishingMessage={fishingMessage}
                packetFishingState={packetFishingState}
                fishingAreaRows={fishingAreaRows}
                selectedFishingAreaRow={selectedFishingAreaRow}
                itemTitle={(row) => itemRowTitle(row, furniMetadata)}
                itemMeta={(row) => itemRowMeta(row, furniMetadata)}
                onStartFishing={() => void sendFishingStart()}
                onSendAction={(action, label) => void sendFishingAction(action as FishingRelayAction, label)}
                onRefresh={() => void refreshRuntimeSnapshot()}
              />
            ) : null}

            {selectedPlugin.id === "present-catcher" ? (
              <PresentCatcherPanel
                desktopBridgeAvailable={desktopBridgeAvailable}
                roomReady={roomReady}
                engineUrl={engineUrl}
                runtimeBusy={runtimeBusy}
                presentCatcherRunning={presentCatcherRunning}
                presentCatcherMessage={presentCatcherMessage}
                presentCatcherTab={presentCatcherTab}
                presentCatcherPanicDraft={presentCatcherPanicDraft}
                presentCatcherPanicNames={presentCatcherPanicNames}
                presentCatcherGiftClass={presentCatcherGiftClass}
                presentPlaceX={presentPlaceX}
                presentPlaceY={presentPlaceY}
                presentPlaceDirection={presentPlaceDirection}
                presentOpenObjectId={presentOpenObjectId}
                presentFragmentEvent={presentFragmentEvent}
                presentFragmentSlotId={presentFragmentSlotId}
                presentFragmentTradeTarget={presentFragmentTradeTarget}
                selectedRuntimeSnapshot={selectedRuntimeSnapshot}
                presentHammerRows={presentHammerRows}
                presentRows={presentRows}
                presentGiftRows={presentGiftRows}
                selectedPresentGiftRow={selectedPresentGiftRow}
                presentCatcherPacketRows={presentCatcherPacketRows}
                userRows={userRows}
                furniMetadata={furniMetadata}
                relayLog={relayLog}
                onStartPresentCatcher={() => setPresentCatcherRunning(true)}
                onStopPresentCatcher={() => setPresentCatcherRunning(false)}
                onRunPresentCatcherStep={(auto) => void runPresentCatcherStep(auto)}
                onRefreshRuntimeSnapshot={(scopes) => void refreshRuntimeSnapshot(scopes as EngineRuntimeSnapshotScope[])}
                onSetPresentCatcherTab={setPresentCatcherTab}
                onSetPresentCatcherPanicDraft={setPresentCatcherPanicDraft}
                onSetPresentCatcherPanicNames={setPresentCatcherPanicNames}
                onSetPresentCatcherGiftClass={setPresentCatcherGiftClass}
                onSetPresentPlaceX={setPresentPlaceX}
                onSetPresentPlaceY={setPresentPlaceY}
                onSetPresentPlaceDirection={setPresentPlaceDirection}
                onSetPresentOpenObjectId={setPresentOpenObjectId}
                onSetPresentFragmentEvent={setPresentFragmentEvent}
                onSetPresentFragmentSlotId={setPresentFragmentSlotId}
                onSetPresentFragmentTradeTarget={setPresentFragmentTradeTarget}
                onUsePresentCatcherFloorItem={(row, mode) => void usePresentCatcherFloorItem(row, mode)}
                onRequestPresentCatcherInventory={() => void requestPresentCatcherInventory()}
                onPlaceSelectedPresentGift={() => void placeSelectedPresentGift()}
                onSendPresentCatcherPacket={(packet, label) => void sendPresentCatcherPacket(packet, label)}
                onOpenPresentObject={() => void openPresentObject()}
                onSendPresentFragmentPacket={(kind) => void sendPresentFragmentPacket(kind as Parameters<typeof sendPresentFragmentPacket>[0])}
                onSetSelectedPresentGiftKey={setSelectedPresentGiftKey}
                onSetPresentCatcherMessage={setPresentCatcherMessage}
              />
            ) : null}

            {selectedPlugin.id === "gardening" ? (
              <GardeningPanel
                engineUrl={engineUrl}
                runtimeBusy={runtimeBusy}
                desktopBridgeAvailable={desktopBridgeAvailable}
                roomReady={roomReady}
                gardeningRunning={gardeningRunning}
                gardeningCycleSec={gardeningCycleSec}
                gardeningMessage={gardeningMessage}
                gardeningJob={gardeningJob}
                runtimeSnapshot={selectedRuntimeSnapshot}
                plantRows={plantRows}
                selectedPlantRow={selectedPlantRow}
                selfUser={selfUser}
                itemTitle={(row) => itemRowTitle(row, furniMetadata)}
                itemMeta={(row) => itemRowMeta(row, furniMetadata)}
                onStartGardening={(mode) => void startGardening(mode)}
                onStopGardening={stopGardening}
                onSetCycleSec={setGardeningCycleSec}
                onSelectPlant={setSelectedPlantKey}
                onRefresh={() => void refreshRuntimeSnapshot()}
              />
            ) : null}

            {selectedPlugin.id === "wall-mover" ? (
              <WallMoverPanel
                engineUrl={engineUrl}
                runtimeBusy={runtimeBusy}
                desktopBridgeAvailable={desktopBridgeAvailable}
                wallMoverMessage={wallMoverMessage}
                rightsCount={selectedRuntimeSnapshot?.userState?.rightsCount ?? 0}
                selectedItemId={selectedWallMoverItemId}
                selectedClassName={compactValue(selectedWallMoverRow?.item.className ?? selectedWallMoverRow?.item.name)}
                selectedOwnerName={compactValue(selectedWallMoverRow?.item.ownerName)}
                selectedWallPos={compactValue(selectedWallMoverRow?.item.wall)}
                selectedLocalPos={compactValue(selectedWallMoverRow?.item.local)}
                selectedOrientation={compactValue(selectedWallMoverRow?.item.orientation ?? selectedWallMoverRow?.item.direction)}
                wallMoverStep={wallMoverStep}
                selectedLocation={selectedWallMoverLocation}
                wallMoverRows={wallMoverRows}
                selectedRow={selectedWallMoverRow}
                itemTitle={(row) => itemRowTitle(row, furniMetadata)}
                itemMeta={(item) => wallObjectMeta(item)}
                onRefresh={() => void refreshRuntimeSnapshot()}
                onSetStep={setWallMoverStep}
                onPickup={() => void sendWallMoverPickup()}
                onMove={(dx, dy, orientation) => void sendWallMoverMove(dx, dy, orientation)}
                onSelectKey={setSelectedWallMoverKey}
              />
            ) : null}

            {selectedPlugin.id === "injection" ? (
              <InjectionPanel
                runtimeBusy={runtimeBusy}
                roomReady={roomReady}
                selectedRuntimeSnapshot={selectedRuntimeSnapshot}
                injectionDraft={injectionDraft}
                injectionRepeatCount={injectionRepeatCount}
                injectionRepeatInterval={injectionRepeatInterval}
                injectionMessage={injectionMessage}
                injectionSnippets={injectionSnippets}
                selectedInjectionSnippetId={selectedInjectionSnippetId}
                selectedInjectionSnippet={selectedInjectionSnippet}
                injectionHistory={injectionHistory}
                injectionFileInputRef={injectionFileInputRef}
                injectionActionOptions={injectionActionOptions}
                onUpdateInjectionDraft={updateInjectionDraft}
                onSetInjectionRepeatCount={setInjectionRepeatCount}
                onSetInjectionRepeatInterval={setInjectionRepeatInterval}
                onExecuteInjectionCommand={(command, label) => void executeInjectionCommand(command, label)}
                onAddInjectionSnippet={addInjectionSnippet}
                onImportInjectionSnippets={(file) => void importInjectionSnippets(file)}
                onExportInjectionSnippets={exportInjectionSnippets}
                onSetInjectionSnippets={setInjectionSnippets as any}
                onSetSelectedInjectionSnippetId={setSelectedInjectionSnippetId}
                onSetInjectionMessage={setInjectionMessage}
                onLoadInjectionSnippet={loadInjectionSnippet}
                onSetInjectionHistory={setInjectionHistory as any}
              />
            ) : null}

            {selectedPlugin.id === "packet-log" ? (
              <PacketLogPanel
                desktopBridgeAvailable={desktopBridgeAvailable}
                packetFilters={packetFilters}
                packetClientChoices={packetClientChoices}
                packetSessionChoices={packetSessionChoices}
                packetListRef={packetListRef}
                handlePacketListScroll={handlePacketListScroll}
                visiblePacketEntries={visiblePacketEntries}
                renderedPacketEntries={renderedPacketEntries}
                selectedPacketEntry={selectedPacketEntry}
                packetVirtualRange={packetVirtualRange}
                selectedRuntimeSnapshot={selectedRuntimeSnapshot}
                relayLog={relayLog}
                packetEntries={packetEntries}
                packetExportMessage={packetExportMessage}
                onRefreshRelayLog={() => void refreshRelayLog()}
                onExportVisiblePacketLog={exportVisiblePacketLog}
                onSetPacketClearOffset={setPacketClearOffset}
                onSetSelectedPacketKey={setSelectedPacketKey}
                onSetPacketExportMessage={setPacketExportMessage}
                onSetPacketFilters={setPacketFilters as any}
              />
            ) : null}

            {selectedPlugin.id === "dev-tools" ? (
              <DevToolsPanel
                engineUrl={engineUrl}
                runtimeBusy={runtimeBusy}
                runtimeSnapshot={selectedRuntimeSnapshot}
                onRefresh={refreshRuntimeSnapshot}
              />
            ) : null}

            {selectedPlugin.id === "about" ? (
              <AboutPanel
                appName={appInfo?.name ?? "Habbpy v4"}
                appVersion={appInfo?.version ?? "-"}
                appMode={compactValue(appInfo?.mode)}
                profileLabel={selectedProfile?.label ?? "No profile selected"}
                buildLabel={engineLaunch?.buildLabel ?? profileLine(selectedProfile)}
                storageMode={selectedProfile?.storageMode ?? "-"}
              />
            ) : null}
          </section>
        ) : null}
      </aside>
    </main>
  );
}
