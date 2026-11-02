import { isSupabaseConfigured } from "./lib/supabaseClient.js";
import { getParentSession } from "./services/api/authApi.js";
import { getCurrentHouseholds } from "./services/api/householdsApi.js";
import { getChildrenByHousehold } from "./services/api/childrenApi.js";
import { loadCloudChildCandidates } from "./services/cloud-child-candidates.js";
import { getChildBalances, getChildAppSyncState, importInitialHapichikeSnapshot } from "./services/api/rewardsApi.js";
import { getRewardLogs } from "./services/api/historyApi.js";

const mappingCore = window.HapichikeCloudMapping;
const importCore = window.HapichikeInitialImport;
const byId = id => document.getElementById(id);
const view = {
  status: byId("cloudMappingStatus"),
  householdRow: byId("cloudHouseholdRow"),
  household: byId("cloudHouseholdSelect"),
  local: byId("cloudLocalChild"),
  child: byId("cloudChildSelect"),
  save: byId("saveCloudMappingBtn"),
  comparison: byId("cloudBalanceComparison"),
  readiness: byId("cloudImportReadiness"),
  readinessList: byId("cloudImportReadinessList"),
  importReason: byId("cloudImportReason"),
  backupStatus: byId("cloudBackupStatus"),
  preview: byId("cloudSnapshotPreview"),
  approvals: byId("cloudImportApprovals"),
  approveBackup: byId("approveCloudBackup"),
  approveMapping: byId("approveCloudMapping"),
  approveSnapshot: byId("approveCloudSnapshot"),
  approveOneTime: byId("approveCloudOneTime"),
  importButton: byId("executeInitialImportBtn"),
  importMessage: byId("cloudImportMessage"),
};

const state = {
  localChild: null,
  households: [],
  householdId: null,
  children: [],
  mappingDocument: null,
  loggedIn: false,
  cloudBalance: null,
  syncState: undefined,
  rewardLogs: null,
  cloudBalanceLoaded: false,
  syncStateLoaded: false,
  rewardLogsLoaded: false,
  importing: false,
  retryAvailable: false,
  rpcRejected: false,
  session: null,
  localReadState: "checking",
  cloudChildrenReadState: "not-run",
};

const readinessLabels = {
  loggedIn: "Supabaseログイン済み",
  household: "household確認済み",
  localChild: "local child検出済み",
  mapping: "保存済みmapping有効",
  backup: "バックアップ済み",
  backupCurrent: "バックアップと現在の6残高が一致",
  localSnapshot: "local snapshot valid",
  cloudBalance: "cloud balance取得済み",
  syncState: "sync state / 履歴取得済み",
  cloudUninitialized: "Cloud未初期化",
  authorizedRole: "parent / owner role",
  importNotComplete: "import未完了",
};

function text(value) {
  return String(value ?? "");
}

function setStatus(message, kind = "") {
  view.status.textContent = message;
  view.status.className = `edit-error${kind ? ` pay-message ${kind}` : ""}`;
}

function setImportMessage(message, kind = "") {
  view.importMessage.textContent = message;
  view.importMessage.className = `edit-error${kind ? ` pay-message ${kind}` : ""}`;
}

function resetApprovals() {
  [view.approveBackup, view.approveMapping, view.approveSnapshot, view.approveOneTime].forEach(input => { input.checked = false; });
}

function resetCloudReadState() {
  state.cloudBalance = null;
  state.syncState = undefined;
  state.rewardLogs = null;
  state.cloudBalanceLoaded = false;
  state.syncStateLoaded = false;
  state.rewardLogsLoaded = false;
  state.retryAvailable = false;
  state.rpcRejected = false;
  setImportMessage("");
  resetApprovals();
}

function resetComparison(message = "対応するクラウドChildを選んでください。") {
  view.comparison.innerHTML = `<p class="parent-note">${text(message)}</p>`;
  resetCloudReadState();
  renderImportPanel();
}

function renderHouseholds() {
  view.household.replaceChildren(...state.households.map(household => {
    const option = document.createElement("option");
    option.value = household.id;
    option.textContent = household.name;
    return option;
  }));
  view.household.value = state.householdId ?? "";
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
  const verified = state.localChild && state.mappingDocument
    ? mappingCore.findVerifiedMapping(state.mappingDocument, state.localChild.localChildKey, state.householdId, state.children)
    : null;
  view.child.value = verified?.supabaseChildId ?? "";
  view.save.disabled = !state.children.length || !state.localChild;
}

function differenceLabel(row) {
  if (row.difference === null) return "欠損";
  if (row.difference === 0) return "±0";
  return `${row.difference > 0 ? "+" : ""}${row.difference}`;
}

function getVerifiedMapping() {
  if (!state.localChild || !state.mappingDocument || !state.householdId) return null;
  const mapping = mappingCore.findVerifiedMapping(
    state.mappingDocument,
    state.localChild.localChildKey,
    state.householdId,
    state.children,
  );
  return mapping?.supabaseChildId === view.child.value ? mapping : null;
}

function readinessInput() {
  const household = state.households.find(item => item.id === state.householdId);
  let backup = null;
  try { backup = importCore.readBackupMetadata(localStorage); } catch { backup = null; }
  return {
    loggedIn: state.loggedIn,
    household: Boolean(household),
    localChild: Boolean(state.localChild),
    mapping: Boolean(getVerifiedMapping()),
    backup: Boolean(backup),
    backupCurrent: Boolean(backup && state.localChild && importCore.isBackupCurrent(backup, state.localChild.balances)),
    localSnapshot: Boolean(state.localChild),
    cloudBalanceLoaded: state.cloudBalanceLoaded,
    cloudBalance: state.cloudBalance,
    syncStateLoaded: state.syncStateLoaded,
    syncState: state.syncState ?? null,
    rewardLogsLoaded: state.rewardLogsLoaded,
    rewardLogCount: state.rewardLogs?.length,
    role: household?.membership_role,
    backupMetadata: backup,
  };
}

function renderSnapshotPreview() {
  if (!state.localChild) {
    view.preview.innerHTML = '<p class="parent-note">有効なlocal snapshotがありません。</p>';
    return;
  }
  view.preview.innerHTML = `
    ${mappingCore.BALANCE_FIELDS.map(field => `
      <div class="cloud-snapshot-row"><span>${field.label}</span><span>Local snapshot: <strong>${state.localChild.balances[field.key]}</strong></span><span>Cloud: <strong>${state.cloudBalanceLoaded ? (state.cloudBalance?.[field.key] ?? "欠損") : "未取得"}</strong></span></div>
    `).join("")}
    <p class="parent-note">初回登録は「Local − Cloud」の差分加算ではなく、表示中のLocal snapshotをクラウド残高の絶対値として設定します。</p>
  `;
}

function renderImportPanel() {
  const input = readinessInput();
  const result = importCore.evaluateReadiness(input);
  const approvalState = {
    backup: view.approveBackup.checked,
    mapping: view.approveMapping.checked,
    snapshot: view.approveSnapshot.checked,
    oneTime: view.approveOneTime.checked,
  };
  view.readiness.textContent = result.ready ? "Ready" : result.cloudInitialized ? "Cloud already initialized" : "Not ready";
  view.readinessList.replaceChildren(...Object.entries(result.checks).map(([key, passed]) => {
    const item = document.createElement("li");
    const waiting = !passed && ((key === "cloudBalance" && !input.cloudBalanceLoaded)
      || (key === "syncState" && (!input.syncStateLoaded || !input.rewardLogsLoaded))
      || (key === "cloudUninitialized" && (!input.cloudBalanceLoaded || !input.syncStateLoaded || !input.rewardLogsLoaded)));
    item.className = passed ? "pass" : "fail";
    item.textContent = `${passed ? "PASS" : waiting ? "要確認" : "実行不可"}：${readinessLabels[key]}`;
    return item;
  }));
  view.backupStatus.textContent = input.backupMetadata
    ? `${input.backupCurrent ? "バックアップ済み" : "バックアップが現在の6残高より古いため再作成が必要です"}（${new Date(input.backupMetadata.backup_created_at).toLocaleString("ja-JP")}）`
    : "バックアップが必要です";
  if (result.importComplete) {
    view.importReason.textContent = "このChildの初回データ登録は完了済みです。再importはできません。";
  } else if (result.cloudInitialized) {
    view.importReason.textContent = "このChildはすでにクラウド側で初期化されています。既存残高や履歴を0へ戻さず、初回importは実行しません。";
  } else if (!result.checks.mapping) {
    view.importReason.textContent = "対応する子どものmappingを保存して確認してください。";
  } else if (!result.checks.authorizedRole && input.household) {
    view.importReason.textContent = "viewerには初回import権限がありません。parentまたはownerで確認してください。";
  } else if (!result.checks.backup) {
    view.importReason.textContent = "データ管理から最新バックアップを書き出してください。";
  } else if (!result.checks.backupCurrent) {
    view.importReason.textContent = "バックアップ後に6残高が変わっています。データ管理からもう一度バックアップを書き出してください。";
  } else {
    view.importReason.textContent = result.ready ? "全条件を確認しました。4項目を明示承認すると実行できます。" : "未確認の条件があるため実行できません。";
  }
  view.approvals.disabled = !result.ready || state.importing || result.importComplete;
  view.importButton.disabled = !importCore.canExecuteImport(result, approvalState, state.importing) || state.rpcRejected;
  view.importButton.textContent = state.importing
    ? "初回登録中..."
    : state.retryAvailable
      ? "同じ内容で再試行"
      : "このデータを初回クラウド登録する";
  renderSnapshotPreview();
}

async function renderComparison() {
  const childId = view.child.value;
  if (!childId) {
    resetComparison();
    return;
  }
  resetComparison("クラウド情報を読み込んでいます…");
  try {
    const visibleChildren = await getChildrenByHousehold(state.householdId);
    const child = visibleChildren.find(item => item.id === childId);
    if (!child) throw new Error("選択したChildは現在の家庭で確認できません。対応付けを保存・使用しません。");
    state.children = visibleChildren;
    const [cloudBalance, syncState, rewardLogs] = await Promise.all([
      getChildBalances(childId),
      getChildAppSyncState(childId),
      getRewardLogs(childId),
    ]);
    state.cloudBalance = cloudBalance;
    state.syncState = syncState;
    state.rewardLogs = rewardLogs ?? [];
    state.cloudBalanceLoaded = true;
    state.syncStateLoaded = true;
    state.rewardLogsLoaded = true;
    const rows = mappingCore.compareBalances(state.localChild, cloudBalance);
    view.comparison.innerHTML = `
      <div class="cloud-compare-row cloud-compare-head"><span>項目</span><span>Local</span><span>Cloud</span><span>差分</span></div>
      ${rows.map(row => `<div class="cloud-compare-row ${row.status}"><span>${text(row.label)}</span><span>${row.local}</span><span>${row.cloud ?? "欠損"}</span><span>${differenceLabel(row)}</span></div>`).join("")}
      <p class="parent-note">差分は比較表示だけです。この画面を開いただけでは送信・上書きしません。</p>
    `;
    renderImportPanel();
    setStatus(`接続中 / Parent login済み / household: ${state.households.find(item => item.id === state.householdId)?.name ?? "確認済み"}`, "success");
  } catch (error) {
    resetComparison("クラウド情報を確認できませんでした。");
    setStatus(error?.message || "ネットワークエラーが発生しました。");
  }
}

async function loadChildren() {
  state.cloudChildrenReadState = "loading";
  const result = await loadCloudChildCandidates({ session: state.session, householdId: state.householdId });
  state.households = result.households;
  state.householdId = result.householdId;
  state.children = result.children;
  state.cloudChildrenReadState = result.childrenState;
  renderChildren();
  renderImportPanel();
  if (!state.children.length) {
    resetComparison("この家庭にクラウドChildがありません。");
    setStatus("接続済みですが、この家庭にchildrenがありません。");
    return;
  }
  await renderComparison();
}

async function openPanel() {
  state.households = [];
  state.householdId = null;
  state.children = [];
  state.loggedIn = false;
  state.session = null;
  state.localReadState = "checking";
  state.cloudChildrenReadState = "not-run";
  state.mappingDocument = mappingCore.parseMappingDocument(null);
  view.householdRow.classList.add("hidden");
  view.child.innerHTML = '<option value="">明示的に選択してください</option>';
  view.save.disabled = true;
  setStatus("接続状態を確認しています…");
  resetComparison();
  try {
    state.localChild = mappingCore.readLocalChild(localStorage);
    state.localReadState = "success";
    view.local.textContent = `${state.localChild.name}（単一ローカルプロフィール）`;
  } catch (error) {
    state.localChild = null;
    const missing = localStorage.getItem(mappingCore.MAIN_STORAGE_KEY) === null;
    state.localReadState = missing ? "missing" : "invalid";
    view.local.textContent = missing ? "未検出" : "読込エラー";
  }
  try { state.mappingDocument = mappingCore.readMapping(localStorage); } catch { state.mappingDocument = mappingCore.parseMappingDocument(null); }
  renderImportPanel();
  if (!isSupabaseConfigured()) {
    setStatus("Supabase未設定です。ローカルデータは変更していません。");
    return;
  }
  try {
    const result = await loadCloudChildCandidates();
    state.session = result.session;
    if (!result.session?.user) {
      setStatus("Parent未ログインです。親ダッシュボードでログインしてから戻ってください。");
      return;
    }
    state.loggedIn = true;
    state.households = result.households;
    if (!state.households.length) {
      setStatus("ログイン中ですが、所属householdがありません。");
      renderImportPanel();
      return;
    }
    const savedHouseholdId = state.localChild
      ? state.mappingDocument.mappings.find(item => item.localChildKey === state.localChild.localChildKey)?.householdId
      : null;
    state.householdId = state.households.some(item => item.id === savedHouseholdId) ? savedHouseholdId : result.householdId;
    state.children = state.householdId === result.householdId ? result.children : [];
    state.cloudChildrenReadState = result.childrenState;
    renderHouseholds();
    if (state.householdId !== result.householdId) await loadChildren();
    else {
      renderChildren();
      renderImportPanel();
      if (!state.children.length) resetComparison("この家庭にクラウドChildがありません。");
      else await renderComparison();
    }
    setStatus(state.children.length
      ? state.localReadState === "success"
        ? `接続中 / Parent login済み / household: ${state.households.find(item => item.id === state.householdId)?.name ?? "確認済み"}`
        : `Cloud Child候補を取得しました。Local childは${state.localReadState === "missing" ? "未検出" : "読込エラー"}です。`
      : "接続済みですが、この家庭にchildrenがありません。",
    state.children.length && state.localReadState === "success" ? "success" : "");
  } catch (error) {
    state.cloudChildrenReadState = "error";
    setStatus(error?.stage === "children" ? "Cloud Child取得エラー。" : error?.message || "Supabaseへの接続に失敗しました。");
    renderImportPanel();
  }
}

function safeImportError(error) {
  const message = String(error?.message || "").toLowerCase();
  if (/fetch|network|offline|timeout|connection/.test(message)) return { retryable: true, text: "network error：通信を確認して再試行してください。同じimport_idとpayloadを再利用します。" };
  if (/session.*expired|jwt.*expired|refresh token/.test(message)) return { retryable: false, text: "session expired：親ダッシュボードで再ログインしてください。" };
  if (/mapping/.test(message)) return { retryable: false, text: "mapping invalid：現在のhouseholdとChildの対応付けを保存し直してください。" };
  if (/not authorized|permission|row-level security|jwt/.test(message)) return { retryable: false, text: "not authorized：parentまたはownerの権限を確認してください。" };
  if (/already initialized|already complete|already imported/.test(message)) return { retryable: false, text: "Cloud already initialized：このChildはすでにクラウド側で初期化されています。" };
  if (/hash/.test(message)) return { retryable: false, text: "hash mismatch：snapshotを再確認し、新しいバックアップを作成してください。" };
  if (/different payload|payload|snapshot was already/.test(message)) return { retryable: false, text: "payload mismatch：同じimport_idへ異なるsnapshotは送信できません。" };
  if (/snapshot|six.*balance|integer|negative/.test(message)) return { retryable: false, text: "invalid snapshot：6残高の内容を確認してください。" };
  if (/backup/.test(message)) return { retryable: false, text: "backup missing：バックアップを作成してから再確認してください。" };
  return { retryable: false, text: "初回データ登録に失敗しました。状態を再確認してください。" };
}

async function refreshImportPreflight() {
  const { session } = await getParentSession();
  if (!session?.user) throw new Error("session expired");
  state.localChild = mappingCore.readLocalChild(localStorage);
  state.mappingDocument = mappingCore.readMapping(localStorage);
  const households = await getCurrentHouseholds(session.user.id);
  const household = households.find(item => item.id === state.householdId);
  if (!household) throw new Error("mapping invalid: household changed");
  const children = await getChildrenByHousehold(state.householdId);
  const mapping = mappingCore.findVerifiedMapping(
    state.mappingDocument,
    state.localChild.localChildKey,
    state.householdId,
    children,
  );
  if (!mapping || mapping.supabaseChildId !== view.child.value) throw new Error("mapping invalid: child changed");
  state.households = households;
  state.children = children;
  const [cloudBalance, syncState, rewardLogs] = await Promise.all([
    getChildBalances(mapping.supabaseChildId),
    getChildAppSyncState(mapping.supabaseChildId),
    getRewardLogs(mapping.supabaseChildId),
  ]);
  state.cloudBalance = cloudBalance;
  state.syncState = syncState;
  state.rewardLogs = rewardLogs ?? [];
  state.cloudBalanceLoaded = true;
  state.syncStateLoaded = true;
  state.rewardLogsLoaded = true;
}

async function executeInitialImport() {
  if (state.importing) return;
  const input = readinessInput();
  const readiness = importCore.evaluateReadiness(input);
  const approvalState = {
    backup: view.approveBackup.checked,
    mapping: view.approveMapping.checked,
    snapshot: view.approveSnapshot.checked,
    oneTime: view.approveOneTime.checked,
  };
  if (!importCore.canExecuteImport(readiness, approvalState, state.importing)) {
    setImportMessage("readiness条件と4つの確認項目をすべて確認してください。");
    return;
  }
  state.importing = true;
  state.rpcRejected = false;
  renderImportPanel();
  setImportMessage("初回登録中...");
  try {
    await refreshImportPreflight();
    const currentInput = readinessInput();
    const currentReadiness = importCore.evaluateReadiness(currentInput);
    if (!currentReadiness.ready || !importCore.approvalsComplete(approvalState)) {
      throw new Error(currentReadiness.cloudInitialized ? "already initialized" : "mapping or readiness invalid");
    }
    const previewInput = {
      childId: view.child.value,
      balances: state.localChild.balances,
      backupCreatedAt: currentInput.backupMetadata.backup_created_at,
      parentApproved: true,
      title: "初回データ移行",
      metadata: { source_ui: "parent_cloud_mapping" },
    };
    const pending = importCore.readPendingPreview(localStorage);
    const preview = pending && await importCore.matchesPreview(pending, previewInput)
      ? pending
      : await importCore.createInitialImportPreview(previewInput);
    if (preview !== pending) importCore.savePendingPreview(localStorage, preview);
    await importInitialHapichikeSnapshot(preview);
    importCore.clearPendingPreview(localStorage);
    state.retryAvailable = false;
    setImportMessage("初回データ登録が完了しました。", "success");
    await renderComparison();
    setImportMessage("初回データ登録が完了しました。", "success");
  } catch (error) {
    const safeError = safeImportError(error);
    state.retryAvailable = safeError.retryable;
    state.rpcRejected = !safeError.retryable;
    const hasPendingPayload = Boolean(importCore.readPendingPreview(localStorage));
    if (!safeError.retryable) importCore.clearPendingPreview(localStorage);
    setImportMessage(safeError.retryable && !hasPendingPayload
      ? "network error：通信を確認して再試行してください。RPCはまだ実行されていません。"
      : safeError.text);
  } finally {
    state.importing = false;
    renderImportPanel();
  }
}

view.household?.addEventListener("change", async () => {
  state.householdId = view.household.value;
  resetComparison();
  try { await loadChildren(); } catch (error) { setStatus(error?.message || "childrenを取得できませんでした。"); }
});

view.child?.addEventListener("change", renderComparison);
view.save?.addEventListener("click", async () => {
  if (!view.child.value) {
    setStatus("対応するクラウドChildを選んでください。");
    return;
  }
  try {
    const visibleChildren = await getChildrenByHousehold(state.householdId);
    if (!visibleChildren.some(child => child.id === view.child.value)) {
      throw new Error("選択したChildは現在の家庭で確認できないため保存しませんでした。");
    }
    state.mappingDocument = mappingCore.saveMapping(localStorage, {
      localChildKey: state.localChild.localChildKey,
      supabaseChildId: view.child.value,
      householdId: state.householdId,
    });
    setStatus("対応付けメタデータだけを端末に保存しました。残高は変更していません。", "success");
    await renderComparison();
  } catch (error) {
    setStatus(error?.message || "対応付けを保存できませんでした。");
  }
});

[view.approveBackup, view.approveMapping, view.approveSnapshot, view.approveOneTime].forEach(input => input?.addEventListener("change", renderImportPanel));
view.importButton?.addEventListener("click", executeInitialImport);
window.addEventListener("hapichike:backup-created", renderImportPanel);
window.addEventListener("hapichike:open-cloud-mapping", openPanel);
