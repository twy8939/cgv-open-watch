import test from "node:test";
import assert from "node:assert/strict";
import { mapApiSchedule, selectScheduleDates, toKstShowTime } from "../src/cgv.js";

const theatre = { name: "용산아이파크몰", siteNo: "0013" };
const raw = {
  movNm: "스파이더맨-브랜드 뉴 데이",
  movNo: "30001192",
  scnsNo: "007",
  scnSseq: "2",
  prodNo: "10001",
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
  assert.equal(schedule.movieNo, raw.movNo);
  assert.equal(schedule.screenNo, raw.scnsNo);
  assert.equal(schedule.scheduleSequence, raw.scnSseq);
  assert.equal(schedule.productNo, raw.prodNo);
  assert.match(schedule.formatName, /SCREENX/);
  assert.equal(schedule.remainingSeats, 120);
  assert.equal(schedule.bookingClosed, false);
});

test("특정 날짜 규칙은 CGV 날짜 목록에서 지정 날짜만 조회한다", () => {
  const rows = ["20260803", "20260810", "20260815", "20260816"].map((scnYmd) => ({ scnYmd }));
  assert.deepEqual(selectScheduleDates(rows, {
    dateMode: "specific",
    specificDates: ["20260815"],
    lookAheadDays: 31,
  }), ["20260815"]);
});

test("특정 날짜가 아직 열리지 않았으면 상영 일정 조회를 생략한다", () => {
  const rows = ["20260803", "20260810"].map((scnYmd) => ({ scnYmd }));
  assert.deepEqual(selectScheduleDates(rows, {
    dateMode: "specific",
    specificDates: ["20260815"],
    lookAheadDays: 31,
  }), []);
});

test("기간 규칙은 기간 안의 날짜만 조회한다", () => {
  const rows = ["20260809", "20260810", "20260815", "20260816"].map((scnYmd) => ({ scnYmd }));
  assert.deepEqual(selectScheduleDates(rows, {
    dateMode: "range",
    startDate: "20260810",
    endDate: "20260815",
    lookAheadDays: 31,
  }), ["20260810", "20260815"]);
});
