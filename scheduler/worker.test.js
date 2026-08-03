import test from "node:test";
import assert from "node:assert/strict";
import worker, {
  createMonitoringPlan,
  dispatchWatchWorkflow,
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
