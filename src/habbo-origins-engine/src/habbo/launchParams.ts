export const ORIGINS306_DEFAULT_CONNECTION_HOST = "game-ous.habbo.com";
export const ORIGINS306_DEFAULT_CONNECTION_PORT = 40001;
export const ORIGINS306_DEFAULT_USERPAGE_TEMPLATE = "http://%predefined%//rd/%ID%";
export const ORIGINS306_DEFAULT_CLIENT_VERSION_ID = 1128;
export const ORIGINS306_DEFAULT_VERSION_CHECK_CLIENT_TYPE = "2";
export const ORIGINS306_DEFAULT_VERSION_CHECK_EXTERNAL_VARIABLES_URL = "http://origins-gamedata.habbo.com/external_variables/1";

export type Origins306ConnectionParams = {
  readonly host: string;
  readonly port: number;
};

export function origins306ExternalParams(searchParams: URLSearchParams = new URLSearchParams()): Map<string, string> {
  const params = new Map<string, string>();
  const connection = origins306ConnectionParams(searchParams);
  const userpageTemplate = firstParam(searchParams, ["link.format.userpage", "userPageTemplate"]) ?? ORIGINS306_DEFAULT_USERPAGE_TEMPLATE;
  const clientVersionId = origins306ClientVersionId(searchParams);
  const defaultBundle = [
    `connection.info.host=${connection.host}`,
    `connection.info.port=${connection.port}`,
    "connection.info.id=#info",
    "connection.room.id=#info",
    `link.format.userpage=${userpageTemplate}`,
    `client.version.id=${clientVersionId}`,
  ].join(";");

  for (let index = 1; index <= 9; index += 1) {
    const key = `sw${index}`;
    const value = searchParams.get(key);
    if (value !== null && value.trim().length > 0) {
      params.set(key, value);
    }
  }

  const existingSw1 = params.get("sw1");
  params.set("sw1", existingSw1 ? `${defaultBundle};${existingSw1}` : defaultBundle);
  return params;
}

export function origins306ClientVersionId(searchParams: URLSearchParams = new URLSearchParams()): number {
  return (
    parsePositiveInt(
      firstParam(searchParams, [
        "client.version.id",
        "clientVersionId",
        "release306VersionCheck",
        "release306VersionCheckBuild",
        "versionCheckBuild",
      ]),
    ) ?? ORIGINS306_DEFAULT_CLIENT_VERSION_ID
  );
}

export function origins306VersionCheckClientType(searchParams: URLSearchParams = new URLSearchParams()): string {
  return origins306VersionCheckClientTypeOverride(searchParams) ?? ORIGINS306_DEFAULT_VERSION_CHECK_CLIENT_TYPE;
}

export function origins306VersionCheckExternalVariablesUrl(searchParams: URLSearchParams = new URLSearchParams()): string {
  return origins306VersionCheckExternalVariablesUrlOverride(searchParams) ?? ORIGINS306_DEFAULT_VERSION_CHECK_EXTERNAL_VARIABLES_URL;
}

export function origins306VersionCheckClientTypeOverride(searchParams: URLSearchParams = new URLSearchParams()): string | undefined {
  return firstParam(searchParams, [
    "release306VersionCheckClientType",
    "versionCheckClientType",
    "clientType",
  ]);
}

export function origins306VersionCheckExternalVariablesUrlOverride(searchParams: URLSearchParams = new URLSearchParams()): string | undefined {
  return firstParam(searchParams, [
    "release306VersionCheckExternalVariablesUrl",
    "release306ExternalVariablesUrl",
    "versionCheckExternalVariablesUrl",
    "externalVariablesUrl",
  ]);
}

export function overrideOrigins306ExternalVariables(
  text: string,
  searchParams: URLSearchParams = new URLSearchParams(),
): string {
  return setExternalVariable(text, "client.version.id", String(origins306ClientVersionId(searchParams)));
}

export function origins306ConnectionParams(searchParams: URLSearchParams = new URLSearchParams()): Origins306ConnectionParams {
  return {
    host: firstParam(searchParams, [
      "connection.info.host",
      "connectionHost",
      "gameHost",
      "tcpHost",
      "upstreamHost",
    ]) ?? ORIGINS306_DEFAULT_CONNECTION_HOST,
    port:
      parsePort(
        firstParam(searchParams, [
          "connection.info.port",
          "connectionPort",
          "gamePort",
          "tcpPort",
          "upstreamPort",
        ]),
      ) ?? ORIGINS306_DEFAULT_CONNECTION_PORT,
  };
}

function firstParam(searchParams: URLSearchParams, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = searchParams.get(name)?.trim();
    if (value) return value;
  }
  return undefined;
}

function parsePort(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const port = Number.parseInt(value, 10);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined;
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function setExternalVariable(text: string, key: string, value: string): string {
  const lines = text.split(/\r\n|\r|\n/);
  let replaced = false;
  const result = lines.map((line) => {
    const separator = line.indexOf("=");
    if (separator <= 0) return line;
    if (line.slice(0, separator).trim().toLowerCase() !== key.toLowerCase()) return line;
    replaced = true;
    return `${key}=${value}`;
  });
  if (!replaced) {
    result.push(`${key}=${value}`);
  }
  return result.join("\r");
}
