import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

function emptyState() {
  return {
    version: 2,
    initialized: false,
    updatedAt: null,
    seen: {},
    pending: {},
  };
}

function normalizeState(parsed) {
  if (parsed?.version === 1 && typeof parsed.seen === "object") {
    return {
      version: 2,
      initialized: parsed.initialized === true,
      updatedAt: parsed.updatedAt ?? null,
      seen: parsed.seen,
      pending: {},
    };
  }
  if (parsed?.version !== 2
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
  const heartbeatDue = previous.initialized
    && (lastUpdate == null
      || Number.isNaN(lastUpdate.getTime())
      || now.getTime() - lastUpdate.getTime() >= 30 * 24 * 60 * 60 * 1000);
  const retainedEntries = Object.entries(previous.seen).filter(([, item]) => {
    if (!item.showDate) return true;
    const date = new Date(`${item.showDate.slice(0, 4)}-${item.showDate.slice(4, 6)}-${item.showDate.slice(6, 8)}T23:59:59+09:00`);
    return Number.isNaN(date.getTime()) || date >= cutoff;
  });
  const seen = Object.fromEntries(
    retainedEntries,
  );
  const pending = { ...previous.pending };

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
      };
      if (previous.initialized || options.notifyExisting === true) {
        pending[schedule.key] = {
          ...schedule,
          queuedAt: now.toISOString(),
        };
      }
    }
  }

  const shouldNotify = previous.initialized || options.notifyExisting === true;
  const changed = !previous.initialized
    || newlySeen.length > 0
    || retainedEntries.length !== Object.keys(previous.seen).length
    || heartbeatDue;
  return {
    state: changed
      ? {
          version: 2,
          initialized: true,
          updatedAt: now.toISOString(),
          seen,
          pending,
        }
      : previous,
    notifications: shouldNotify ? newlySeen : [],
    baselineCount: previous.initialized ? 0 : newlySeen.length,
    changed,
  };
}

export function markDelivered(previous, scheduleKeys, options = {}) {
  const pending = { ...previous.pending };
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
    version: 2,
    updatedAt: (options.now ?? new Date()).toISOString(),
    pending,
  };
}

export async function writeState(statePath, state) {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}
