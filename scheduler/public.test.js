import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const publicUrl = new URL("./public/", import.meta.url);

test("관리 화면 선택 UI가 공통 Picker 계약을 유지한다", async () => {
  const html = await readFile(new URL("index.html", publicUrl), "utf8");

  assert.doesNotMatch(html, /<(?:select|datalist)\b/i);
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

test("Picker가 표시 이름 대신 CGV 식별자를 저장한다", async () => {
  const script = await readFile(new URL("app.js", publicUrl), "utf8");

  assert.match(script, /quickMovieNo/);
  assert.match(script, /quickTheatreSiteNo/);
  assert.match(script, /find\(\(theatre\) => theatre\.siteNo === theatreSiteNo\)/);
  assert.match(script, /state\.draftTheatres\.set\(item\.siteNo/);
  assert.match(script, /event\.key !== "Tab"/);
  assert.match(script, /aria-activedescendant/);
});
