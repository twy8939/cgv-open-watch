import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { markDelivered, readState, updateState } from "../src/state.js";
import { selectTargetSchedules } from "../src/matcher.js";

const schedule = {
  key: "0013:movie:20260808:screenx:1930",
  showDate: "20260808",
  theatreName: "용산아이파크몰",
  movieTitle: "스파이더맨-브랜드 뉴 데이",
  auditoriumName: "SCREENX관",
  startTime: "1930",
};

test("첫 실행은 기준선만 저장한다", () => {
  const result = updateState(
    { version: 1, initialized: false, updatedAt: null, seen: {} },
    [schedule],
    { now: new Date("2026-08-02T00:00:00Z") },
  );
  assert.equal(result.notifications.length, 0);
  assert.equal(result.baselineCount, 1);
  assert.equal(result.changed, true);
  assert.ok(result.state.seen[schedule.key]);
  assert.equal(Object.keys(result.state.pending).length, 0);
});

test("이미 본 회차는 다시 알리지 않는다", () => {
  const previous = {
    version: 1,
    initialized: true,
    updatedAt: "2026-08-02T00:00:00Z",
    seen: { [schedule.key]: { ...schedule, firstSeenAt: "2026-08-02T00:00:00Z" } },
  };
  const result = updateState(previous, [schedule], { now: new Date("2026-08-02T00:05:00Z") });
  assert.equal(result.notifications.length, 0);
  assert.equal(result.changed, false);
  assert.equal(result.state, previous);
});

test("새 회차는 초기화 후 한 번만 알린다", () => {
  const previous = { version: 2, initialized: true, updatedAt: null, seen: {}, pending: {} };
  const first = updateState(previous, [schedule], { now: new Date("2026-08-02T00:00:00Z") });
  assert.deepEqual(first.notifications.map((item) => item.key), [schedule.key]);
  assert.equal(first.state.pending[schedule.key].key, schedule.key);
  const second = updateState(first.state, [schedule], { now: new Date("2026-08-02T00:05:00Z") });
  assert.equal(second.notifications.length, 0);
  assert.equal(second.state.pending[schedule.key].key, schedule.key);
});

test("예매 준비 회차가 열린 순간에만 최초 한 번 알린다", () => {
  const config = { movieTitle: schedule.movieTitle, formats: [] };
  const rawSchedule = {
    ...schedule,
    siteNo: "0013",
    remainingSeats: 120,
    saleEnabled: false,
  };
  const beforeOpen = selectTargetSchedules([rawSchedule], config);
  const baseline = updateState(
    { version: 2, initialized: false, updatedAt: null, seen: {}, pending: {} },
    beforeOpen,
    { now: new Date("2026-08-02T00:00:00Z") },
  );
  assert.equal(beforeOpen.length, 0);
  assert.equal(baseline.notifications.length, 0);

  const afterOpen = selectTargetSchedules([{ ...rawSchedule, saleEnabled: true }], config);
  const detected = updateState(baseline.state, afterOpen, {
    now: new Date("2026-08-02T00:05:00Z"),
  });
  assert.equal(afterOpen.length, 1);
  const openedKey = afterOpen[0].key;
  assert.deepEqual(detected.notifications.map((item) => item.key), [openedKey]);
  assert.equal(detected.state.pending[openedKey].queuedAt, "2026-08-02T00:05:00.000Z");

  const repeated = updateState(detected.state, afterOpen, {
    now: new Date("2026-08-02T00:10:00Z"),
  });
  assert.equal(repeated.notifications.length, 0);
  assert.equal(Object.keys(repeated.state.pending).length, 1);
});

test("전송 성공 회차만 대기열에서 제거한다", () => {
  const previous = {
    version: 2,
    initialized: true,
    updatedAt: "2026-08-02T00:00:00Z",
    seen: { [schedule.key]: schedule },
    pending: {
      [schedule.key]: schedule,
      other: { ...schedule, key: "other" },
    },
  };
  const result = markDelivered(previous, [schedule.key], {
    now: new Date("2026-08-02T00:01:00Z"),
  });
  assert.equal(result.pending[schedule.key], undefined);
  assert.equal(result.pending.other.key, "other");
});

test("version 1 상태 파일을 대기열이 있는 version 2로 읽는다", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cgv-state-"));
  const statePath = join(directory, "notifications.json");
  await writeFile(statePath, JSON.stringify({
    version: 1,
    initialized: true,
    updatedAt: "2026-08-02T00:00:00Z",
    seen: { [schedule.key]: schedule },
  }));
  const result = await readState(statePath);
  assert.equal(result.version, 2);
  assert.deepEqual(result.pending, {});
  assert.ok(result.seen[schedule.key]);
});

test("30일마다 상태를 갱신해 공개 저장소 예약 실행 중단을 예방한다", () => {
  const previous = {
    version: 2,
    initialized: true,
    updatedAt: "2026-06-01T00:00:00Z",
    seen: {},
    pending: {},
  };
  const result = updateState(previous, [], { now: new Date("2026-07-01T00:00:00Z") });
  assert.equal(result.changed, true);
  assert.equal(result.state.updatedAt, "2026-07-01T00:00:00.000Z");
  assert.equal(result.notifications.length, 0);
});
