import test from "node:test";
import assert from "node:assert/strict";
import {
  createCgvBookingUrl,
  createDiscordMessage,
  createDiscordTestMessage,
  createDiscordBatches,
  createDiscordMessages,
  sendDiscordMessage,
} from "../src/discord.js";

const schedule = {
  key: "0013:movie:20260808:screenx:1930",
  movieTitle: "스파이더맨-브랜드 뉴 데이",
  theatreName: "용산아이파크몰",
  auditoriumName: "SCREENX관",
  showDate: "20260808",
  startTime: "1930",
  remainingSeats: 120,
  movieNo: "30001192",
  siteNo: "0013",
  screenNo: "007",
  scheduleSequence: "2",
};

test("감지된 회차 정보로 CGV 공식 예매 URL을 만든다", () => {
  const url = new URL(createCgvBookingUrl(schedule));
  assert.equal(url.origin, "https://cgv.co.kr");
  assert.equal(url.pathname, "/cnm/movieBook/movie");
  assert.equal(url.searchParams.get("movNo"), "30001192");
  assert.equal(url.searchParams.get("scnYmd"), "20260808");
  assert.equal(url.searchParams.get("siteNo"), "0013");
  assert.equal(url.searchParams.get("siteNm"), "CGV 용산아이파크몰");
  assert.equal(url.searchParams.get("scnsNo"), "007");
  assert.equal(url.searchParams.get("scnSseq"), "2");
});

test("Discord 메시지에 필수 일정 정보를 넣는다", () => {
  const message = createDiscordMessage(schedule);
  assert.match(message, /스파이더맨/);
  assert.match(message, /용산아이파크몰/);
  assert.match(message, /2026-08-08 19:30/);
  assert.match(message, /120석/);
  assert.match(message, /지금 예매하기/);
  assert.match(message, /movNo=30001192/);
  assert.match(message, /CGV 앱 링크를 지원하는 기기/);
});

test("테스트 알림은 실제 오픈 알림과 명확히 구분한다", () => {
  const message = createDiscordTestMessage(new Date("2026-08-03T01:30:00Z"));
  assert.match(message, /CGV Open Watch 테스트/);
  assert.match(message, /2026\. 08\. 03/);
  assert.match(message, /실제 예매 오픈 알림이 아닙니다/);
  assert.match(message, /모바일 앱 연결 테스트/);
});

test("같은 극장과 날짜의 회차를 한 메시지로 묶는다", () => {
  const second = {
    ...schedule,
    key: "0013:movie:20260808:screenx:2200",
    startTime: "2200",
    remainingSeats: 80,
  };
  const messages = createDiscordMessages([
    schedule,
    second,
  ]);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /19:30 \(120석\), 22:00 \(80석\)/);

  const batches = createDiscordBatches([schedule, second]);
  assert.deepEqual(batches[0].keys, [schedule.key, second.key]);
});

test("회차가 많으면 Discord 글자 제한 안에서 여러 메시지로 나눈다", () => {
  const schedules = Array.from({ length: 80 }, (_, index) => ({
    ...schedule,
    key: `schedule-${index}`,
    auditoriumName: `${index + 1}관`,
    formatName: index % 2 === 0 ? "일반 2D" : "IMAX LASER 2D",
    startTime: String(800 + index).padStart(4, "0"),
  }));
  const batches = createDiscordBatches(schedules);
  assert.ok(batches.length > 1);
  assert.ok(batches.every((batch) => batch.content.length <= 1_900));
  assert.equal(new Set(batches.flatMap((batch) => batch.keys)).size, schedules.length);
});

test("Webhook URL을 요청 본문에 노출하지 않는다", async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ id: "message-id" }) };
  };
  await sendDiscordMessage("https://discord.example/webhook", schedule, { fetchImpl });
  assert.equal(request.url, "https://discord.example/webhook?wait=true");
  assert.doesNotMatch(request.options.body, /discord\.example/);
});

test("기존 Webhook 쿼리를 보존하고 429 응답을 재시도한다", async () => {
  const requests = [];
  const responses = [
    {
      ok: false,
      status: 429,
      headers: { get: () => "0.001" },
      text: async () => "rate limited",
    },
    { ok: true, status: 200, json: async () => ({ id: "message-id" }) },
  ];
  await sendDiscordMessage("https://discord.example/webhook?thread_id=123", schedule, {
    fetchImpl: async (url) => {
      requests.push(url);
      return responses.shift();
    },
    sleep: async () => {},
  });
  assert.equal(requests.length, 2);
  assert.match(requests[0], /thread_id=123/);
  assert.match(requests[0], /wait=true/);
});
