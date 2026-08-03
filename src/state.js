import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

function emptyState() {
  return {
    version: 3,
    initializedRules: {},
    updatedAt: null,
    seen: {},
    pending: {},
  };
}

function normalizeState(parsed) {
  if (parsed?.version === 1 && typeof parsed.seen === "object") {
    return {
      version: 3,
      initializedRules: parsed.initialized === true ? { "legacy-default": null } : {},
      updatedAt: parsed.updatedAt ?? null,
      seen: parsed.seen,
      pending: {},
    };
  }
  if (parsed?.version === 2
      && typeof parsed.seen === "object"
      && typeof parsed.pending === "object") {
    return {
      version: 3,
      initializedRules: parsed.initialized === true ? { "legacy-default": null } : {},
      updatedAt: parsed.updatedAt ?? null,
      seen: parsed.seen,
      pending: parsed.pending,
    };
  }
  if (parsed?.version !== 3
      || typeof parsed.initializedRules !== "object"
      || typeof parsed.seen !== "object"
      || typeof parsed.pending !== "object") {
    throw new Error("Unsupported state file format");
  }
  return parsed;
}

export async function readState(statePath) {
  try {
    return normalizeState(JSON.parse(await readFile(statePath, "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return emptyState();
    }
    throw error;
  }
}

export function updateState(previous, schedules, options = {}) {
  const now = options.now ?? new Date();
  const cutoff = options.cutoff ?? new Date(now.getTime() - 48 * 60 * 60 * 1000);
  const lastUpdate = previous.updatedAt ? new Date(previous.updatedAt) : null;
  const initializedRules = {
    ...(previous.initializedRules
      ?? (previous.initialized === true ? { "legacy-default": null } : {})),
  };
  const rules = Array.isArray(options.rules) && options.rules.length > 0
    ? options.rules
    : [{ id: "legacy-default", fingerprint: null, notifyExisting: options.notifyExisting === true }];
  const currentRuleIds = new Set(rules.map((rule) => rule.id));
  const ruleIdFor = (key, item) => item.ruleId
    ?? [...currentRuleIds].find((ruleId) => key.startsWith(`${ruleId}:`))
    ?? "legacy-default";
  const heartbeatDue = Object.keys(initializedRules).length > 0
    && (lastUpdate == null
      || Number.isNaN(lastUpdate.getTime())
      || now.getTime() - lastUpdate.getTime() >= 30 * 24 * 60 * 60 * 1000);
  const retainedEntries = Object.entries(previous.seen).filter(([, item]) => {
    if (!item.showDate) return true;
    const date = new Date(`${item.showDate.slice(0, 4)}-${item.showDate.slice(4, 6)}-${item.showDate.slice(6, 8)}T23:59:59+09:00`);
    return Number.isNaN(date.getTime()) || date >= cutoff;
  });
  const seen = Object.fromEntries(retainedEntries.filter(([key, item]) => {
    const ruleId = ruleIdFor(key, item);
    return currentRuleIds.has(ruleId);
  }));
  const previousPending = previous.pending ?? {};
  const pending = Object.fromEntries(Object.entries(previousPending).filter(([key, item]) => {
    const ruleId = ruleIdFor(key, item);
    return currentRuleIds.has(ruleId);
  }));

  const baseliningRules = new Set();
  for (const rule of rules) {
    const wasInitialized = Object.hasOwn(initializedRules, rule.id);
    const sameFingerprint = initializedRules[rule.id] === rule.fingerprint
      || initializedRules[rule.id] == null
      || rule.fingerprint == null;
    if (!wasInitialized || !sameFingerprint) baseliningRules.add(rule.id);
    initializedRules[rule.id] = rule.fingerprint ?? null;
  }
  for (const ruleId of Object.keys(initializedRules)) {
    if (!currentRuleIds.has(ruleId)) delete initializedRules[ruleId];
  }

  const newlySeen = [];
  for (const schedule of schedules) {
    if (!seen[schedule.key]) {
      newlySeen.push(schedule);
      seen[schedule.key] = {
        firstSeenAt: now.toISOString(),
        showDate: schedule.showDate,
        theatreName: schedule.theatreName,
        movieTitle: schedule.movieTitle,
        auditoriumName: schedule.auditoriumName,
        startTime: schedule.startTime,
        ruleId: schedule.ruleId ?? "legacy-default",
      };
      const ruleId = schedule.ruleId ?? "legacy-default";
      const rule = rules.find((candidate) => candidate.id === ruleId);
      if (!baseliningRules.has(ruleId) || rule?.notifyExisting === true || options.notifyExisting === true) {
        pending[schedule.key] = {
          ...schedule,
          queuedAt: now.toISOString(),
        };
      }
    }
  }

  const notifications = newlySeen.filter((schedule) => {
    const ruleId = schedule.ruleId ?? "legacy-default";
    const rule = rules.find((candidate) => candidate.id === ruleId);
    return !baseliningRules.has(ruleId) || rule?.notifyExisting === true || options.notifyExisting === true;
  });
  const changed = baseliningRules.size > 0
    || newlySeen.length > 0
    || retainedEntries.length !== Object.keys(previous.seen).length
    || Object.keys(pending).length !== Object.keys(previousPending).length
    || heartbeatDue;
  return {
    state: changed
      ? {
          version: 3,
          initializedRules,
          updatedAt: now.toISOString(),
          seen,
          pending,
        }
      : previous,
    notifications,
    baselineCount: newlySeen.length - notifications.length,
    changed,
  };
}

export function markDelivered(previous, scheduleKeys, options = {}) {
  const pending = { ...(previous.pending ?? {}) };
  let changed = false;
  for (const key of scheduleKeys) {
    if (pending[key]) {
      delete pending[key];
      changed = true;
    }
  }
  if (!changed) return previous;

  return {
    ...previous,
    version: 3,
    updatedAt: (options.now ?? new Date()).toISOString(),
    pending,
  };
}

export async function writeState(statePath, state) {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}
