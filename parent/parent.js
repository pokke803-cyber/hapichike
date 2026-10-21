import { isSupabaseConfigured } from "../src/lib/supabaseClient.js";
import {
  getParentSession,
  onParentAuthStateChange,
  requestParentPasswordReset,
  signInParent,
  signOutParent,
} from "../src/services/api/authApi.js";
import { getCurrentHouseholds } from "../src/services/api/householdsApi.js";
import { getChildrenByHousehold } from "../src/services/api/childrenApi.js";
import { getChildBalances } from "../src/services/api/rewardsApi.js";
import { getRecentRewardLogs } from "../src/services/api/historyApi.js";

const elements = Object.fromEntries([
  "configView", "loginView", "loadingView", "dashboardView", "loginForm", "emailInput",
  "passwordInput", "loginButton", "loginError", "logoutButton", "parentEmail",
  "showPasswordResetButton", "passwordResetPanel", "passwordResetForm", "resetEmailInput",
  "passwordResetMessage", "passwordResetButton", "showLoginButton",
  "dashboardError", "householdEmpty", "dashboardContent", "householdField",
  "householdSelect", "childTabs", "childrenEmpty", "childContent", "selectedChildName",
  "balanceLoading", "balanceEmpty", "balanceGrid", "balanceUpdated", "choresList",
  "logsLoading", "logsList",
].map((id) => [id, document.getElementById(id)]));

const state = {
  user: null,
  households: [],
  householdId: null,
  children: [],
  childId: null,
  loadToken: 0,
};

function showOnly(view) {
  [elements.configView, elements.loginView, elements.loadingView, elements.dashboardView]
    .forEach((element) => { element.hidden = element !== view; });
}

function setDashboardError(message = "") {
  elements.dashboardError.textContent = message;
  elements.dashboardError.hidden = !message;
}

function showLoginMode(mode = "login") {
  const showsPasswordReset = mode === "password-reset";
  elements.loginForm.hidden = showsPasswordReset;
  elements.showPasswordResetButton.hidden = showsPasswordReset;
  elements.passwordResetPanel.hidden = !showsPasswordReset;
  if (!showsPasswordReset) {
    elements.passwordResetForm.reset();
    elements.passwordResetMessage.textContent = "";
    elements.passwordResetMessage.classList.remove("is-success");
  }
}

function friendlyError(error, fallback) {
  if (error?.message?.toLowerCase().includes("invalid login credentials")) {
    return "メールアドレスまたはパスワードを確認してください。";
  }
  return fallback;
}

async function handleSession(session) {
  state.loadToken += 1;
  state.user = session?.user ?? null;
  if (!state.user) {
    state.households = [];
    state.householdId = null;
    state.children = [];
    state.childId = null;
    elements.loginForm.reset();
    elements.loginError.textContent = "";
    showLoginMode();
    showOnly(elements.loginView);
    return;
  }
  showOnly(elements.loadingView);
  elements.parentEmail.textContent = state.user.email ?? "";
  await loadHouseholds();
}

async function loadHouseholds() {
  const token = ++state.loadToken;
  try {
    const households = await getCurrentHouseholds(state.user.id);
    if (token !== state.loadToken) return;
    state.households = households ?? [];
    state.householdId = state.households.some(({ id }) => id === state.householdId)
      ? state.householdId
      : state.households[0]?.id ?? null;
    renderHouseholds();
    showOnly(elements.dashboardView);
    if (!state.householdId) return;
    await loadChildren();
  } catch (error) {
    if (token !== state.loadToken) return;
    showOnly(elements.dashboardView);
    elements.householdEmpty.hidden = true;
    elements.dashboardContent.hidden = true;
    setDashboardError(friendlyError(error, "データを読み込めませんでした。Supabase接続を確認してください。"));
  }
}

function renderHouseholds() {
  setDashboardError();
  const hasHouseholds = state.households.length > 0;
  elements.householdEmpty.hidden = hasHouseholds;
  elements.dashboardContent.hidden = !hasHouseholds;
  elements.householdField.hidden = state.households.length < 2;
  elements.householdSelect.replaceChildren(...state.households.map((household) => {
    const option = document.createElement("option");
    option.value = household.id;
    option.textContent = household.name;
    option.selected = household.id === state.householdId;
    return option;
  }));
}

async function loadChildren() {
  const token = ++state.loadToken;
  elements.childrenEmpty.hidden = true;
  elements.childContent.hidden = true;
  elements.childTabs.innerHTML = "";
  try {
    const children = await getChildrenByHousehold(state.householdId);
    if (token !== state.loadToken) return;
    state.children = children ?? [];
    state.childId = state.children.some(({ id }) => id === state.childId)
      ? state.childId
      : state.children[0]?.id ?? null;
    renderChildren();
    if (state.childId) await loadChildData();
  } catch (error) {
    if (token !== state.loadToken) return;
    setDashboardError(friendlyError(error, "子どものデータを読み込めませんでした。"));
  }
}

function renderChildren() {
  const hasChildren = state.children.length > 0;
  elements.childrenEmpty.hidden = hasChildren;
  elements.childContent.hidden = !hasChildren;
  elements.childTabs.replaceChildren(...state.children.map((child) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "child-tab";
    button.dataset.childId = child.id;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(child.id === state.childId));
    button.textContent = `${child.icon ? `${child.icon} ` : ""}${child.name}`;
    return button;
  }));
  const selectedChild = state.children.find(({ id }) => id === state.childId);
  elements.selectedChildName.textContent = selectedChild?.name ?? "";
}

async function loadChildData() {
  const token = ++state.loadToken;
  elements.balanceLoading.hidden = false;
  elements.logsLoading.hidden = false;
  elements.balanceGrid.innerHTML = "";
  elements.logsList.innerHTML = "";
  elements.choresList.innerHTML = "";
  elements.balanceEmpty.hidden = true;
  setDashboardError();
  try {
    const [balance, logs] = await Promise.all([
      getChildBalances(state.childId),
      getRecentRewardLogs(state.childId, 20),
    ]);
    if (token !== state.loadToken) return;
    renderBalance(balance);
    renderLogs(logs ?? []);
  } catch (error) {
    if (token !== state.loadToken) return;
    elements.balanceGrid.innerHTML = "";
    elements.logsList.innerHTML = "";
    elements.choresList.innerHTML = "";
    setDashboardError(friendlyError(error, "選択中の子どものデータを読み込めませんでした。"));
  } finally {
    if (token === state.loadToken) {
      elements.balanceLoading.hidden = true;
      elements.logsLoading.hidden = true;
    }
  }
}

function renderBalance(balance) {
  elements.balanceEmpty.hidden = Boolean(balance);
  elements.balanceUpdated.textContent = balance?.updated_at
    ? `更新 ${formatDateTime(balance.updated_at)}`
    : "";
  if (!balance) {
    elements.balanceGrid.innerHTML = "";
    return;
  }
  const stars = Number(balance.star_coins) || 0;
  const starNote = stars >= 5
    ? "5つそろっています"
    : `あと${5 - stars}つでチケット！`;
  const cards = [
    ["🎟", "チケット", `${balance.tickets} 枚`, ""],
    ["⭐", "スターコイン", `${stars} / 5`, starNote, Math.min(stars / 5, 1) * 100],
    ["🍩", "SweetsPAY", `${balance.sweets_pay} P`, ""],
    ["🤖", "ToyPAY", `${balance.toy_pay} P`, ""],
    ["🎮", "GamePAY", `${balance.game_pay} P`, ""],
    ["💖", "ハピチャン", `${balance.happy_chance_cards} 枚`, ""],
  ];
  elements.balanceGrid.replaceChildren(...cards.map(([icon, label, value, note, progress]) => {
    const card = document.createElement("article");
    card.className = "balance-card";
    const labelElement = document.createElement("div");
    labelElement.className = "balance-label";
    labelElement.innerHTML = `<span class="balance-icon" aria-hidden="true">${icon}</span>`;
    labelElement.append(document.createTextNode(label));
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
  renderLogList(elements.choresList, logs.filter((log) => taskTypes.has(log.type)).slice(0, 10), "まだお手伝い履歴はありません。");
}

function renderLogList(container, logs, emptyMessage) {
  if (logs.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-line";
    empty.textContent = emptyMessage;
    container.replaceChildren(empty);
    return;
  }
  container.replaceChildren(...logs.map((log) => {
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
  return ({
    ticket_added: "チケット獲得",
    star_coin_added: "スターコイン獲得",
    pay_adjusted: "PAYポイント変更",
    today_task_reward: "お手伝い完了",
    task_completed: "お手伝い完了",
    star_coin_exchange: "スター交換",
    parent_gift: "おうちの人からのプレゼント",
    help_job_reward: "掲示板報酬",
    help_board_reward: "掲示板報酬",
  })[type] ?? type ?? "報酬履歴";
}

function amountLabel(log) {
  const amount = Number(log.amount);
  if (!Number.isFinite(amount)) return typeLabel(log.type);
  const sign = amount > 0 ? "+" : "";
  if (log.type === "star_coin_added") return `⭐ ${sign}${amount}`;
  if (log.type === "pay_adjusted") {
    const pay = { sweets: "🍩", toy: "🤖", game: "🎮" }[log.metadata?.pay_type] ?? "PAY";
    return `${pay} ${sign}${amount}P`;
  }
  if (log.type === "today_task_reward" || log.type === "help_job_reward") {
    return log.metadata?.reward_type === "starCoin" ? `⭐ +${amount}` : `🎟 +${amount}`;
  }
  if (log.type === "star_coin_exchange") return `🎟 +${amount}`;
  if (log.type.includes("ticket") || log.type === "parent_gift") return `🎟 ${sign}${amount}`;
  return `${sign}${amount}`;
}

function formatShortDate(value) {
  if (!value) return "--";
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" }).format(new Date(value));
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

elements.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.loginError.textContent = "";
  elements.loginButton.disabled = true;
  elements.loginButton.textContent = "ログイン中...";
  try {
    await signInParent(elements.emailInput.value.trim(), elements.passwordInput.value);
  } catch (error) {
    elements.loginError.textContent = friendlyError(error, "ログインできませんでした。時間をおいてもう一度お試しください。");
  } finally {
    elements.loginButton.disabled = false;
    elements.loginButton.textContent = "ログイン";
  }
});

elements.showPasswordResetButton.addEventListener("click", () => {
  elements.resetEmailInput.value = elements.emailInput.value.trim();
  elements.loginError.textContent = "";
  showLoginMode("password-reset");
  elements.resetEmailInput.focus();
});

elements.showLoginButton.addEventListener("click", () => {
  showLoginMode();
  elements.emailInput.focus();
});

elements.passwordResetForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = elements.resetEmailInput.value.trim();
  elements.passwordResetMessage.textContent = "";
  elements.passwordResetMessage.classList.remove("is-success");
  elements.passwordResetButton.disabled = true;
  elements.passwordResetButton.textContent = "送信中...";
  try {
    await requestParentPasswordReset(email);
    elements.passwordResetMessage.textContent = "パスワード再設定メールを送信しました。\nメールをご確認ください。";
    elements.passwordResetMessage.classList.add("is-success");
  } catch (error) {
    elements.passwordResetMessage.textContent = friendlyError(error, "再設定メールを送信できませんでした。時間をおいてもう一度お試しください。");
  } finally {
    elements.passwordResetButton.disabled = false;
    elements.passwordResetButton.textContent = "再設定メールを送る";
  }
});

elements.logoutButton.addEventListener("click", async () => {
  elements.logoutButton.disabled = true;
  try {
    await signOutParent();
  } catch (error) {
    setDashboardError(friendlyError(error, "ログアウトできませんでした。"));
  } finally {
    elements.logoutButton.disabled = false;
  }
});

elements.householdSelect.addEventListener("change", async () => {
  state.householdId = elements.householdSelect.value;
  state.childId = null;
  await loadChildren();
});

elements.childTabs.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-child-id]");
  if (!button || button.dataset.childId === state.childId) return;
  state.childId = button.dataset.childId;
  renderChildren();
  await loadChildData();
});

async function init() {
  if (!isSupabaseConfigured()) {
    showOnly(elements.configView);
    return;
  }
  try {
    const { session } = await getParentSession();
    onParentAuthStateChange((_event, nextSession) => {
      queueMicrotask(() => handleSession(nextSession));
    });
    await handleSession(session);
  } catch (error) {
    showOnly(elements.loginView);
    elements.loginError.textContent = friendlyError(error, "Supabaseに接続できませんでした。接続設定を確認してください。");
  }
}

init();
