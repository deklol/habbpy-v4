#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const args = process.argv.slice(2);
const webhookUrl = process.env.ORIGINS_DISCORD_WEBHOOK_URL || "";

function usage() {
  console.error(
    [
      "Usage:",
      "  ORIGINS_DISCORD_WEBHOOK_URL=<url> node tools/dev/send-discord-webhook.mjs --message \"text\" [--file path]...",
      "",
      "The webhook URL is intentionally read from the environment so it is not committed to the repo.",
    ].join("\n"),
  );
}

function optionValues(name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== name) continue;
    const value = args[index + 1];
    if (!value) throw new Error(`Missing value for ${name}`);
    values.push(value);
    index += 1;
  }
  return values;
}

async function main() {
  if (!webhookUrl) {
    usage();
    process.exitCode = 2;
    return;
  }

  const message = optionValues("--message").at(-1) || "";
  const files = optionValues("--file");
  if (!message && files.length === 0) {
    usage();
    process.exitCode = 2;
    return;
  }

  let response;
  if (files.length === 0) {
    response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: message }),
    });
  } else {
    const form = new FormData();
    form.append("payload_json", JSON.stringify({ content: message }));
    for (let index = 0; index < files.length; index += 1) {
      const path = files[index];
      const bytes = await readFile(path);
      const name = basename(path);
      form.append(`files[${index}]`, new Blob([bytes]), name);
    }
    response = await fetch(webhookUrl, { method: "POST", body: form });
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Discord webhook failed: HTTP ${response.status}${body ? ` ${body}` : ""}`);
  }
  console.log("webhook ok");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
