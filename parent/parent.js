import { isSupabaseConfigured } from "../src/lib/supabaseClient.js";
import {
  getParentSession, onParentAuthStateChange, requestParentPasswordReset,
  signInParent, signOutParent,
} from "../src/services/api/authApi.js";
import { getCurrentHouseholds } from "../src/services/api/householdsApi.js";
import { getChildrenByHousehold } from "../src/services/api/childrenApi.js";
import { getChildBalances } from "../src/services/api/rewardsApi.js";
import { getRecentRewardLogs } from "../src/services/api/historyApi.js";
import "../src/parent/parent-runtime-core.js";
import "../src/child-identity-core.js";
import "../src/backup-core.js";
import "../src/parent/parent-runtime.js";

const elements = Object.fromEntries([
  "configView", "loginView", "loadingView", "dashboardView", "loginForm", "emailInput", "passwordInput",
  "loginButton", "loginError", "loginRetryButton", "logoutButton", "parentEmail", "showPasswordResetButton", "passwordResetPanel",
  "passwordResetForm", "resetEmailInput", "passwordResetMessage", "passwordResetButton", "showLoginButton",
  "dashboardError", "householdEmpty", "dashboardContent", "householdField", "householdSelect", "childTabs",
  "childrenEmpty", "childSelectionEmpty", "childContent", "selectedChildName", "balanceLoading", "balanceEmpty",
  "balanceGrid", "balanceUpdated", "choresList", "logsLoading", "logsList", "refreshRuntimeButton",
  "refreshChildButton", "authStatus", "connectionStatus", "householdStatus", "childrenStatus", "localV1Status", "localV2Status",
  "detailsStatus", "finalStatus", "localProfileStatus",
].map(id => [id, document.getElementById(id)]));

const runtime = globalThis.HapichikeParentRuntime.createParentRuntime({
  authApi: { getParentSession, onParentAuthStateChange },
  householdsApi: { getCurrentHouseholds },
  childrenApi: { getChildrenByHousehold },
  rewardsApi: { getChildBalances },
  historyApi: { getRecentRewardLogs },
  storage: window.localStorage,
  parsers: {
    parseLegacy: globalThis.HapichikeBackup.parseMainState,
    parseV2: globalThis.HapichikeChildIdentity.parseStore,
  },
});

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

if (!isSupabaseConfigured()) showOnly(elements.configView);
else void runtime.initializeParentRuntime();
