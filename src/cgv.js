import { access } from "node:fs/promises";
import { chromium } from "playwright-core";

const MAC_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    process.platform === "darwin" ? MAC_CHROME : null,
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next system browser.
    }
  }
  throw new Error("Chrome executable not found. Set CHROME_PATH.");
}

function toKstShowTime(showDate, startTime) {
  const date = String(showDate ?? "");
  const time = String(startTime ?? "").padStart(4, "0");
  if (!/^\d{8}$/.test(date) || !/^\d{4}$/.test(time)) return null;

  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(4, 6));
  const day = Number(date.slice(6, 8));
  const hour = Number(time.slice(0, 2));
  const minute = Number(time.slice(2, 4));
  if (month < 1 || month > 12 || hour > 47 || minute > 59) return null;

  return new Date(Date.UTC(year, month - 1, day, hour - 9, minute));
}

function mapApiSchedule(item, theatre, now = new Date()) {
  const remainingSeats = item.frSeatCnt == null ? null : Number(item.frSeatCnt);
  const totalSeats = item.stcnt == null ? null : Number(item.stcnt);
  const startsAt = toKstShowTime(item.scnYmd, item.scnsrtTm);
  const statusText = [item.salsStusNm, item.scnStusNm, item.cntJoinNm]
    .filter(Boolean)
    .join(" ");

  return {
    siteNo: theatre.siteNo,
    theatreName: theatre.name,
    movieTitle: item.movNm ?? item.movieNm ?? item.expoProdNm ?? "",
    movieNo: item.movNo ?? item.movieNo ?? null,
    screenNo: item.scnsNo ?? null,
    scheduleSequence: item.scnSseq ?? null,
    productNo: item.prodNo ?? null,
    showDate: item.scnYmd ?? item.showDate ?? "",
    startTime: item.scnsrtTm ?? item.startTime ?? "",
    endTime: item.scnendTm ?? item.endTime ?? "",
    auditoriumName: item.expoScnsNm ?? item.scnsNm ?? item.auditoriumName ?? "",
    formatName: [item.movkndDsplNm, item.movkndDsplEnm, item.movkndNm, item.videoAddexpCont]
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index)
      .join(" "),
    screenGradeName: item.tcscnsGradNm ?? item.scnsGradNm ?? item.scnsGradCdNm ?? "",
    movieKindName: item.movkndCdNm ?? "",
    remainingSeats: Number.isFinite(remainingSeats) ? remainingSeats : null,
    totalSeats: Number.isFinite(totalSeats) ? totalSeats : null,
    startsAt: startsAt?.toISOString() ?? null,
    disabled: item.disabled === true || item.cntlYn === "Y",
    bookingClosed: startsAt == null || startsAt <= now || /예매종료|판매종료/.test(statusText),
    soldOut: /매진/.test(statusText),
    saleEnabled: item.cntlYn !== "Y" && (item.salYn == null || item.salYn === "Y"),
    rawStatus: statusText,
  };
}

async function fetchTheatreSchedules(page, theatre, config) {
  const result = await page.evaluate(async ({ siteNo, lookAheadDays: maxDays, movieNo }) => {
    const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    const getJson = async (url) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const response = await window.fetch(url, {
          headers: { Accept: "application/json", "Accept-Language": "ko-KR" },
          credentials: "include",
          cache: "no-store",
        });
        if (!response.ok) {
          const retryable = response.status === 429 || response.status >= 500;
          if (retryable && attempt < 2) {
            const retryAfter = Number(response.headers.get("retry-after"));
            await delay(Number.isFinite(retryAfter) && retryAfter > 0
              ? Math.min(retryAfter * 1_000, 30_000)
              : 1_000 * (2 ** attempt));
            continue;
          }
          throw new Error(`CGV request failed (${response.status})`);
        }
        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.includes("application/json")) {
          throw new Error(`CGV returned non-JSON content: ${contentType}`);
        }
        const payload = await response.json();
        if (payload?.statusCode !== 0 || !Array.isArray(payload?.data)) {
          throw new Error(`Unexpected CGV response: ${payload?.statusCode}`);
        }
        return payload.data;
      }
      throw new Error("CGV request retry limit exceeded");
    };

    const dateQuery = new URLSearchParams({
      coCd: "A420",
      siteNo,
      ...(movieNo ? { movNo: movieNo } : {}),
      div: "",
      attrCd: "",
    });
    const dateEndpoint = movieNo
      ? "/api/v1/booking/searchSiteScnscYmdListByMov"
      : "/api/v1/booking/searchSiteScnscYmdListBySite";
    const dateRows = await getJson(`${dateEndpoint}?${dateQuery}`);
    const dates = dateRows
      .map((row) => row.scnYmd)
      .filter((value) => /^\d{8}$/.test(value))
      .slice(0, maxDays);

    const schedules = [];
    for (const showDate of dates) {
      const query = new URLSearchParams({
        coCd: "A420",
        siteNo,
        scnYmd: showDate,
        scnsNo: "",
        scnSseq: "",
        ...(movieNo ? { movNo: movieNo, prodNo: "" } : {}),
        rtctlScopCd: "08",
        salsTznCd: "",
        tcscnsGradCd: "",
        sascnsGradCd: "",
        custNo: "",
      });
      const scheduleEndpoint = movieNo
        ? "/api/v1/booking/searchSchByMov"
        : "/api/v1/booking/searchMovScnInfo";
      const rows = await getJson(`${scheduleEndpoint}?${query}`);
      schedules.push(...rows);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return schedules;
  }, {
    siteNo: theatre.siteNo,
    lookAheadDays: config.lookAheadDays,
    movieNo: config.movieNo ?? "",
  });

  if (!Array.isArray(result)) {
    throw new Error("CGV schedule result is not an array");
  }
  const now = new Date();
  return result.map((item) => mapApiSchedule(item, theatre, now));
}

export async function collectCgvSchedules(config, options = {}) {
  if (!config?.movieTitle || !Array.isArray(config.formats)) {
    throw new Error("watch config requires movieTitle and a formats array");
  }
  if (!Array.isArray(config.theatres) || config.theatres.length === 0
      || config.theatres.some((item) => !item.name || !item.siteNo)) {
    throw new Error("watch config requires at least one valid theatre");
  }
  if (!Number.isInteger(config.lookAheadDays) || config.lookAheadDays < 1 || config.lookAheadDays > 31) {
    throw new Error("lookAheadDays must be an integer from 1 to 31");
  }

  const executablePath = options.executablePath ?? await findChrome();
  const browser = await chromium.launch({
    executablePath,
    headless: options.headless ?? true,
    args: ["--disable-dev-shm-usage", "--no-sandbox"],
  });

  try {
    const chromeVersion = browser.version();
    const platform = process.platform === "darwin"
      ? "Macintosh; Intel Mac OS X 10_15_7"
      : "X11; Linux x86_64";
    const context = await browser.newContext({
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
      userAgent: `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`,
    });
    const page = await context.newPage();
    await page.goto("https://cgv.co.kr/cnm/movieBook/cinema", {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    if (!(await page.title()).includes("CGV")) {
      throw new Error("CGV booking page did not load");
    }
    const schedules = [];
    for (const theatre of config.theatres) {
      schedules.push(...await fetchTheatreSchedules(page, theatre, config));
    }
    return schedules;
  } finally {
    await browser.close();
  }
}

export async function collectCgvSchedulesForRules(rules, options = {}) {
  const requests = [];
  const seen = new Set();
  for (const rule of rules) {
    for (const theatre of rule.theatres) {
      const key = `${theatre.siteNo}:${rule.movieNo}:${rule.lookAheadDays}`;
      if (seen.has(key)) continue;
      seen.add(key);
      requests.push({
        movieTitle: rule.movieTitle,
        movieNo: rule.movieNo,
        formats: [],
        theatres: [theatre],
        lookAheadDays: rule.dateMode === "rolling" ? rule.lookAheadDays : 31,
      });
    }
  }

  const executablePath = options.executablePath ?? await findChrome();
  const browser = await chromium.launch({
    executablePath,
    headless: options.headless ?? true,
    args: ["--disable-dev-shm-usage", "--no-sandbox"],
  });
  try {
    const chromeVersion = browser.version();
    const platform = process.platform === "darwin" ? "Macintosh; Intel Mac OS X 10_15_7" : "X11; Linux x86_64";
    const context = await browser.newContext({
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
      userAgent: `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`,
    });
    const page = await context.newPage();
    await page.goto("https://cgv.co.kr/cnm/movieBook/cinema", {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    if (!(await page.title()).includes("CGV")) throw new Error("CGV booking page did not load");
    const schedules = [];
    for (const request of requests) {
      schedules.push(...await fetchTheatreSchedules(page, request.theatres[0], request));
    }
    return schedules.filter((schedule, index, items) => items.findIndex((candidate) => (
      candidate.siteNo === schedule.siteNo
        && candidate.movieNo === schedule.movieNo
        && candidate.showDate === schedule.showDate
        && candidate.startTime === schedule.startTime
        && candidate.auditoriumName === schedule.auditoriumName
    )) === index);
  } finally {
    await browser.close();
  }
}

export async function collectCgvCatalog(options = {}) {
  const executablePath = options.executablePath ?? await findChrome();
  const browser = await chromium.launch({
    executablePath,
    headless: options.headless ?? true,
    args: ["--disable-dev-shm-usage", "--no-sandbox"],
  });
  try {
    const chromeVersion = browser.version();
    const platform = process.platform === "darwin" ? "Macintosh; Intel Mac OS X 10_15_7" : "X11; Linux x86_64";
    const context = await browser.newContext({
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
      userAgent: `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`,
    });
    const page = await context.newPage();
    await page.goto("https://cgv.co.kr/cnm/movieBook/cinema", {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    const catalog = await page.evaluate(async () => {
      const load = async (url) => {
        const response = await fetch(url, { credentials: "include", cache: "no-store" });
        if (!response.ok) throw new Error(`CGV catalog request failed (${response.status})`);
        const payload = await response.json();
        if (payload?.statusCode !== 0) throw new Error("Unexpected CGV catalog response");
        return payload.data;
      };
      const [siteData, movieData] = await Promise.all([
        load("/api/v1/content/site/searchAllRegionAndSite?coCd=A420"),
        load("/api/v1/booking/searchAtktTopPostrList?coCd=A420&movNm=&div=&attrCd="),
      ]);
      return { siteData, movieData };
    });
    const regions = Array.isArray(catalog.siteData?.regionInfo) ? catalog.siteData.regionInfo : [];
    const theatres = Array.isArray(catalog.siteData?.siteInfo) ? catalog.siteData.siteInfo : [];
    const movies = Array.isArray(catalog.movieData) ? catalog.movieData : [];
    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      regions: regions.map((item) => ({
        code: String(item.comCdval ?? item.regnGrpCd ?? item.regnCd ?? ""),
        name: String(item.comCdvalNm ?? item.regnGrpNm ?? item.regnNm ?? ""),
      })).filter((item) => item.code && item.name),
      theatres: theatres.map((item) => ({
        siteNo: String(item.siteNo ?? ""),
        name: String(item.siteNm ?? ""),
        regionCode: String(item.regnGrpCd ?? ""),
      })).filter((item) => item.siteNo && item.name),
      movies: movies.map((item) => ({
        no: String(item.movNo ?? ""),
        title: String(item.movNm ?? ""),
        releaseDate: String(item.rlsYmd ?? item.rlsDt ?? ""),
        grade: String(item.gradNm ?? item.rpsntGradNm ?? ""),
      })).filter((item) => item.no && item.title),
    };
  } finally {
    await browser.close();
  }
}

export { mapApiSchedule, toKstShowTime };
