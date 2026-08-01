import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { collectCgvSchedules } from "./cgv.js";
import { selectTargetSchedules } from "./matcher.js";
import { markDelivered, readState, updateState, writeState } from "./state.js";
import { createDiscordBatches, sendDiscordContent } from "./discord.js";

function parseArgs(argv) {
  const args = new Set(argv);
  return {
    dryRun: args.has("--dry-run"),
    notifyExisting: args.has("--notify-existing"),
    scanOnly: args.has("--scan-only"),
    sendPending: args.has("--send-pending"),
  };
}

async function sendPending(statePath, dryRun) {
  let state = await readState(statePath);
  const schedules = Object.values(state.pending);
  const batches = createDiscordBatches(schedules);
  if (dryRun) {
    for (const batch of batches) console.log(`\n${batch.content}\n`);
  } else {
    for (const batch of batches) {
      await sendDiscordContent(process.env.DISCORD_WEBHOOK_URL, batch.content);
      state = markDelivered(state, batch.keys);
      await writeState(statePath, state);
      console.log(`Discord 알림 전송: 새 회차 ${batch.keys.length}개`);
    }
  }
  return { scheduleCount: schedules.length, messageCount: batches.length };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const projectRoot = resolve(import.meta.dirname, "..");
  const configPath = process.env.CGV_WATCH_CONFIG ?? resolve(projectRoot, "config/watch.json");
  const statePath = process.env.CGV_WATCH_STATE ?? resolve(projectRoot, "state/notifications.json");

  if (options.sendPending) {
    const counts = await sendPending(statePath, options.dryRun);
    console.log(`Discord 알림 대상 ${counts.scheduleCount}개를 메시지 ${counts.messageCount}건으로 처리`);
    return;
  }

  const config = JSON.parse(await readFile(configPath, "utf8"));

  const allSchedules = await collectCgvSchedules(config);
  const targets = selectTargetSchedules(allSchedules, config);
  const previous = await readState(statePath);
  const result = updateState(previous, targets, {
    notifyExisting: options.notifyExisting,
  });

  if (!options.dryRun && result.changed) {
    await writeState(statePath, result.state);
  }

  const formatLabel = config.formats.length > 0 ? config.formats.join(", ") : "전체 형식";
  console.log(`CGV 일정 ${allSchedules.length}개, 대상 회차 ${targets.length}개 (${formatLabel})`);
  if (!result.changed) {
    console.log("새로 열린 회차가 없습니다.");
  }
  if (result.baselineCount > 0 && result.notifications.length === 0) {
    console.log(`최초 기준선 ${result.baselineCount}개를 저장했습니다. 알림은 보내지 않습니다.`);
  }

  if (options.dryRun) {
    const batches = createDiscordBatches(result.notifications);
    for (const batch of batches) console.log(`\n${batch.content}\n`);
  } else if (!options.scanOnly) {
    await sendPending(statePath, false);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
