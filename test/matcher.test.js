import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeText,
  titleMatches,
  isBookableSchedule,
  makeScheduleKey,
  selectTargetSchedules,
} from "../src/matcher.js";

const base = {
  siteNo: "0013",
  theatreName: "용산아이파크몰",
  movieTitle: "스파이더맨-브랜드 뉴 데이",
  showDate: "20260808",
  startTime: "1930",
  auditoriumName: "14관[SCREENX] (Laser)",
  formatName: "SCREENX 2D",
  remainingSeats: 120,
  saleEnabled: true,
};

test("제목의 공백과 문장부호를 무시한다", () => {
  assert.equal(normalizeText("스파이더맨: 브랜드 뉴 데이"), "스파이더맨브랜드뉴데이");
  assert.equal(titleMatches("스파이더맨 : 브랜드-뉴데이", base.movieTitle), true);
});

test("매진과 예매 종료 회차를 제외한다", () => {
  assert.equal(isBookableSchedule(base), true);
  assert.equal(isBookableSchedule({ ...base, remainingSeats: 0 }), false);
  assert.equal(isBookableSchedule({ ...base, bookingClosed: true }), false);
  assert.equal(isBookableSchedule({ ...base, saleEnabled: false }), false);
});

test("설정한 상영 형식만 선택한다", () => {
  const config = { movieTitle: base.movieTitle, formats: ["SCREENX"] };
  const selected = selectTargetSchedules([
    base,
    { ...base, startTime: "2000", auditoriumName: "IMAX관", formatName: "IMAX LASER 2D" },
    { ...base, startTime: "2030", movieTitle: "다른 영화" },
  ], config);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].key, makeScheduleKey(base));
});

test("상영 형식 목록이 비어 있으면 모든 형식을 선택한다", () => {
  const config = { movieTitle: base.movieTitle, formats: [] };
  const selected = selectTargetSchedules([
    base,
    { ...base, startTime: "2000", auditoriumName: "IMAX관", formatName: "IMAX LASER 2D" },
  ], config);
  assert.equal(selected.length, 2);
});

test("알림 키는 시작 시간과 상영관을 구분한다", () => {
  assert.notEqual(makeScheduleKey(base), makeScheduleKey({ ...base, startTime: "2000" }));
  assert.notEqual(makeScheduleKey(base), makeScheduleKey({ ...base, auditoriumName: "SCREENX 2관" }));
});

test("상영관·기간·시간·최소 좌석 조건을 함께 적용한다", () => {
  const config = {
    id: "rule-a",
    movieTitle: base.movieTitle,
    theatres: [{ siteNo: "0013" }],
    formats: ["SCREENX"],
    auditoriums: ["14관"],
    dateMode: "range",
    startDate: "20260808",
    endDate: "20260810",
    startTime: "1800",
    endTime: "2200",
    minSeats: 10,
  };
  const selected = selectTargetSchedules([
    base,
    { ...base, startTime: "1700" },
    { ...base, startTime: "2000", remainingSeats: 5 },
    { ...base, startTime: "2030", auditoriumName: "2관" },
  ], config);
  assert.equal(selected.length, 1);
  assert.match(selected[0].key, /^rule-a:/);
});
