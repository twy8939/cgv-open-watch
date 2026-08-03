const $ = (selector) => document.querySelector(selector);
const state = {
  config: { version: 3, revision: 1, paused: false, rules: [] },
  catalog: { regions: [], theatres: [], movies: [] },
  dirty: false,
  editingIndex: -1,
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && path !== "/api/login") showLogin();
  if (!response.ok)
    throw new Error(
      data.error || data.errors?.join("\n") || "요청을 처리하지 못했습니다.",
    );
  return data;
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("show"), 3000);
}

function showLogin() {
  $("#appView").hidden = true;
  $("#loginView").hidden = false;
  $("#password").focus();
}

function showApp() {
  $("#loginView").hidden = true;
  $("#appView").hidden = false;
}

function markDirty() {
  state.dirty = true;
  $("#saveButton").disabled = false;
  $("#dirtyLabel").textContent = "저장하지 않은 변경사항이 있습니다.";
}

function clean() {
  state.dirty = false;
  $("#saveButton").disabled = true;
  $("#dirtyLabel").textContent = "모든 변경사항이 저장되었습니다.";
}

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>'"]/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        char
      ],
  );
}

function dateText(rule) {
  if (rule.dateMode === "range")
    return `${formatDate(rule.startDate)} ~ ${formatDate(rule.endDate)}`;
  if (rule.dateMode === "specific")
    return `${rule.specificDates?.length ?? 0}개 날짜`;
  return `오늘부터 ${rule.lookAheadDays ?? 14}일`;
}

function formatDate(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length === 8
    ? `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6)}`
    : "미지정";
}

function renderRules() {
  const list = $("#ruleList");
  if (state.config.rules.length === 0) {
    list.innerHTML =
      '<div class="empty-state"><b>아직 감시 규칙이 없습니다.</b><br><br>영화와 극장을 골라 첫 규칙을 추가해 주세요.</div>';
  } else {
    list.innerHTML = state.config.rules
      .map((rule, index) => {
        const formats = rule.formats?.length
          ? rule.formats.join(" · ")
          : "모든 상영 형식";
        const theatres = rule.theatres.map((item) => item.name).join(", ");
        return `<article class="rule-card">
        <div class="rule-index">${String(index + 1).padStart(2, "0")}</div>
        <div class="rule-main"><small>${escapeHtml(rule.name)}</small><strong>${escapeHtml(rule.movieTitle)}</strong><small>${escapeHtml(formats)}</small></div>
        <div class="rule-detail"><small>극장</small><b>${escapeHtml(theatres)}</b></div>
        <div class="rule-detail"><small>날짜 · 시간</small><b>${escapeHtml(dateText(rule))}</b><small>${displayTime(rule.startTime)}–${displayTime(rule.endTime)}</small></div>
        <div class="rule-state"><i class="status-dot ${rule.enabled ? "" : "off"}"></i><b>${rule.enabled ? "감지 중" : "꺼짐"}</b></div>
        <button class="edit-rule" data-index="${index}" aria-label="${escapeHtml(rule.name)} 편집">›</button>
      </article>`;
      })
      .join("");
  }
  $("#pauseToggle").checked = state.config.paused === true;
  $("#activeRuleCount").textContent =
    `${state.config.rules.filter((rule) => rule.enabled).length}개`;
  document
    .querySelectorAll(".edit-rule")
    .forEach((button) =>
      button.addEventListener("click", () =>
        openRule(Number(button.dataset.index)),
      ),
    );
}

function displayTime(value) {
  const digits = String(value ?? "")
    .replace(/\D/g, "")
    .padStart(4, "0");
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

function renderCatalogOptions() {
  $("#movieSelect").innerHTML =
    '<option value="">직접 입력</option>' +
    state.catalog.movies
      .map(
        (movie) =>
          `<option value="${escapeHtml(movie.no)}">${escapeHtml(movie.title)}</option>`,
      )
      .join("");
  $("#regionSelect").innerHTML =
    '<option value="">모든 지역</option>' +
    state.catalog.regions
      .map(
        (region) =>
          `<option value="${escapeHtml(region.code)}">${escapeHtml(region.name)}</option>`,
      )
      .join("");
  renderTheatres();
}

function selectedTheatres() {
  return new Set(
    [...document.querySelectorAll("#theatreOptions input:checked")].map(
      (input) => input.value,
    ),
  );
}

function renderTheatres(preserve = selectedTheatres()) {
  const region = $("#regionSelect").value;
  const search = $("#theatreSearch").value.trim().toLowerCase();
  const theatres = state.catalog.theatres.filter(
    (item) =>
      (!region || item.regionCode === region) &&
      (!search || item.name.toLowerCase().includes(search)),
  );
  $("#theatreOptions").innerHTML = theatres.length
    ? theatres
        .map(
          (item) =>
            `<label><input type="checkbox" value="${escapeHtml(item.siteNo)}" ${preserve.has(item.siteNo) ? "checked" : ""}><span>${escapeHtml(item.name)}</span></label>`,
        )
        .join("")
    : '<span class="field-hint">조건에 맞는 극장이 없습니다. CGV 목록을 갱신해 주세요.</span>';
}

function emptyRule() {
  return {
    id: crypto.randomUUID(),
    name: "",
    enabled: true,
    movieTitle: "",
    movieNo: "",
    theatres: [],
    formats: [],
    auditoriums: [],
    dateMode: "rolling",
    lookAheadDays: 14,
    startDate: "",
    endDate: "",
    specificDates: [],
    startTime: "0000",
    endTime: "4759",
    minSeats: 1,
    notifyExisting: false,
  };
}

function toInputDate(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length === 8
    ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`
    : "";
}

function openRule(index = -1) {
  state.editingIndex = index;
  const rule =
    index >= 0 ? structuredClone(state.config.rules[index]) : emptyRule();
  $("#dialogTitle").textContent =
    index >= 0 ? "감시 규칙 편집" : "감시 규칙 추가";
  $("#deleteRuleButton").hidden = index < 0;
  $("#ruleId").value = rule.id;
  $("#ruleName").value = rule.name;
  $("#ruleEnabled").checked = rule.enabled;
  $("#movieSelect").value = state.catalog.movies.some(
    (movie) => movie.no === rule.movieNo,
  )
    ? rule.movieNo
    : "";
  $("#movieTitle").value = rule.movieTitle;
  $("#movieNo").value = rule.movieNo;
  $("#regionSelect").value = "";
  $("#theatreSearch").value = "";
  renderTheatres(new Set(rule.theatres.map((item) => item.siteNo)));
  document.querySelectorAll("#formatOptions input").forEach((input) => {
    input.checked = rule.formats.includes(input.value);
  });
  $("#auditoriums").value = rule.auditoriums.join(", ");
  document.querySelector(
    `input[name="dateMode"][value="${rule.dateMode}"]`,
  ).checked = true;
  $("#lookAheadDays").value = rule.lookAheadDays;
  $("#startDate").value = toInputDate(rule.startDate);
  $("#endDate").value = toInputDate(rule.endDate);
  $("#specificDates").value = rule.specificDates.map(formatDate).join(", ");
  $("#startTime").value = displayTime(rule.startTime);
  $("#endTime").value = displayTime(rule.endTime);
  $("#minSeats").value = rule.minSeats;
  $("#notifyExisting").checked = rule.notifyExisting;
  $("#ruleError").textContent = "";
  updateDateFields();
  $("#ruleDialog").showModal();
}

function updateDateFields() {
  const mode = document.querySelector('input[name="dateMode"]:checked').value;
  $("#rollingFields").hidden = mode !== "rolling";
  $("#rangeFields").hidden = mode !== "range";
  $("#specificFields").hidden = mode !== "specific";
}

function digits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function ruleFromForm() {
  const picked = selectedTheatres();
  const theatres = state.catalog.theatres
    .filter((item) => picked.has(item.siteNo))
    .map((item) => ({
      name: item.name,
      siteNo: item.siteNo,
      regionCode: item.regionCode,
      regionName:
        state.catalog.regions.find((region) => region.code === item.regionCode)
          ?.name ?? "",
    }));
  return {
    id: $("#ruleId").value,
    name:
      $("#ruleName").value.trim() || `${$("#movieTitle").value.trim()} 감시`,
    enabled: $("#ruleEnabled").checked,
    movieTitle: $("#movieTitle").value.trim(),
    movieNo: $("#movieNo").value.trim(),
    theatres,
    formats: [...document.querySelectorAll("#formatOptions input:checked")].map(
      (input) => input.value,
    ),
    auditoriums: $("#auditoriums")
      .value.split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    dateMode: document.querySelector('input[name="dateMode"]:checked').value,
    lookAheadDays: Number($("#lookAheadDays").value || 14),
    startDate: digits($("#startDate").value),
    endDate: digits($("#endDate").value),
    specificDates: $("#specificDates")
      .value.split(",")
      .map(digits)
      .filter(Boolean)
      .sort(),
    startTime: digits($("#startTime").value),
    endTime: digits($("#endTime").value),
    minSeats: Number($("#minSeats").value || 1),
    notifyExisting: $("#notifyExisting").checked,
  };
}

function validateRule(rule) {
  if (!rule.movieTitle) return "영화 제목을 입력해 주세요.";
  if (rule.theatres.length === 0) return "극장을 하나 이상 선택해 주세요.";
  if (
    rule.dateMode === "range" &&
    (!rule.startDate || !rule.endDate || rule.startDate > rule.endDate)
  )
    return "감시 기간을 확인해 주세요.";
  if (rule.dateMode === "specific" && rule.specificDates.length === 0)
    return "날짜를 하나 이상 입력해 주세요.";
  if (rule.startTime > rule.endTime)
    return "종료 시간은 시작 시간보다 빠를 수 없습니다.";
  return "";
}

async function loadData() {
  const [config, catalog] = await Promise.all([
    api("/api/config"),
    api("/api/catalog"),
  ]);
  state.config = config;
  state.catalog = catalog;
  renderCatalogOptions();
  renderRules();
  clean();
  await loadStatus();
}

async function loadStatus() {
  try {
    const status = await api("/api/status");
    $("#systemStatus").textContent = status.paused ? "일시정지" : "정상 감지";
    $("#systemStatus").style.color = status.paused
      ? "var(--amber)"
      : "var(--green)";
    $("#activeRuleCount").textContent = `${status.activeRules}개`;
    const latest = status.runs[0];
    $("#lastResult").textContent = latest
      ? resultLabel(latest)
      : "실행 기록 없음";
    $("#runList").innerHTML = status.runs.length
      ? status.runs
          .map(
            (run) =>
              `<div class="run-row"><i class="${run.conclusion ?? ""}"></i><b>${escapeHtml(resultLabel(run))}</b><time>${new Date(run.createdAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</time><a href="${escapeHtml(run.url)}" target="_blank" rel="noreferrer">상세 ↗</a></div>`,
          )
          .join("")
      : '<p class="muted">아직 실행 기록이 없습니다.</p>';
  } catch (error) {
    toast(error.message);
  }
}

function resultLabel(run) {
  if (run.status !== "completed") return "감지 실행 중";
  if (run.conclusion === "success") return "감지 성공";
  if (run.conclusion === "cancelled") return "감지 취소";
  return "감지 실패";
}

function renderClock() {
  const now = new Date();
  const active = Math.floor(now.getMinutes() / 5);
  $("#signalClock").innerHTML = Array.from(
    { length: 12 },
    (_, index) =>
      `<span class="${index === active ? "active" : ""}" data-minute="${String(index * 5).padStart(2, "0")}"></span>`,
  ).join("");
  const next = new Date(now);
  next.setSeconds(0, 0);
  next.setMinutes((Math.floor(now.getMinutes() / 5) + 1) * 5);
  $("#nextRun").textContent = next.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#loginError").textContent = "";
  try {
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ password: $("#password").value }),
    });
    $("#password").value = "";
    showApp();
    await loadData();
  } catch (error) {
    $("#loginError").textContent = error.message;
  }
});

$("#logoutButton").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  showLogin();
});
$("#addRuleButton").addEventListener("click", () => openRule());
$("#closeDialog").addEventListener("click", () => $("#ruleDialog").close());
$("#cancelDialog").addEventListener("click", () => $("#ruleDialog").close());
$("#regionSelect").addEventListener("change", () => renderTheatres());
$("#theatreSearch").addEventListener("input", () => renderTheatres());
document
  .querySelectorAll('input[name="dateMode"]')
  .forEach((input) => input.addEventListener("change", updateDateFields));
$("#movieSelect").addEventListener("change", () => {
  const movie = state.catalog.movies.find(
    (item) => item.no === $("#movieSelect").value,
  );
  if (movie) {
    $("#movieTitle").value = movie.title;
    $("#movieNo").value = movie.no;
  }
});
$("#ruleForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const rule = ruleFromForm();
  const error = validateRule(rule);
  if (error) {
    $("#ruleError").textContent = error;
    return;
  }
  if (state.editingIndex >= 0) state.config.rules[state.editingIndex] = rule;
  else state.config.rules.push(rule);
  renderRules();
  markDirty();
  $("#ruleDialog").close();
});
$("#deleteRuleButton").addEventListener("click", () => {
  if (state.editingIndex >= 0 && confirm("이 감시 규칙을 삭제할까요?")) {
    state.config.rules.splice(state.editingIndex, 1);
    renderRules();
    markDirty();
    $("#ruleDialog").close();
  }
});
$("#pauseToggle").addEventListener("change", (event) => {
  state.config.paused = event.target.checked;
  markDirty();
});
$("#saveButton").addEventListener("click", async () => {
  try {
    state.config = await api("/api/config", {
      method: "PUT",
      body: JSON.stringify(state.config),
    });
    clean();
    renderRules();
    toast("감시 설정을 저장했습니다. 다음 5분 감지부터 적용됩니다.");
  } catch (error) {
    toast(error.message);
  }
});

async function dispatch(mode, message) {
  try {
    await api("/api/run", { method: "POST", body: JSON.stringify({ mode }) });
    toast(message);
    setTimeout(loadStatus, 3500);
  } catch (error) {
    toast(error.message);
  }
}
$("#runButton").addEventListener("click", () =>
  dispatch("scan", "즉시 감지를 요청했습니다."),
);
$("#testButton").addEventListener("click", () =>
  dispatch("test", "Discord 테스트를 요청했습니다."),
);
$("#catalogButton").addEventListener("click", () =>
  dispatch("catalog", "CGV 목록 갱신을 요청했습니다. 약 1분 후 반영됩니다."),
);
$("#refreshStatusButton").addEventListener("click", loadStatus);
$("#exportButton").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state.config, null, 2)], {
    type: "application/json",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "cgv-open-watch-config.json";
  link.click();
  URL.revokeObjectURL(link.href);
});
$("#importInput").addEventListener("change", async (event) => {
  try {
    state.config = JSON.parse(await event.target.files[0].text());
    renderRules();
    markDirty();
    toast("설정을 불러왔습니다. 검토 후 저장해 주세요.");
  } catch {
    toast("올바른 설정 파일이 아닙니다.");
  }
  event.target.value = "";
});
window.addEventListener("beforeunload", (event) => {
  if (state.dirty) event.preventDefault();
});

renderClock();
setInterval(renderClock, 15_000);
const session = await api("/api/session");
if (session.authenticated) {
  showApp();
  await loadData();
} else showLogin();
