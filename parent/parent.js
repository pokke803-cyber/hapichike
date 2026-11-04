import { isSupabaseConfigured } from "../src/lib/supabaseClient.js";
import {
  getParentSession, onParentAuthStateChange, requestParentPasswordReset,
  signInParent, signOutParent,
} from "../src/services/api/authApi.js";
import { getCurrentHouseholds } from "../src/services/api/householdsApi.js";
import { getChildrenByHousehold } from "../src/services/api/childrenApi.js";
import { getChildAppSyncState, getChildBalances, importInitialHapichikeSnapshot } from "../src/services/api/rewardsApi.js";
import { getRecentRewardLogs } from "../src/services/api/historyApi.js";
import "../src/parent/parent-runtime-core.js";
import "../src/child-identity-core.js";
import "../src/backup-core.js";
import "../src/cloud-mapping-core.js";
import "../src/initial-import-core.js";
import "../src/profile-domain.js";
import "../src/profile-migration.js";
import "../src/parent/parent-runtime.js";
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
  "restorePreviewResult", "restoreApprovalLabel", "restoreApproval", "executeRestoreButton", "backupActionMessage",
  "migrationApprovals", "migrationApplyButton", "migrationActionMessage", "mappingPreviewMessage", "mappingPreviewButton",
  "mappingApproval", "mappingSaveButton", "mappingActionMessage", "importPreviewButton", "importPreviewResult", "importApprovals",
  "importExecuteButton", "importActionMessage",
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
let selectedLocalChildKey = "";
let importing = false;

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

function localProfiles() {
  try { return globalThis.HapichikeParentCloudActions.readLocalProfiles(window.localStorage); }
  catch { return []; }
}

function resetActionPreviews() {
  mappingPreview = null;
  initialImportPreview = null;
  elements.mappingApproval.checked = false;
  elements.mappingApproval.disabled = true;
  elements.importApprovals.querySelectorAll("input").forEach(input => { input.checked = false; });
  elements.importApprovals.disabled = true;
  elements.mappingPreviewMessage.textContent = "Local profileとCloud Childを選択してください。";
  elements.importPreviewResult.textContent = "readinessとmappingを確認してください。";
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
  if (selectedLocalChildKey && !profiles.some(profile => profile.localChildKey === selectedLocalChildKey)) selectedLocalChildKey = "";
  if (!selectedLocalChildKey) selectedLocalChildKey = profiles.find(profile => profile.active)?.localChildKey ?? "";
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
  elements.comparisonMessage.textContent = model.localProfile.unresolved
    ? "比較対象のLocal profileが未確定です。名前だけでは対応付けません。"
    : `${model.localProfile.source} とCloudを比較しています。${model.mismatch ? "ローカルとクラウドの残高が一致していません" : "6残高は一致しています"}`;
  elements.comparisonBody.replaceChildren(...model.comparison.map(row => {
    const tr = document.createElement("tr");
    [row.label, valueLabel(row.local), valueLabel(row.cloud), row.difference === null ? "--" : `${row.difference > 0 ? "+" : ""}${row.difference}`].forEach(value => { const td = document.createElement("td"); td.textContent = value; tr.append(td); });
    return tr;
  }));
  const sync = model.initialImport.syncState;
  const readiness = model.initialImport.readiness;
  elements.importSummary.textContent = sync?.initial_import_completed_at ? "Initial import completed" : readiness.cloudInitialized ? "Cloud already initialized / Initial import not completed" : "Initial import not completed";
  elements.importDetails.textContent = `sync state: ${sync ? "あり" : "なし"} / completed_at: ${sync?.initial_import_completed_at ?? "なし"} / import version: ${sync?.import_version ?? "なし"} / Cloud initialized: ${readiness.cloudInitialized ? "はい" : "いいえ"} / import eligible: ${readiness.ready ? "eligible" : "not eligible"}`;
  elements.backupSummary.textContent = model.backup.present ? `backupあり / ${selectedBackupCurrent() ? "選択中Localのcurrent snapshotと一致" : "選択中Localに対してoutdated"}` : "backupなし";
  elements.backupDetails.textContent = model.backup.metadata?.backup_created_at
    ? `created_at: ${new Date(model.backup.metadata.backup_created_at).toLocaleString("ja-JP")}` : "created_at: --";
  elements.diagnosticGrid.replaceChildren(...Object.entries(model.diagnostic).map(([key, value]) => { const div = document.createElement("div"); const dt = document.createElement("dt"); const dd = document.createElement("dd"); dt.textContent = key; dd.textContent = statusLabel(value); div.append(dt, dd); return div; }));
  if (migrationPreview?.targetCloudChild.id !== state.parentViewedSupabaseChildId) migrationPreview = null;
  renderMigrationPreview();
  renderActionButtons(model);
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
}

function renderChildren(state) {
  const items = state.cloudChildren.items;
  const selectedId = state.parentViewedSupabaseChildId;
  elements.childrenEmpty.hidden = state.cloudChildren.status !== "empty";
  elements.childSelectionEmpty.hidden = state.cloudChildren.status !== "ready" || Boolean(selectedId);
  elements.childContent.hidden = !selectedId;
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
  renderRuntimeStatus(state);
  renderHouseholds(state);
  renderChildren(state);
  setDashboardError(state.viewedChildData.errorCode ?? state.cloudChildren.errorCode ?? state.households.errorCode ?? state.connection.errorCode);
  const loading = state.viewedChildData.status === "loading";
  elements.balanceLoading.hidden = !loading;
  elements.logsLoading.hidden = !loading;
  elements.refreshRuntimeButton.disabled = state.households.status === "loading" || state.cloudChildren.status === "loading";
  elements.refreshChildButton.disabled = loading;
  renderBalance(state.viewedChildBalance);
  renderLogs(state.viewedChildRewardLogs);
  renderCloudManagement(state);
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
    IMPORT_NOT_ALLOWED: "IMPORT_NOT_ALLOWED: readiness条件を満たしていません。", MIGRATION_CONFLICT: "MIGRATION_CONFLICT: preview・競合・承認を確認してください。",
    NETWORK_ERROR: "NETWORK_ERROR: 接続を確認し、状態を再読込してください。",
  })[code];
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

elements.createBackupButton.addEventListener("click", () => {
  try {
    if (!selectedLocalChildKey) throw new Error("LOCAL_INVALID");
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
    elements.restorePreviewResult.textContent = [`created_at: ${details.createdAt}`, `format version: ${details.version}`, `childName: ${details.childName}`, `v2 profiles: ${details.profileCount}`, `activeLocalChildKey: ${details.activeLocalChildKey || "なし"}`, ...details.rows.map(row => `${row[0]}: ${valueLabel(row[1])} → ${valueLabel(row[2])}`)].join("\n");
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
    void runtime.readLocalIdentityState();
  } catch (error) { setActionMessage(elements.migrationActionMessage, actionError(error)); }
});

elements.mappingPreviewButton.addEventListener("click", () => {
  const state = runtime.getState();
  try {
    mappingPreview = globalThis.HapichikeParentCloudActions.createMappingPreview(window.localStorage, {
      localChildKey: selectedLocalChildKey, cloudChild: selectedChild(state), householdId: state.selectedHouseholdId, visibleChildren: state.cloudChildren.items,
    });
    elements.mappingPreviewMessage.textContent = mappingPreview.message;
    elements.mappingApproval.checked = false;
    elements.mappingApproval.disabled = false;
    setActionMessage(elements.mappingActionMessage, "保存前にLocal / Cloud / Householdを目視確認してください。");
  } catch (error) { mappingPreview = null; setActionMessage(elements.mappingActionMessage, actionError(error)); }
  renderCloudManagement(state);
});
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
