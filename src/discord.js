function displayTime(value) {
  const digits = String(value).replace(/\D/g, "").padStart(4, "0");
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

function displayDate(value) {
  const digits = String(value).replace(/\D/g, "");
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function displaySeats(schedule) {
  return schedule.remainingSeats == null ? "" : ` (${schedule.remainingSeats}석)`;
}

export function createDiscordMessage(schedule) {
  const seats = schedule.remainingSeats == null
    ? ""
    : `\n남은 좌석: ${schedule.remainingSeats}석`;
  const bookingUrl = "https://cgv.co.kr/cnm/movieBook/cinema";

  return [
    "**🎬 CGV SCREENX 예매 오픈**",
    `영화: ${schedule.movieTitle}`,
    `극장: ${schedule.theatreName}`,
    `상영관: ${schedule.auditoriumName || schedule.formatName}`,
    `일시: ${displayDate(schedule.showDate)} ${displayTime(schedule.startTime)}${seats}`,
    `예매: ${bookingUrl}`,
  ].join("\n");
}

export function createDiscordBatches(schedules) {
  const bookingUrl = "https://cgv.co.kr/cnm/movieBook/cinema";
  const groups = new Map();

  for (const schedule of schedules) {
    const key = [schedule.movieTitle, schedule.theatreName, schedule.showDate].join("\u0000");
    const group = groups.get(key) ?? {
      movieTitle: schedule.movieTitle,
      theatreName: schedule.theatreName,
      showDate: schedule.showDate,
      auditoriums: new Map(),
    };
    const auditorium = schedule.auditoriumName || schedule.formatName || "SCREENX";
    const rows = group.auditoriums.get(auditorium) ?? [];
    rows.push(schedule);
    group.auditoriums.set(auditorium, rows);
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => {
    const sections = [...group.auditoriums.entries()].map(([auditorium, rows]) => {
      const times = rows
        .sort((left, right) => String(left.startTime).localeCompare(String(right.startTime)))
        .map((schedule) => `${displayTime(schedule.startTime)}${displaySeats(schedule)}`)
        .join(", ");
      return `상영관: ${auditorium}\n시간: ${times}`;
    });

    const content = [
      "**🎬 CGV SCREENX 예매 오픈**",
      `영화: ${group.movieTitle}`,
      `극장: ${group.theatreName}`,
      `날짜: ${displayDate(group.showDate)}`,
      ...sections,
      `예매: ${bookingUrl}`,
    ].join("\n");

    if (content.length > 2_000) {
      throw new Error(`Discord message is too long (${content.length} characters)`);
    }
    return {
      content,
      keys: [...group.auditoriums.values()].flat().map((schedule) => schedule.key),
    };
  });
}

export function createDiscordMessages(schedules) {
  return createDiscordBatches(schedules).map((batch) => batch.content);
}

function webhookRequestUrl(webhookUrl) {
  const url = new URL(webhookUrl);
  url.searchParams.set("wait", "true");
  return url.toString();
}

function retryDelayMs(response, attempt) {
  const header = Number(response.headers?.get?.("retry-after"));
  if (Number.isFinite(header) && header > 0) {
    return Math.min(header * 1_000, 30_000);
  }
  return Math.min(1_000 * (2 ** attempt), 10_000);
}

export async function sendDiscordContent(webhookUrl, content, options = {}) {
  if (!webhookUrl) throw new Error("DISCORD_WEBHOOK_URL is required");
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const attempts = options.attempts ?? 3;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetchImpl(webhookRequestUrl(webhookUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        allowed_mentions: { parse: [] },
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    });

    if (response.ok) return response.json();
    const canRetry = response.status === 429 || response.status >= 500;
    if (canRetry && attempt + 1 < attempts) {
      await sleep(retryDelayMs(response, attempt));
      continue;
    }

    const detail = await response.text();
    throw new Error(`Discord webhook failed (${response.status}): ${detail.slice(0, 200)}`);
  }

  throw new Error("Discord webhook retry limit exceeded");
}

export async function sendDiscordMessages(webhookUrl, schedules, options = {}) {
  const messages = createDiscordMessages(schedules);
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  for (let index = 0; index < messages.length; index += 1) {
    await sendDiscordContent(webhookUrl, messages[index], { ...options, sleep });
    if (index + 1 < messages.length) await sleep(options.intervalMs ?? 350);
  }
  return messages.length;
}

export async function sendDiscordMessage(webhookUrl, schedule, options = {}) {
  return sendDiscordContent(webhookUrl, createDiscordMessage(schedule), options);
}
