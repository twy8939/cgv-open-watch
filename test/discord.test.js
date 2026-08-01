import test from "node:test";
import assert from "node:assert/strict";
import {
  createDiscordMessage,
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
};

test("Discord 메시지에 필수 일정 정보를 넣는다", () => {
  const message = createDiscordMessage(schedule);
  assert.match(message, /스파이더맨/);
  assert.match(message, /용산아이파크몰/);
  assert.match(message, /2026-08-08 19:30/);
  assert.match(message, /120석/);
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
