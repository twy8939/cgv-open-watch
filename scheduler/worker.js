const GITHUB_API_VERSION = "2026-03-10";
const DISPATCH_TIMEOUT_MS = 15_000;
const SESSION_MAX_AGE = 60 * 60 * 12;
const MAX_ACTIVE_TARGETS = 12;
const MAX_RULES = 25;

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

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

function encodeBase64Url(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return encodeBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))));
}

async function sha256(value) {
  return encodeBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

function safeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

async function createSession(env) {
  const payload = encodeBase64Url(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE }));
  return `${payload}.${await hmac(payload, required(env, "SESSION_SECRET"))}`;
}

async function validSession(request, env) {
  const cookie = request.headers.get("Cookie") ?? "";
  const token = cookie.match(/(?:^|;\s*)cgv_watch_session=([^;]+)/)?.[1];
  if (!token) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !safeEqual(await hmac(payload, required(env, "SESSION_SECRET")), signature)) return false;
  try {
    const data = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload)));
    return Number(data.exp) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function assertSameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) throw new Response("Invalid origin", { status: 403 });
}

async function getSetting(env, key, fallback = null) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first();
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return fallback; }
}

async function setSetting(env, key, value) {
  await env.DB.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .bind(key, JSON.stringify(value)).run();
}

async function audit(env, action, summary, detail = null) {
  await env.DB.prepare("INSERT INTO audit_log (action, summary, detail_json) VALUES (?, ?, ?)")
    .bind(action, summary, detail == null ? null : JSON.stringify(detail)).run();
}

function validateConfig(input) {
  const errors = [];
  if (input?.version !== 3 || !Array.isArray(input.rules)) return ["지원하지 않는 설정 형식입니다."];
  if (input.rules.length < 1 || input.rules.length > MAX_RULES) errors.push(`감시 규칙은 1~${MAX_RULES}개여야 합니다.`);
  const ids = new Set();
  let targets = 0;
  for (const [index, rule] of input.rules.entries()) {
    const label = String(rule?.name || `규칙 ${index + 1}`);
    if (!rule?.id || ids.has(rule.id)) errors.push(`${label}: 규칙 ID가 중복되었거나 없습니다.`);
    ids.add(rule?.id);
    if (!String(rule?.movieTitle ?? "").trim()) errors.push(`${label}: 영화 제목을 입력해 주세요.`);
    if (!Array.isArray(rule?.theatres) || rule.theatres.length === 0) errors.push(`${label}: 극장을 선택해 주세요.`);
    if (rule?.enabled !== false) targets += rule?.theatres?.length ?? 0;
    if (rule?.dateMode === "range" && (!/^\d{8}$/.test(rule.startDate) || !/^\d{8}$/.test(rule.endDate) || rule.startDate > rule.endDate)) {
      errors.push(`${label}: 날짜 범위를 확인해 주세요.`);
    }
    if (rule?.dateMode === "specific" && (!Array.isArray(rule.specificDates) || rule.specificDates.length === 0)) {
      errors.push(`${label}: 날짜를 하나 이상 선택해 주세요.`);
    }
  }
  if (targets > MAX_ACTIVE_TARGETS) errors.push(`활성 영화·극장 조합은 최대 ${MAX_ACTIVE_TARGETS}개입니다.`);
  return errors;
}

export async function dispatchWatchWorkflow(env, scheduledTime, options = {}) {
  const owner = required(env, "GITHUB_OWNER");
  const repo = required(env, "GITHUB_REPO");
  const workflow = required(env, "GITHUB_WORKFLOW");
  const ref = required(env, "GITHUB_REF");
  const token = required(env, "GITHUB_TOKEN");
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`;
  const inputs = {
    notify_existing: String(options.notifyExisting === true),
    send_test_notification: String(options.testNotification === true),
    sync_catalog: String(options.syncCatalog === true),
    trigger_source: options.source ?? "cloudflare-cron",
    scheduled_time_ms: String(scheduledTime),
  };
  if (options.config) inputs.watch_config_b64 = encodeBase64Url(JSON.stringify(options.config));
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "cgv-open-watch-scheduler",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
    },
    body: JSON.stringify({ ref, inputs }),
    signal: AbortSignal.timeout(options.timeoutMs ?? DISPATCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new WorkflowDispatchError(response.status, (await response.text()).slice(0, 300));
  let result = null;
  if (response.status !== 204) {
    const text = await response.text();
    if (text) result = JSON.parse(text);
  }
  return { status: response.status, result };
}

async function githubJson(env, path) {
  const response = await fetch(`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${required(env, "GITHUB_TOKEN")}`,
      "User-Agent": "cgv-open-watch-console",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
    },
  });
  if (!response.ok) throw new Error(`GitHub 조회 실패 (${response.status})`);
  return response.json();
}

async function apiHandler(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/api/session" && request.method === "GET") return json({ authenticated: await validSession(request, env) });
  if (url.pathname === "/api/login" && request.method === "POST") {
    assertSameOrigin(request);
    const ipHash = await sha256(request.headers.get("CF-Connecting-IP") ?? "unknown");
    const attempt = await env.DB.prepare("SELECT count, blocked_until FROM login_attempts WHERE ip_hash = ?").bind(ipHash).first();
    if (attempt?.blocked_until && new Date(`${attempt.blocked_until}Z`).getTime() > Date.now()) return json({ error: "잠시 후 다시 시도해 주세요." }, 429);
    const body = await request.json();
    const expected = await sha256(required(env, "ADMIN_PASSWORD"));
    const actual = await sha256(String(body.password ?? ""));
    if (!safeEqual(actual, expected)) {
      const count = Number(attempt?.count ?? 0) + 1;
      await env.DB.prepare(`INSERT INTO login_attempts (ip_hash, count, blocked_until, updated_at) VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(ip_hash) DO UPDATE SET count = ?, blocked_until = ?, updated_at = datetime('now')`)
        .bind(ipHash, count, count >= 5 ? new Date(Date.now() + 15 * 60_000).toISOString().slice(0, 19) : null, count, count >= 5 ? new Date(Date.now() + 15 * 60_000).toISOString().slice(0, 19) : null).run();
      return json({ error: "비밀번호가 맞지 않습니다." }, 401);
    }
    await env.DB.prepare("DELETE FROM login_attempts WHERE ip_hash = ?").bind(ipHash).run();
    await audit(env, "login", "관리 화면 로그인");
    return json({ ok: true }, 200, {
      "Set-Cookie": `cgv_watch_session=${await createSession(env)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_MAX_AGE}`,
    });
  }
  if (!await validSession(request, env)) return json({ error: "로그인이 필요합니다." }, 401);
  if (!["GET", "HEAD"].includes(request.method)) assertSameOrigin(request);

  if (url.pathname === "/api/logout" && request.method === "POST") {
    return json({ ok: true }, 200, { "Set-Cookie": "cgv_watch_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0" });
  }
  if (url.pathname === "/api/config" && request.method === "GET") {
    return json(await getSetting(env, "watch_config", { version: 3, revision: 1, paused: false, rules: [] }));
  }
  if (url.pathname === "/api/config" && request.method === "PUT") {
    const config = await request.json();
    const errors = validateConfig(config);
    if (errors.length > 0) return json({ errors }, 422);
    const previous = await getSetting(env, "watch_config", { revision: 0 });
    const saved = { ...config, revision: Number(previous.revision ?? 0) + 1, updatedAt: new Date().toISOString() };
    await setSetting(env, "watch_config", saved);
    await audit(env, "config-saved", `감시 규칙 ${saved.rules.length}개 저장`, { revision: saved.revision });
    return json(saved);
  }
  if (url.pathname === "/api/catalog" && request.method === "GET") {
    const response = await fetch(`https://raw.githubusercontent.com/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/${env.GITHUB_REF}/config/catalog.json`, { cf: { cacheTtl: 300 } });
    if (!response.ok) return json({ version: 1, regions: [], theatres: [], movies: [], unavailable: true });
    return json(await response.json());
  }
  if (url.pathname === "/api/run" && request.method === "POST") {
    const body = await request.json();
    const config = await getSetting(env, "watch_config", null);
    if (!config && body.mode === "scan") return json({ error: "먼저 감시 규칙을 저장해 주세요." }, 409);
    const result = await dispatchWatchWorkflow(env, Date.now(), {
      config: body.mode === "scan" ? config : undefined,
      notifyExisting: body.notifyExisting === true,
      testNotification: body.mode === "test",
      syncCatalog: body.mode === "catalog",
      source: `console-${body.mode ?? "scan"}`,
    });
    await audit(env, "workflow-dispatched", body.mode === "test" ? "Discord 테스트 요청" : body.mode === "catalog" ? "CGV 목록 새로고침 요청" : "즉시 감지 요청", { runId: result.result?.workflow_run_id ?? null });
    return json({ ok: true, runId: result.result?.workflow_run_id ?? null });
  }
  if (url.pathname === "/api/status" && request.method === "GET") {
    const [runs, config] = await Promise.all([
      githubJson(env, `/actions/workflows/${env.GITHUB_WORKFLOW}/runs?per_page=10`),
      getSetting(env, "watch_config", { paused: false, rules: [] }),
    ]);
    return json({
      paused: config.paused === true,
      activeRules: config.rules.filter((rule) => rule.enabled !== false).length,
      runs: runs.workflow_runs.map((run) => ({ id: run.id, status: run.status, conclusion: run.conclusion, event: run.event, createdAt: run.created_at, updatedAt: run.updated_at, url: run.html_url })),
    });
  }
  if (url.pathname === "/api/audit" && request.method === "GET") {
    const result = await env.DB.prepare("SELECT id, action, summary, created_at AS createdAt FROM audit_log ORDER BY id DESC LIMIT 30").all();
    return json({ items: result.results ?? [] });
  }
  return json({ error: "찾을 수 없습니다." }, 404);
}

function securityHeaders(response) {
  const copy = new Response(response.body, response);
  copy.headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  copy.headers.set("Referrer-Policy", "no-referrer");
  copy.headers.set("X-Content-Type-Options", "nosniff");
  copy.headers.set("X-Frame-Options", "DENY");
  copy.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return copy;
}

export default {
  async fetch(request, env) {
    try {
      const response = new URL(request.url).pathname.startsWith("/api/")
        ? await apiHandler(request, env)
        : await env.ASSETS.fetch(request);
      return securityHeaders(response);
    } catch (error) {
      if (error instanceof Response) return securityHeaders(error);
      console.error(error);
      return securityHeaders(json({ error: "요청을 처리하지 못했습니다." }, 500));
    }
  },
  async scheduled(controller, env, _ctx, options = {}) {
    try {
      const config = await getSetting(env, "watch_config", null);
      if (!config || config.paused === true || config.rules.every((rule) => rule.enabled === false)) {
        console.log(JSON.stringify({ event: "workflow-skipped", reason: !config ? "no-config" : "paused" }));
        return;
      }
      const dispatched = await dispatchWatchWorkflow(env, controller.scheduledTime, { ...options, config });
      console.log(JSON.stringify({ event: "workflow-dispatched", scheduledTime: controller.scheduledTime, cron: controller.cron, status: dispatched.status, workflowRunId: dispatched.result?.workflow_run_id ?? null }));
    } catch (error) {
      if (error instanceof WorkflowDispatchError && [400, 401, 403, 404, 422].includes(error.status)) controller.noRetry();
      console.error(JSON.stringify({ event: "workflow-dispatch-failed", scheduledTime: controller.scheduledTime, cron: controller.cron, error: error instanceof Error ? error.message : String(error) }));
      throw error;
    }
  },
};
