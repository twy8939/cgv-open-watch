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

export function auditoriumMatches(schedule, auditoriums = []) {
  if (!Array.isArray(auditoriums) || auditoriums.length === 0) return true;
  const actual = normalizeText(schedule.auditoriumName);
  return auditoriums.some((auditorium) => actual.includes(normalizeText(auditorium)));
}

export function dateMatches(schedule, config) {
  const showDate = String(schedule.showDate ?? "").replace(/\D/g, "");
  if (!/^\d{8}$/.test(showDate)) return false;
  if (config.dateMode === "range") {
    return showDate >= String(config.startDate ?? "") && showDate <= String(config.endDate ?? "");
  }
  if (config.dateMode === "specific") {
    return (config.specificDates ?? []).includes(showDate);
  }
  return true;
}

export function showTimeMatches(schedule, config) {
  const time = String(schedule.startTime ?? "").replace(/\D/g, "").padStart(4, "0");
  return time >= (config.startTime ?? "0000") && time <= (config.endTime ?? "4759");
}

export function seatsMatch(schedule, minimum = 1) {
  return schedule.remainingSeats == null || Number(schedule.remainingSeats) >= Number(minimum || 1);
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
    .filter((schedule) => !Array.isArray(config.theatres)
      || config.theatres.length === 0
      || config.theatres.some((theatre) => theatre.siteNo === schedule.siteNo))
    .filter((schedule) => formatMatches(schedule, config.formats))
    .filter((schedule) => auditoriumMatches(schedule, config.auditoriums))
    .filter((schedule) => dateMatches(schedule, config))
    .filter((schedule) => showTimeMatches(schedule, config))
    .filter((schedule) => seatsMatch(schedule, config.minSeats))
    .filter(isBookableSchedule)
    .map((schedule) => {
      const baseKey = makeScheduleKey(schedule);
      return {
        ...schedule,
        baseKey,
        key: config.id ? `${config.id}:${baseKey}` : baseKey,
        ruleId: config.id ?? null,
        ruleName: config.name ?? null,
      };
    })
    .sort((left, right) => left.key.localeCompare(right.key));
}

export function selectTargetsForRules(schedules, rules) {
  return rules.flatMap((rule) => selectTargetSchedules(schedules, rule));
}
