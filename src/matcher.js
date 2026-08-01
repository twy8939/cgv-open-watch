export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

export function titleMatches(actualTitle, expectedTitle) {
  const actual = normalizeText(actualTitle);
  const expected = normalizeText(expectedTitle);
  return actual.length > 0 && actual === expected;
}

export function formatMatches(schedule, formats = []) {
  if (!Array.isArray(formats) || formats.length === 0) return true;
  if (formats.some((format) => ["*", "ALL", "전체"].includes(String(format).trim().toUpperCase()))) {
    return true;
  }

  const haystack = normalizeText([
    schedule.formatName,
    schedule.auditoriumName,
    schedule.screenGradeName,
    schedule.movieKindName,
  ].filter(Boolean).join(" "));

  return formats.some((format) => haystack.includes(normalizeText(format)));
}

export function isBookableSchedule(schedule) {
  if (schedule.disabled === true) return false;
  if (schedule.bookingClosed === true) return false;
  if (schedule.soldOut === true) return false;
  if (schedule.saleEnabled === false) return false;
  if (schedule.remainingSeats != null && Number(schedule.remainingSeats) <= 0) {
    return false;
  }
  return Boolean(schedule.startTime && schedule.showDate);
}

export function makeScheduleKey(schedule) {
  return [
    schedule.siteNo,
    normalizeText(schedule.movieTitle),
    schedule.showDate,
    normalizeText(schedule.auditoriumName || schedule.formatName),
    String(schedule.startTime).replace(/\D/g, ""),
  ].join(":");
}

export function selectTargetSchedules(schedules, config) {
  return schedules
    .filter((schedule) => titleMatches(schedule.movieTitle, config.movieTitle))
    .filter((schedule) => formatMatches(schedule, config.formats))
    .filter(isBookableSchedule)
    .map((schedule) => ({ ...schedule, key: makeScheduleKey(schedule) }))
    .sort((left, right) => left.key.localeCompare(right.key));
}
