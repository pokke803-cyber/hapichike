import { isSupabaseConfigured } from "../src/lib/supabaseClient.js";
import {
  getParentSession, onParentAuthStateChange, requestParentPasswordReset,
  signInParent, signOutParent,
} from "../src/services/api/authApi.js";
import { getCurrentHouseholds } from "../src/services/api/householdsApi.js";
import { createChild, getChildrenByHousehold } from "../src/services/api/childrenApi.js";
import { getChildAppSyncState, getChildBalances, importInitialHapichikeSnapshot } from "../src/services/api/rewardsApi.js";
import { getRecentRewardLogs } from "../src/services/api/historyApi.js";
import "../src/parent/parent-runtime-core.js";
import "../src/child-identity-core.js";
import "../src/backup-core.js";
import "../src/cloud-mapping-core.js";
import "../src/initial-import-core.js";
import "../src/profile-domain.js";
import "../src/profile-repository.js";
import "../src/profile-migration.js";
import "../src/parent/parent-runtime.js";
import "../src/parent/cloud-child-create-core.js";
import "../src/parent/cloud-management-core.js";
import "../src/parent/cloud-management-actions.js";

const elements = Object.fromEntries([
  "configView", "loginView", "loadingView", "dashboardView", "loginForm", "emailInput", "passwordInput",
  "loginButton", "loginError", "loginRetryButton", "logoutButton", "parentEmail", "showPasswordResetButton", "passwordResetPanel",
  "passwordResetForm", "resetEmailInput", "passwordResetMessage", "passwordResetButton", "showLoginButton",
  "dashboardError", "householdEmpty", "dashboardContent", "householdField", "householdSelect", "childTabs",
  "childrenEmpty", "childSelectionEmpty", "childContent", "selectedChildName", "balanceLoading", "balanceEmpty",
  "balanceGrid", "balanceUpdated", "choresList", "logsLoading", "logsList", "refreshRuntimeButton",
  "refreshChildButton", "authStatus", "connectionStatus", "householdStatus", "childrenStatus", "localV1Status", "localV2Status",
  "detailsStatus", "finalStatus", "localProfileStatus",
  "cloudManagement", "mappingSummary", "mappingDetails", "localIdentitySummary", "comparisonMessage", "comparisonBody",
  "importSummary", "importDetails", "backupSummary", "backupDetails", "diagnosticGrid", "migrationPreviewButton", "migrationPreviewResult",
  "cloudIdentityName", "localProfileSelect", "identityMappingState", "createBackupButton", "selectRestoreButton", "restoreFileInput",
  "profileCreationPreviewButton", "profileCreationPreviewResult", "profileCreationApproval", "profileCreationButton", "profileCreationMessage",
  "restorePreviewResult", "restoreApprovalLabel", "restoreApproval", "executeRestoreButton", "backupActionMessage",
  "migrationApprovals", "migrationApplyButton", "migrationActionMessage", "mappingPreviewMessage", "mappingPreviewButton",
  "mappingPreviewResult", "mappingApproval", "mappingSaveButton", "mappingActionMessage", "importPreviewButton", "importPreviewResult", "importApprovals",
  "importExecuteButton", "importActionMessage",
  "showChildCreateButton", "childCreateForm", "childNameInput", "childNicknameInput", "childPreviewButton",
  "cancelChildCreateButton", "childCreatePreview", "childPreviewHousehold", "childPreviewName", "childPreviewNickname",
  "createChildButton", "childCreateMessage",
  "homePanel", "dataPanel", "settingsPanel", "dataSelectionEmpty", "homeCloudStatus", "openChildAppLink",
  "localSourceMeta", "cloudSourceMeta", "settingsAccountEmail", "settingsHouseholdName", "settingsHouseholdRole",
].map(id => [id, document.getElementById(id)]));

const runtime = globalThis.HapichikeParentRuntime.createParentRuntime({
  authApi: { getParentSession, onParentAuthStateChange },
  householdsApi: { getCurrentHouseholds },
  childrenApi: { getChildrenByHousehold },
  rewardsApi: { getChildBalances, getChildAppSyncState },
  historyApi: { getRecentRewardLogs },
  storage: window.localStorage,
  parsers: {
    parseLegacy: globalThis.HapichikeBackup.parseMainState,
    parseV2: globalThis.HapichikeChildIdentity.parseStore,
  },
});
let migrationPreview = null;
let mappingPreview = null;
let initialImportPreview = null;
let pendingRestoreEnvelope = null;
let profileCreationPreview = null;
let selectedLocalChildKey = "";
let importing = false;
let mappingPreviewPhase = "idle";
let childCreatePreview = null;
let creatingChild = false;
let activeDashboardTab = "home";

function setActiveDashboardTab(tabName) {
  activeDashboardTab = ["home", "data", "settings"].includes(tabName) ? tabName : "home";
  document.querySelectorAll("[data-dashboard-tab]").forEach(button => {
    const selected = button.dataset.dashboardTab === activeDashboardTab;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  elements.homePanel.hidden = activeDashboardTab !== "home";
  elements.dataPanel.hidden = activeDashboardTab !== "data";
  elements.settingsPanel.hidden = activeDashboardTab !== "settings";
}

document.querySelectorAll("[data-dashboard-tab]").forEach(button => button.addEventListener("click", () => {
  setActiveDashboardTab(button.dataset.dashboardTab);
}));

function showOnly(view) {
  [elements.configView, elements.loginView, elements.loadingView, elements.dashboardView]
    .forEach(element => { element.hidden = element !== view; });
}

function showLoginMode(mode = "login") {
  const reset = mode === "password-reset";
  elements.loginForm.hidden = reset;
  elements.showPasswordResetButton.hidden = reset;
  elements.passwordResetPanel.hidden = !reset;
  if (!reset) {
    elements.passwordResetForm.reset();
    elements.passwordResetMessage.textContent = "";
    elements.passwordResetMessage.classList.remove("is-success");
  }
}

function friendlyError(error, fallback) {
  return error?.message?.toLowerCase().includes("invalid login credentials")
    ? "メールアドレスまたはパスワードを確認してください。" : fallback;
}

const errorMessages = {
  AUTH_LOAD_FAILED: "ログイン状態を確認できませんでした。",
  HOUSEHOLD_LOAD_FAILED: "所属家庭を読み込めませんでした。",
  CHILD_LOAD_FAILED: "子どものデータを読み込めませんでした。",
  CONNECTION_FAILED: "接続を確認して、もう一度更新してください。",
};

function setDashboardError(code = null) {
  elements.dashboardError.textContent = code ? (errorMessages[code] ?? "データを読み込めませんでした。") : "";
  elements.dashboardError.hidden = !code;
}

function statusLabel(status) {
  return ({ signed_in: "ログイン済み", signed_out: "未ログイン", loading: "確認中",
    ready: "成功", idle: "待機中", not_loaded: "対象なし", success: "成功", empty: "0件",
    missing: "なし", invalid: "無効", error: "エラー" })[status] ?? status;
}

function renderRuntimeStatus(state) {
  elements.authStatus.textContent = statusLabel(state.auth.status);
  elements.connectionStatus.textContent = statusLabel(state.connection.status);
  elements.householdStatus.textContent = statusLabel(state.households.status);
  elements.childrenStatus.textContent = statusLabel(state.cloudChildren.status);
  elements.localV1Status.textContent = statusLabel(state.local.legacyStatus);
  elements.localV2Status.textContent = statusLabel(state.local.v2Status);
  elements.detailsStatus.textContent = statusLabel(state.viewedChildData.status);
  elements.finalStatus.textContent = statusLabel(state.runtime.status);
  elements.localProfileStatus.textContent = `${state.local.profileCount ?? 0}件${state.local.activeLocalChildExists ? "・選択あり" : ""}`;
}

function valueLabel(value) { return value === null || value === undefined ? "--" : String(value); }

function selectedChild(state) {
  return state.cloudChildren.items.find(item => item.id === state.parentViewedSupabaseChildId) ?? null;
}

function selectedHousehold(state) {
  return state.households.items.find(item => item.id === state.selectedHouseholdId) ?? null;
}

function resetChildCreatePreview() {
  childCreatePreview = null;
  elements.childCreatePreview.hidden = true;
  elements.createChildButton.disabled = true;
}

function setChildCreateMessage(message, success = false) {
  elements.childCreateMessage.textContent = message;
  elements.childCreateMessage.classList.toggle("is-success", success);
}

function childCreateError(error) {
  return ({
    NAME_REQUIRED: "名前を入力してください。",
    NAME_TOO_LONG: "名前は12文字以内で入力してください。",
    HOUSEHOLD_REQUIRED: "対象家庭を選択してください。",
    HOUSEHOLD_CHANGED: "対象家庭が変更されました。もう一度previewしてください。",
    HOUSEHOLD_FORBIDDEN: "この家庭への追加権限を確認できませんでした。",
    ROLE_FORBIDDEN: "子どもを追加できるのはownerまたはparentだけです。",
    AUTH_REQUIRED: "ログイン状態を確認できませんでした。もう一度ログインしてください。",
  })[error?.code] ?? "子どもを追加できませんでした。接続を確認して一覧を更新してください。";
}

function localProfiles() {
  try { return globalThis.HapichikeParentCloudActions.readLocalProfiles(window.localStorage); }
  catch { return []; }
}

function resetActionPreviews() {
  mappingPreview = null;
  mappingPreviewPhase = "idle";
  initialImportPreview = null;
  elements.mappingApproval.checked = false;
  elements.mappingApproval.disabled = true;
  elements.importApprovals.querySelectorAll("input").forEach(input => { input.checked = false; });
  elements.importApprovals.disabled = true;
  elements.mappingPreviewMessage.textContent = "Local profileとCloud Childを選択してください。";
  elements.mappingPreviewResult.textContent = "previewはまだ実行されていません。";
  elements.importPreviewResult.textContent = "readinessとmappingを確認してください。";
}

function resetProfileCreationPreview() {
  profileCreationPreview = null;
  elements.profileCreationApproval.checked = false;
  elements.profileCreationApproval.disabled = true;
  elements.profileCreationButton.disabled = true;
  elements.profileCreationPreviewResult.textContent = "previewはまだ実行されていません。";
}

function selectedBackupCurrent() {
  try {
    const profile = globalThis.HapichikeParentCloudActions.requireProfile(window.localStorage, selectedLocalChildKey);
    const metadata = globalThis.HapichikeInitialImport.readBackupMetadata(window.localStorage);
    return Boolean(metadata && globalThis.HapichikeInitialImport.isBackupCurrent(metadata, profile.balances));
  } catch { return false; }
}

function renderActionButtons(model) {
  const migrationChecks = [...elements.migrationApprovals.querySelectorAll("input")];
  let legacyBackupCurrent = false;
  try {
    const legacy = globalThis.HapichikeParentCloudActions.requireProfile(window.localStorage, globalThis.HapichikeCloudMapping.LOCAL_CHILD_KEY);
    const metadata = globalThis.HapichikeInitialImport.readBackupMetadata(window.localStorage);
    legacyBackupCurrent = Boolean(metadata && globalThis.HapichikeInitialImport.isBackupCurrent(metadata, legacy.balances));
  } catch { /* unavailable */ }
  elements.migrationApprovals.disabled = !(migrationPreview?.canApply && legacyBackupCurrent);
  elements.migrationApplyButton.disabled = elements.migrationApprovals.disabled || !migrationChecks.every(input => input.checked);
  elements.mappingSaveButton.disabled = !mappingPreview || !elements.mappingApproval.checked;
  const approvals = Object.fromEntries([...elements.importApprovals.querySelectorAll("input")].map(input => [input.dataset.importApproval, input.checked]));
  elements.importExecuteButton.disabled = !globalThis.HapichikeParentCloudActions.canExecuteImport({
    readiness: model.initialImport.readiness, approvals, importing, preview: initialImportPreview,
    childId: model.selectedChild?.id, mappingValid: model.mapping.status === "valid" && model.mapping.viewedChildMatches,
  });
}

function renderCloudManagement(state) {
  elements.cloudManagement.hidden = !state.parentViewedSupabaseChildId;
  if (!state.parentViewedSupabaseChildId) return;
  const model = globalThis.HapichikeParentCloudManagement.inspect(window.localStorage, state);
  const map = model.mapping;
  const profiles = localProfiles();
  if (profileCreationPreview?.cloudChildId !== state.parentViewedSupabaseChildId) resetProfileCreationPreview();
  if (selectedLocalChildKey && !profiles.some(profile => profile.localChildKey === selectedLocalChildKey)) selectedLocalChildKey = "";
  if (!selectedLocalChildKey) selectedLocalChildKey = profiles.find(profile => profile.active)?.localChildKey
    ?? profiles.find(profile => profile.kind === "legacy")?.localChildKey ?? "";
  const profileOptions = [Object.assign(document.createElement("option"), { value: "", textContent: "Local profileを明示選択" })];
  profiles.forEach(profile => {
    const option = document.createElement("option");
    option.value = profile.localChildKey;
    option.textContent = `${profile.displayName}（${profile.kind} / ${profile.localChildKey}）`;
    option.selected = profile.localChildKey === selectedLocalChildKey;
    profileOptions.push(option);
  });
  elements.localProfileSelect.replaceChildren(...profileOptions);
  elements.cloudIdentityName.textContent = `${model.selectedChild?.displayName ?? "未選択"} / ${model.selectedChild?.id ?? "--"}`;
  elements.identityMappingState.textContent = map.viewedChildMatches ? `Connected: ${map.item.localChildKey}` : "Not connected";
  elements.localIdentitySummary.textContent = `Legacy v1: ${statusLabel(state.local.legacyStatus)} / v2: ${statusLabel(state.local.v2Status)} / v2 profile: ${state.local.profileCount}件 / active key: ${state.local.activeLocalChildExists ? "あり" : "なし"}`;
  elements.mappingSummary.textContent = `${({ valid: "mappingあり（valid）", stale: "mappingあり（stale）", missing: "mappingなし", invalid: "mapping invalid" })[map.status]} / ${map.version === 2 ? "v2" : "legacy v1 compatibility"}`;
  elements.mappingDetails.textContent = map.item
    ? `localChildKey: ${map.item.localChildKey} / mapped Supabase Child: ${map.item.supabaseChildId} / household: ${map.householdMatches ? "一致" : "不一致"}。${map.viewedChildMatches ? "このLocal profileは現在表示中のChildに対応しています" : "現在表示中のChildとは対応していません"}`
    : "比較対象のLocal profileが未確定です。Local profileの所有者が未確定です。";
  let comparison = model.comparison;
  let comparisonSource = model.localProfile.source;
  if (selectedLocalChildKey) {
    try {
      comparison = globalThis.HapichikeParentCloudActions.compareProfileToCloud(window.localStorage, selectedLocalChildKey, state.viewedChildBalance);
      comparisonSource = profiles.find(profile => profile.localChildKey === selectedLocalChildKey)?.displayName ?? "選択中Local profile";
    } catch { /* mapped comparison or unresolved message remains */ }
  }
  const comparisonMismatch = comparison.some(row => row.difference !== null && row.difference !== 0);
  elements.comparisonMessage.textContent = comparison.length
    ? `${comparisonSource} と表示中Cloud Childをread-only比較しています。${comparisonMismatch ? "ローカルとクラウドの残高が一致していません" : "6残高は一致しています"}`
    : "比較対象のLocal profileを明示選択してください。名前だけでは対応付けません。";
  elements.localSourceMeta.textContent = `この端末のlocalStorage / 取得 ${state.local.readAt ? formatDateTime(state.local.readAt) : "--"}`;
  elements.cloudSourceMeta.textContent = `Supabase / 取得 ${state.viewedChildData.fetchedAt ? formatDateTime(state.viewedChildData.fetchedAt) : "--"}`;
  elements.comparisonBody.replaceChildren(...comparison.map(row => {
    const tr = document.createElement("tr");
    [row.label, valueLabel(row.local), valueLabel(row.cloud), row.difference === null ? "--" : `${row.difference > 0 ? "+" : ""}${row.difference}`].forEach(value => { const td = document.createElement("td"); td.textContent = value; tr.append(td); });
    return tr;
  }));
  const sync = model.initialImport.syncState;
  const readiness = model.initialImport.readiness;
  elements.importSummary.textContent = sync?.initial_import_completed_at
    ? "初回import済み（6残高snapshotのみ）"
    : readiness.cloudInitialized ? "確認が必要（Cloudに既存データあり）" : readiness.ready ? "未完了（実行条件を確認できます）" : "未完了（準備が必要）";
  elements.importDetails.textContent = `初回import記録: ${sync ? "あり" : "なし"} / 完了日時: ${sync?.initial_import_completed_at ? formatDateTime(sync.initial_import_completed_at) : "なし"} / Cloud既存データ: ${readiness.cloudInitialized ? "あり" : "なし"} / 実行可能: ${readiness.ready ? "はい" : "いいえ"}。タスク・全履歴は同期対象外です。`;
  elements.backupSummary.textContent = model.backup.present ? `backupあり / ${selectedBackupCurrent() ? "選択中Localのcurrent snapshotと一致" : "選択中Localに対してoutdated"}` : "backupなし";
  elements.backupDetails.textContent = model.backup.metadata?.backup_created_at
    ? `created_at: ${new Date(model.backup.metadata.backup_created_at).toLocaleString("ja-JP")}` : "created_at: --";
  elements.diagnosticGrid.replaceChildren(...Object.entries(model.diagnostic).map(([key, value]) => { const div = document.createElement("div"); const dt = document.createElement("dt"); const dd = document.createElement("dd"); dt.textContent = key; dd.textContent = statusLabel(value); div.append(dt, dd); return div; }));
  if (migrationPreview?.targetCloudChild.id !== state.parentViewedSupabaseChildId) migrationPreview = null;
  renderMigrationPreview();
  renderMappingPreview();
  renderActionButtons(model);
}

function shortId(value) {
  const text = String(value || "");
  return text.length > 12 ? `${text.slice(0, 8)}…` : text || "--";
}

function renderMappingPreview() {
  if (!mappingPreview) {
    if (mappingPreviewPhase === "idle") elements.mappingPreviewResult.textContent = "previewはまだ実行されていません。";
    return;
  }
  elements.mappingPreviewResult.textContent = [
    "handler：実行済み",
    "preview core：成功",
    `Local：${mappingPreview.localDisplayName}（localChildKey ${shortId(mappingPreview.localChildKey)}）`,
    `Cloud：${mappingPreview.cloudDisplayName}（${shortId(mappingPreview.supabaseChildId)}）`,
    `Household：${mappingPreview.householdDisplayName || mappingPreview.householdId}（${mappingPreview.householdId}）`,
    `existing mapping：${mappingPreview.existingMapping ? `${shortId(mappingPreview.existingMapping.localChildKey)} → ${shortId(mappingPreview.existingMapping.supabaseChildId)}` : "なし"}`,
    `duplicate conflict：${mappingPreview.duplicateConflict ? "あり" : "なし"}`,
    `stale：${mappingPreview.stale ? "あり" : "なし"}`,
    `判定：${mappingPreview.valid ? "Mapping可能" : "Mapping不可"}`,
    "preview write：0 / mapping save：0",
  ].join("\n");
}

function mappingPreviewError(error, state) {
  const code = globalThis.HapichikeParentCloudActions.safeError(error);
  const text = ({
    LOCAL_INVALID: "Local profile未取得。migration後のLocal stateを再読込してください。",
    CHILD_LOAD_FAILED: state?.parentViewedSupabaseChildId ? "Cloud Child情報がstaleです。runtime refreshが必要です。" : "Cloud Child未選択です。",
    HOUSEHOLD_LOAD_FAILED: "Household未取得です。runtime refreshが必要です。",
    MAPPING_CONFLICT: "Household不一致、または同じCloud Childへのduplicate mappingです。",
    MAPPING_STALE: "既存mappingがstaleです。runtime refresh後にmappingを確認してください。",
  })[code] ?? "preview core error。安全のためMapping不可としました。runtime refresh後に再試行してください。";
  return { code: code || "PREVIEW_ERROR", text };
}

function renderMappingPreviewError(error, state) {
  const safe = mappingPreviewError(error, state);
  const details = error?.previewDetails ?? {};
  elements.mappingPreviewMessage.textContent = safe.text;
  elements.mappingPreviewResult.textContent = [
    "handler：実行済み",
    "preview core：error",
    `Local：${details.localDisplayName ?? (selectedLocalChildKey ? shortId(selectedLocalChildKey) : "未取得")}（localChildKey ${shortId(details.localChildKey ?? selectedLocalChildKey)}）`,
    `Cloud：${details.cloudDisplayName ?? selectedChild(state)?.displayName ?? "未選択"}`,
    `Household：${details.householdId ?? state?.selectedHouseholdId ?? "未取得"}`,
    `existing mapping：${details.existingMapping ? `${shortId(details.existingMapping.localChildKey)} → ${shortId(details.existingMapping.supabaseChildId)}` : "なし"}`,
    `duplicate conflict：${details.duplicateConflict ? "あり" : "なし"}`,
    `stale：${details.stale ? "あり" : "なし"}`,
    `判定：Mapping不可（${safe.code}）`,
    "preview write：0 / mapping save：0",
  ].join("\n");
  setActionMessage(elements.mappingActionMessage, safe.text);
}

function renderMigrationPreview() {
  if (!migrationPreview) { elements.migrationPreviewResult.textContent = "明示的にpreviewした場合だけLegacyデータを読み取ります。"; return; }
  const p = migrationPreview;
  elements.migrationPreviewResult.textContent = [
    `source childName: ${p.sourceChildName}`, `target Cloud Child: ${p.targetCloudChild.displayName}`, `新規localChildKey: ${p.plannedLocalChildKey}`,
    `6残高: ${Object.values(p.balances).join(" / ")}`, `task件数: ${p.taskAssignments}`, `history件数: ${p.historyCount}`,
    `progress: badge ${p.progress.badgeCount}件`, `reset state: ${p.resetState.lastDailyResetKey || "なし"}`,
    `householdShared: task master ${p.householdShared.taskMasterCount}件`, `legacyExtras: profile ${p.legacyExtras.profileCount} / household ${p.legacyExtras.householdCount}`,
    `secret除外: ${p.excludedSecretFields.join(", ") || "なし"}`, `conflict: ${p.conflicts.join(", ") || "なし"}`,
    p.balanceMismatch ? "ローカルとクラウドの残高が一致していません" : "ローカルとクラウドの残高は一致しています",
  ].join("\n");
}

function renderHouseholds(state) {
  const ready = state.households.status === "ready";
  elements.householdEmpty.hidden = state.households.status !== "empty";
  elements.dashboardContent.hidden = !ready;
  elements.householdField.hidden = state.households.items.length < 2;
  const options = [];
  if (!state.selectedHouseholdId && state.households.items.length > 1) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "家庭を選んでください";
    options.push(option);
  }
  state.households.items.forEach(household => {
    const option = document.createElement("option");
    option.value = household.id;
    option.textContent = household.name;
    option.selected = household.id === state.selectedHouseholdId;
    options.push(option);
  });
  elements.householdSelect.replaceChildren(...options);
  elements.showChildCreateButton.disabled = !state.selectedHouseholdId || creatingChild;
}

function renderChildren(state) {
  const items = state.cloudChildren.items;
  const selectedId = state.parentViewedSupabaseChildId;
  elements.childrenEmpty.hidden = state.cloudChildren.status !== "empty";
  elements.childSelectionEmpty.hidden = state.cloudChildren.status !== "ready" || Boolean(selectedId);
  elements.childContent.hidden = !selectedId;
  elements.cloudManagement.hidden = !selectedId;
  elements.dataSelectionEmpty.hidden = Boolean(selectedId);
  elements.childTabs.replaceChildren(...items.map(child => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "child-tab";
    button.dataset.childId = child.id;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(child.id === selectedId));
    button.textContent = child.displayName;
    return button;
  }));
  elements.selectedChildName.textContent = items.find(child => child.id === selectedId)?.displayName ?? "";
}

function renderBalance(balance) {
  elements.balanceEmpty.hidden = Boolean(balance);
  elements.balanceUpdated.textContent = balance?.updated_at ? `更新 ${formatDateTime(balance.updated_at)}` : "";
  if (!balance) {
    elements.balanceGrid.replaceChildren();
    return;
  }
  const stars = Number(balance.star_coins) || 0;
  const cards = [
    ["🎟", "チケット", `${balance.tickets} 枚`, ""],
    ["⭐", "スターコイン", `${stars} / 5`, stars >= 5 ? "5つそろっています" : `あと${5 - stars}つでチケット！`, Math.min(stars / 5, 1) * 100],
    ["🍩", "SweetsPAY", `${balance.sweets_pay} P`, ""], ["🤖", "ToyPAY", `${balance.toy_pay} P`, ""],
    ["🎮", "GamePAY", `${balance.game_pay} P`, ""], ["💖", "ハピチャン", `${balance.happy_chance_cards} 枚`, ""],
  ];
  elements.balanceGrid.replaceChildren(...cards.map(([icon, label, value, note, progress]) => {
    const card = document.createElement("article");
    card.className = "balance-card";
    const labelElement = document.createElement("div");
    labelElement.className = "balance-label";
    const iconElement = document.createElement("span");
    iconElement.className = "balance-icon";
    iconElement.setAttribute("aria-hidden", "true");
    iconElement.textContent = icon;
    labelElement.append(iconElement, document.createTextNode(label));
    const valueElement = document.createElement("p");
    valueElement.className = "balance-value";
    valueElement.textContent = value;
    card.append(labelElement, valueElement);
    if (progress !== undefined) {
      const meter = document.createElement("div");
      meter.className = "star-meter";
      meter.setAttribute("aria-label", `5枚中${Math.min(stars, 5)}枚`);
      const fill = document.createElement("span");
      fill.style.width = `${progress}%`;
      meter.append(fill);
      card.append(meter);
    }
    if (note) {
      const noteElement = document.createElement("p");
      noteElement.className = "balance-note";
      noteElement.textContent = note;
      card.append(noteElement);
    }
    return card;
  }));
}

const taskTypes = new Set(["today_task_reward", "task_completed", "help_job_reward", "help_board_reward"]);

function renderLogs(logs) {
  renderLogList(elements.logsList, logs.slice(0, 10), "まだ報酬履歴はありません。");
  renderLogList(elements.choresList, logs.filter(log => taskTypes.has(log.type)).slice(0, 10), "まだお手伝い履歴はありません。");
}

function renderLogList(container, logs, emptyMessage) {
  if (!logs.length) {
    const empty = document.createElement("p");
    empty.className = "empty-line";
    empty.textContent = emptyMessage;
    container.replaceChildren(empty);
    return;
  }
  container.replaceChildren(...logs.map(log => {
    const item = document.createElement("article");
    item.className = "history-item";
    const date = document.createElement("time");
    date.className = "history-date";
    date.dateTime = log.created_at;
    date.textContent = formatShortDate(log.created_at);
    const copy = document.createElement("div");
    const title = document.createElement("p");
    title.className = "history-title";
    title.textContent = log.title || typeLabel(log.type);
    copy.append(title);
    if (log.message) {
      const message = document.createElement("p");
      message.className = "history-message";
      message.textContent = log.message;
      copy.append(message);
    }
    const amount = document.createElement("div");
    amount.className = "history-amount";
    amount.textContent = amountLabel(log);
    item.append(date, copy, amount);
    return item;
  }));
}

function typeLabel(type) {
  return ({ ticket_added: "チケット獲得", star_coin_added: "スターコイン獲得", pay_adjusted: "PAYポイント変更",
    today_task_reward: "お手伝い完了", task_completed: "お手伝い完了", star_coin_exchange: "スター交換",
    parent_gift: "おうちの人からのプレゼント", help_job_reward: "掲示板報酬", help_board_reward: "掲示板報酬" })[type] ?? type ?? "報酬履歴";
}

function amountLabel(log) {
  const amount = Number(log.amount);
  if (!Number.isFinite(amount)) return typeLabel(log.type);
  const sign = amount > 0 ? "+" : "";
  if (log.type === "star_coin_added") return `⭐ ${sign}${amount}`;
  if (log.type === "pay_adjusted") return `${({ sweets: "🍩", toy: "🤖", game: "🎮" })[log.metadata?.pay_type] ?? "PAY"} ${sign}${amount}P`;
  if (log.type === "today_task_reward" || log.type === "help_job_reward") return log.metadata?.reward_type === "starCoin" ? `⭐ +${amount}` : `🎟 +${amount}`;
  if (log.type === "star_coin_exchange") return `🎟 +${amount}`;
  if (log.type?.includes("ticket") || log.type === "parent_gift") return `🎟 ${sign}${amount}`;
  return `${sign}${amount}`;
}

function formatShortDate(value) {
  return value ? new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" }).format(new Date(value)) : "--";
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function render(state) {
  if (state.auth.status === "loading") return showOnly(elements.loadingView);
  if (state.auth.status === "signed_out" || state.auth.status === "error") {
    showLoginMode();
    showOnly(elements.loginView);
    elements.loginError.textContent = state.auth.errorCode ? (errorMessages[state.auth.errorCode] ?? "データの読み込みに失敗しました。") : "";
    elements.loginRetryButton.hidden = state.auth.status !== "error";
    return;
  }
  showOnly(elements.dashboardView);
  elements.parentEmail.textContent = runtime.getParentEmail();
  elements.settingsAccountEmail.textContent = runtime.getParentEmail() || "--";
  const household = selectedHousehold(state);
  elements.settingsHouseholdName.textContent = household?.name || "未選択";
  elements.settingsHouseholdRole.textContent = ({ owner: "管理者", parent: "保護者", viewer: "閲覧者" })[household?.membershipRole] ?? household?.membershipRole ?? "--";
  renderRuntimeStatus(state);
  renderHouseholds(state);
  renderChildren(state);
  setDashboardError(state.viewedChildData.errorCode ?? state.cloudChildren.errorCode ?? state.households.errorCode ?? state.connection.errorCode);
  const loading = state.viewedChildData.status === "loading";
  elements.balanceLoading.hidden = !loading;
  elements.logsLoading.hidden = !loading;
  elements.refreshRuntimeButton.disabled = state.households.status === "loading" || state.cloudChildren.status === "loading";
  elements.refreshChildButton.disabled = loading;
  elements.homeCloudStatus.textContent = loading
    ? "クラウドから取得中です。"
    : state.viewedChildData.status === "ready"
      ? `取得できました。最終取得 ${state.viewedChildData.fetchedAt ? formatDateTime(state.viewedChildData.fetchedAt) : "--"}`
      : state.viewedChildData.status === "error" ? "取得できませんでした。自動再送はしません。更新ボタンで再確認してください。" : "子どもを選ぶと取得します。";
  renderBalance(state.viewedChildBalance);
  renderLogs(state.viewedChildRewardLogs);
  renderCloudManagement(state);
  setActiveDashboardTab(activeDashboardTab);
}

runtime.subscribe(render);

elements.loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  elements.loginError.textContent = "";
  elements.loginButton.disabled = true;
  elements.loginButton.textContent = "ログイン中...";
  try { await signInParent(elements.emailInput.value.trim(), elements.passwordInput.value); }
  catch (error) { elements.loginError.textContent = friendlyError(error, "ログインできませんでした。時間をおいてもう一度お試しください。"); }
  finally { elements.loginButton.disabled = false; elements.loginButton.textContent = "ログイン"; }
});
elements.loginRetryButton.addEventListener("click", () => { void runtime.initializeParentRuntime(); });

elements.showPasswordResetButton.addEventListener("click", () => {
  elements.resetEmailInput.value = elements.emailInput.value.trim();
  elements.loginError.textContent = "";
  showLoginMode("password-reset");
  elements.resetEmailInput.focus();
});
elements.showLoginButton.addEventListener("click", () => { showLoginMode(); elements.emailInput.focus(); });

elements.passwordResetForm.addEventListener("submit", async event => {
  event.preventDefault();
  elements.passwordResetMessage.textContent = "";
  elements.passwordResetMessage.classList.remove("is-success");
  elements.passwordResetButton.disabled = true;
  try {
    await requestParentPasswordReset(elements.resetEmailInput.value.trim());
    elements.passwordResetMessage.textContent = "パスワード再設定メールを送信しました。\nメールをご確認ください。";
    elements.passwordResetMessage.classList.add("is-success");
  } catch (error) {
    elements.passwordResetMessage.textContent = friendlyError(error, "再設定メールを送信できませんでした。");
  } finally { elements.passwordResetButton.disabled = false; }
});

elements.logoutButton.addEventListener("click", async () => {
  elements.logoutButton.disabled = true;
  try { await signOutParent(); } catch { setDashboardError("CONNECTION_FAILED"); }
  finally { elements.logoutButton.disabled = false; }
});
elements.householdSelect.addEventListener("change", () => {
  resetChildCreatePreview();
  setChildCreateMessage("");
  if (elements.householdSelect.value) void runtime.selectHousehold(elements.householdSelect.value);
});
elements.childTabs.addEventListener("click", event => {
  const button = event.target.closest("[data-child-id]");
  if (button && button.dataset.childId !== runtime.getState().parentViewedSupabaseChildId) void runtime.selectViewedCloudChild(button.dataset.childId);
});
elements.refreshRuntimeButton.addEventListener("click", async () => {
  await runtime.initializeParentRuntime();
});
elements.refreshChildButton.addEventListener("click", () => { void runtime.refreshViewedChildData(); });

elements.showChildCreateButton.addEventListener("click", () => {
  elements.childCreateForm.hidden = false;
  elements.showChildCreateButton.hidden = true;
  resetChildCreatePreview();
  setChildCreateMessage("");
  elements.childNameInput.focus();
});

elements.cancelChildCreateButton.addEventListener("click", () => {
  elements.childCreateForm.reset();
  elements.childCreateForm.hidden = true;
  elements.showChildCreateButton.hidden = false;
  resetChildCreatePreview();
  setChildCreateMessage("");
});

[elements.childNameInput, elements.childNicknameInput].forEach(input => input.addEventListener("input", () => {
  resetChildCreatePreview();
  setChildCreateMessage("");
}));

elements.childCreateForm.addEventListener("submit", event => {
  event.preventDefault();
  const state = runtime.getState();
  try {
    childCreatePreview = globalThis.HapichikeCloudChildCreate.createPreview({
      draft: { name: elements.childNameInput.value, nickname: elements.childNicknameInput.value },
      household: selectedHousehold(state),
    });
    elements.childPreviewHousehold.textContent = childCreatePreview.householdName || childCreatePreview.householdId;
    elements.childPreviewName.textContent = childCreatePreview.name;
    elements.childPreviewNickname.textContent = childCreatePreview.nickname || "（なし）";
    elements.childCreatePreview.hidden = false;
    elements.createChildButton.disabled = false;
    setChildCreateMessage("内容を確認してから追加してください。");
  } catch (error) {
    resetChildCreatePreview();
    setChildCreateMessage(childCreateError(error));
  }
});

async function selectCreatedChild(child) {
  if (!child?.id || child.household_id !== childCreatePreview?.householdId) throw new Error("invalid child response");
  const refreshed = await runtime.refreshCloudChildren();
  if (!refreshed.cloudChildren.items.some(item => item.id === child.id)) throw new Error("created child not visible");
  await runtime.selectViewedCloudChild(child.id);
}

elements.createChildButton.addEventListener("click", async () => {
  if (creatingChild || !childCreatePreview) return;
  const preview = childCreatePreview;
  let beforeIds = [];
  let insertAttempted = false;
  creatingChild = true;
  elements.createChildButton.disabled = true;
  elements.childPreviewButton.disabled = true;
  elements.cancelChildCreateButton.disabled = true;
  elements.householdSelect.disabled = true;
  setChildCreateMessage("登録しています...");
  try {
    const { session } = await getParentSession();
    const households = session?.user?.id ? await getCurrentHouseholds(session.user.id) : [];
    globalThis.HapichikeCloudChildCreate.verifyPreflight({
      preview,
      session,
      selectedHouseholdId: runtime.getState().selectedHouseholdId,
      households,
    });
    const latestChildren = await getChildrenByHousehold(preview.householdId);
    if (latestChildren.some(child => child.household_id !== preview.householdId)) throw new Error("invalid household response");
    beforeIds = latestChildren.map(child => child.id);
    insertAttempted = true;
    const child = await createChild(preview.householdId, preview.name, preview.nickname);
    await selectCreatedChild(child);
    elements.childCreateForm.reset();
    elements.childCreateForm.hidden = true;
    elements.showChildCreateButton.hidden = false;
    resetChildCreatePreview();
    setChildCreateMessage("Cloud Childを追加しました。", true);
  } catch (error) {
    let recoveredChild = null;
    let outcomeChecked = false;
    if (insertAttempted) {
      try {
        const children = await getChildrenByHousehold(preview.householdId);
        outcomeChecked = true;
        recoveredChild = globalThis.HapichikeCloudChildCreate.findNewMatchingChild(beforeIds, children, preview);
      } catch { /* The result remains unknown; do not retry automatically. */ }
    }
    if (recoveredChild) {
      try {
        childCreatePreview = preview;
        await selectCreatedChild(recoveredChild);
        elements.childCreateForm.reset();
        elements.childCreateForm.hidden = true;
        elements.showChildCreateButton.hidden = false;
        resetChildCreatePreview();
        setChildCreateMessage("通信応答は失敗しましたが、追加済みのChildを一覧で確認しました。", true);
      } catch {
        resetChildCreatePreview();
        setChildCreateMessage("追加結果を一覧で確認できませんでした。更新してから再度確認してください。");
      }
    } else {
      resetChildCreatePreview();
      setChildCreateMessage(insertAttempted && !outcomeChecked
        ? "追加結果を確認できませんでした。再送信せず、一覧を更新してから確認してください。"
        : childCreateError(error));
    }
  } finally {
    creatingChild = false;
    elements.childPreviewButton.disabled = false;
    elements.cancelChildCreateButton.disabled = false;
    elements.householdSelect.disabled = false;
    if (childCreatePreview) elements.createChildButton.disabled = false;
    renderHouseholds(runtime.getState());
  }
});

elements.migrationPreviewButton.addEventListener("click", () => {
  const state = runtime.getState();
  const child = selectedChild(state);
  try { migrationPreview = globalThis.HapichikeParentCloudManagement.previewLegacy(window.localStorage, child, state.viewedChildBalance); }
  catch { migrationPreview = null; elements.migrationPreviewResult.textContent = "LOCAL_INVALID: Legacy migration previewを作成できませんでした。"; return; }
  elements.migrationApprovals.querySelectorAll("input").forEach(input => { input.checked = false; });
  elements.migrationActionMessage.textContent = "実行前に対象Childと4項目を目視確認してください。";
  renderMigrationPreview();
  renderCloudManagement(state);
});

function actionError(error) {
  const code = globalThis.HapichikeParentCloudActions.safeError(error);
  return ({
    AUTH_REQUIRED: "AUTH_REQUIRED: 親ログインが必要です。", HOUSEHOLD_LOAD_FAILED: "HOUSEHOLD_LOAD_FAILED: Householdを再読込してください。",
    CHILD_LOAD_FAILED: "CHILD_LOAD_FAILED: Child一覧が古い可能性があります。再読込してください。", LOCAL_INVALID: "LOCAL_INVALID: Local profileを確認してください。",
    BACKUP_REQUIRED: "BACKUP_REQUIRED: 現在のLocal snapshotに一致するbackupが必要です。", MAPPING_REQUIRED: "MAPPING_REQUIRED: mappingを先に保存してください。",
    MAPPING_CONFLICT: "MAPPING_CONFLICT: 同じCloud Childへの重複または家庭不一致です。", CLOUD_INITIALIZED: "CLOUD_INITIALIZED: Cloudは初期化済みのためimportできません。",
    MAPPING_STALE: "MAPPING_STALE: 既存mappingが古いため、状態を再読込してください。",
    LOCAL_PROFILE_DUPLICATE: "LOCAL_PROFILE_DUPLICATE: このCloud Child用のLocal profileはすでにあります。",
    PROFILE_CREATION_CONFLICT: "PROFILE_CREATION_CONFLICT: preview後に状態が変わりました。再確認してください。",
    V2_NOT_ACTIVATED: "V2_NOT_ACTIVATED: v2 activation済み環境でのみ追加できます。",
    IMPORT_NOT_ALLOWED: "IMPORT_NOT_ALLOWED: readiness条件を満たしていません。", MIGRATION_CONFLICT: "MIGRATION_CONFLICT: preview・競合・承認を確認してください。",
    NETWORK_ERROR: "通信結果を確認できませんでした。自動再送はしません。Cloud状態と履歴を更新してから確認してください。",
  })[code] ?? "処理に失敗しました。状態を再読込して再試行してください。";
}

function setActionMessage(element, message, success = false) {
  element.textContent = message;
  element.classList.toggle("is-success", success);
}

function downloadBackup(envelope) {
  const blob = new Blob([`${JSON.stringify(envelope, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = globalThis.HapichikeBackup.filename(new Date(envelope.createdAt));
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

elements.localProfileSelect.addEventListener("change", () => {
  selectedLocalChildKey = elements.localProfileSelect.value;
  resetActionPreviews();
  renderCloudManagement(runtime.getState());
});

elements.profileCreationPreviewButton.addEventListener("click", () => {
  const state = runtime.getState();
  try {
    profileCreationPreview = globalThis.HapichikeParentCloudActions.previewLocalProfileCreation(window.localStorage, {
      cloudChild: selectedChild(state), householdId: state.selectedHouseholdId, visibleChildren: state.cloudChildren.items,
    });
    elements.profileCreationPreviewResult.textContent = [
      `Cloud Child: ${profileCreationPreview.childName} (${profileCreationPreview.cloudChildId})`,
      "Local profile: 新規UUID v4を作成時に発行",
      `6残高: ${Object.values(profileCreationPreview.balances).join(" / ")}`,
      `task assignment: ${profileCreationPreview.taskAssignments} / history: ${profileCreationPreview.historyEntries}`,
      `progress: ${profileCreationPreview.progress} / reset: ${profileCreationPreview.resetState}`,
      `activeLocalChildKey: ${profileCreationPreview.activeLocalChildKey}（変更しません）`,
      "Cloud残高コピー: なし / Cloud write: 0 / mapping save: 0",
    ].join("\n");
    elements.profileCreationApproval.checked = false;
    elements.profileCreationApproval.disabled = false;
    elements.profileCreationButton.disabled = true;
    setActionMessage(elements.profileCreationMessage, "Local writeの実行前に内容を目視確認してください。");
  } catch (error) {
    resetProfileCreationPreview();
    setActionMessage(elements.profileCreationMessage, actionError(error));
  }
});
elements.profileCreationApproval.addEventListener("change", () => {
  elements.profileCreationButton.disabled = !profileCreationPreview || !elements.profileCreationApproval.checked;
});
elements.profileCreationButton.addEventListener("click", async () => {
  const state = runtime.getState();
  try {
    const result = globalThis.HapichikeParentCloudActions.createLocalProfile(window.localStorage, profileCreationPreview, {
      parentApproved: elements.profileCreationApproval.checked,
      cloudChild: selectedChild(state), householdId: state.selectedHouseholdId, visibleChildren: state.cloudChildren.items,
    });
    selectedLocalChildKey = result.profile.localChildKey;
    resetProfileCreationPreview();
    resetActionPreviews();
    await runtime.readLocalIdentityState();
    setActionMessage(elements.profileCreationMessage, `Local profileを作成しました: ${result.profile.childName}。active ChildとCloudは変更していません。`, true);
    renderCloudManagement(runtime.getState());
  } catch (error) { setActionMessage(elements.profileCreationMessage, actionError(error)); }
});

elements.createBackupButton.addEventListener("click", () => {
  try {
    const result = globalThis.HapichikeParentCloudActions.createBackup(window.localStorage, selectedLocalChildKey);
    downloadBackup(result.envelope);
    setActionMessage(elements.backupActionMessage, `backupを作成しました（format v${result.envelope.version} / ${result.profile.displayName}）。`, true);
    renderCloudManagement(runtime.getState());
  } catch (error) { setActionMessage(elements.backupActionMessage, actionError(error)); }
});

elements.selectRestoreButton.addEventListener("click", () => elements.restoreFileInput.click());
elements.restoreFileInput.addEventListener("change", async () => {
  pendingRestoreEnvelope = null;
  elements.restoreApproval.checked = false;
  elements.executeRestoreButton.disabled = true;
  const file = elements.restoreFileInput.files?.[0];
  if (!file) return;
  try {
    const envelope = globalThis.HapichikeBackup.parseBackup(await file.text());
    const current = JSON.parse(window.localStorage.getItem(globalThis.HapichikeBackup.STORAGE_KEY) || "null");
    const details = globalThis.HapichikeBackup.preview(envelope, current);
    pendingRestoreEnvelope = envelope;
    elements.restorePreviewResult.textContent = [`created_at: ${details.createdAt}`, `format version: ${details.version}`, `childName: ${details.childName}`, `v2 profiles: ${details.profileCount}`, ...details.profiles.map(profile => `- ${profile.childName} (${profile.localChildKey})${profile.active ? " [active]" : ""}`), `activeLocalChildKey: ${details.activeLocalChildKey || "なし"}`, ...details.rows.map(row => `${row[0]}: ${valueLabel(row[1])} → ${valueLabel(row[2])}`)].join("\n");
    elements.restoreApprovalLabel.hidden = false;
    elements.executeRestoreButton.hidden = false;
    setActionMessage(elements.backupActionMessage, "restore previewです。まだLocalデータは変更されていません。", true);
  } catch (error) { setActionMessage(elements.backupActionMessage, actionError(error)); }
});
elements.restoreApproval.addEventListener("change", () => { elements.executeRestoreButton.disabled = !pendingRestoreEnvelope || !elements.restoreApproval.checked; });
elements.executeRestoreButton.addEventListener("click", () => {
  if (!pendingRestoreEnvelope || !elements.restoreApproval.checked) return;
  try { globalThis.HapichikeBackup.restore(window.localStorage, pendingRestoreEnvelope); window.location.reload(); }
  catch (error) { setActionMessage(elements.backupActionMessage, actionError(error)); }
});

elements.migrationApprovals.addEventListener("change", () => renderCloudManagement(runtime.getState()));
elements.migrationApplyButton.addEventListener("click", async () => {
  const state = runtime.getState();
  const checks = Object.fromEntries([...elements.migrationApprovals.querySelectorAll("input")].map(input => [input.dataset.migrationApproval, input.checked]));
  try {
    const refreshed = await verifyImportPreflight(state);
    const target = refreshed.children.find(child => child.id === state.parentViewedSupabaseChildId);
    const result = globalThis.HapichikeParentCloudActions.applyMigration(window.localStorage, {
      preview: migrationPreview, targetChild: target, householdId: state.selectedHouseholdId, visibleChildren: refreshed.children,
      parentApproved: checks.owner, backupApproved: checks.backup, previewApproved: checks.preview, cloudWriteZeroApproved: checks.cloud,
    });
    selectedLocalChildKey = result.localChildKey;
    migrationPreview = null;
    setActionMessage(elements.migrationActionMessage, `migration完了: ${result.localChildKey}。v1とsafety copyは保持されています。`, true);
    resetActionPreviews();
    await runtime.readLocalIdentityState();
    const refreshedProfiles = localProfiles();
    if (!refreshedProfiles.some(profile => profile.localChildKey === result.localChildKey)) throw new Error("LOCAL_INVALID");
    selectedLocalChildKey = result.localChildKey;
    renderCloudManagement(runtime.getState());
  } catch (error) { setActionMessage(elements.migrationActionMessage, actionError(error)); }
});

async function handleMappingPreview() {
  mappingPreview = null;
  mappingPreviewPhase = "refreshing";
  elements.mappingPreviewMessage.textContent = "handler実行：migration後のLocal v2 stateを再読込しています。";
  elements.mappingPreviewResult.textContent = "handler：実行済み\npreview core：呼出前（Local state再読込中）\n判定：確認中\npreview write：0 / mapping save：0";
  try {
    await runtime.readLocalIdentityState();
    const state = runtime.getState();
    const profiles = localProfiles();
    if (!selectedLocalChildKey || !profiles.some(profile => profile.localChildKey === selectedLocalChildKey)) {
      selectedLocalChildKey = profiles.find(profile => profile.active && profile.kind === "v2")?.localChildKey ?? "";
    }
    if (!selectedLocalChildKey) throw new Error("LOCAL_INVALID");
    mappingPreviewPhase = "core";
    mappingPreview = globalThis.HapichikeParentCloudActions.createMappingPreview(window.localStorage, {
      localChildKey: selectedLocalChildKey, cloudChild: selectedChild(state), householdId: state.selectedHouseholdId, visibleChildren: state.cloudChildren.items,
    });
    mappingPreview.householdDisplayName = state.households.items.find(item => item.id === state.selectedHouseholdId)?.name ?? mappingPreview.householdId;
    mappingPreviewPhase = "success";
    elements.mappingPreviewMessage.textContent = mappingPreview.message;
    elements.mappingApproval.checked = false;
    elements.mappingApproval.disabled = false;
    setActionMessage(elements.mappingActionMessage, "保存前にLocal / Cloud / Householdを目視確認してください。");
    renderCloudManagement(state);
  } catch (error) {
    mappingPreview = null;
    mappingPreviewPhase = "error";
    const state = runtime.getState();
    renderCloudManagement(state);
    try { renderMappingPreviewError(error, state); }
    catch { elements.mappingActionMessage.textContent = "preview render error。結果を表示できませんでした。runtime refresh後に再試行してください。"; }
  }
}

elements.mappingPreviewButton.addEventListener("click", handleMappingPreview);
elements.mappingPreviewButton.dataset.handlerRegistered = "true";
elements.mappingApproval.addEventListener("change", () => renderCloudManagement(runtime.getState()));
elements.mappingSaveButton.addEventListener("click", async () => {
  const state = runtime.getState();
  try {
    const refreshed = await verifyImportPreflight(state);
    globalThis.HapichikeParentCloudActions.saveMapping(window.localStorage, mappingPreview, {
      parentApproved: elements.mappingApproval.checked, cloudChild: refreshed.children.find(child => child.id === state.parentViewedSupabaseChildId), householdId: state.selectedHouseholdId, visibleChildren: refreshed.children,
    });
    mappingPreview = null;
    setActionMessage(elements.mappingActionMessage, "mappingを保存しました。Cloudデータは変更していません。", true);
    renderCloudManagement(state);
  } catch (error) { setActionMessage(elements.mappingActionMessage, actionError(error)); }
});

elements.importPreviewButton.addEventListener("click", async () => {
  const state = runtime.getState();
  const model = globalThis.HapichikeParentCloudManagement.inspect(window.localStorage, state);
  try {
    if (!(model.mapping.status === "valid" && model.mapping.viewedChildMatches && model.mapping.item?.localChildKey === selectedLocalChildKey)) throw new Error("MAPPING_REQUIRED");
    initialImportPreview = await globalThis.HapichikeParentCloudActions.createImportPreview(window.localStorage, {
      localChildKey: selectedLocalChildKey, childId: state.parentViewedSupabaseChildId, readiness: model.initialImport.readiness, parentApproved: true,
    });
    elements.importPreviewResult.textContent = [`Local profile: ${selectedLocalChildKey}`, `Cloud Child: ${model.selectedChild.displayName}`, `absolute snapshot: ${JSON.stringify(initialImportPreview.balances)}`, `canonical hash: ${initialImportPreview.source_snapshot_hash}`, `backup date: ${initialImportPreview.backup_created_at}`, `import_id: ${initialImportPreview.import_id}`].join("\n");
    elements.importApprovals.disabled = false;
    elements.importApprovals.querySelectorAll("input").forEach(input => { input.checked = false; });
    setActionMessage(elements.importActionMessage, "実行前に4項目を目視確認してください。");
  } catch (error) { initialImportPreview = null; setActionMessage(elements.importActionMessage, actionError(error)); }
  renderCloudManagement(state);
});
elements.importApprovals.addEventListener("change", () => renderCloudManagement(runtime.getState()));

async function verifyImportPreflight(state) {
  const { session } = await getParentSession();
  if (!session?.user?.id) throw new Error("AUTH_REQUIRED");
  const households = await getCurrentHouseholds(session.user.id);
  const household = households.find(item => item.id === state.selectedHouseholdId);
  if (!household || !["owner", "parent"].includes(household.membership_role)) throw new Error("AUTH_REQUIRED");
  const children = (await getChildrenByHousehold(state.selectedHouseholdId)).map(child => ({
    id: child.id, householdId: child.household_id, displayName: child.display_name ?? child.name ?? "",
  }));
  if (!children.some(child => child.id === state.parentViewedSupabaseChildId && child.householdId === state.selectedHouseholdId)) {
    throw new Error("CHILD_LOAD_FAILED");
  }
  return { household, children };
}

elements.importExecuteButton.addEventListener("click", async () => {
  if (importing) return;
  importing = true;
  renderCloudManagement(runtime.getState());
  try {
    await verifyImportPreflight(runtime.getState());
    await runtime.refreshViewedChildData();
    const state = runtime.getState();
    const model = globalThis.HapichikeParentCloudManagement.inspect(window.localStorage, state);
    const approvals = Object.fromEntries([...elements.importApprovals.querySelectorAll("input")].map(input => [input.dataset.importApproval, input.checked]));
    if (!globalThis.HapichikeParentCloudActions.canExecuteImport({ readiness: model.initialImport.readiness, approvals, importing: false, preview: initialImportPreview, childId: state.parentViewedSupabaseChildId, mappingValid: model.mapping.status === "valid" && model.mapping.viewedChildMatches })) throw new Error(model.initialImport.readiness.cloudInitialized ? "CLOUD_INITIALIZED" : "IMPORT_NOT_ALLOWED");
    await importInitialHapichikeSnapshot(initialImportPreview);
    globalThis.HapichikeInitialImport.clearPendingPreview(window.localStorage);
    initialImportPreview = null;
    await runtime.refreshViewedChildData();
    setActionMessage(elements.importActionMessage, "initial importが完了しました。再importはできません。", true);
  } catch (error) {
    if (!globalThis.HapichikeParentCloudActions.isRetryableNetworkError(error)) {
      globalThis.HapichikeInitialImport.clearPendingPreview(window.localStorage);
      initialImportPreview = null;
    }
    setActionMessage(elements.importActionMessage, actionError(error));
  }
  finally { importing = false; renderCloudManagement(runtime.getState()); }
});

if (!isSupabaseConfigured()) showOnly(elements.configView);
else void runtime.initializeParentRuntime();
