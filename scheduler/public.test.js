import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const publicUrl = new URL("./public/", import.meta.url);

test("관리 화면 선택 UI가 공통 Picker 계약을 유지한다", async () => {
  const html = await readFile(new URL("index.html", publicUrl), "utf8");

  assert.doesNotMatch(html, /<(?:select|datalist)\b/i);
  assert.match(html, /<meta name="theme-color" content="#ffffff"/);
  assert.match(html, /id="mobileMenuDialog"[^>]+aria-labelledby="mobileMenuTitle"/);
  assert.match(html, /id="mobileImportInput"[^>]+type="file"/);
  assert.match(html, /id="pickerDialog"[^>]+aria-labelledby="pickerTitle"[^>]+aria-describedby="pickerDescription"/);
  assert.match(html, /id="pickerSearch"[^>]+role="combobox"[^>]+aria-controls="pickerList"/);
  assert.match(html, /id="pickerList"[^>]+role="listbox"/);

  for (const id of [
    "quickMoviePicker",
    "quickTheatrePicker",
    "wizardMoviePicker",
    "wizardTheatrePicker",
  ]) {
    assert.match(html, new RegExp(`id="${id}"[^>]+aria-haspopup="dialog"[^>]+aria-expanded="false"`));
  }
});

test("관리 화면이 Airbnb 기반 소비자 디자인 토큰을 사용한다", async () => {
  const css = await readFile(new URL("styles-20260803-12.css", publicUrl), "utf8");

  assert.match(css, /--brand: #ff385c/);
  assert.match(css, /--paper: #ffffff/);
  assert.match(css, /--radius: 14px/);
  assert.match(css, /\.side-rail \{[\s\S]*background: rgba\(255, 255, 255, 0\.96\)/);
  assert.match(css, /\.quick-form \{[\s\S]*border-radius: 32px/);
  assert.match(css, /\.mobile-menu-dialog \{/);
});

test("첫 화면은 실제 감시 판단에 필요한 정보만 표시한다", async () => {
  const [html, script] = await Promise.all([
    readFile(new URL("index.html", publicUrl), "utf8"),
    readFile(new URL("app-20260803-12.js", publicUrl), "utf8"),
  ]);

  assert.match(html, /class="operation-panel"/);
  assert.match(html, /id="systemStatus"/);
  assert.match(html, /id="lastResultTime"/);
  assert.match(html, /id="nextRun"/);
  assert.match(html, /id="activeRuleCount"/);
  assert.match(html, /id="mobileTestButton"/);
  assert.match(html, /id="mobileCatalogButton"/);
  assert.doesNotMatch(html, /5분 신호선|signal-board|signalClock/);
  assert.doesNotMatch(html, /spiderPresetButton|CATALOG|OPERATIONS DESK/);
  assert.doesNotMatch(script, /function renderClock|signalIntervalTitle|signalClock/);
  assert.match(script, /const staleAfter = Math\.max\(15, state\.intervalMinutes \* 3\)/);
});

test("Picker가 표시 이름 대신 CGV 식별자를 저장한다", async () => {
  const script = await readFile(new URL("app-20260803-12.js", publicUrl), "utf8");

  assert.match(script, /quickMovieNo/);
  assert.match(script, /quickTheatreSiteNo/);
  assert.match(script, /find\(\(theatre\) => theatre\.siteNo === theatreSiteNo\)/);
  assert.match(script, /state\.draftTheatres\.set\(item\.siteNo/);
  assert.match(script, /event\.key !== "Tab"/);
  assert.match(script, /aria-activedescendant/);
  assert.match(script, /function closeMobileMenu\(\)/);
  assert.match(script, /mobileLogoutButton/);
  assert.match(script, /mobileImportInput/);
});
