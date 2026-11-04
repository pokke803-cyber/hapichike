const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");

test("legacy selectorはchildNameをdisabled optionとして表示し空selectにしない", () => {
  assert.match(html, /if \(localStateMode === "legacy"\)[\s\S]*select\.disabled = true;[\s\S]*legacy-single-profile[\s\S]*legacyName/);
  assert.match(html, /<span>操作する子ども：<\/span>/);
});

test("multi-profile selectorはprofile UUIDをvalue、childNameを表示名にする", () => {
  assert.match(html, /profile\.localChildKey,[\s\S]*profile\.childName,[\s\S]*profile\.active/);
  assert.match(html, /select\.disabled = false/);
});

test("broken v2 selectorは空にせず安全エラーを表示する", () => {
  assert.match(html, /localStateMode = "blocked";[\s\S]*select\.disabled = true;[\s\S]*データ確認が必要です/);
});

test("初期保存失敗を隔離して後続handler登録を継続する", () => {
  assert.match(html, /try \{[\s\S]*applyAutomaticDailyReset\(\);[\s\S]*!localStateBlockedError[\s\S]*\} catch \(error\) \{[\s\S]*localStateMode = "blocked"/);
});

test("おうちの人用button handlerは親設定modalを開く", () => {
  assert.match(html, /openParentSettingsBtn"\)\.addEventListener\("click", openParentSettings\)/);
  assert.match(html, /function openParentSettings\(\)[\s\S]*parentSettingsModal"\)\.classList\.remove\("hidden"\)/);
});

test("selector handlerは親設定handlerの後に登録されfail isolationされる", () => {
  const parentHandler = html.indexOf('openParentSettingsBtn").addEventListener("click", openParentSettings)');
  const selectorHandler = html.indexOf('localChildSelector").addEventListener("change", switchLocalChild)');
  assert.ok(parentHandler >= 0);
  assert.ok(selectorHandler > parentHandler);
});

test("Cloud管理はみまもりダッシュボード導線のままlocal親設定を保持する", () => {
  assert.match(html, /お手伝い編集/);
  assert.match(html, /音設定/);
  assert.match(html, /データ管理/);
  assert.match(html, /クラウド管理はみまもりダッシュボードで行います/);
});
