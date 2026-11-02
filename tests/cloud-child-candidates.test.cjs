const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadModule() {
  let source = fs.readFileSync(path.join(__dirname, "../src/services/cloud-child-candidates.js"), "utf8");
  source = source
    .replace(/import[\s\S]*?from "\.\/api\/authApi\.js";\s*/, "")
    .replace(/import[\s\S]*?from "\.\/api\/householdsApi\.js";\s*/, "")
    .replace(/import[\s\S]*?from "\.\/api\/childrenApi\.js";\s*/, "")
    .replace("export class CloudChildCandidatesError", "class CloudChildCandidatesError")
    .replace("export async function loadCloudChildCandidates", "async function loadCloudChildCandidates");
  const context = {
    module: { exports: {} },
    getParentSession: async () => ({ session: null }),
    getHouseholdMembershipsForUser: async () => [],
    getHouseholdsByIds: async () => [],
    getChildrenByHousehold: async () => [],
  };
  vm.runInNewContext(`${source}\nmodule.exports = { CloudChildCandidatesError, loadCloudChildCandidates };`, context);
  return context.module.exports;
}

const { loadCloudChildCandidates } = loadModule();
const session = id => ({ user: { id } });

function dependencies(overrides = {}) {
  return {
    getSession: async () => ({ session: session("parent-a") }),
    getMemberships: async () => [{ household_id: "household-a", role: "owner", created_at: "1" }],
    getHouseholds: async () => [{ id: "household-a", name: "Household A", created_at: "1" }],
    getChildren: async () => [
      { id: "child-a", household_id: "household-a", name: "Child A", display_order: 1 },
      { id: "child-c", household_id: "household-a", name: "Child C", display_order: 2 },
    ],
    ...overrides,
  };
}

test("sessionなしとuserなしをSELECT未実行として区別する", async () => {
  const absent = await loadCloudChildCandidates({ dependencies: dependencies({ getSession: async () => ({ session: null }) }) });
  assert.equal(absent.sessionState, "absent");
  assert.equal(absent.membershipsState, "not-run");
  const noUser = await loadCloudChildCandidates({ session: {}, dependencies: dependencies() });
  assert.equal(noUser.sessionState, "present");
  assert.equal(noUser.userState, "absent");
});

test("household_members 0件とSELECT errorを区別する", async () => {
  const empty = await loadCloudChildCandidates({ session: session("parent-a"), dependencies: dependencies({ getMemberships: async () => [] }) });
  assert.equal(empty.membershipsState, "empty");
  assert.equal(empty.childrenState, "not-run");
  await assert.rejects(
    loadCloudChildCandidates({ session: session("parent-a"), dependencies: dependencies({ getMemberships: async () => { throw new Error("select failed"); } }) }),
    error => error.stage === "household_members",
  );
});

test("households 0件とSELECT errorを区別する", async () => {
  const empty = await loadCloudChildCandidates({ session: session("parent-a"), dependencies: dependencies({ getHouseholds: async () => [] }) });
  assert.equal(empty.householdsState, "empty");
  await assert.rejects(
    loadCloudChildCandidates({ session: session("parent-a"), dependencies: dependencies({ getHouseholds: async () => { throw new Error("select failed"); } }) }),
    error => error.stage === "households",
  );
});

test("children 0件とSELECT errorを区別する", async () => {
  const empty = await loadCloudChildCandidates({ session: session("parent-a"), dependencies: dependencies({ getChildren: async () => [] }) });
  assert.equal(empty.childrenState, "empty");
  await assert.rejects(
    loadCloudChildCandidates({ session: session("parent-a"), dependencies: dependencies({ getChildren: async () => { throw new Error("select failed"); } }) }),
    error => error.stage === "children",
  );
});

test("Parent AはA/C、Parent BはBだけをmapping未設定でも取得する", async () => {
  const parentA = await loadCloudChildCandidates({ session: session("parent-a"), dependencies: dependencies() });
  assert.deepEqual(parentA.children.map(child => child.name), ["Child A", "Child C"]);
  const parentB = await loadCloudChildCandidates({
    session: session("parent-b"),
    dependencies: dependencies({
      getMemberships: async () => [{ household_id: "household-b", role: "owner", created_at: "1" }],
      getHouseholds: async () => [{ id: "household-b", name: "Household B", created_at: "1" }],
      getChildren: async id => id === "household-b" ? [{ id: "child-b", household_id: id, name: "Child B" }] : [],
    }),
  });
  assert.deepEqual(parentB.children.map(child => child.name), ["Child B"]);
  assert.equal(parentA.children.some(child => child.name === "Child B"), false);
  assert.equal(parentB.children.some(child => ["Child A", "Child C"].includes(child.name)), false);
});

test("両main app UIは共通loaderをmapping/import前に使いLocal読込状態と分離する", () => {
  for (const file of ["cloud-mapping-ui.js", "profile-migration-ui.js"]) {
    const source = fs.readFileSync(path.join(__dirname, "../src", file), "utf8");
    assert.match(source, /loadCloudChildCandidates/);
    assert.match(source, /localReadState/);
    assert.match(source, /cloudChildrenReadState/);
  }
});
