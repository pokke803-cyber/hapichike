import { isSupabaseConfigured } from "./lib/supabaseClient.js";
import { getParentSession } from "./services/api/authApi.js";
import { getCurrentHouseholds } from "./services/api/householdsApi.js";
import { getChildrenByHousehold } from "./services/api/childrenApi.js";
import { getChildBalances } from "./services/api/rewardsApi.js";

const migration = window.HapichikeProfileMigration;
const uiCore = window.HapichikeProfileMigrationUi;
const identity = window.HapichikeChildIdentity;
const importCore = window.HapichikeInitialImport;
const byId = id => document.getElementById(id);
const view = {
  status: byId("migrationStatus"),
  source: byId("migrationSourceSummary"),
  householdRow: byId("migrationHouseholdRow"),
  household: byId("migrationHouseholdSelect"),
  child: byId("migrationChildSelect"),
  preview: byId("migrationPreview"),
  comparison: byId("migrationCloudComparison"),
  mismatch: byId("migrationMismatchWarning"),
  backup: byId("migrationBackupStatus"),
  approvals: byId("migrationApprovals"),
  approveOwner: byId("approveMigrationOwner"),
  approveBackup: byId("approveMigrationBackup"),
  approvePreview: byId("approveMigrationPreview"),
  approveCloud: byId("approveMigrationCloud"),
  apply: byId("executeProfileMigrationBtn"),
  message: byId("migrationApplyMessage"),
  legacyNotice: byId("migrationLegacyNotice"),
};

const state = {
  source: null,
  preview: null,
  households: [],
  householdId: null,
  children: [],
  cloudBalance: null,
  sourceValid: false,
  selectedChildValid: false,
  backupCurrent: false,
  applying: false,
  completed: false,
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}

function setStatus(message, success = false) {
  view.status.textContent = message;
  view.status.className = `edit-error${success ? " pay-message success" : ""}`;
}

function setMessage(message, success = false) {
  view.message.textContent = message;
  view.message.className = `edit-error${success ? " pay-message success" : ""}`;
}

function selectedChild() {
  return state.children.find(child => child.id === view.child.value) || null;
}

function resetApprovals() {
  [view.approveOwner, view.approveBackup, view.approvePreview, view.approveCloud].forEach(input => { input.checked = false; });
}

function approvalState() {
  return {
    owner: view.approveOwner.checked,
    backup: view.approveBackup.checked,
    preview: view.approvePreview.checked,
    cloudUnchanged: view.approveCloud.checked,
  };
}

function updateBackupGate() {
  let metadata = null;
  try { metadata = importCore.readBackupMetadata(localStorage); } catch { metadata = null; }
  state.backupCurrent = Boolean(metadata && state.source && importCore.isBackupCurrent(metadata, uiCore.backupBalances(state.source.balances)));
  view.backup.textContent = state.backupCurrent
    ? `最新バックアップを確認済み（${new Date(metadata.backup_created_at).toLocaleString("ja-JP")}）`
    : metadata
      ? "バックアップ後に6残高が変わっています。データ管理から再作成してください。"
      : "データ管理からバックアップを書き出すまで移行できません。";
}

function updateApplyState() {
  const enabled = uiCore.canApply({
    sourceValid: state.sourceValid,
    selectedChildValid: state.selectedChildValid,
    previewCanApply: state.preview?.canApply === true,
    backupCurrent: state.backupCurrent,
    approvals: approvalState(),
    applying: state.applying,
    completed: state.completed,
  });
  view.approvals.disabled = !state.preview || !state.preview.canApply || !state.backupCurrent || state.applying || state.completed;
  view.apply.disabled = !enabled;
  view.apply.textContent = state.applying ? "移行中..." : "この子どものデータとして移行する";
}

function renderSource() {
  if (!state.source) return;
  const values = [
    ["現在の名前", state.source.sourceChildName || "未設定"],
    ...uiCore.BALANCE_FIELDS.map(field => [field.label, state.source.balances[field.key]]),
    ["今日タスク件数", state.source.todayTasks.count],
    ["履歴件数", state.source.historyCount],
  ];
  view.source.innerHTML = values.map(([label, value]) => `<div class="migration-summary-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
}

function renderPreview() {
  if (!state.preview) {
    view.preview.classList.add("hidden");
    return;
  }
  const preview = state.preview;
  view.preview.innerHTML = `
    <div class="backup-preview-summary"><strong>移行プレビュー</strong><br>元の名前：${escapeHtml(preview.sourceChildName)}<br>移行先Child：${escapeHtml(preview.targetDisplayName)}<br>新しいlocal profileをUUID v4で1件作成します。</div>
    <div class="migration-summary-grid">
      ${uiCore.BALANCE_FIELDS.map(field => `<div class="migration-summary-item"><span>${field.label}</span><strong>${escapeHtml(preview.balances[field.key])}</strong></div>`).join("")}
      <div class="migration-summary-item"><span>tasks</span><strong>${preview.taskAssignments}</strong></div>
      <div class="migration-summary-item"><span>completion</span><strong>完了 ${preview.todayTasks.completed} / 未完了 ${preview.todayTasks.pending}</strong></div>
      <div class="migration-summary-item"><span>history</span><strong>${preview.historyCount}</strong></div>
      <div class="migration-summary-item"><span>progress / badge</span><strong>${preview.progress.badgeCount}</strong></div>
      <div class="migration-summary-item"><span>reset</span><strong>${escapeHtml(preview.resetState.lastDailyResetKey || "未設定")} / 6時</strong></div>
      <div class="migration-summary-item"><span>household shared</span><strong>task ${preview.householdShared.taskMasterCount}件</strong></div>
      <div class="migration-summary-item"><span>legacyExtras</span><strong>profile ${preview.legacyExtras.profileCount} / household ${preview.legacyExtras.householdCount}</strong></div>
      <div class="migration-summary-item"><span>excluded secret</span><strong>${preview.excludedSecretFields.length}件</strong></div>
      <div class="migration-summary-item"><span>conflict</span><strong>${preview.conflicts.length}件</strong></div>
    </div>
    ${preview.legacyExtras.undecided.length ? `<div class="migration-warning">分類が必要な旧データがあります：${escapeHtml(preview.legacyExtras.undecided.join(", "))}</div>` : ""}
    ${preview.conflicts.length ? '<div class="migration-warning">現在のデータ構造に競合があります。移行前に確認が必要です。</div>' : ""}
    ${preview.duplicateMigration ? '<div class="migration-warning">この端末データは移行済みです。重複移行はできません。</div>' : ""}
  `;
  view.preview.classList.remove("hidden");
}

function renderComparison() {
  if (!state.preview || !state.selectedChildValid) {
    view.comparison.classList.add("hidden");
    view.mismatch.classList.add("hidden");
    return;
  }
  const rows = uiCore.compareBalances(state.preview.balances, state.cloudBalance);
  const mismatch = rows.some(row => !row.matches);
  view.comparison.innerHTML = `
    <div class="cloud-compare-row cloud-compare-head"><span>項目</span><span>Local legacy</span><span>Cloud current</span><span>状態</span></div>
    ${rows.map(row => `<div class="cloud-compare-row ${row.matches ? "" : "cloud-greater"}"><span>${row.label}</span><span>${escapeHtml(row.local)}</span><span>${Number.isFinite(row.cloud) ? escapeHtml(row.cloud) : "未取得"}</span><span>${row.matches ? "一致" : "不一致"}</span></div>`).join("")}
    <p class="parent-note">比較は読取専用です。ローカル・クラウドのどちらも自動修正しません。</p>
  `;
  view.comparison.classList.remove("hidden");
  view.mismatch.classList.toggle("hidden", !mismatch);
}

function renderHouseholds() {
  view.household.replaceChildren(...state.households.map(household => {
    const option = document.createElement("option");
    option.value = household.id;
    option.textContent = household.name;
    return option;
  }));
  view.household.value = state.householdId || "";
  view.householdRow.classList.toggle("hidden", state.households.length < 2);
}

function renderChildren() {
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "明示的に選択してください";
  view.child.replaceChildren(placeholder, ...state.children.map(child => {
    const option = document.createElement("option");
    option.value = child.id;
    option.textContent = child.nickname ? `${child.name}（${child.nickname}）` : child.name;
    return option;
  }));
  view.child.value = "";
  view.child.disabled = !state.children.length || !state.sourceValid || state.completed;
}

async function loadChildren() {
  state.children = await getChildrenByHousehold(state.householdId);
  renderChildren();
  if (!state.children.length) setStatus("このHouseholdに選択できるCloud Childがありません。");
}

async function selectChild() {
  state.preview = null;
  state.cloudBalance = null;
  state.selectedChildValid = false;
  resetApprovals();
  setMessage("");
  const child = selectedChild();
  if (!child) {
    renderPreview();
    renderComparison();
    updateApplyState();
    return;
  }
  const targetDisplayName = String(child.name || "").trim();
  try {
    state.preview = migration.previewLegacyMigration(localStorage, { targetDisplayName });
    state.selectedChildValid = true;
    renderPreview();
    updateBackupGate();
    setStatus("移行プレビューを作成しました。クラウド残高を読取中です。", true);
    try {
      state.cloudBalance = await getChildBalances(child.id);
      setStatus("移行プレビューとクラウド残高を読取専用で確認しました。", true);
    } catch {
      state.cloudBalance = null;
      setStatus("移行プレビューを作成しました。クラウド残高は取得できないため未取得と表示します。");
    }
    renderComparison();
  } catch (error) {
    state.preview = null;
    state.selectedChildValid = false;
    renderPreview();
    renderComparison();
    setMessage(uiCore.safeError(error));
  }
  updateApplyState();
}

async function openPanel() {
  Object.assign(state, {
    source: null, preview: null, households: [], householdId: null, children: [], cloudBalance: null,
    sourceValid: false, selectedChildValid: false, backupCurrent: false, applying: false, completed: false,
  });
  resetApprovals();
  view.source.innerHTML = '<p class="parent-note">確認中です。</p>';
  view.child.innerHTML = '<option value="">明示的に選択してください</option>';
  view.child.disabled = true;
  view.householdRow.classList.add("hidden");
  view.preview.classList.add("hidden");
  view.comparison.classList.add("hidden");
  view.mismatch.classList.add("hidden");
  view.legacyNotice.classList.add("hidden");
  setMessage("");
  setStatus("移行対象を確認しています。");
  try {
    state.source = migration.inspectLegacyMigration(localStorage);
    state.sourceValid = true;
    renderSource();
    updateBackupGate();
    if (state.source.migrated) {
      state.completed = true;
      setStatus("移行済みです。", true);
      view.legacyNotice.classList.remove("hidden");
      updateApplyState();
      return;
    }
  } catch (error) {
    state.sourceValid = false;
    const noSource = localStorage.getItem(migration.V1_KEY) === null;
    setStatus(noSource ? "移行対象データはありません。" : uiCore.safeError(error));
    updateBackupGate();
    updateApplyState();
    return;
  }
  if (!isSupabaseConfigured()) {
    setStatus("移行対象データはありますが、Cloud Child一覧を取得するためのSupabase設定がありません。");
    updateApplyState();
    return;
  }
  try {
    const { session } = await getParentSession();
    if (!session?.user) {
      setStatus("移行対象データはあります。親ダッシュボードでログインするとChildを選択できます。");
      updateApplyState();
      return;
    }
    state.households = await getCurrentHouseholds(session.user.id);
    if (!state.households.length) {
      setStatus("ログイン中ですが、所属Householdがありません。");
      updateApplyState();
      return;
    }
    state.householdId = state.households[0].id;
    renderHouseholds();
    await loadChildren();
    if (state.children.length) setStatus("移行対象データがあります。所有者のChildを明示的に選択してください。", true);
  } catch {
    setStatus("Cloud Child一覧を取得できませんでした。ローカルデータは変更していません。");
  }
  updateApplyState();
}

function verifySuccess(result, before) {
  const root = identity.parseStore(localStorage.getItem(migration.V2_KEY));
  const record = root.identityMigrations?.find(item => item.sourceHash === result.sourceHash);
  if (!root.profiles[result.localChildKey]) throw new Error("readback profile missing");
  if (root.activeLocalChildKey !== result.localChildKey) throw new Error("readback active key mismatch");
  if (!record || record.targetLocalChildKey !== result.localChildKey) throw new Error("readback migration metadata missing");
  if (localStorage.getItem(migration.V1_KEY) !== before.v1) throw new Error("legacy v1 changed during migration");
  if (localStorage.getItem(migration.CLOUD_MAPPING_V1_KEY) !== before.mapping) throw new Error("cloudMapping v1 changed during migration");
  const safetyRaw = localStorage.getItem(migration.SAFETY_KEY);
  if (!safetyRaw || JSON.parse(safetyRaw).sourceHash !== result.sourceHash) throw new Error("migration safety copy readback failed");
}

async function executeMigration() {
  if (state.applying || state.completed) return;
  updateBackupGate();
  updateApplyState();
  if (view.apply.disabled) {
    setMessage(state.backupCurrent ? "4つの確認項目をすべて確認してください。" : "最新バックアップが必要です。");
    return;
  }
  state.applying = true;
  updateApplyState();
  setMessage("移行中...");
  const child = selectedChild();
  try {
    const { session } = await getParentSession();
    if (!session?.user) throw new Error("selected Child invalid");
    const households = await getCurrentHouseholds(session.user.id);
    if (!households.some(item => item.id === state.householdId)) throw new Error("selected Child invalid");
    const children = await getChildrenByHousehold(state.householdId);
    if (!children.some(item => item.id === child?.id)) throw new Error("selected Child invalid");
    const currentPreview = migration.previewLegacyMigration(localStorage, { targetDisplayName: state.preview.targetDisplayName });
    if (currentPreview.previewToken !== state.preview.previewToken) throw new Error("source state changed");
    updateBackupGate();
    if (!state.backupCurrent) throw new Error("backup missing");
    const before = {
      v1: localStorage.getItem(migration.V1_KEY),
      mapping: localStorage.getItem(migration.CLOUD_MAPPING_V1_KEY),
    };
    const result = migration.applyLegacyMigration(localStorage, {
      targetDisplayName: state.preview.targetDisplayName,
      previewToken: state.preview.previewToken,
    });
    verifySuccess(result, before);
    state.completed = true;
    setStatus("移行済みです。", true);
    setMessage("子どもデータの移行が完了しました。", true);
    view.legacyNotice.classList.remove("hidden");
    view.child.disabled = true;
  } catch (error) {
    setMessage(/selected child invalid/i.test(String(error?.message)) ? "選択したChildを現在のHouseholdで確認できませんでした。" : uiCore.safeError(error));
  } finally {
    state.applying = false;
    updateApplyState();
  }
}

view.household?.addEventListener("change", async () => {
  state.householdId = view.household.value;
  state.preview = null;
  state.selectedChildValid = false;
  resetApprovals();
  renderPreview();
  renderComparison();
  try { await loadChildren(); } catch { setStatus("Cloud Child一覧を取得できませんでした。"); }
  updateApplyState();
});
view.child?.addEventListener("change", selectChild);
[view.approveOwner, view.approveBackup, view.approvePreview, view.approveCloud].forEach(input => input?.addEventListener("change", updateApplyState));
view.apply?.addEventListener("click", executeMigration);
window.addEventListener("hapichike:backup-created", () => { updateBackupGate(); updateApplyState(); });
window.addEventListener("hapichike:open-profile-migration", openPanel);
