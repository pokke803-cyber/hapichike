const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const clientPath = path.join(root, "src", "lib", "supabaseClient.js");
const clientSource = fs.readFileSync(clientPath, "utf8");

function loadClient(env, { failInitialization = false } = {}) {
  let createClientCalls = 0;
  const runnableSource = clientSource
    .replace(
      'import { createClient } from "@supabase/supabase-js";',
      "const createClient = globalThis.__createClient;",
    )
    .replaceAll("import.meta.env", "globalThis.__env")
    .replaceAll("export const ", "const ")
    .replaceAll("export function ", "function ")
    .concat("\nglobalThis.__result = { supabase, isSupabaseConfigured, getSupabaseRuntimeDiagnostics };\n");

  const context = {
    URL,
    __env: env,
    __createClient(url, anonKey) {
      createClientCalls += 1;
      if (failInitialization) throw new Error("initialization failed");
      return { url, anonKey };
    },
    console: { warn() {} },
  };
  context.globalThis = context;
  vm.runInNewContext(runnableSource, context, { filename: clientPath });
  return { ...context.__result, createClientCalls };
}

test("Supabase envありなら共有clientを初期化する", () => {
  const loaded = loadClient({
    VITE_SUPABASE_URL: "https://dhmkpqrfaukfbuoaenhk.supabase.co",
    VITE_SUPABASE_ANON_KEY: "test-anon-key",
  });

  assert.equal(loaded.createClientCalls, 1);
  assert.equal(loaded.isSupabaseConfigured(), true);
  assert.equal(loaded.getSupabaseRuntimeDiagnostics().clientInitialized, true);
  assert.equal(loaded.getSupabaseRuntimeDiagnostics().stagingProject, true);
});

for (const [name, env] of [
  ["envなし", {}],
  ["URLのみ不足", { VITE_SUPABASE_ANON_KEY: "test-anon-key" }],
  ["anon keyのみ不足", { VITE_SUPABASE_URL: "https://dhmkpqrfaukfbuoaenhk.supabase.co" }],
]) {
  test(`${name}ならfallbackにする`, () => {
    const loaded = loadClient(env);
    assert.equal(loaded.createClientCalls, 0);
    assert.equal(loaded.supabase, null);
    assert.equal(loaded.isSupabaseConfigured(), false);
  });
}

test("envがあってもclient生成失敗ならfallbackにする", () => {
  const loaded = loadClient({
    VITE_SUPABASE_URL: "https://dhmkpqrfaukfbuoaenhk.supabase.co",
    VITE_SUPABASE_ANON_KEY: "test-anon-key",
  }, { failInitialization: true });

  assert.equal(loaded.createClientCalls, 1);
  assert.equal(loaded.supabase, null);
  assert.equal(loaded.isSupabaseConfigured(), false);
});

test("Parentはimport.meta.envを使う共有ES module clientだけを参照する", () => {
  const parentSource = fs.readFileSync(path.join(root, "parent", "parent.js"), "utf8");
  const apiClientSource = fs.readFileSync(path.join(root, "src", "services", "api", "apiClient.js"), "utf8");
  const clientPathSources = [parentSource, apiClientSource, clientSource].join("\n");

  assert.match(parentSource, /from "\.\.\/src\/lib\/supabaseClient\.js"/);
  assert.doesNotMatch(parentSource, /createClient\s*\(/);
  assert.match(apiClientSource, /from "\.\.\/\.\.\/lib\/supabaseClient\.js"/);
  assert.match(clientSource, /import\.meta\.env\.VITE_SUPABASE_URL/);
  assert.match(clientSource, /import\.meta\.env\.VITE_SUPABASE_ANON_KEY/);
  assert.doesNotMatch(clientPathSources, /\brequire\s*\(/);
  assert.doesNotMatch(clientPathSources, /process\.env/);
});
