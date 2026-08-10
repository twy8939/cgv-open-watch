import test from "node:test";
import assert from "node:assert/strict";
import worker, {
  createMonitoringPlan,
  dispatchWatchWorkflow,
  isScheduledInterval,
  nextExpectedRun,
  WorkflowDispatchError,
} from "./worker.js";

const env = {
  GITHUB_OWNER: "twy8939",
  GITHUB_REPO: "cgv-open-watch",
  GITHUB_WORKFLOW: "watch.yml",
  GITHUB_REF: "main",
  GITHUB_TOKEN: "github-secret-token",
  DB: {
    prepare: () => ({
      bind: () => ({
        first: async () => ({ value: JSON.stringify({
          version: 3,
          paused: false,
          rules: [{ id: "rule", enabled: true }],
        }) }),
      }),
    }),
  },
};

test("5분 예약 시각을 포함해 GitHub workflow_dispatch를 호출한다", async () => {
  let request;
  const result = await dispatchWatchWorkflow(env, 1785720600000, {
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ workflow_run_id: 123 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  const body = JSON.parse(request.options.body);
  assert.match(request.url, /twy8939\/cgv-open-watch\/actions\/workflows\/watch\.yml\/dispatches$/);
  assert.equal(request.options.headers.Authorization, "Bearer github-secret-token");
  assert.equal(body.ref, "main");
  assert.equal(body.inputs.trigger_source, "cloudflare-cron");
  assert.equal(body.inputs.scheduled_time_ms, "1785720600000");
  assert.equal(result.result.workflow_run_id, 123);
  assert.doesNotMatch(request.options.body, /github-secret-token/);
});

test("GitHub의 기존 204 응답도 성공으로 처리한다", async () => {
  const result = await dispatchWatchWorkflow(env, 1785720600000, {
    fetchImpl: async () => new Response(null, { status: 204 }),
  });
  assert.equal(result.status, 204);
  assert.equal(result.result, null);
});

test("권한 오류는 즉시 재시도를 막고 실패로 기록한다", async () => {
  let noRetryCalled = false;
  await assert.rejects(
    worker.scheduled({
      scheduledTime: 1785720600000,
      cron: "*/5 * * * *",
      noRetry: () => { noRetryCalled = true; },
    }, env, {
      waitUntil: () => {},
    }, {
      fetchImpl: async () => new Response("forbidden", { status: 403 }),
    }),
    WorkflowDispatchError,
  );
  assert.equal(noRetryCalled, true);
});

test("특정 상영일 5일 전부터 2분 감시로 전환한다", () => {
  const config = {
    version: 3,
    paused: false,
    rules: [{ id: "august-15", enabled: true, dateMode: "specific", specificDates: ["20260815"] }],
  };
  const baseline = createMonitoringPlan(config, Date.parse("2026-08-09T14:59:59Z"));
  const boosted = createMonitoringPlan(config, Date.parse("2026-08-09T15:00:00Z"));
  assert.equal(baseline.today, "20260809");
  assert.equal(baseline.intervalMinutes, 5);
  assert.equal(baseline.nextBoostDate, "20260810");
  assert.equal(boosted.today, "20260810");
  assert.equal(boosted.intervalMinutes, 2);
});

test("저장한 평상시·집중 감지 간격을 실행 계획에 반영한다", () => {
  const config = {
    version: 3,
    paused: false,
    schedule: {
      normalIntervalMinutes: 15,
      focusedIntervalMinutes: 5,
      focusedLeadDays: 3,
    },
    rules: [{ id: "august-15", enabled: true, dateMode: "specific", specificDates: ["20260815"] }],
  };
  const normal = createMonitoringPlan(config, Date.parse("2026-08-11T14:59:59Z"));
  const focused = createMonitoringPlan(config, Date.parse("2026-08-11T15:00:00Z"));
  assert.equal(normal.intervalMinutes, 15);
  assert.equal(normal.mode, "normal");
  assert.equal(normal.nextBoostDate, "20260812");
  assert.equal(focused.intervalMinutes, 5);
  assert.equal(focused.mode, "focused");
});

test("선택한 분 간격 경계에서만 예약 실행한다", () => {
  const atTenMinutes = Date.parse("2026-08-03T01:30:00Z");
  assert.equal(isScheduledInterval(atTenMinutes, 10), true);
  assert.equal(isScheduledInterval(atTenMinutes + 5 * 60_000, 10), false);
  assert.equal(nextExpectedRun(atTenMinutes + 30_000, 10), Date.parse("2026-08-03T01:40:00Z"));
});

test("15분 설정은 5분 Cron 중 15분 경계에서만 GitHub를 호출한다", async () => {
  const config = {
    version: 3,
    paused: false,
    schedule: {
      normalIntervalMinutes: 15,
      focusedIntervalMinutes: 5,
      focusedLeadDays: 3,
    },
    rules: [{ id: "rolling", enabled: true, dateMode: "rolling" }],
  };
  const customEnv = {
    ...env,
    DB: {
      prepare: () => ({
        bind: () => ({ first: async () => ({ value: JSON.stringify(config) }) }),
      }),
    },
  };
  let dispatchCount = 0;
  const options = {
    fetchImpl: async () => {
      dispatchCount += 1;
      return new Response(null, { status: 204 });
    },
  };
  await worker.scheduled({
    scheduledTime: Date.parse("2026-08-03T01:35:00Z"),
    cron: "*/5 * * * *",
    noRetry: () => {},
  }, customEnv, {}, options);
  await worker.scheduled({
    scheduledTime: Date.parse("2026-08-03T01:45:00Z"),
    cron: "*/5 * * * *",
    noRetry: () => {},
  }, customEnv, {}, options);
  assert.equal(dispatchCount, 1);
});

test("특정 상영일이 지나면 감시 대상에서 자동 제외한다", () => {
  const config = {
    version: 3,
    paused: false,
    rules: [{ id: "august-15", enabled: true, dateMode: "specific", specificDates: ["20260815"] }],
  };
  const plan = createMonitoringPlan(config, Date.parse("2026-08-15T15:00:00Z"));
  assert.equal(plan.today, "20260816");
  assert.equal(plan.activeRules.length, 0);
  assert.deepEqual(plan.expiredRules.map((rule) => rule.id), ["august-15"]);
});

test("여러 특정 날짜는 다음 예정일을 기준으로 집중 감지를 계산한다", () => {
  const config = {
    version: 3,
    paused: false,
    rules: [{
      id: "august-dates",
      enabled: true,
      dateMode: "specific",
      specificDates: ["20260815", "20260829"],
    }],
  };
  const betweenDates = createMonitoringPlan(config, Date.parse("2026-08-19T15:00:00Z"));
  const focusedAgain = createMonitoringPlan(config, Date.parse("2026-08-23T15:00:00Z"));
  assert.equal(betweenDates.today, "20260820");
  assert.equal(betweenDates.intervalMinutes, 5);
  assert.equal(betweenDates.nextBoostDate, "20260824");
  assert.equal(focusedAgain.today, "20260824");
  assert.equal(focusedAgain.intervalMinutes, 2);
});

test("기본 기간에는 2분 Cron을 건너뛰고 5분 Cron만 실행한다", async () => {
  let dispatchCount = 0;
  await worker.scheduled({
    scheduledTime: Date.parse("2026-08-03T01:30:00Z"),
    cron: "*/2 * * * *",
    noRetry: () => {},
  }, env, { waitUntil: () => {} }, {
    fetchImpl: async () => {
      dispatchCount += 1;
      return new Response(null, { status: 204 });
    },
  });
  assert.equal(dispatchCount, 0);
});

test("관리 화면 HTML은 캐시하지 않고 보안 헤더를 적용한다", async () => {
  const response = await worker.fetch(new Request("https://example.com/"), {
    ASSETS: {
      fetch: async () => new Response("<!doctype html><title>CGV Open Watch</title>", {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    },
  });

  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.match(response.headers.get("Content-Security-Policy"), /default-src 'self'/);
  assert.equal(response.headers.get("X-Frame-Options"), "DENY");
});
