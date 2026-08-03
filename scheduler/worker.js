const GITHUB_API_VERSION = "2026-03-10";
const DISPATCH_TIMEOUT_MS = 15_000;

export class WorkflowDispatchError extends Error {
  constructor(status, detail) {
    super(`GitHub workflow dispatch failed (${status}): ${detail}`);
    this.name = "WorkflowDispatchError";
    this.status = status;
  }
}

function required(env, name) {
  const value = env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export async function dispatchWatchWorkflow(env, scheduledTime, options = {}) {
  const owner = required(env, "GITHUB_OWNER");
  const repo = required(env, "GITHUB_REPO");
  const workflow = required(env, "GITHUB_WORKFLOW");
  const ref = required(env, "GITHUB_REF");
  const token = required(env, "GITHUB_TOKEN");
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "cgv-open-watch-scheduler",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
    },
    body: JSON.stringify({
      ref,
      inputs: {
        notify_existing: "false",
        send_test_notification: "false",
        trigger_source: "cloudflare-cron",
        scheduled_time_ms: String(scheduledTime),
      },
    }),
    signal: AbortSignal.timeout(options.timeoutMs ?? DISPATCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new WorkflowDispatchError(response.status, detail);
  }

  let result = null;
  if (response.status !== 204) {
    const text = await response.text();
    if (text) result = JSON.parse(text);
  }
  return { status: response.status, result };
}

export default {
  async scheduled(controller, env, _ctx, options = {}) {
    try {
      const dispatched = await dispatchWatchWorkflow(env, controller.scheduledTime, options);
      console.log(JSON.stringify({
        event: "workflow-dispatched",
        scheduledTime: controller.scheduledTime,
        cron: controller.cron,
        status: dispatched.status,
        workflowRunId: dispatched.result?.workflow_run_id ?? null,
      }));
    } catch (error) {
      if (error instanceof WorkflowDispatchError
          && [400, 401, 403, 404, 422].includes(error.status)) {
        controller.noRetry();
      }
      console.error(JSON.stringify({
        event: "workflow-dispatch-failed",
        scheduledTime: controller.scheduledTime,
        cron: controller.cron,
        error: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    }
  },
};
