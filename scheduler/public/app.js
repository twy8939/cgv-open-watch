const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  config: { version: 3, revision: 1, paused: false, rules: [] },
  catalog: { regions: [], theatres: [], movies: [] },
  editingIndex: -1,
  wizardStep: 1,
  dialogDirty: false,
  draftTheatres: new Map(),
  dirty: false,
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

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>'"]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[character],
  );
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("show"), 3400);
}

function showLogin() {
  $("#appView").hidden = true;
  $("#loginView").hidden = false;
  requestAnimationFrame(() => $("#password")?.focus());
}

function showApp() {
  $("#loginView").hidden = true;
  $("#appView").hidden = false;
}

function setButtonBusy(button, busy, label) {
  if (!button.dataset.label) button.dataset.label = button.textContent.trim();
  button.disabled = busy;
  button.classList.toggle("is-busy", busy);
  button.textContent = busy ? label : button.dataset.label;
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

function digits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function displayTime(value) {
  const valueDigits = digits(value).padStart(4, "0");
  return `${valueDigits.slice(0, 2)}:${valueDigits.slice(2)}`;
}

function formatDate(value) {
  const valueDigits = digits(value);
  return valueDigits.length === 8
    ? `${valueDigits.slice(0, 4)}.${valueDigits.slice(4, 6)}.${valueDigits.slice(6)}`
    : "미지정";
}

function toInputDate(value) {
  const valueDigits = digits(value);
  return valueDigits.length === 8
    ? `${valueDigits.slice(0, 4)}-${valueDigits.slice(4, 6)}-${valueDigits.slice(6)}`
    : "";
}

function dateText(rule) {
  if (rule.dateMode === "range")
    return `${formatDate(rule.startDate)}–${formatDate(rule.endDate)}`;
  if (rule.dateMode === "specific")
    return `선택한 날짜 ${rule.specificDates?.length ?? 0}개`;
  return `오늘부터 ${rule.lookAheadDays ?? 14}일`;
}

function ruleMatchesSearch(rule, query) {
  if (!query) return true;
  const haystack = [
    rule.name,
    rule.movieTitle,
    ...rule.theatres.map((theatre) => theatre.name),
    ...(rule.formats ?? []),
  ]
    .join(" ")
    .toLocaleLowerCase("ko-KR");
  return haystack.includes(query.toLocaleLowerCase("ko-KR"));
}

function renderRules() {
  const list = $("#ruleList");
  const query = $("#ruleSearch")?.value.trim() ?? "";
  const visibleRules = state.config.rules
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => ruleMatchesSearch(rule, query));
  $("#ruleSummaryText").textContent =
    `전체 ${state.config.rules.length}개 · 감지 중 ${state.config.rules.filter((rule) => rule.enabled).length}개`;
  $("#activeRuleCount").textContent =
    `${state.config.rules.filter((rule) => rule.enabled).length}개`;
  $("#pauseToggle").checked = state.config.paused === true;

  if (state.config.rules.length === 0) {
    list.innerHTML = `<div class="empty-state"><div><span class="empty-icon">＋</span><h3>첫 감시 규칙을 만들어 보세요.</h3><p>영화와 극장만 선택해도 5분마다 예매 오픈을 확인합니다.</p><button class="button button-primary" data-empty-add>첫 규칙 만들기</button></div></div>`;
    $("[data-empty-add]")?.addEventListener("click", () => openRule());
    return;
  }
  if (visibleRules.length === 0) {
    list.innerHTML = `<div class="empty-state"><div><span class="empty-icon">⌕</span><h3>검색 결과가 없습니다.</h3><p>영화 또는 극장 이름을 다르게 입력해 보세요.</p></div></div>`;
    return;
  }

  list.innerHTML = visibleRules
    .map(({ rule, index }) => {
      const formatTags = rule.formats?.length
        ? rule.formats
            .map(
              (format) =>
                `<span class="format-tag">${escapeHtml(format)}</span>`,
            )
            .join("")
        : '<span class="format-tag">모든 형식</span>';
      return `<article class="rule-card" data-rule-index="${index}">
      <div class="rule-index">${String(index + 1).padStart(2, "0")}</div>
      <div class="rule-main"><small>${escapeHtml(rule.name)}</small><strong>${escapeHtml(rule.movieTitle)}</strong><div class="format-tags">${formatTags}</div></div>
      <div class="rule-detail"><small>극장</small><b>${escapeHtml(rule.theatres.map((theatre) => theatre.name).join(", "))}</b><small>${rule.theatres.length}개 극장</small></div>
      <div class="rule-detail"><small>날짜 · 시간</small><b>${escapeHtml(dateText(rule))}</b><small>${displayTime(rule.startTime)}–${displayTime(rule.endTime)} · ${rule.minSeats}석 이상</small></div>
      <div class="rule-actions"><label class="rule-toggle-label"><input type="checkbox" role="switch" data-toggle-index="${index}" ${rule.enabled ? "checked" : ""} /><span>${rule.enabled ? "감지 중" : "꺼짐"}</span></label><button class="edit-rule" data-edit-index="${index}">편집</button></div>
    </article>`;
    })
    .join("");

  $$("[data-edit-index]").forEach((button) =>
    button.addEventListener("click", () =>
      openRule(Number(button.dataset.editIndex)),
    ),
  );
  $$("[data-toggle-index]").forEach((input) =>
    input.addEventListener("change", () =>
      toggleRule(Number(input.dataset.toggleIndex), input.checked),
    ),
  );
}

function renderCatalogOptions() {
  $("#movieSelect").innerHTML =
    '<option value="">목록에 없는 영화 직접 입력</option>' +
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
  $("#movieCatalogCount").textContent = state.catalog.movies.length || "0";
  $("#theatreCatalogCount").textContent = state.catalog.theatres.length || "0";
}

function renderTheatres() {
  const region = $("#regionSelect").value;
  const query = $("#theatreSearch").value.trim().toLocaleLowerCase("ko-KR");
  const theatres = state.catalog.theatres.filter(
    (theatre) =>
      (!region || theatre.regionCode === region) &&
      (!query || theatre.name.toLocaleLowerCase("ko-KR").includes(query)),
  );
  $("#selectedTheatreCount").textContent =
    `${state.draftTheatres.size}개 극장 선택`;
  $("#theatreOptions").innerHTML = theatres.length
    ? theatres
        .map(
          (theatre) =>
            `<label><input type="checkbox" value="${escapeHtml(theatre.siteNo)}" ${state.draftTheatres.has(theatre.siteNo) ? "checked" : ""} /><span>${escapeHtml(theatre.name)}</span></label>`,
        )
        .join("")
    : `<div class="empty-state"><div><h3>극장을 찾지 못했습니다.</h3><p>검색어를 바꾸거나 CGV 목록을 갱신해 주세요.</p></div></div>`;
  $$("#theatreOptions input").forEach((input) =>
    input.addEventListener("change", () => {
      const theatre = state.catalog.theatres.find(
        (item) => item.siteNo === input.value,
      );
      if (input.checked && theatre) {
        const regionItem = state.catalog.regions.find(
          (item) => item.code === theatre.regionCode,
        );
        state.draftTheatres.set(input.value, {
          name: theatre.name,
          siteNo: theatre.siteNo,
          regionCode: theatre.regionCode,
          regionName: regionItem?.name ?? "",
        });
      } else {
        state.draftTheatres.delete(input.value);
      }
      state.dialogDirty = true;
      $("#selectedTheatreCount").textContent =
        `${state.draftTheatres.size}개 극장 선택`;
    }),
  );
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

function openRule(index = -1) {
  state.editingIndex = index;
  state.wizardStep = 1;
  state.dialogDirty = false;
  const rule =
    index >= 0 ? structuredClone(state.config.rules[index]) : emptyRule();
  state.draftTheatres = new Map(
    rule.theatres.map((theatre) => [theatre.siteNo, theatre]),
  );
  $("#dialogTitle").textContent =
    index >= 0 ? "감시 규칙 편집" : "감시 규칙 만들기";
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
  $$("#formatOptions input").forEach((input) => {
    input.checked = rule.formats.includes(input.value);
  });
  $("#auditoriums").value = rule.auditoriums.join(", ");
  $(`input[name="dateMode"][value="${rule.dateMode}"]`).checked = true;
  $("#lookAheadDays").value = rule.lookAheadDays;
  $("#startDate").value = toInputDate(rule.startDate);
  $("#endDate").value = toInputDate(rule.endDate);
  $("#specificDates").value = rule.specificDates.map(formatDate).join(", ");
  $("#startTime").value = displayTime(rule.startTime);
  $("#endTime").value = displayTime(rule.endTime);
  $("#minSeats").value = rule.minSeats;
  $("#notifyExisting").checked = rule.notifyExisting;
  $("#ruleError").textContent = "";
  renderTheatres();
  updateDateFields();
  setWizardStep(1);
  $("#ruleDialog").showModal();
}

function ruleFromForm() {
  return {
    id: $("#ruleId").value,
    name:
      $("#ruleName").value.trim() || `${$("#movieTitle").value.trim()} 감시`,
    enabled: $("#ruleEnabled").checked,
    movieTitle: $("#movieTitle").value.trim(),
    movieNo: $("#movieNo").value.trim(),
    theatres: [...state.draftTheatres.values()],
    formats: $$("#formatOptions input:checked").map((input) => input.value),
    auditoriums: $("#auditoriums")
      .value.split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    dateMode: $('input[name="dateMode"]:checked').value,
    lookAheadDays: Number($("#lookAheadDays").value || 14),
    startDate: digits($("#startDate").value),
    endDate: digits($("#endDate").value),
    specificDates: $("#specificDates")
      .value.split(",")
      .map(digits)
      .filter((date) => date.length === 8)
      .sort(),
    startTime: digits($("#startTime").value),
    endTime: digits($("#endTime").value),
    minSeats: Number($("#minSeats").value || 1),
    notifyExisting: $("#notifyExisting").checked,
  };
}

function validateStep(step, rule = ruleFromForm()) {
  if (step === 1 && !rule.movieTitle)
    return { message: "영화 제목을 입력해 주세요.", field: $("#movieTitle") };
  if (step === 2 && rule.theatres.length === 0)
    return {
      message: "극장을 하나 이상 선택해 주세요.",
      field: $("#theatreSearch"),
    };
  if (
    step === 3 &&
    rule.dateMode === "range" &&
    (!rule.startDate || !rule.endDate || rule.startDate > rule.endDate)
  )
    return {
      message: "시작일과 종료일을 확인해 주세요.",
      field: $("#startDate"),
    };
  if (
    step === 3 &&
    rule.dateMode === "specific" &&
    rule.specificDates.length === 0
  )
    return {
      message: "감시할 날짜를 하나 이상 입력해 주세요.",
      field: $("#specificDates"),
    };
  if (
    step === 3 &&
    (!/^\d{4}$/.test(rule.startTime) ||
      !/^\d{4}$/.test(rule.endTime) ||
      rule.startTime > rule.endTime)
  )
    return {
      message: "상영 시작·종료 시간을 확인해 주세요.",
      field: $("#startTime"),
    };
  return null;
}

function setWizardStep(nextStep) {
  state.wizardStep = Math.min(4, Math.max(1, nextStep));
  $$(".wizard-panel").forEach((panel) =>
    panel.classList.toggle(
      "active",
      Number(panel.dataset.panel) === state.wizardStep,
    ),
  );
  $$(".wizard-step-button").forEach((button) => {
    const step = Number(button.dataset.step);
    button.classList.toggle("active", step === state.wizardStep);
    button.classList.toggle("done", step < state.wizardStep);
    if (step === state.wizardStep) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
  });
  $("#wizardBack").hidden = state.wizardStep === 1;
  $("#wizardNext").hidden = state.wizardStep === 4;
  $("#wizardSubmit").hidden = state.wizardStep !== 4;
  $("#ruleError").textContent = "";
  if (state.wizardStep === 4) renderRuleReview(ruleFromForm());
  $(".wizard-content").scrollTop = 0;
}

function moveWizard(nextStep) {
  if (nextStep > state.wizardStep) {
    const error = validateStep(state.wizardStep);
    if (error) {
      $("#ruleError").textContent = error.message;
      error.field?.focus();
      return;
    }
  }
  setWizardStep(nextStep);
}

function renderRuleReview(rule) {
  const formatLabel = rule.formats.length
    ? rule.formats.join(", ")
    : "모든 상영 형식";
  const theatreLabel = rule.theatres.map((theatre) => theatre.name).join(", ");
  $("#ruleReview").innerHTML = `
    <div class="review-sentence">영화 <em>${escapeHtml(rule.movieTitle)}</em> · 극장 <em>${escapeHtml(theatreLabel)}</em>.<br>${escapeHtml(dateText(rule))} 동안 감지합니다.</div>
    <div class="review-item"><span>극장</span><b>${escapeHtml(theatreLabel)}</b></div>
    <div class="review-item"><span>상영 형식</span><b>${escapeHtml(formatLabel)}</b></div>
    <div class="review-item"><span>날짜</span><b>${escapeHtml(dateText(rule))}</b></div>
    <div class="review-item"><span>시간 · 좌석</span><b>${displayTime(rule.startTime)}–${displayTime(rule.endTime)} · ${rule.minSeats}석 이상</b></div>`;
}

function updateDateFields() {
  const mode = $('input[name="dateMode"]:checked').value;
  $("#rollingFields").hidden = mode !== "rolling";
  $("#rangeFields").hidden = mode !== "range";
  $("#specificFields").hidden = mode !== "specific";
}

async function persistConfig(successMessage) {
  state.config = await api("/api/config", {
    method: "PUT",
    body: JSON.stringify(state.config),
  });
  clean();
  renderRules();
  if (successMessage) toast(successMessage);
}

async function toggleRule(index, enabled) {
  const previous = state.config.rules[index].enabled;
  state.config.rules[index].enabled = enabled;
  renderRules();
  try {
    await persistConfig(
      enabled ? "규칙 감지를 시작했습니다." : "규칙 감지를 껐습니다.",
    );
  } catch (error) {
    state.config.rules[index].enabled = previous;
    renderRules();
    toast(error.message);
  }
}

function renderLoading() {
  $("#ruleList").innerHTML =
    '<div class="skeleton"></div><div class="skeleton"></div>';
  $("#runList").innerHTML = '<div class="skeleton"></div>';
}

async function loadData() {
  renderLoading();
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

function resultLabel(run) {
  if (run.status !== "completed") return "감지 실행 중";
  if (run.conclusion === "success") return "감지 성공";
  if (run.conclusion === "cancelled") return "감지 취소";
  return "감지 실패";
}

async function loadStatus() {
  const button = $("#refreshStatusButton");
  setButtonBusy(button, true, "확인 중");
  try {
    const status = await api("/api/status");
    const healthy = !status.paused;
    $("#systemStatus").textContent = healthy ? "정상 감지" : "일시정지";
    $("#systemStatus").style.color = healthy ? "var(--green)" : "var(--amber)";
    $("#railStatus").textContent = healthy ? "정상 감지 중" : "전체 일시정지";
    $(".rail-status").classList.toggle("paused", !healthy);
    $("#activeRuleCount").textContent = `${status.activeRules}개`;
    const latest = status.runs[0];
    $("#lastResult").textContent = latest ? resultLabel(latest) : "기록 없음";
    $("#lastResultTime").textContent = latest
      ? new Date(latest.updatedAt).toLocaleString("ko-KR", {
          timeZone: "Asia/Seoul",
          month: "long",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "첫 감지 전입니다.";
    const runs = status.runs.slice(0, 6);
    $("#runList").innerHTML = runs.length
      ? runs
          .map(
            (run) =>
              `<div class="run-row"><i class="run-status-dot ${run.conclusion ?? ""}"></i><b>${escapeHtml(resultLabel(run))}</b><time>${new Date(run.createdAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</time><a href="${escapeHtml(run.url)}" target="_blank" rel="noreferrer">상세 ↗</a></div>`,
          )
          .join("")
      : '<div class="empty-state"><div><h3>아직 실행 기록이 없습니다.</h3><p>지금 감지하기를 눌러 첫 확인을 시작하세요.</p></div></div>';
  } catch (error) {
    $("#systemStatus").textContent = "상태 확인 실패";
    $("#systemStatus").style.color = "var(--red)";
    $("#runList").innerHTML =
      `<div class="empty-state"><div><h3>실행 기록을 불러오지 못했습니다.</h3><p>${escapeHtml(error.message)}</p><button class="button button-secondary" data-retry-status>다시 시도</button></div></div>`;
    $("[data-retry-status]")?.addEventListener("click", loadStatus);
  } finally {
    setButtonBusy(button, false);
  }
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

async function dispatch(mode, message, button) {
  const busyLabels = {
    scan: "CGV 확인 중",
    test: "전송 중",
    catalog: "갱신 요청 중",
  };
  setButtonBusy(button, true, busyLabels[mode]);
  try {
    await api("/api/run", { method: "POST", body: JSON.stringify({ mode }) });
    toast(message);
    if (mode !== "catalog") setTimeout(loadStatus, 3500);
  } catch (error) {
    toast(error.message);
  } finally {
    setButtonBusy(button, false);
  }
}

function requestCloseDialog() {
  if (state.dialogDirty && !confirm("작성 중인 변경사항을 버리고 닫을까요?"))
    return;
  state.dialogDirty = false;
  $("#ruleDialog").close();
}

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $('#loginForm button[type="submit"]');
  $("#loginError").textContent = "";
  setButtonBusy(button, true, "확인 중");
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
  } finally {
    setButtonBusy(button, false);
  }
});

$("#logoutButton").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  showLogin();
});
$("#addRuleButton").addEventListener("click", () => openRule());
$("#ruleSearch").addEventListener("input", renderRules);
$("#regionSelect").addEventListener("change", renderTheatres);
$("#theatreSearch").addEventListener("input", renderTheatres);
$("#movieSelect").addEventListener("change", () => {
  const movie = state.catalog.movies.find(
    (item) => item.no === $("#movieSelect").value,
  );
  if (movie) {
    $("#movieTitle").value = movie.title;
    $("#movieNo").value = movie.no;
  }
  state.dialogDirty = true;
});
$$('input[name="dateMode"]').forEach((input) =>
  input.addEventListener("change", updateDateFields),
);
$("#ruleForm").addEventListener("input", () => {
  state.dialogDirty = true;
});
$("#closeDialog").addEventListener("click", requestCloseDialog);
$("#cancelDialog").addEventListener("click", requestCloseDialog);
$("#ruleDialog").addEventListener("cancel", (event) => {
  event.preventDefault();
  requestCloseDialog();
});
$("#wizardBack").addEventListener("click", () =>
  moveWizard(state.wizardStep - 1),
);
$("#wizardNext").addEventListener("click", () =>
  moveWizard(state.wizardStep + 1),
);
$$(".wizard-step-button").forEach((button) =>
  button.addEventListener("click", () =>
    moveWizard(Number(button.dataset.step)),
  ),
);

$("#ruleForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const rule = ruleFromForm();
  const error = [1, 2, 3]
    .map((step) => ({ step, error: validateStep(step, rule) }))
    .find((item) => item.error);
  if (error) {
    setWizardStep(error.step);
    $("#ruleError").textContent = error.error.message;
    error.error.field?.focus();
    return;
  }
  const button = $("#wizardSubmit");
  const previousRules = structuredClone(state.config.rules);
  if (state.editingIndex >= 0) state.config.rules[state.editingIndex] = rule;
  else state.config.rules.push(rule);
  setButtonBusy(button, true, "저장 중");
  try {
    await persistConfig(
      state.editingIndex >= 0
        ? "감시 규칙을 변경했습니다."
        : "새 감시 규칙을 시작했습니다.",
    );
    state.dialogDirty = false;
    $("#ruleDialog").close();
  } catch (saveError) {
    state.config.rules = previousRules;
    $("#ruleError").textContent = saveError.message;
  } finally {
    setButtonBusy(button, false);
  }
});

$("#deleteRuleButton").addEventListener("click", async () => {
  if (state.editingIndex < 0 || !confirm("이 감시 규칙을 삭제할까요?")) return;
  const previousRules = structuredClone(state.config.rules);
  state.config.rules.splice(state.editingIndex, 1);
  try {
    await persistConfig("감시 규칙을 삭제했습니다.");
    state.dialogDirty = false;
    $("#ruleDialog").close();
  } catch (error) {
    state.config.rules = previousRules;
    $("#ruleError").textContent = error.message;
  }
});

$("#pauseToggle").addEventListener("change", async (event) => {
  const previous = state.config.paused;
  state.config.paused = event.target.checked;
  try {
    await persistConfig(
      state.config.paused
        ? "전체 감시를 일시정지했습니다."
        : "전체 감시를 다시 시작했습니다.",
    );
    await loadStatus();
  } catch (error) {
    state.config.paused = previous;
    renderRules();
    toast(error.message);
  }
});

$("#saveButton").addEventListener("click", async () => {
  try {
    await persistConfig("가져온 설정을 저장했습니다.");
  } catch (error) {
    toast(error.message);
  }
});
$("#runButton").addEventListener("click", () =>
  dispatch("scan", "즉시 감지를 요청했습니다.", $("#runButton")),
);
$("#testButton").addEventListener("click", () =>
  dispatch("test", "Discord 테스트를 요청했습니다.", $("#testButton")),
);
$("#catalogButton").addEventListener("click", () =>
  dispatch(
    "catalog",
    "CGV 목록 갱신을 요청했습니다. 약 1분 뒤 새로고침해 주세요.",
    $("#catalogButton"),
  ),
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
    const imported = JSON.parse(await event.target.files[0].text());
    if (imported?.version !== 3 || !Array.isArray(imported.rules))
      throw new Error();
    state.config = imported;
    renderRules();
    markDirty();
    toast("설정을 불러왔습니다. 검토 후 저장해 주세요.");
  } catch {
    toast("올바른 CGV Open Watch 설정 파일이 아닙니다.");
  }
  event.target.value = "";
});

window.addEventListener("beforeunload", (event) => {
  if (state.dirty) event.preventDefault();
});
$$(".rail-nav a").forEach((link) =>
  link.addEventListener("click", () => {
    $$(".rail-nav a").forEach((item) => item.classList.remove("active"));
    link.classList.add("active");
  }),
);

renderClock();
setInterval(renderClock, 15_000);
const session = await api("/api/session");
if (session.authenticated) {
  showApp();
  await loadData();
} else showLogin();
