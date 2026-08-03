import { createHash } from "node:crypto";

export const LEGACY_RULE_ID = "legacy-default";
export const CONFIG_VERSION = 3;
export const MAX_RULES = 25;
export const MAX_ACTIVE_TARGETS = 12;
export const NORMAL_INTERVALS = [5, 10, 15, 30];
export const FOCUSED_INTERVALS = [2, 5];
export const FOCUSED_LEAD_DAYS = [1, 3, 5, 7, 14];
export const DEFAULT_SCHEDULE = Object.freeze({
  normalIntervalMinutes: 5,
  focusedIntervalMinutes: 2,
  focusedLeadDays: 5,
});

const DATE_PATTERN = /^\d{8}$/;
const TIME_PATTERN = /^\d{4}$/;

function uniqueStrings(values, limit = 50) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean))].slice(0, limit);
}

function normalizedDate(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return DATE_PATTERN.test(digits) ? digits : "";
}

function normalizedTime(value, fallback) {
  const rawDigits = String(value ?? "").replace(/\D/g, "");
  if (!rawDigits) return fallback;
  const digits = rawDigits.padStart(4, "0");
  if (!TIME_PATTERN.test(digits)) return fallback;
  const hour = Number(digits.slice(0, 2));
  const minute = Number(digits.slice(2));
  return hour <= 47 && minute <= 59 ? digits : fallback;
}

function normalizeTheatre(theatre) {
  return {
    name: String(theatre?.name ?? theatre?.siteNm ?? "").trim(),
    siteNo: String(theatre?.siteNo ?? "").trim(),
    regionCode: String(theatre?.regionCode ?? theatre?.regnGrpCd ?? "").trim(),
    regionName: String(theatre?.regionName ?? theatre?.regnGrpNm ?? "").trim(),
  };
}

export function normalizeSchedule(schedule) {
  const normalIntervalMinutes = NORMAL_INTERVALS.includes(Number(schedule?.normalIntervalMinutes))
    ? Number(schedule.normalIntervalMinutes)
    : DEFAULT_SCHEDULE.normalIntervalMinutes;
  const requestedFocused = FOCUSED_INTERVALS.includes(Number(schedule?.focusedIntervalMinutes))
    ? Number(schedule.focusedIntervalMinutes)
    : DEFAULT_SCHEDULE.focusedIntervalMinutes;
  const focusedIntervalMinutes = requestedFocused < normalIntervalMinutes
    ? requestedFocused
    : DEFAULT_SCHEDULE.focusedIntervalMinutes;
  const focusedLeadDays = FOCUSED_LEAD_DAYS.includes(Number(schedule?.focusedLeadDays))
    ? Number(schedule.focusedLeadDays)
    : DEFAULT_SCHEDULE.focusedLeadDays;
  return { normalIntervalMinutes, focusedIntervalMinutes, focusedLeadDays };
}

export function normalizeRule(rule, index = 0) {
  const movieTitle = String(rule?.movieTitle ?? rule?.movie?.title ?? "").trim();
  const movieNo = String(rule?.movieNo ?? rule?.movie?.no ?? "").trim();
  const lookAheadDays = Math.min(31, Math.max(1, Number(rule?.lookAheadDays) || 14));
  const dateMode = ["rolling", "range", "specific"].includes(rule?.dateMode)
    ? rule.dateMode
    : "rolling";
  const theatres = (Array.isArray(rule?.theatres) ? rule.theatres : [])
    .map(normalizeTheatre)
    .filter((theatre) => theatre.name && theatre.siteNo)
    .filter((theatre, theatreIndex, items) => (
      items.findIndex((candidate) => candidate.siteNo === theatre.siteNo) === theatreIndex
    ));

  return {
    id: String(rule?.id || (index === 0 ? LEGACY_RULE_ID : `rule-${index + 1}`)),
    name: String(rule?.name || movieTitle || `감시 규칙 ${index + 1}`).trim().slice(0, 80),
    enabled: rule?.enabled !== false,
    movieTitle,
    movieNo,
    theatres,
    formats: uniqueStrings(rule?.formats, 15),
    auditoriums: uniqueStrings(rule?.auditoriums, 30),
    dateMode,
    lookAheadDays,
    startDate: normalizedDate(rule?.startDate),
    endDate: normalizedDate(rule?.endDate),
    specificDates: uniqueStrings(rule?.specificDates, 31).map(normalizedDate).filter(Boolean).sort(),
    startTime: normalizedTime(rule?.startTime, "0000"),
    endTime: normalizedTime(rule?.endTime, "4759"),
    minSeats: Math.min(9999, Math.max(1, Number(rule?.minSeats) || 1)),
    notifyExisting: rule?.notifyExisting === true,
  };
}

export function normalizeWatchConfig(input) {
  if (input?.version === CONFIG_VERSION && Array.isArray(input.rules)) {
    return {
      version: CONFIG_VERSION,
      revision: Math.max(1, Number(input.revision) || 1),
      paused: input.paused === true,
      updatedAt: input.updatedAt ?? null,
      schedule: normalizeSchedule(input.schedule),
      rules: input.rules.slice(0, MAX_RULES).map(normalizeRule),
    };
  }

  const legacyRule = normalizeRule({
    ...input,
    id: LEGACY_RULE_ID,
    name: input?.movieTitle ? `${input.movieTitle} 감시` : "기본 감시",
  });
  return {
    version: CONFIG_VERSION,
    revision: 1,
    paused: false,
    updatedAt: null,
    schedule: normalizeSchedule(input?.schedule),
    rules: legacyRule.movieTitle ? [legacyRule] : [],
  };
}

function isValidCalendarDate(value) {
  if (!DATE_PATTERN.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function validateWatchConfig(input) {
  const config = normalizeWatchConfig(input);
  const errors = [];
  if (input?.schedule) {
    const normal = Number(input.schedule.normalIntervalMinutes);
    const focused = Number(input.schedule.focusedIntervalMinutes);
    const leadDays = Number(input.schedule.focusedLeadDays);
    if (!NORMAL_INTERVALS.includes(normal)) errors.push("평상시 감지 간격을 다시 선택해 주세요.");
    if (!FOCUSED_INTERVALS.includes(focused)) errors.push("집중 감지 간격을 다시 선택해 주세요.");
    if (!FOCUSED_LEAD_DAYS.includes(leadDays)) errors.push("집중 감지 시작 시점을 다시 선택해 주세요.");
    if (focused >= normal) errors.push("집중 감지 간격은 평상시보다 짧아야 합니다.");
  }
  if (config.rules.length === 0) errors.push("감시 규칙을 하나 이상 추가해 주세요.");
  if (config.rules.length > MAX_RULES) errors.push(`감시 규칙은 최대 ${MAX_RULES}개까지 저장할 수 있습니다.`);

  const ids = new Set();
  for (const [index, rule] of config.rules.entries()) {
    const label = rule.name || `감시 규칙 ${index + 1}`;
    if (!rule.id || ids.has(rule.id)) errors.push(`${label}: 규칙 ID가 올바르지 않습니다.`);
    ids.add(rule.id);
    if (!rule.movieTitle) errors.push(`${label}: 영화 제목을 입력해 주세요.`);
    if (rule.theatres.length === 0) errors.push(`${label}: 극장을 하나 이상 선택해 주세요.`);
    if (rule.dateMode === "range") {
      if (!isValidCalendarDate(rule.startDate) || !isValidCalendarDate(rule.endDate)) {
        errors.push(`${label}: 시작일과 종료일을 선택해 주세요.`);
      } else if (rule.startDate > rule.endDate) {
        errors.push(`${label}: 종료일은 시작일보다 빠를 수 없습니다.`);
      }
    }
    if (rule.dateMode === "specific"
        && (rule.specificDates.length === 0 || rule.specificDates.some((date) => !isValidCalendarDate(date)))) {
      errors.push(`${label}: 감시할 날짜를 하나 이상 선택해 주세요.`);
    }
    if (rule.startTime > rule.endTime) errors.push(`${label}: 종료 시간은 시작 시간보다 빠를 수 없습니다.`);
  }

  const activeTargets = config.rules
    .filter((rule) => rule.enabled)
    .reduce((count, rule) => count + rule.theatres.length, 0);
  if (activeTargets > MAX_ACTIVE_TARGETS) {
    errors.push(`활성 감시 대상은 영화·극장 조합 기준 최대 ${MAX_ACTIVE_TARGETS}개입니다.`);
  }

  return { config, errors };
}

export function ruleFingerprint(rule) {
  const normalized = normalizeRule(rule);
  const selection = {
    movieTitle: normalized.movieTitle,
    movieNo: normalized.movieNo,
    theatres: normalized.theatres.map((theatre) => theatre.siteNo).sort(),
    formats: [...normalized.formats].sort(),
    auditoriums: [...normalized.auditoriums].sort(),
    dateMode: normalized.dateMode,
    lookAheadDays: normalized.lookAheadDays,
    startDate: normalized.startDate,
    endDate: normalized.endDate,
    specificDates: normalized.specificDates,
    startTime: normalized.startTime,
    endTime: normalized.endTime,
    minSeats: normalized.minSeats,
  };
  return createHash("sha256").update(JSON.stringify(selection)).digest("hex").slice(0, 20);
}

export function configForDispatch(config) {
  const normalized = normalizeWatchConfig(config);
  return {
    ...normalized,
    rules: normalized.rules.filter((rule) => rule.enabled),
  };
}
