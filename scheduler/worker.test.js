import test from "node:test";
import assert from "node:assert/strict";
import worker, {
  dispatchWatchWorkflow,
  WorkflowDispatchError,
} from "./worker.js";

const env = {
  GITHUB_OWNER: "twy8939",
  GITHUB_REPO: "cgv-open-watch",
  GITHUB_WORKFLOW: "watch.yml",
  GITHUB_REF: "main",
  GITHUB_TOKEN: "github-secret-token",
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
