import test from "node:test";
import assert from "node:assert/strict";
import { mapApiSchedule, toKstShowTime } from "../src/cgv.js";

const theatre = { name: "용산아이파크몰", siteNo: "0013" };
const raw = {
  movNm: "스파이더맨-브랜드 뉴 데이",
  movNo: "30001192",
  scnYmd: "20260802",
  scnsrtTm: "2530",
  scnendTm: "2805",
  expoScnsNm: "SCREENX관",
  movkndDsplNm: "SCREENX 2D",
  tcscnsGradNm: "SCREENX",
  frSeatCnt: "120",
  stcnt: "200",
  cntlYn: "N",
};

test("24시 이후 상영 시간을 다음 날로 계산한다", () => {
  assert.equal(toKstShowTime("20260802", "2530").toISOString(), "2026-08-02T16:30:00.000Z");
});

test("현재 시간이 지난 회차는 예매 종료로 변환한다", () => {
  const schedule = mapApiSchedule(raw, theatre, new Date("2026-08-02T17:00:00Z"));
  assert.equal(schedule.bookingClosed, true);
});

test("CGV 판매 통제 회차는 예매 불가로 변환한다", () => {
  const schedule = mapApiSchedule(
    { ...raw, cntlYn: "Y" },
    theatre,
    new Date("2026-08-02T00:00:00Z"),
  );
  assert.equal(schedule.disabled, true);
  assert.equal(schedule.saleEnabled, false);
});

test("CGV SCREENX 필드와 좌석 수를 변환한다", () => {
  const schedule = mapApiSchedule(raw, theatre, new Date("2026-08-02T00:00:00Z"));
  assert.equal(schedule.movieTitle, raw.movNm);
  assert.match(schedule.formatName, /SCREENX/);
  assert.equal(schedule.remainingSeats, 120);
  assert.equal(schedule.bookingClosed, false);
});
