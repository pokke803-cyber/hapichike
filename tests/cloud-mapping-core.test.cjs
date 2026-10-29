const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("../src/cloud-mapping-core.js");

const validState = {
  childName: "うぱ", coins: 12, starCoins: 3, happyChanceCards: 2,
  points: { snack: 5, toy: 1, game: 0 },
};

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  const writes = [];
  return {
    writes,
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem(key, value) { writes.push([key, value]); values.set(key, value); },
  };
}

test("local stateから単一childと6残高を副作用なく読む", () => {
  const store = storage({ [core.MAIN_STORAGE_KEY]: JSON.stringify(validState) });
  const child = core.readLocalChild(store);
  assert.equal(child.localChildKey, "legacy-single-profile");
  assert.equal(child.name, "うぱ");
  assert.deepEqual(child.balances, { tickets: 12, star_coins: 3, sweets_pay: 5, toy_pay: 1, game_pay: 0, happy_chance_cards: 2 });
  assert.equal(store.writes.length, 0);
});

test("malformed local stateを拒否し書き換えない", () => {
  const store = storage({ [core.MAIN_STORAGE_KEY]: "{" });
  assert.throws(() => core.readLocalChild(store), /JSON/);
  assert.equal(store.writes.length, 0);
});

test("Phase 1比較はticketsとPAYの負数を保持しstarとcardの負数を拒否する", () => {
  const negativeAllowed = {
    ...validState,
    coins: -2,
    points: { snack: -3, toy: -4, game: -5 },
  };
  assert.deepEqual(core.parseLocalState(JSON.stringify(negativeAllowed)).balances, {
    tickets: -2,
    star_coins: 3,
    sweets_pay: -3,
    toy_pay: -4,
    game_pay: -5,
    happy_chance_cards: 2,
  });
  assert.throws(() => core.parseLocalState(JSON.stringify({ ...validState, starCoins: -1 })), /0以上/);
  assert.throws(() => core.parseLocalState(JSON.stringify({ ...validState, happyChanceCards: -1 })), /0以上/);
});

test("Local > Cloud / Local < Cloud / Local = Cloud / 欠損を区別する", () => {
  const child = core.parseLocalState(JSON.stringify(validState));
  const rows = core.compareBalances(child, { tickets: 2, star_coins: 5, sweets_pay: 5, toy_pay: 0, game_pay: 0 });
  assert.equal(rows.find(row => row.key === "tickets").status, "local-greater");
  assert.equal(rows.find(row => row.key === "star_coins").status, "cloud-greater");
  assert.equal(rows.find(row => row.key === "sweets_pay").status, "equal");
  assert.equal(rows.find(row => row.key === "happy_chance_cards").status, "missing");
});

test("mapping未設定はnull、家庭内childrenで再確認できたmappingだけ採用する", () => {
  const document = core.parseMappingDocument(null);
  assert.equal(core.findVerifiedMapping(document, core.LOCAL_CHILD_KEY, "h1", []), null);
  document.mappings.push({ localChildKey: core.LOCAL_CHILD_KEY, supabaseChildId: "c1", householdId: "h1", confirmedAt: "2026-10-22T00:00:00.000Z" });
  assert.equal(core.findVerifiedMapping(document, core.LOCAL_CHILD_KEY, "h1", [{ id: "c2" }]), null);
  assert.equal(core.findVerifiedMapping(document, core.LOCAL_CHILD_KEY, "h1", [{ id: "c1" }]).supabaseChildId, "c1");
});

test("mapping保存と再読込は専用keyだけに書き込む", () => {
  const store = storage({ [core.MAIN_STORAGE_KEY]: JSON.stringify(validState) });
  const before = store.getItem(core.MAIN_STORAGE_KEY);
  core.saveMapping(store, { localChildKey: core.LOCAL_CHILD_KEY, supabaseChildId: "c1", householdId: "h1" }, "2026-10-22T00:00:00.000Z");
  assert.equal(store.writes.length, 1);
  assert.equal(store.writes[0][0], core.MAPPING_STORAGE_KEY);
  assert.equal(store.getItem(core.MAIN_STORAGE_KEY), before);
  assert.equal(core.readMapping(store).mappings[0].supabaseChildId, "c1");
});

test("同じcloud childの重複mappingを拒否する", () => {
  const existing = { appId: "hapichike", version: 1, mappings: [{ localChildKey: "other", supabaseChildId: "c1", householdId: "h1", confirmedAt: "2026-10-22T00:00:00.000Z" }] };
  const store = storage({ [core.MAPPING_STORAGE_KEY]: JSON.stringify(existing) });
  assert.throws(() => core.saveMapping(store, { localChildKey: core.LOCAL_CHILD_KEY, supabaseChildId: "c1", householdId: "h1" }), /複数/);
});

test("Phase 2 payload案を生成するが送信処理を持たない", () => {
  const child = core.parseLocalState(JSON.stringify(validState));
  const payload = core.createImportPayloadProposal(child, "c1");
  assert.equal(payload.child_id, "c1");
  assert.equal(payload.app_id, "hapichike");
  assert.deepEqual(payload.balances, child.balances);
  assert.equal(typeof core.importInitialBalance, "undefined");
});

test("Phase 1 UIのSupabase経路は読取APIだけをimportする", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/cloud-mapping-ui.js"), "utf8");
  assert.match(source, /getCurrentHouseholds/);
  assert.match(source, /getChildrenByHousehold/);
  assert.match(source, /getChildBalances/);
  assert.doesNotMatch(source, /\.rpc\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
  assert.doesNotMatch(source, /addTicket|addStarCoin|exchangeStarCoins|adjustPayBalance|adjustHappyChance|reward_logs/);
});

test("children取得はhousehold条件付き、表示列限定である", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/services/api/childrenApi.js"), "utf8");
  assert.match(source, /select\("id, household_id, name, nickname, display_order"\)/);
  assert.match(source, /\.eq\("household_id", householdId\)/);
});
