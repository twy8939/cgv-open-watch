import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const projectRoot = resolve(import.meta.dirname, "..");

function schedule(key, showDate, startTime) {
  return {
    key,
    siteNo: "0013",
    movieTitle: "스파이더맨-브랜드 뉴 데이",
    theatreName: "용산아이파크몰",
    auditoriumName: "14관[SCREENX] (Laser)",
    formatName: "SCREENX 2D",
    showDate,
    startTime,
    remainingSeats: 100,
  };
}

async function startWebhook(responses) {
  const requests = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      requests.push({ url: request.url, body });
      const next = responses.shift() ?? { status: 200, body: { id: "message" } };
      response.writeHead(next.status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(next.body));
    });
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  return {
    requests,
    url: `http://127.0.0.1:${address.port}/webhook?token=super-secret`,
    close: () => new Promise((resolveClose) => server.close(resolveClose)),
  };
}

function runCli(args, environment = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, ["src/cli.js", ...args], {
      cwd: projectRoot,
      env: {
        ...process.env,
        ...environment,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolveRun({ code, stdout, stderr }));
  });
}

function runSendPending(statePath, webhookUrl) {
  return runCli(["--send-pending"], {
    CGV_WATCH_STATE: statePath,
    DISCORD_WEBHOOK_URL: webhookUrl,
  });
}

async function writePendingState(statePath, schedules) {
  await writeFile(statePath, `${JSON.stringify({
    version: 2,
    initialized: true,
    updatedAt: "2026-08-01T00:00:00.000Z",
    seen: Object.fromEntries(schedules.map((item) => [item.key, item])),
    pending: Object.fromEntries(schedules.map((item) => [item.key, item])),
  }, null, 2)}\n`);
}

test("대기 알림을 묶어 보내고 성공한 회차를 상태에서 제거한다", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cgv-cli-success-"));
  const statePath = join(directory, "notifications.json");
  const schedules = [
    schedule("first", "20260808", "1930"),
    schedule("second", "20260808", "2200"),
  ];
  await writePendingState(statePath, schedules);
  const webhook = await startWebhook([{ status: 200, body: { id: "message-1" } }]);

  try {
    const result = await runSendPending(statePath, webhook.url);
    const state = JSON.parse(await readFile(statePath, "utf8"));
    assert.equal(result.code, 0);
    assert.equal(webhook.requests.length, 1);
    assert.deepEqual(state.pending, {});
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /super-secret/);
  } finally {
    await webhook.close();
  }
});

test("Discord 테스트 알림을 실제 오픈 알림과 구분해 전송한다", async () => {
  const webhook = await startWebhook([{ status: 200, body: { id: "test-message" } }]);

  try {
    const result = await runCli(["--test-discord"], {
      DISCORD_WEBHOOK_URL: webhook.url,
    });
    assert.equal(result.code, 0);
    assert.equal(webhook.requests.length, 1);
    const payload = JSON.parse(webhook.requests[0].body);
    assert.match(payload.content, /CGV Open Watch 테스트/);
    assert.match(payload.content, /실제 예매 오픈 알림이 아닙니다/);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /super-secret/);
  } finally {
    await webhook.close();
  }
});

test("일부 전송 실패 시 성공 건만 제거하고 실패 건은 대기열에 남긴다", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cgv-cli-partial-"));
  const statePath = join(directory, "notifications.json");
  const first = schedule("first", "20260808", "1930");
  const second = schedule("second", "20260809", "1930");
  await writePendingState(statePath, [first, second]);
  const webhook = await startWebhook([
    { status: 200, body: { id: "message-1" } },
    { status: 400, body: { message: "bad request" } },
  ]);

  try {
    const result = await runSendPending(statePath, webhook.url);
    const state = JSON.parse(await readFile(statePath, "utf8"));
    assert.equal(result.code, 1);
    assert.equal(webhook.requests.length, 2);
    assert.equal(state.pending.first, undefined);
    assert.equal(state.pending.second.key, second.key);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /super-secret/);
  } finally {
    await webhook.close();
  }
});
