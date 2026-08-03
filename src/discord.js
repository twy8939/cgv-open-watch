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

function displayFormat(schedule) {
  const values = [schedule.formatName, schedule.screenGradeName, schedule.movieKindName]
    .filter(Boolean)
    .filter((value, index, items) => items.indexOf(value) === index);
  return values.join(" / ") || "일반 상영";
}

function displayKstDateTime(value) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(value);
}

function cgvTheatreName(value) {
  const name = String(value ?? "").trim();
  if (!name || /^CGV\s/i.test(name)) return name;
  return `CGV ${name}`;
}

export function createCgvBookingUrl(schedule = {}) {
  const hasMovie = Boolean(schedule.movieNo);
  const url = new URL(hasMovie
    ? "https://cgv.co.kr/cnm/movieBook/movie"
    : "https://cgv.co.kr/cnm/movieBook/cinema");

  const parameters = {
    movNo: schedule.movieNo,
    scnSseq: schedule.scheduleSequence,
    scnYmd: schedule.showDate,
    scnsNo: schedule.screenNo,
    siteNm: cgvTheatreName(schedule.theatreName),
    siteNo: schedule.siteNo,
  };
  for (const [name, value] of Object.entries(parameters)) {
    if (value != null && String(value).trim()) url.searchParams.set(name, String(value));
  }
  return url.toString();
}

function bookingFooter(schedule) {
  return [
    "**지금 예매하기**",
    createCgvBookingUrl(schedule),
    "📱 CGV 앱 링크를 지원하는 기기에서는 앱으로, 아니면 웹 예매로 열립니다.",
  ].join("\n");
}

export function createDiscordTestMessage(now = new Date()) {
  return [
    "**🧪 CGV Open Watch 테스트**",
    "Discord Webhook 연결이 정상입니다.",
    `확인 시각: ${displayKstDateTime(now)} (KST)`,
    "이 메시지는 실제 예매 오픈 알림이 아닙니다.",
    "📱 모바일 앱 연결 테스트:",
    "https://cgv.co.kr/cnm/movieBook",
  ].join("\n");
}

export function createDiscordMessage(schedule) {
  const seats = schedule.remainingSeats == null
    ? ""
    : `\n남은 좌석: ${schedule.remainingSeats}석`;

  return [
    "**🎬 CGV 예매 오픈**",
    `영화: ${schedule.movieTitle}`,
    `극장: ${schedule.theatreName}`,
    `상영관: ${schedule.auditoriumName || schedule.formatName}`,
    `형식: ${displayFormat(schedule)}`,
    `일시: ${displayDate(schedule.showDate)} ${displayTime(schedule.startTime)}${seats}`,
    bookingFooter(schedule),
  ].join("\n");
}

export function createDiscordBatches(schedules) {
  const maxMessageLength = 1_900;
  const maxSectionLength = 1_200;
  const groups = new Map();

  for (const schedule of schedules) {
    const key = [schedule.movieTitle, schedule.theatreName, schedule.showDate].join("\u0000");
    const group = groups.get(key) ?? {
      movieTitle: schedule.movieTitle,
      theatreName: schedule.theatreName,
      showDate: schedule.showDate,
      bookingSchedule: schedule,
      sections: new Map(),
    };
    const auditorium = schedule.auditoriumName || "상영관 정보 없음";
    const format = displayFormat(schedule);
    const sectionKey = `${auditorium}\u0000${format}`;
    const section = group.sections.get(sectionKey) ?? { auditorium, format, rows: [] };
    const rows = section.rows;
    rows.push(schedule);
    group.sections.set(sectionKey, section);
    groups.set(key, group);
  }

  const batches = [];
  for (const group of groups.values()) {
    const header = [
      "**🎬 CGV 예매 오픈**",
      `영화: ${group.movieTitle}`,
      `극장: ${group.theatreName}`,
      `날짜: ${displayDate(group.showDate)}`,
    ];
    const footer = bookingFooter(group.bookingSchedule);
    const sectionChunks = [];

    for (const section of group.sections.values()) {
      const prefix = `상영관: ${section.auditorium}\n형식: ${section.format}\n시간: `;
      const sortedRows = [...section.rows]
        .sort((left, right) => String(left.startTime).localeCompare(String(right.startTime)));
      let tokens = [];
      let keys = [];
      for (const schedule of sortedRows) {
        const token = `${displayTime(schedule.startTime)}${displaySeats(schedule)}`;
        const candidate = `${prefix}${[...tokens, token].join(", ")}`;
        if (candidate.length > maxSectionLength && tokens.length > 0) {
          sectionChunks.push({ text: `${prefix}${tokens.join(", ")}`, keys });
          tokens = [];
          keys = [];
        }
        tokens.push(token);
        keys.push(schedule.key);
      }
      if (tokens.length > 0) {
        sectionChunks.push({ text: `${prefix}${tokens.join(", ")}`, keys });
      }
    }

    let currentSections = [];
    let currentKeys = [];
    const flush = () => {
      if (currentSections.length === 0) return;
      batches.push({
        content: [...header, ...currentSections, footer].join("\n"),
        keys: currentKeys,
      });
      currentSections = [];
      currentKeys = [];
    };

    for (const section of sectionChunks) {
      const candidate = [...header, ...currentSections, section.text, footer].join("\n");
      if (candidate.length > maxMessageLength && currentSections.length > 0) flush();
      const single = [...header, section.text, footer].join("\n");
      if (single.length > maxMessageLength) {
        throw new Error(`Discord message section is too long (${single.length} characters)`);
      }
      currentSections.push(section.text);
      currentKeys.push(...section.keys);
    }
    flush();
  }

  return batches;
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
