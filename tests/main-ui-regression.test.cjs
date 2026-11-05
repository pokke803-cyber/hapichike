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

test("v1 missingはempty/new stateとしてmainと親設定を維持する", () => {
  assert.match(html, /NEW_OR_EMPTY_LEGACY_STATE/);
  assert.match(html, /localStateMode === "empty"[\s\S]*データなし/);
  assert.match(html, /loaded\.mode === "empty" \? emptyFallback\(\)/);
  assert.match(fs.readFileSync(path.join(__dirname, "..\/src\/local-state-adapter.js"), "utf8"), /EMPTY_LEGACY_READ_ONLY/);
});

test("LEGACY_MODEのpage loadは自動resetを永続化せずlocalStorage write 0にする", () => {
  assert.match(html, /applyAutomaticDailyReset\(false, false\)/);
  assert.match(html, /function applyAutomaticDailyReset\(notify = false, persist = true\)[\s\S]*if \(persist\) saveState\(\)/);
  const bootSection = html.slice(html.indexOf("const sfxAudio"), html.indexOf("function loadState"));
  assert.doesNotMatch(bootSection, /saveState\(\)/);
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

test("main entryはlocal state依存moduleを明示順で先にimportする", () => {
  const core = html.indexOf('import "/src/child-identity-core.js"');
  const adapter = html.indexOf('import "/src/local-state-adapter.js"');
  const load = html.indexOf("let state = loadState()");
  assert.ok(core >= 0 && adapter > core && load > adapter);
  assert.equal((html.match(/src="\/src\//g) || []).length, 0);
});

test("mainのUMD依存moduleはbrowser bundleでrequire分岐に入らない", () => {
  for (const file of ["local-state-adapter.js", "profile-domain.js", "profile-migration.js"]) {
    const source = fs.readFileSync(path.join(__dirname, "..", "src", file), "utf8");
    assert.match(source, /module\.exports && typeof require === "function"/);
  }
});

test("staging boot diagnosticは指定状態だけを表示する", () => {
  assert.match(html, /location\.hostname === "hapichike-staging\.vercel\.app"/);
  for (const label of ["script", "legacy read", "mode", "child render", "parent handler", "main render"]) {
    assert.match(html, new RegExp(label.replace(" ", "\\s")));
  }
  assert.match(html, /BOOT_ERROR/);
  assert.match(html, /PROFILE_INIT_ERROR/);
  assert.match(html, /UI_BIND_ERROR/);
  assert.doesNotMatch(html, /stack:\s*\$\{/);
});

test("staging boot diagnosticはorigin・storage availability・対象keyの存在だけを表示する", () => {
  for (const text of [
    "location.origin", "storage availability", "kidsVegasCasino.v1", "kidsVegasCasino.v2",
    "kidsVegasCasino.initialImportBackup.v1", "kidsVegasCasino.identityMigrationSafety.v1",
    "kidsVegasCasino.restoreSafety.v1", "kidsVegasCasino.cloudMapping.v1",
    "kidsVegasCasino.cloudMapping.v2", "kidsVegasCasino.v2.activation"
  ]) assert.ok(html.includes(text), `${text} should be present`);
  assert.match(html, /localStorage\.getItem\(key\) === null \? "MISSING" : "PRESENT"/);
});

test("window errorとunhandledrejectionはsafe codeへ変換する", () => {
  assert.match(html, /addEventListener\("error", \(\) => safeCode\("BOOT_ERROR"\)\)/);
  assert.match(html, /addEventListener\("unhandledrejection", \(\) => safeCode\("BOOT_ERROR"\)\)/);
});

test("親設定fallback handlerはmodule mainより前に独立登録される", () => {
  const bootstrap = html.indexOf('window.HapichikeBootDiagnostic = Object.freeze');
  const fallback = html.indexOf('button.addEventListener("click", () => modal.classList.remove("hidden"))');
  const moduleMain = html.indexOf('import "/src/child-identity-core.js"');
  assert.ok(bootstrap >= 0 && fallback > bootstrap && moduleMain > fallback);
});

test("handler登録は機能群ごとに隔離されchild/main renderも別に完了判定する", () => {
  assert.ok((html.match(/isolateUiBindings\(\(\) => \{/g) || []).length >= 5);
  assert.match(html, /renderAccount\(\);[\s\S]*renderLocalChildSelector\(\);[\s\S]*childRender", "OK"/);
  assert.match(html, /try \{[\s\S]*render\(\);[\s\S]*mainRender", "OK"[\s\S]*\} catch/);
});

test("Cloud管理はみまもりダッシュボード導線のままlocal親設定を保持する", () => {
  assert.match(html, /お手伝い編集/);
  assert.match(html, /音設定/);
  assert.match(html, /データ管理/);
  assert.match(html, /クラウド管理はみまもりダッシュボードで行います/);
});
