import { describe, expect, it } from "vitest";
import { DirectorMovie, MovieManifest } from "../../src/director/Movie";
import { ScriptInstance } from "../../src/director/Runtime";
import { CastRegistry } from "../../src/director/members";
import {
  decodeHabboBase64,
  decodeVl64Text,
  encodeHabboBase64,
  encodeVl64,
  type DirectorNetworkBridgeOptions,
  type DirectorWebSocketLike,
  formatOutgoingPacketTrace,
  latin1BytesFromString,
  rewriteRelease306VersionCheckPayload,
  rewriteRelease306VersionCheckPacket,
  stringFromLatin1Bytes,
} from "../../src/director/network";
import { LINGO_VOID, LingoValue, symbol } from "../../src/director/values";

class FakeSocket implements DirectorWebSocketLike {
  binaryType?: BinaryType;
  readyState = 0;
  readonly sent: Uint8Array[] = [];
  private readonly listeners = new Map<string, ((event: { data?: unknown }) => void)[]>();

  send(data: string | ArrayBufferLike | ArrayBufferView | Blob): void {
    if (typeof data === "string") {
      this.sent.push(latin1BytesFromString(data));
    } else if (ArrayBuffer.isView(data)) {
      this.sent.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    } else if (data instanceof ArrayBuffer) {
      this.sent.push(new Uint8Array(data));
    } else {
      throw new Error("FakeSocket only supports string and binary sends");
    }
  }

  close(): void {
    this.readyState = 3;
    this.emit("close");
  }

  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
    const list = this.listeners.get(type);
    if (!list) return;
    this.listeners.set(type, list.filter((entry) => entry !== listener));
  }

  open(): void {
    this.readyState = 1;
    this.emit("open");
  }

  message(data: unknown): void {
    this.emit("message", { data });
  }

  private emit(type: string, event: { data?: unknown } = {}): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

function createMovie(
  socketFactory: (url: string) => DirectorWebSocketLike,
  networkOptions: Partial<DirectorNetworkBridgeOptions> = {},
): DirectorMovie {
  const manifest: MovieManifest = {
    stage: { width: 640, height: 480, backgroundColor: "#000000" },
    casts: [],
    score: { frameRate: 12, markers: [], behaviors: [], frames: [] },
  };
  const members = new CastRegistry({ movie: { casts: [] }, textFields: [], bitmaps: [] }, "/assets/");
  return new DirectorMovie(
    manifest,
    { log: () => {} },
    async () => {},
    async () => "",
    members,
    () => {},
    "/origins-data/client/",
    new Map<string, string>(),
    async () => {},
    {
      url: "ws://127.0.0.1:12326",
      webSocketFactory: socketFactory,
      ...networkOptions,
    },
  );
}

function versionCheckPayload(build: number, clientType = "", externalVariables = ""): string {
  const body =
    encodeHabboBase64(5, 2) +
    encodeVl64(build) +
    encodeStringParam(clientType) +
    encodeStringParam(externalVariables);
  return encodeHabboBase64(body.length, 3) + body;
}

function uniqueIdPayload(machineId: string): string {
  const body = encodeHabboBase64(6, 2) + encodeStringParam(machineId);
  return encodeHabboBase64(body.length, 3) + body;
}

function tryLoginPayload(identifier: string, password: string, totp = "", steamId = ""): string {
  const body =
    encodeHabboBase64(4, 2) +
    encodeStringParam(identifier) +
    encodeStringParam(password) +
    encodeStringParam(totp) +
    encodeStringParam(steamId);
  return encodeHabboBase64(body.length, 3) + body;
}

function readVersionCheckBuild(payload: string): number {
  return decodeVl64Text(payload.slice(5)).value;
}

function readVersionCheckParams(payload: string): { build: number; clientType: string; externalVariables: string } {
  const build = decodeVl64Text(payload.slice(5));
  const clientType = readStringParam(payload, 5 + build.bytesRead);
  const externalVariables = readStringParam(payload, clientType.offset);
  return {
    build: build.value,
    clientType: clientType.value,
    externalVariables: externalVariables.value,
  };
}

function readTryLoginIdentifier(payload: string): string {
  return readStringParam(payload, 5).value;
}

function readStringParam(payload: string, offset: number): { value: string; offset: number } {
  const length = decodeHabboBase64(payload.slice(offset, offset + 2));
  const start = offset + 2;
  const end = start + length;
  return { value: payload.slice(start, end), offset: end };
}

function encodeStringParam(value: string): string {
  return encodeHabboBase64(value.length, 2) + value;
}

describe("Director network bridge", () => {
  it("round-trips relay bytes as latin1 strings", () => {
    const text = "\u0000@A\u00ff";
    expect(stringFromLatin1Bytes(latin1BytesFromString(text))).toBe(text);
  });

  it("formats v306 outgoing TRY_LOGIN traces without leaking the password", () => {
    const user = "sample-user";
    const pass = "sampleSecret!";
    const params = `@${String.fromCharCode(64 + user.length)}${user}@${String.fromCharCode(64 + pass.length)}${pass}@@@`;
    const body = `@D${params}`;
    const payload = `@A${String.fromCharCode(64 + body.length)}${body}`;

    expect(formatOutgoingPacketTrace(payload)).toContain("id=4 TRY_LOGIN");
    expect(formatOutgoingPacketTrace(payload)).toContain("string[2]=<redacted len=13>");
    expect(formatOutgoingPacketTrace(payload)).not.toContain(pass);
  });

  it("rewrites release306 VERSIONCHECK build while preserving source-authored string params", () => {
    const original = versionCheckPayload(401, "", "/origins-data/client/external_variables.txt");
    const rewritten = rewriteRelease306VersionCheckPayload(original, 1124);

    expect(readVersionCheckParams(rewritten)).toEqual({
      build: 1124,
      clientType: "",
      externalVariables: "/origins-data/client/external_variables.txt",
    });
    expect(formatOutgoingPacketTrace(rewritten)).toContain("id=5 VERSIONCHECK");
    expect(formatOutgoingPacketTrace(rewritten)).toContain("params=build=1124,clientType=\"\"");
    expect(rewriteRelease306VersionCheckPayload(versionCheckPayload(401).replace("@E", "@D"), 1124)).not.toBe(
      rewritten,
    );
  });

  it("supports explicit VERSIONCHECK client/url overrides", () => {
    const rewritten = rewriteRelease306VersionCheckPacket(versionCheckPayload(401), {
      build: 3180,
      clientType: "3",
      externalVariablesUrl: "https://example.test/external_variables",
    });

    expect(readVersionCheckParams(rewritten)).toEqual({
      build: 3180,
      clientType: "3",
      externalVariables: "https://example.test/external_variables",
    });
  });

  it("delivers plaintext release306 relay frames through Multiuser getNetMessage", async () => {
    let socket: FakeSocket | undefined;
    const movie = createMovie((url) => {
      expect(url).toBe("ws://127.0.0.1:12326");
      socket = new FakeSocket();
      return socket;
    });
    const multiuserRef = movie.runtime.call("xtra", ["Multiuser"]);
    const multiuser = movie.runtime.call("new", [multiuserRef]);
    let lastSubject: LingoValue = LINGO_VOID;
    let lastContent: LingoValue = LINGO_VOID;

    const target = new ScriptInstance({
      scriptName: "Network Target",
      scriptType: "parent",
      scriptProperties: [],
      scriptGlobals: [],
      handlers: {
        xtramsghandler(ctx) {
          const message = ctx.callMethod(multiuser, "getnetmessage", []);
          lastSubject = ctx.callMethod(message, "getaprop", [symbol("subject")]);
          lastContent = ctx.callMethod(message, "getaprop", [symbol("content")]);
          return 1;
        },
      },
    });

    expect(movie.callMethod(multiuser, "setnetmessagehandler", [symbol("xtraMsgHandler"), target])).toBe(0);
    expect(movie.callMethod(multiuser, "connecttonetserver", ["*", "*", "game-ous.habbo.com", 40001, "*", 1])).toBe(1);
    socket!.open();
    expect(lastSubject).toBe("ConnectToNetServer");
    expect(lastContent).toBe(LINGO_VOID);

    socket!.message(new Uint8Array([64, 65, 1]).buffer);
    await Promise.resolve();
    expect(lastContent).toBe("@A\u0001");

    expect(movie.callMethod(multiuser, "sendnetmessage", [0, 0, "@Chello"])).toBe(1);
    expect([...socket!.sent[0]!]).toEqual([64, 67, 104, 101, 108, 108, 111]);
  });

  it("ignores stale Multiuser callbacks after a source connection replaces pXtra", () => {
    const sockets: FakeSocket[] = [];
    const movie = createMovie(() => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    });
    const oldMultiuser = movie.runtime.call("new", [movie.runtime.call("xtra", ["Multiuser"])]);
    const currentMultiuser = movie.runtime.call("new", [movie.runtime.call("xtra", ["Multiuser"])]);
    let handlerCalls = 0;
    let lastSubject: LingoValue = LINGO_VOID;

    const target = new ScriptInstance({
      scriptName: "Connection Instance Class",
      scriptType: "parent",
      scriptProperties: ["pXtra"],
      scriptGlobals: [],
      handlers: {
        xtramsghandler(ctx) {
          handlerCalls += 1;
          const message = ctx.callMethod(currentMultiuser, "getnetmessage", []);
          lastSubject = ctx.callMethod(message, "getaprop", [symbol("subject")]);
          return 1;
        },
      },
    });
    target.props.set("pxtra", currentMultiuser);

    expect(movie.callMethod(oldMultiuser, "setnetmessagehandler", [symbol("xtraMsgHandler"), target])).toBe(0);
    expect(movie.callMethod(oldMultiuser, "connecttonetserver", ["*", "*", "game-ous.habbo.com", 40001, "*", 1])).toBe(1);
    sockets[0]!.open();
    expect(handlerCalls).toBe(0);
    expect(sockets[0]!.readyState).toBe(3);

    expect(movie.callMethod(currentMultiuser, "setnetmessagehandler", [symbol("xtraMsgHandler"), target])).toBe(0);
    expect(movie.callMethod(currentMultiuser, "connecttonetserver", ["*", "*", "game-ous.habbo.com", 40001, "*", 1])).toBe(1);
    sockets[1]!.open();
    expect(handlerCalls).toBe(1);
    expect(lastSubject).toBe("ConnectToNetServer");
  });

  it("sends hardcoded source VERSIONCHECK packets with the configured bypass build", () => {
    let socket: FakeSocket | undefined;
    const movie = createMovie(() => {
      socket = new FakeSocket();
      return socket;
    }, { release306VersionCheckBuild: 1124 });
    const multiuserRef = movie.runtime.call("xtra", ["Multiuser"]);
    const multiuser = movie.runtime.call("new", [multiuserRef]);

    expect(movie.callMethod(multiuser, "connecttonetserver", ["*", "*", "game-ous.habbo.com", 40001, "*", 1])).toBe(1);
    socket!.open();
    expect(movie.callMethod(multiuser, "sendnetmessage", [0, 0, versionCheckPayload(401)])).toBe(1);

    const sent = stringFromLatin1Bytes(socket!.sent[0]!);
    expect(readVersionCheckParams(sent)).toEqual({
      build: 1124,
      clientType: "",
      externalVariables: "",
    });
  });

  it("reuses the authenticated login identifier when room relogin tries to send the avatar name", () => {
    const sockets: FakeSocket[] = [];
    const movie = createMovie(() => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    });
    const first = movie.runtime.call("new", [movie.runtime.call("xtra", ["Multiuser"])]);
    const second = movie.runtime.call("new", [movie.runtime.call("xtra", ["Multiuser"])]);

    expect(movie.callMethod(first, "connecttonetserver", [])).toBe(1);
    sockets[0]!.open();
    expect(movie.callMethod(first, "sendnetmessage", [0, 0, tryLoginPayload("user@example.test", "sampleSecret!")])).toBe(1);

    expect(movie.callMethod(second, "connecttonetserver", [])).toBe(1);
    sockets[1]!.open();
    expect(movie.callMethod(second, "sendnetmessage", [0, 0, tryLoginPayload("dek", "sampleSecret!")])).toBe(1);

    expect(readTryLoginIdentifier(stringFromLatin1Bytes(sockets[0]!.sent[0]!))).toBe("user@example.test");
    expect(readTryLoginIdentifier(stringFromLatin1Bytes(sockets[1]!.sent[0]!))).toBe("user@example.test");
  });

  it("does not replace a later explicit email login", () => {
    const sockets: FakeSocket[] = [];
    const movie = createMovie(() => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    });
    const first = movie.runtime.call("new", [movie.runtime.call("xtra", ["Multiuser"])]);
    const second = movie.runtime.call("new", [movie.runtime.call("xtra", ["Multiuser"])]);

    expect(movie.callMethod(first, "connecttonetserver", [])).toBe(1);
    sockets[0]!.open();
    expect(movie.callMethod(first, "sendnetmessage", [0, 0, tryLoginPayload("first@example.test", "sampleSecret!")])).toBe(1);

    expect(movie.callMethod(second, "connecttonetserver", [])).toBe(1);
    sockets[1]!.open();
    expect(movie.callMethod(second, "sendnetmessage", [0, 0, tryLoginPayload("second@example.test", "otherSecret!")])).toBe(1);

    expect(readTryLoginIdentifier(stringFromLatin1Bytes(sockets[1]!.sent[0]!))).toBe("second@example.test");
  });

  it("treats relay Xtra instances as Director objects for generated connection guards", () => {
    const movie = createMovie(() => new FakeSocket());
    const multiuser = movie.runtime.call("new", [movie.runtime.call("xtra", ["Multiuser"])]);
    const bobba = movie.runtime.call("new", [movie.runtime.call("xtra", ["BobbaXtra"])]);

    expect(movie.runtime.call("objectp", [multiuser])).toBe(1);
    expect(movie.runtime.call("objectp", [bobba])).toBe(1);
  });

  it("keeps BobbaXtra relay-terminated so generated connection code stays plaintext", () => {
    const movie = createMovie(() => new FakeSocket());
    const bobbaRef = movie.runtime.call("xtra", ["BobbaXtra"]);
    const bobba = movie.runtime.call("new", [bobbaRef]);

    expect(movie.callMethod(bobba, "crypto_generatepublickey", [])).toBe("relay-terminated");
    expect(movie.callMethod(bobba, "crypto_setserverpublickey", ["12345"])).toBe(1);
    expect(movie.callMethod(bobba, "crypto_isready", [])).toBe(0);
    expect(movie.callMethod(bobba, "crypto_encryptpayload", ["@CPAYLOAD"])).toBe("@CPAYLOAD");
    expect(movie.callMethod(bobba, "crypto_encryptheader", ["X@A@"])).toBe("@A@");
  });

  it("provides a stable BobbaXtra machine id with the original UNIQUEID packet shape", () => {
    const movie = createMovie(() => new FakeSocket());
    const bobbaRef = movie.runtime.call("xtra", ["BobbaXtra"]);
    const firstBobba = movie.runtime.call("new", [bobbaRef]);
    const secondBobba = movie.runtime.call("new", [bobbaRef]);

    const machineId = movie.callMethod(firstBobba, "Device_GetMachineId", []);

    expect(machineId).toMatch(/^BX1(?:-[A-Z0-9]{4}){5}$/);
    expect(movie.callMethod(secondBobba, "device_getmachineid", [])).toBe(machineId);

    const payload = uniqueIdPayload(String(machineId));
    expect(decodeHabboBase64(payload.slice(0, 3))).toBe(32);
    expect(payload.length).toBe(35);
    expect(formatOutgoingPacketTrace(payload)).toContain("id=6 UNIQUEID");
    expect(formatOutgoingPacketTrace(payload)).toContain('machineIdLen=28,machineIdPrefix="BX1-"');
  });

  it("supports a runtime machine id override for standalone parity with the working donor boundary", () => {
    const movie = createMovie(() => new FakeSocket(), { machineId: "director-habbo-runtime" });
    const bobba = movie.runtime.call("new", [movie.runtime.call("xtra", ["BobbaXtra"])]);

    expect(movie.callMethod(bobba, "Device_GetMachineId", [])).toBe("director-habbo-runtime");
  });
});
