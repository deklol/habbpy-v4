import { mkdir, readFile, writeFile } from "node:fs/promises";

const url = process.env.HABBPY_V4_DISCORD_WEBHOOK_URL || await webhookFromGoalFile();
const messageIndex = process.argv.indexOf("--message");
const fileIndex = process.argv.indexOf("--file");
const message =
  messageIndex >= 0 ? process.argv[messageIndex + 1] :
  process.argv.slice(2).join(" ").trim();

if (!url) {
  console.log("Webhook skipped: no webhook configured in HABBPY_V4_DISCORD_WEBHOOK_URL or goal.md.");
  process.exit(0);
}

if (!message) {
  console.error("Usage: npm run webhook -- --message \"text\" [--file screenshot.png]");
  process.exit(1);
}

const attachedFile = fileIndex >= 0 ? process.argv[fileIndex + 1] : "";
const response = attachedFile ? await sendMultipart(message, attachedFile) : await sendJson(message);

if (!response.ok) {
  await logWebhookFailure(`Webhook failed: ${response.status} ${await response.text()}`);
  console.log("Webhook failed; logged locally and continuing.");
  process.exit(0);
}

console.log("Webhook sent.");

async function sendJson(content) {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
}

async function sendMultipart(content, filePath) {
  const form = new FormData();
  form.append("payload_json", JSON.stringify({ content }));
  const bytes = await readFile(filePath);
  const name = filePath.split(/[\\/]/).pop() || "screenshot.png";
  form.append("files[0]", new Blob([bytes]), name);
  return fetch(url, { method: "POST", body: form });
}

async function webhookFromGoalFile() {
  try {
    const text = await readFile("goal.md", "utf8");
    return text.match(/https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/[^\s)\]'"<>]+/)?.[0] ?? "";
  } catch {
    return "";
  }
}

async function logWebhookFailure(message) {
  await mkdir("logs", { recursive: true });
  await writeFile("logs/webhook.log", `[${new Date().toISOString()}] ${message}\n`, { flag: "a" });
}
