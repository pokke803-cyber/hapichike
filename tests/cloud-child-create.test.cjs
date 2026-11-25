const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("../src/parent/cloud-child-create-core.js");

const household = { id: "house-a", name: "家庭A" };
const preview = () => core.createPreview({ draft: { name: "  こども  ", nickname: "  こ  " }, household });

test("Cloud Child draftは名前必須・最大12文字でtrimする", () => {
  assert.deepEqual(core.normalizeDraft({ name: "  こども  ", nickname: "  こ  " }), { name: "こども", nickname: "こ" });
  assert.throws(() => core.normalizeDraft({ name: "   " }), error => error.code === "NAME_REQUIRED");
  assert.throws(() => core.normalizeDraft({ name: "1234567890123" }), error => error.code === "NAME_TOO_LONG");
});

test("previewは対象家庭・名前・nicknameを固定しINSERTを行わない", () => {
  assert.deepEqual(preview(), { householdId: "house-a", householdName: "家庭A", name: "こども", nickname: "こ" });
});

test("ownerとparentだけが最新membership確認を通過する", () => {
  for (const membership_role of ["owner", "parent"]) {
    assert.equal(core.verifyPreflight({
      preview: preview(), session: { user: { id: "user-a" } }, selectedHouseholdId: "house-a",
      households: [{ id: "house-a", membership_role }],
    }).role, membership_role);
  }
});

test("viewerはChild追加を拒否される", () => {
  assert.throws(() => core.verifyPreflight({
    preview: preview(), session: { user: { id: "user-a" } }, selectedHouseholdId: "house-a",
    households: [{ id: "house-a", membership_role: "viewer" }],
  }), error => error.code === "ROLE_FORBIDDEN");
});

test("別家庭またはpreview後に切替済みの家庭は拒否される", () => {
  assert.throws(() => core.verifyPreflight({
    preview: preview(), session: { user: { id: "user-a" } }, selectedHouseholdId: "house-b",
    households: [{ id: "house-a", membership_role: "owner" }],
  }), error => error.code === "HOUSEHOLD_CHANGED");
  assert.throws(() => core.verifyPreflight({
    preview: preview(), session: { user: { id: "user-a" } }, selectedHouseholdId: "house-a",
    households: [{ id: "house-b", membership_role: "owner" }],
  }), error => error.code === "HOUSEHOLD_FORBIDDEN");
});

test("通信失敗後は追加前に存在しなかった完全一致Childだけを復旧候補にする", () => {
  const children = [
    { id: "old", household_id: "house-a", name: "こども", nickname: "こ" },
    { id: "new", household_id: "house-a", name: "こども", nickname: "こ" },
    { id: "other", household_id: "house-b", name: "こども", nickname: "こ" },
  ];
  assert.equal(core.findNewMatchingChild(["old"], children, preview()).id, "new");
  assert.equal(core.findNewMatchingChild(["old", "new"], children, preview()), null);
});

test("createChild APIのINSERT列はhousehold_id・name・nicknameだけに限定する", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/services/api/childrenApi.js"), "utf8");
  const insert = source.match(/export const createChild[\s\S]*?\.select\(/)?.[0] ?? "";
  assert.match(insert, /\.insert\(\{ household_id: householdId, name: normalizedName, nickname: normalizedNickname \}\)/);
  assert.doesNotMatch(insert, /\bid\s*:|display_order\s*:|parent_id\s*:/);
  assert.match(source, /!normalizedName \|\| normalizedName\.length > 12/);
});

test("親UIは二重送信をguardし、確定直前にauth・membership・Child一覧を再取得する", () => {
  const source = fs.readFileSync(path.join(__dirname, "../parent/parent.js"), "utf8");
  assert.match(source, /if \(creatingChild \|\| !childCreatePreview\) return;/);
  assert.match(source, /creatingChild = true;/);
  assert.match(source, /await getParentSession\(\)/);
  assert.match(source, /await getCurrentHouseholds\(session\.user\.id\)/);
  assert.match(source, /verifyPreflight/);
  assert.match(source, /await getChildrenByHousehold\(preview\.householdId\)/);
  assert.match(source, /await createChild\(preview\.householdId, preview\.name, preview\.nickname\)/);
});

test("Child追加経路はLocal profile・mapping・initial importを自動実行しない", () => {
  const source = fs.readFileSync(path.join(__dirname, "../parent/parent.js"), "utf8");
  const start = source.indexOf('elements.createChildButton.addEventListener("click"');
  const end = source.indexOf("elements.migrationPreviewButton.addEventListener", start);
  const handler = source.slice(start, end);
  assert.doesNotMatch(handler, /createLocalProfile|saveMapping|importInitialHapichikeSnapshot|localStorage\.setItem/);
});

test("Child 0件でも追加UIを表示し、表示・previewだけではINSERTしない", () => {
  const html = fs.readFileSync(path.join(__dirname, "../parent/index.html"), "utf8");
  const source = fs.readFileSync(path.join(__dirname, "../parent/parent.js"), "utf8");
  const settings = html.slice(html.indexOf('id="settingsPanel"'), html.indexOf("</section>\n        </div>"));
  assert.match(settings, /id="showChildCreateButton"/);
  assert.match(settings, /Cloud Childだけを追加します/);
  assert.match(html, /id="childrenEmpty"/);
  const previewStart = source.indexOf('elements.showChildCreateButton.addEventListener("click"');
  const insertStart = source.indexOf('elements.createChildButton.addEventListener("click"', previewStart);
  assert.doesNotMatch(source.slice(previewStart, insertStart), /createChild\s*\(/);
});
