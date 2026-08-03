import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeWatchConfig,
  ruleFingerprint,
  validateWatchConfig,
} from "../src/config.js";

const legacy = {
  movieTitle: "스파이더맨-브랜드 뉴 데이",
  movieNo: "30001192",
  formats: ["SCREENX"],
  lookAheadDays: 14,
  theatres: [{ name: "용산아이파크몰", siteNo: "0013", detailNo: "0013001" }],
};

test("기존 단일 영화 설정을 version 3 규칙으로 변환한다", () => {
  const config = normalizeWatchConfig(legacy);
  assert.equal(config.version, 3);
  assert.equal(config.rules.length, 1);
  assert.equal(config.rules[0].id, "legacy-default");
  assert.equal(config.rules[0].theatres[0].siteNo, "0013");
  assert.equal(config.rules[0].startTime, "0000");
  assert.equal(config.rules[0].endTime, "4759");
  assert.deepEqual(config.schedule, {
    normalIntervalMinutes: 5,
    focusedIntervalMinutes: 2,
    focusedLeadDays: 5,
  });
});

test("사용자가 선택한 감지 주기를 정규화한다", () => {
  const config = normalizeWatchConfig({
    version: 3,
    rules: [],
    schedule: {
      normalIntervalMinutes: 15,
      focusedIntervalMinutes: 5,
      focusedLeadDays: 3,
    },
  });
  assert.deepEqual(config.schedule, {
    normalIntervalMinutes: 15,
    focusedIntervalMinutes: 5,
    focusedLeadDays: 3,
  });
});

test("규칙 선택 조건이 바뀌면 기준선 지문도 바뀐다", () => {
  const rule = normalizeWatchConfig(legacy).rules[0];
  assert.notEqual(ruleFingerprint(rule), ruleFingerprint({ ...rule, formats: ["IMAX"] }));
  assert.equal(ruleFingerprint(rule), ruleFingerprint({ ...rule, name: "표시 이름만 변경" }));
});

test("활성 영화·극장 조합을 최대 12개로 제한한다", () => {
  const theatres = Array.from({ length: 13 }, (_, index) => ({ name: `극장 ${index}`, siteNo: String(index) }));
  const { errors } = validateWatchConfig({ version: 3, rules: [{ ...legacy, id: "many", theatres }] });
  assert.ok(errors.some((error) => error.includes("최대 12개")));
});
