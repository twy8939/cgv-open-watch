const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  config: { version: 3, revision: 1, paused: false, rules: [] },
  catalog: { regions: [], theatres: [], movies: [] },
  editingIndex: -1,
  wizardStep: 1,
  dialogDirty: false,
  draftTheatres: new Map(),
  draftDates: new Set(),
  dirty: false,
  intervalMinutes: 5,
  quickRuleId: null,
  picker: {
    kind: null,
    context: null,
    multiple: false,
    region: "",
    items: [],
    filteredItems: [],
    activeIndex: -1,
    trigger: null,
  },
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
  button.setAttribute("aria-busy", String(busy));
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

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^\p{L}\p{N}]/gu, "");
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
  if (rule.dateMode === "specific") {
    const dates = rule.specificDates ?? [];
    if (dates.length === 1) return `${formatDate(dates[0])} 오픈 대기`;
    return dates.map(formatDate).join(", ");
  }
  return `오늘부터 ${rule.lookAheadDays ?? 14}일`;
}

function quickRule() {
  return state.config.rules.find((rule) => rule.id === state.quickRuleId)
    ?? state.config.rules[0]
    ?? null;
}

function quickRuleIndex() {
  const id = quickRule()?.id;
  return state.config.rules.findIndex((rule) => rule.id === id);
}

function setQuickMovie(movie) {
  $("#quickMovie").value = movie?.title ?? "";
  $("#quickMovieNo").value = movie?.no ?? "";
  $("#quickMovieValue").textContent = movie?.title || "영화를 선택해 주세요";
  $("#quickMovieMeta").textContent = movie?.no
    ? `CGV 영화번호 ${movie.no}`
    : movie?.title ? "직접 입력한 영화 제목" : "영화명으로 검색할 수 있습니다.";
}

function setQuickTheatre(theatre) {
  $("#quickTheatre").value = theatre?.name ?? "";
  $("#quickTheatreSiteNo").value = theatre?.siteNo ?? "";
  $("#quickTheatreValue").textContent = theatre?.name || "극장을 선택해 주세요";
  const region = state.catalog.regions.find((item) => item.code === theatre?.regionCode)?.name
    ?? theatre?.regionName;
  $("#quickTheatreMeta").textContent = theatre?.siteNo
    ? `${region ? `${region} · ` : ""}CGV ${theatre.siteNo}`
    : "지역과 극장명으로 검색할 수 있습니다.";
}

function quickFormat() {
  return $('input[name="quickFormat"]:checked')?.value ?? "";
}

function isQuickEditable(rule) {
  const formats = rule?.formats ?? [];
  return rule?.enabled === true
    && !rule.completedAt
    && !rule.completionReason
    && rule.theatres?.length === 1
    && (formats.length === 0
      || (formats.length === 1 && ["SCREENX", "IMAX", "4DX"].includes(formats[0])))
    && (rule.auditoriums?.length ?? 0) === 0
    && rule.dateMode === "specific"
    && rule.specificDates?.length === 1
    && rule.startTime === "0000"
    && rule.endTime === "4759"
    && Number(rule.minSeats ?? 1) === 1;
}

function updateQuickPreview() {
  const movie = $("#quickMovie").value.trim() || "영화";
  const theatre = $("#quickTheatre").value.trim() || "극장";
  const format = quickFormat() || "모든 형식";
  const date = digits($("#quickDate").value);
  $("#quickPreview").textContent = `${movie} · ${theatre} · ${format} · ${formatDate(date)}`;
}

function renderQuickSetup() {
  const rules = state.config.rules;
  const hasRules = rules.length > 0;
  $("#quickEmpty").hidden = hasRules;
  $("#quickForm").hidden = !hasRules;
  $("#spiderPresetButton").hidden = !hasRules;
  $("#quickRulePicker").hidden = !hasRules;
  if (!hasRules) return;

  if (!rules.some((rule) => rule.id === state.quickRuleId)) state.quickRuleId = rules[0].id;
  const rule = quickRule();
  $("#quickRuleTabs").innerHTML = rules
    .map((candidate) => {
      const active = candidate.id === rule.id;
      const status = candidate.completionReason === "booked"
        ? "예매 완료"
        : candidate.enabled ? "감지 중" : "꺼짐";
      return `<button type="button" role="tab" tabindex="${active ? "0" : "-1"}" data-quick-rule-id="${escapeHtml(candidate.id)}" aria-selected="${active}" class="${active ? "active" : ""}"><span>${escapeHtml(candidate.movieTitle)}</span><small>${escapeHtml(candidate.theatres[0]?.name ?? "극장 미지정")} · ${escapeHtml(candidate.formats?.join(", ") || "모든 형식")} · ${escapeHtml(status)}</small></button>`;
    })
    .join("");
  setQuickMovie({ title: rule.movieTitle, no: rule.movieNo });
  setQuickTheatre(rule.theatres[0]);
  const supportedFormat = rule.formats.length === 1
    && ["SCREENX", "IMAX", "4DX"].includes(rule.formats[0])
    ? rule.formats[0]
    : "";
  $$('input[name="quickFormat"]').forEach((input) => { input.checked = false; });
  const formatInput = $(`input[name="quickFormat"][value="${supportedFormat}"]`);
  if (formatInput) formatInput.checked = true;
  const selectedDate = rule.dateMode === "specific"
    ? rule.specificDates[0]
    : rule.dateMode === "range"
      ? rule.startDate
      : "";
  $("#quickDate").value = toInputDate(selectedDate);
  const editable = isQuickEditable(rule);
  $("#quickSafetyNotice").hidden = editable;
  $("#spiderPresetButton").disabled = !editable;
  $("#quickSaveButton").disabled = !editable;
  ["#quickMoviePicker", "#quickTheatrePicker", "#quickDate"].forEach((selector) => {
    $(selector).disabled = !editable;
  });
  $$('input[name="quickFormat"], [data-quick-date]').forEach((input) => {
    input.disabled = !editable;
  });
  $("#quickError").textContent = "";
  updateQuickPreview();
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
  renderQuickSetup();

  if (state.config.rules.length === 0) {
    list.innerHTML = `<div class="empty-state"><div><span class="empty-icon">＋</span><h3>첫 감시 규칙을 만들어 보세요.</h3><p>평소에는 5분마다, 선택한 날짜 5일 전부터는 2분마다 예매 오픈을 확인합니다.</p><button class="button button-primary" data-empty-add>첫 규칙 만들기</button></div></div>`;
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
      <div class="rule-actions"><label class="rule-toggle-label"><input type="checkbox" role="switch" data-toggle-index="${index}" ${rule.enabled ? "checked" : ""} /><span>${rule.enabled ? "감지 중" : "꺼짐"}</span></label>${rule.enabled ? `<button class="complete-rule" data-complete-index="${index}">예매 완료</button>` : ""}<button class="edit-rule" data-edit-index="${index}">편집</button></div>
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
  $$("[data-complete-index]").forEach((button) =>
    button.addEventListener("click", () =>
      completeRule(Number(button.dataset.completeIndex)),
    ),
  );
}

function renderCatalogOptions() {
  $("#movieCatalogCount").textContent = state.catalog.movies.length || "0";
  $("#theatreCatalogCount").textContent = state.catalog.theatres.length || "0";
}

function renderTheatres() {
  $("#selectedTheatreCount").textContent =
    `${state.draftTheatres.size}개 극장 선택`;
  $("#wizardTheatreSelections").innerHTML = state.draftTheatres.size > 0
    ? [...state.draftTheatres.values()].map((theatre) =>
        `<span><b>${escapeHtml(theatre.name)}</b><small>CGV ${escapeHtml(theatre.siteNo)}</small><button type="button" data-remove-theatre="${escapeHtml(theatre.siteNo)}" aria-label="${escapeHtml(theatre.name)} 선택 해제">×</button></span>`,
      ).join("")
    : '<p>선택한 극장이 없습니다. 위 버튼을 눌러 극장을 찾아보세요.</p>';
  $$("[data-remove-theatre]").forEach((button) =>
    button.addEventListener("click", () => {
      state.draftTheatres.delete(button.dataset.removeTheatre);
      state.dialogDirty = true;
      renderTheatres();
    }),
  );
}

function setWizardMovie(movie) {
  $("#movieTitle").value = movie?.title ?? "";
  $("#movieNo").value = movie?.no ?? "";
  $("#wizardMovieValue").textContent = movie?.title || "영화를 선택해 주세요";
  $("#wizardMovieMeta").textContent = movie?.no
    ? `CGV 영화번호 ${movie.no}`
    : movie?.title ? "직접 입력한 영화 제목" : "검색하거나 제목을 직접 사용할 수 있습니다.";
}

function pickerItemKey(item) {
  return state.picker.kind === "movie" ? item.no : item.siteNo;
}

function pickerItemLabel(item) {
  return state.picker.kind === "movie" ? item.title : item.name;
}

function pickerItemDescription(item) {
  if (state.picker.kind === "movie") {
    const release = /^\d{8}$/.test(item.releaseDate ?? "") ? ` · ${formatDate(item.releaseDate)} 개봉` : "";
    return `CGV 영화번호 ${item.no}${release}`;
  }
  const region = state.catalog.regions.find((candidate) => candidate.code === item.regionCode)?.name
    ?? item.regionName;
  return `${region ? `${region} · ` : ""}CGV ${item.siteNo}`;
}

function pickerSelected(item) {
  const key = pickerItemKey(item);
  if (state.picker.context === "quick-movie") return $("#quickMovieNo").value === key;
  if (state.picker.context === "quick-theatre") return $("#quickTheatreSiteNo").value === key;
  if (state.picker.context === "wizard-movie") return $("#movieNo").value === key;
  return state.draftTheatres.has(key);
}

function pickerSourceItems(kind) {
  if (kind === "movie") return [...state.catalog.movies];
  const items = [...state.catalog.theatres];
  for (const theatre of state.draftTheatres.values()) {
    if (!items.some((candidate) => candidate.siteNo === theatre.siteNo)) items.push(theatre);
  }
  const currentTheatre = quickRule()?.theatres?.[0];
  if (currentTheatre && !items.some((candidate) => candidate.siteNo === currentTheatre.siteNo)) {
    items.push(currentTheatre);
  }
  return items;
}

function renderPickerRegions() {
  const container = $("#pickerRegions");
  container.hidden = state.picker.kind !== "theatre";
  if (container.hidden) return;
  container.innerHTML = [
    { code: "", name: "전체" },
    ...state.catalog.regions,
  ].map((region) =>
    `<button type="button" data-picker-region="${escapeHtml(region.code)}" class="${state.picker.region === region.code ? "active" : ""}" aria-pressed="${state.picker.region === region.code}">${escapeHtml(region.name)}</button>`,
  ).join("");
}

function renderPicker() {
  const query = normalizeText($("#pickerSearch").value);
  state.picker.filteredItems = state.picker.items.filter((item) => {
    const regionMatch = state.picker.kind !== "theatre"
      || !state.picker.region
      || item.regionCode === state.picker.region;
    const text = state.picker.kind === "movie"
      ? `${item.title} ${item.no}`
      : `${item.name} ${item.siteNo} ${pickerItemDescription(item)}`;
    return regionMatch && (!query || normalizeText(text).includes(query));
  });
  if (state.picker.filteredItems.length === 0) state.picker.activeIndex = -1;
  else state.picker.activeIndex = Math.min(
    Math.max(state.picker.activeIndex, 0),
    state.picker.filteredItems.length - 1,
  );

  $("#pickerList").setAttribute("aria-multiselectable", String(state.picker.multiple));
  $("#pickerList").innerHTML = state.picker.filteredItems.map((item, index) => {
    const selected = pickerSelected(item);
    const active = index === state.picker.activeIndex;
    return `<button id="picker-option-${index}" type="button" role="option" tabindex="-1" data-picker-index="${index}" aria-selected="${selected}" class="picker-option ${selected ? "selected" : ""} ${active ? "active" : ""}"><span class="picker-option-mark">${selected ? "✓" : ""}</span><span><strong>${escapeHtml(pickerItemLabel(item))}</strong><small>${escapeHtml(pickerItemDescription(item))}</small></span></button>`;
  }).join("");
  const count = state.picker.filteredItems.length;
  const selectedCount = state.picker.multiple ? state.draftTheatres.size : 0;
  $("#pickerResultCount").textContent = `${count}개 결과${selectedCount ? ` · ${selectedCount}개 선택` : ""}`;
  $("#pickerEmpty").hidden = count > 0;
  const customTitle = $("#pickerSearch").value.trim();
  const exactMovie = state.catalog.movies.some(
    (movie) => normalizeText(movie.title) === normalizeText(customTitle),
  );
  $("#pickerCustomMovie").hidden = state.picker.kind !== "movie" || !customTitle || exactMovie;
  $("#pickerCustomMovie").textContent = `“${customTitle}” 제목 그대로 사용`;
  $("#pickerClear").hidden = !state.picker.multiple || state.draftTheatres.size === 0;
  $("#pickerDone").hidden = !state.picker.multiple;
  $("#pickerDone").textContent = `${state.draftTheatres.size}개 극장 선택 완료`;

  if (state.picker.activeIndex >= 0) {
    $("#pickerSearch").setAttribute("aria-activedescendant", `picker-option-${state.picker.activeIndex}`);
    requestAnimationFrame(() => $("#picker-option-" + state.picker.activeIndex)?.scrollIntoView({ block: "nearest" }));
  } else {
    $("#pickerSearch").removeAttribute("aria-activedescendant");
  }
}

function openPicker(context, trigger) {
  const kind = context.endsWith("movie") ? "movie" : "theatre";
  const multiple = context === "wizard-theatre";
  state.picker = {
    kind,
    context,
    multiple,
    region: "",
    items: pickerSourceItems(kind),
    filteredItems: [],
    activeIndex: 0,
    trigger,
  };
  $("#pickerTitle").textContent = kind === "movie"
    ? context === "quick-movie" ? "영화 선택" : "감시할 영화 찾기"
    : multiple ? "극장 여러 곳 선택" : "극장 선택";
  $("#pickerDescription").textContent = kind === "movie"
    ? "영화 제목으로 검색하고 목록에 없으면 직접 입력할 수 있습니다."
    : multiple
      ? "검색과 지역 필터를 바꿔도 선택한 극장은 그대로 유지됩니다."
      : "CGV 극장 목록에서 한 곳을 선택해 주세요.";
  $("#pickerSearch").placeholder = kind === "movie" ? "영화 제목 검색" : "극장 이름 검색";
  $("#pickerSearch").setAttribute("aria-label", kind === "movie" ? "영화 제목 검색" : "극장 이름 검색");
  $("#pickerSearch").setAttribute("aria-expanded", "true");
  trigger.setAttribute("aria-expanded", "true");
  $("#pickerSearch").value = "";
  renderPickerRegions();
  renderPicker();
  $("#pickerDialog").showModal();
  requestAnimationFrame(() => $("#pickerSearch").focus());
}

function closePicker() {
  if ($("#pickerDialog").open) $("#pickerDialog").close();
  $("#pickerSearch").setAttribute("aria-expanded", "false");
  state.picker.trigger?.setAttribute("aria-expanded", "false");
  state.picker.trigger?.focus();
}

function selectedTheatreRecord(theatre) {
  const region = state.catalog.regions.find((item) => item.code === theatre.regionCode);
  return {
    name: theatre.name,
    siteNo: theatre.siteNo,
    regionCode: theatre.regionCode ?? "",
    regionName: region?.name ?? theatre.regionName ?? "",
  };
}

function choosePickerItem(index) {
  const item = state.picker.filteredItems[index];
  if (!item) return;
  if (state.picker.context === "quick-movie") setQuickMovie(item);
  else if (state.picker.context === "quick-theatre") setQuickTheatre(item);
  else if (state.picker.context === "wizard-movie") {
    setWizardMovie(item);
    state.dialogDirty = true;
  } else if (state.draftTheatres.has(item.siteNo)) {
    state.draftTheatres.delete(item.siteNo);
    state.dialogDirty = true;
    renderTheatres();
    renderPicker();
    return;
  } else {
    state.draftTheatres.set(item.siteNo, selectedTheatreRecord(item));
    state.dialogDirty = true;
    renderTheatres();
    renderPicker();
    return;
  }
  updateQuickPreview();
  closePicker();
}

function chooseCustomMovie() {
  const title = $("#pickerSearch").value.trim();
  if (!title) return;
  const movie = { title, no: "" };
  if (state.picker.context === "quick-movie") setQuickMovie(movie);
  else {
    setWizardMovie(movie);
    state.dialogDirty = true;
  }
  updateQuickPreview();
  closePicker();
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

function renderSpecificDates() {
  const dates = [...state.draftDates].sort();
  $("#specificDateChips").innerHTML = dates.length
    ? dates
        .map(
          (date) =>
            `<span>${escapeHtml(formatDate(date))}<button type="button" data-remove-date="${escapeHtml(date)}" aria-label="${escapeHtml(formatDate(date))} 삭제">×</button></span>`,
        )
        .join("")
    : "<small>아직 기다릴 날짜를 추가하지 않았습니다.</small>";
  $$("[data-remove-date]").forEach((button) =>
    button.addEventListener("click", () => {
      state.draftDates.delete(button.dataset.removeDate);
      state.dialogDirty = true;
      renderSpecificDates();
    }),
  );
}

function addSpecificDate() {
  const selected = digits($("#specificDatePicker").value);
  if (selected.length !== 8) {
    $("#ruleError").textContent = "기다릴 날짜를 선택해 주세요.";
    $("#specificDatePicker").focus();
    return;
  }
  state.draftDates.add(selected);
  state.dialogDirty = true;
  $("#specificDatePicker").value = "";
  $("#ruleError").textContent = "";
  renderSpecificDates();
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
  state.draftDates = new Set(rule.specificDates ?? []);
  $("#dialogTitle").textContent =
    index >= 0 ? "감시 규칙 편집" : "감시 규칙 만들기";
  $("#deleteRuleButton").hidden = index < 0;
  $("#ruleId").value = rule.id;
  $("#ruleName").value = rule.name;
  $("#ruleEnabled").checked = rule.enabled;
  setWizardMovie({ title: rule.movieTitle, no: rule.movieNo });
  $$("#formatOptions input").forEach((input) => {
    input.checked = rule.formats.includes(input.value);
  });
  $("#auditoriums").value = rule.auditoriums.join(", ");
  $(`input[name="dateMode"][value="${rule.dateMode}"]`).checked = true;
  $("#lookAheadDays").value = rule.lookAheadDays;
  $("#startDate").value = toInputDate(rule.startDate);
  $("#endDate").value = toInputDate(rule.endDate);
  $("#specificDatePicker").value = "";
  $("#startTime").value = displayTime(rule.startTime);
  $("#endTime").value = displayTime(rule.endTime);
  $("#minSeats").value = rule.minSeats;
  $("#notifyExisting").checked = rule.notifyExisting;
  $("#ruleError").textContent = "";
  renderTheatres();
  renderSpecificDates();
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
    specificDates: [...state.draftDates].sort(),
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
      field: $("#wizardTheatrePicker"),
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
      field: $("#specificDatePicker"),
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
  const waitingSentence =
    rule.dateMode === "specific"
      ? `${rule.specificDates.map(formatDate).join(", ")} 회차가 CGV에 처음 열리는 순간 알립니다.`
      : `${dateText(rule)} 동안 감지합니다.`;
  $("#ruleReview").innerHTML = `
    <div class="review-sentence">영화 <em>${escapeHtml(rule.movieTitle)}</em> · 극장 <em>${escapeHtml(theatreLabel)}</em>.<br>${escapeHtml(waitingSentence)}</div>
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

async function saveQuickSetting() {
  const rule = quickRule();
  if (!rule) return;
  if (!isQuickEditable(rule)) {
    $("#quickError").textContent = "상세 조건을 보호하기 위해 전체 설정 편집을 이용해 주세요.";
    return;
  }
  const movieTitle = $("#quickMovie").value.trim();
  const movieNo = $("#quickMovieNo").value.trim();
  const theatreSiteNo = $("#quickTheatreSiteNo").value.trim();
  const showDate = digits($("#quickDate").value);
  if (!movieTitle) {
    $("#quickError").textContent = "영화를 선택하거나 제목을 입력해 주세요.";
    $("#quickMoviePicker").focus();
    return;
  }
  const catalogTheatre = state.catalog.theatres.find((theatre) => theatre.siteNo === theatreSiteNo);
  const currentTheatre = rule.theatres.find((theatre) => theatre.siteNo === theatreSiteNo);
  const theatre = catalogTheatre ?? currentTheatre;
  if (!theatre) {
    $("#quickError").textContent = "CGV 목록에서 극장을 선택해 주세요.";
    $("#quickTheatrePicker").focus();
    return;
  }
  if (!/^\d{8}$/.test(showDate)) {
    $("#quickError").textContent = "알림을 기다릴 상영 날짜를 선택해 주세요.";
    $("#quickDate").focus();
    return;
  }

  const regionItem = state.catalog.regions.find((item) => item.code === theatre.regionCode);
  const format = quickFormat();
  const previousRule = structuredClone(rule);
  const { completedAt: _completedAt, completionReason: _completionReason, ...activeRule } = rule;
  const ruleIndex = quickRuleIndex();
  state.config.rules[ruleIndex] = {
    ...activeRule,
    enabled: true,
    movieTitle,
    movieNo,
    theatres: [{
      name: theatre.name,
      siteNo: theatre.siteNo,
      regionCode: theatre.regionCode ?? "",
      regionName: regionItem?.name ?? theatre.regionName ?? "",
    }],
    formats: format ? [format] : [],
    auditoriums: [],
    dateMode: "specific",
    startDate: "",
    endDate: "",
    specificDates: [showDate],
  };

  const button = $("#quickSaveButton");
  $("#quickError").textContent = "";
  setButtonBusy(button, true, "저장 중");
  try {
    await persistConfig("빠른 설정을 저장하고 감시를 시작했습니다.");
    await loadStatus();
  } catch (error) {
    state.config.rules[ruleIndex] = previousRule;
    renderRules();
    $("#quickError").textContent = error.message;
  } finally {
    setButtonBusy(button, false);
  }
}

function applySpiderPreset() {
  setQuickMovie({ title: "스파이더맨-브랜드 뉴 데이", no: "30001192" });
  const theatre = state.catalog.theatres.find((item) => item.siteNo === "0013")
    ?? { name: "용산아이파크몰", siteNo: "0013", regionCode: "01", regionName: "서울" };
  setQuickTheatre(theatre);
  $('input[name="quickFormat"][value="SCREENX"]').checked = true;
  $("#quickError").textContent = "";
  updateQuickPreview();
  toast("스파이더맨 · 용산 · SCREENX를 불러왔습니다. 날짜를 확인하고 저장해 주세요.");
  if (!$("#quickDate").value) $("#quickDate").focus();
}

function applyQuickDate(shortcut) {
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1_000);
  let daysToAdd = shortcut === "tomorrow" ? 1 : 0;
  if (shortcut === "saturday") daysToAdd = (6 - kstNow.getUTCDay() + 7) % 7;
  kstNow.setUTCDate(kstNow.getUTCDate() + daysToAdd);
  $("#quickDate").value = kstNow.toISOString().slice(0, 10);
  updateQuickPreview();
}

async function completeRule(index) {
  if (!confirm("예매를 마쳤나요? 이 규칙의 자동 감시를 종료합니다.")) return;
  const previousRule = structuredClone(state.config.rules[index]);
  state.config.rules[index].enabled = false;
  state.config.rules[index].completedAt = new Date().toISOString();
  state.config.rules[index].completionReason = "booked";
  renderRules();
  try {
    await persistConfig("예매 완료로 표시하고 감시를 종료했습니다.");
    await loadStatus();
  } catch (error) {
    state.config.rules[index] = previousRule;
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
    state.intervalMinutes = status.intervalMinutes ?? 5;
    $("#systemStatus").textContent = healthy
      ? state.intervalMinutes === 2 ? "2분 집중 감지" : "5분 정상 감지"
      : "일시정지";
    $("#systemStatusDetail").textContent = healthy
      ? `Cloudflare ${state.intervalMinutes}분 자동 감지`
      : "자동 감지가 멈춰 있습니다.";
    $("#systemStatus").style.color = healthy ? "var(--ink)" : "var(--amber)";
    $("#railStatus").textContent = healthy ? "정상 감지 중" : "전체 일시정지";
    $(".mobile-signal").innerHTML = `<i></i>${state.intervalMinutes}분 감지`;
    $(".rail-status").classList.toggle("paused", !healthy);
    $("#activeRuleCount").textContent = `${status.activeRules}개`;
    renderClock();
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
  const interval = state.intervalMinutes;
  const segments = 60 / interval;
  const active = Math.floor(now.getMinutes() / interval);
  $("#signalIntervalTitle").textContent = `${interval}분 신호선`;
  $("#signalClock").style.setProperty("--segments", segments);
  $("#signalClock").setAttribute("aria-label", `시간당 ${interval}분 감지 구간`);
  $("#signalClock").innerHTML = Array.from(
    { length: segments },
    (_, index) =>
      `<span class="${index === active ? "active" : ""}" data-minute="${index % Math.max(1, Math.round(10 / interval)) === 0 ? String(index * interval).padStart(2, "0") : ""}"></span>`,
  ).join("");
  const next = new Date(now);
  next.setSeconds(0, 0);
  next.setMinutes((Math.floor(now.getMinutes() / interval) + 1) * interval);
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

async function logout() {
  await api("/api/logout", { method: "POST" });
  showLogin();
}

function exportConfig() {
  const blob = new Blob([JSON.stringify(state.config, null, 2)], {
    type: "application/json",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "cgv-open-watch-config.json";
  link.click();
  URL.revokeObjectURL(link.href);
}

async function importConfig(input) {
  try {
    const imported = JSON.parse(await input.files[0].text());
    if (imported?.version !== 3 || !Array.isArray(imported.rules))
      throw new Error();
    state.config = imported;
    renderRules();
    markDirty();
    toast("설정을 불러왔습니다. 검토 후 저장해 주세요.");
  } catch {
    toast("올바른 CGV Open Watch 설정 파일이 아닙니다.");
  }
  input.value = "";
}

function closeMobileMenu() {
  if ($("#mobileMenuDialog").open) $("#mobileMenuDialog").close();
  $("#mobileMenuButton").setAttribute("aria-expanded", "false");
  $("#mobileMenuButton").focus();
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

$("#logoutButton").addEventListener("click", logout);
$("#mobileMenuButton").addEventListener("click", () => {
  $("#mobileMenuButton").setAttribute("aria-expanded", "true");
  $("#mobileMenuDialog").showModal();
  requestAnimationFrame(() => $("#mobileMenuClose").focus());
});
$("#mobileMenuClose").addEventListener("click", closeMobileMenu);
$("#mobileMenuDialog").addEventListener("cancel", (event) => {
  event.preventDefault();
  closeMobileMenu();
});
$("#mobileMenuDialog").addEventListener("click", (event) => {
  if (event.target === $("#mobileMenuDialog")) closeMobileMenu();
});
$("#mobileMenuDialog").addEventListener("keydown", (event) => {
  if (event.key !== "Tab") return;
  const focusable = $$('a[href], button:not([disabled]), input:not([disabled])', event.currentTarget)
    .filter((element) => !element.hidden && element.getClientRects().length > 0);
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});
$$('[data-mobile-menu-link]').forEach((link) =>
  link.addEventListener("click", closeMobileMenu),
);
$("#mobileLogoutButton").addEventListener("click", async () => {
  closeMobileMenu();
  await logout();
});
$("#quickRuleTabs").addEventListener("click", (event) => {
  const button = event.target.closest("[data-quick-rule-id]");
  if (!button) return;
  state.quickRuleId = button.dataset.quickRuleId;
  renderQuickSetup();
});
$("#quickRuleTabs").addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = $$("[data-quick-rule-id]", event.currentTarget);
  if (tabs.length < 2) return;
  event.preventDefault();
  const currentIndex = Math.max(0, tabs.indexOf(document.activeElement));
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? tabs.length - 1
      : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  state.quickRuleId = tabs[nextIndex].dataset.quickRuleId;
  renderQuickSetup();
  $(`[data-quick-rule-id="${CSS.escape(state.quickRuleId)}"]`)?.focus();
});
$("#quickForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveQuickSetting();
});
$("#quickAdvancedButton").addEventListener("click", () =>
  openRule(quickRuleIndex()),
);
$("#quickCreateButton").addEventListener("click", () => openRule());
$("#spiderPresetButton").addEventListener("click", applySpiderPreset);
$("#quickDate").addEventListener("input", updateQuickPreview);
$$('input[name="quickFormat"]').forEach((input) =>
  input.addEventListener("change", updateQuickPreview),
);
$$('[data-quick-date]').forEach((button) =>
  button.addEventListener("click", () => applyQuickDate(button.dataset.quickDate)),
);
$("#addRuleButton").addEventListener("click", () => openRule());
$("#ruleSearch").addEventListener("input", renderRules);
$("#addSpecificDate").addEventListener("click", addSpecificDate);
$("#movieTitle").addEventListener("input", () => {
  setWizardMovie({ title: $("#movieTitle").value.trim(), no: "" });
  state.dialogDirty = true;
});
$$('[data-picker-open]').forEach((button) =>
  button.addEventListener("click", () => openPicker(button.dataset.pickerOpen, button)),
);
$("#pickerClose").addEventListener("click", closePicker);
$("#pickerDone").addEventListener("click", closePicker);
$("#pickerCustomMovie").addEventListener("click", chooseCustomMovie);
$("#pickerClear").addEventListener("click", () => {
  state.draftTheatres.clear();
  state.dialogDirty = true;
  renderTheatres();
  renderPicker();
});
$("#pickerList").addEventListener("click", (event) => {
  const option = event.target.closest("[data-picker-index]");
  if (option) choosePickerItem(Number(option.dataset.pickerIndex));
});
$("#pickerRegions").addEventListener("click", (event) => {
  const region = event.target.closest("[data-picker-region]");
  if (!region) return;
  state.picker.region = region.dataset.pickerRegion;
  state.picker.activeIndex = 0;
  renderPickerRegions();
  renderPicker();
});
$("#pickerSearch").addEventListener("input", () => {
  state.picker.activeIndex = 0;
  renderPicker();
});
$("#pickerSearch").addEventListener("keydown", (event) => {
  const lastIndex = state.picker.filteredItems.length - 1;
  if (lastIndex < 0 && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    return;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    state.picker.activeIndex = Math.min(state.picker.activeIndex + 1, lastIndex);
    renderPicker();
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    state.picker.activeIndex = Math.max(state.picker.activeIndex - 1, 0);
    renderPicker();
  } else if (event.key === "Home") {
    event.preventDefault();
    state.picker.activeIndex = 0;
    renderPicker();
  } else if (event.key === "End") {
    event.preventDefault();
    state.picker.activeIndex = lastIndex;
    renderPicker();
  } else if (event.key === "Enter" && state.picker.activeIndex >= 0) {
    event.preventDefault();
    choosePickerItem(state.picker.activeIndex);
  } else if (event.key === "Escape") {
    event.preventDefault();
    closePicker();
  }
});
$("#pickerDialog").addEventListener("cancel", (event) => {
  event.preventDefault();
  closePicker();
});
$("#pickerDialog").addEventListener("keydown", (event) => {
  if (event.key !== "Tab") return;
  const focusable = $$('button:not([disabled]):not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"])', event.currentTarget)
    .filter((element) => !element.hidden && element.getClientRects().length > 0);
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});
$("#pickerDialog").addEventListener("click", (event) => {
  if (event.target === $("#pickerDialog")) closePicker();
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
$("#exportButton").addEventListener("click", exportConfig);
$("#mobileExportButton").addEventListener("click", () => {
  exportConfig();
  closeMobileMenu();
});
$("#importInput").addEventListener("change", (event) => importConfig(event.target));
$("#mobileImportInput").addEventListener("change", async (event) => {
  await importConfig(event.target);
  closeMobileMenu();
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
