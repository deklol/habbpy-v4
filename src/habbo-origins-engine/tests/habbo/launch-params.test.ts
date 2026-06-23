import { describe, expect, it } from "vitest";
import {
  ORIGINS306_DEFAULT_CLIENT_VERSION_ID,
  ORIGINS306_DEFAULT_CONNECTION_HOST,
  ORIGINS306_DEFAULT_CONNECTION_PORT,
  ORIGINS306_DEFAULT_USERPAGE_TEMPLATE,
  origins306ClientVersionId,
  origins306ConnectionParams,
  origins306ExternalParams,
  overrideOrigins306ExternalVariables,
} from "../../src/habbo/launchParams";

describe("Habbo release306 launch parameters", () => {
  it("injects source-compatible sw1 connection info by default", () => {
    const params = origins306ExternalParams();

    expect(params.get("sw1")).toBe(
      `connection.info.host=${ORIGINS306_DEFAULT_CONNECTION_HOST};connection.info.port=${ORIGINS306_DEFAULT_CONNECTION_PORT};connection.info.id=#info;connection.room.id=#info;link.format.userpage=${ORIGINS306_DEFAULT_USERPAGE_TEMPLATE};client.version.id=${ORIGINS306_DEFAULT_CLIENT_VERSION_ID}`,
    );
  });

  it("keeps user sw parameters after defaults so source parsing can override them", () => {
    const params = origins306ExternalParams(
      new URLSearchParams({
        sw1: "connection.info.host=127.0.0.1;custom.flag=1",
        sw2: "another.flag=2",
      }),
    );

    expect(params.get("sw1")).toBe(
      `connection.info.host=${ORIGINS306_DEFAULT_CONNECTION_HOST};connection.info.port=${ORIGINS306_DEFAULT_CONNECTION_PORT};connection.info.id=#info;connection.room.id=#info;link.format.userpage=${ORIGINS306_DEFAULT_USERPAGE_TEMPLATE};client.version.id=${ORIGINS306_DEFAULT_CLIENT_VERSION_ID};connection.info.host=127.0.0.1;custom.flag=1`,
    );
    expect(params.get("sw2")).toBe("another.flag=2");
  });

  it("defaults Origins VERSIONCHECK/client.version.id to the current accepted build bypass", () => {
    expect(ORIGINS306_DEFAULT_CLIENT_VERSION_ID).toBe(1128);
    expect(origins306ClientVersionId()).toBe(1128);
    expect(origins306ExternalParams().get("sw1")).toContain("client.version.id=1128");
  });

  it("supports Slopwave-style URL overrides for the version check build", () => {
    const params = new URLSearchParams({ versionCheckBuild: "1125" });

    expect(origins306ClientVersionId(params)).toBe(1125);
    expect(origins306ExternalParams(params).get("sw1")).toContain("client.version.id=1125");
  });

  it("rewrites fetched external_variables client.version.id consistently", () => {
    expect(overrideOrigins306ExternalVariables("system.debug=1\rclient.version.id=401\rfoo=bar")).toBe(
      "system.debug=1\rclient.version.id=1128\rfoo=bar",
    );
    expect(overrideOrigins306ExternalVariables("system.debug=1", new URLSearchParams({ release306VersionCheck: "1125" }))).toBe(
      "system.debug=1\rclient.version.id=1125",
    );
  });

  it("allows the user-page URL template to be overridden", () => {
    const params = origins306ExternalParams(new URLSearchParams({ userPageTemplate: "https://example.test/%ID%" }));

    expect(params.get("sw1")).toContain("link.format.userpage=https://example.test/%ID%");
  });

  it("supports explicit connection host and port query overrides", () => {
    expect(
      origins306ConnectionParams(
        new URLSearchParams({
          connectionHost: "127.0.0.1",
          connectionPort: "30000",
        }),
      ),
    ).toEqual({ host: "127.0.0.1", port: 30000 });
  });

  it("falls back to the release306 official port when an override is invalid", () => {
    expect(
      origins306ConnectionParams(
        new URLSearchParams({
          upstreamPort: "999999",
        }),
      ).port,
    ).toBe(ORIGINS306_DEFAULT_CONNECTION_PORT);
  });
});
