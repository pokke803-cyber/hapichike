import { getParentSession, onParentAuthStateChange, updateParentPassword } from "../src/services/api/authApi.js";
import { isSupabaseConfigured } from "../src/lib/supabaseClient.js";

const STAGING_PROJECT_REF = "dhmkpqrfaukfbuoaenhk";

const elements = Object.fromEntries([
  "configView", "loadingView", "loginRequiredView", "passwordView", "successView",
  "passwordForm", "newPasswordInput", "confirmPasswordInput", "passwordError",
  "submitButton", "goToLoginButton", "goToParentButton",
].map((id) => [id, document.getElementById(id)]));

let passwordWasUpdated = false;
let recoverySessionReady = [
  new URLSearchParams(window.location.search).get("type"),
  new URLSearchParams(window.location.hash.slice(1)).get("type"),
].includes("recovery");

function showOnly(view) {
  [
    elements.configView,
    elements.loadingView,
    elements.loginRequiredView,
    elements.passwordView,
    elements.successView,
  ].forEach((element) => { element.hidden = element !== view; });
}

function isStagingProject() {
  try {
    return new URL(import.meta.env.VITE_SUPABASE_URL).hostname === `${STAGING_PROJECT_REF}.supabase.co`;
  } catch {
    return false;
  }
}

function safeErrorMessage(error, password) {
  const fallback = "パスワードを設定できませんでした。時間をおいてもう一度お試しください。";
  const message = typeof error?.message === "string" ? error.message.trim() : "";
  if (!message) return fallback;
  return password ? message.split(password).join("[非表示]") : message;
}

function handleSession(event, session) {
  if (passwordWasUpdated) return;
  if (event === "PASSWORD_RECOVERY") recoverySessionReady = true;
  if (!session || !recoverySessionReady) {
    elements.passwordForm.reset();
    elements.passwordError.textContent = "";
    showOnly(elements.loginRequiredView);
    return;
  }
  showOnly(elements.passwordView);
}

elements.passwordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const newPassword = elements.newPasswordInput.value;
  const confirmedPassword = elements.confirmPasswordInput.value;
  elements.passwordError.textContent = "";

  if (newPassword.length < 16) {
    elements.passwordError.textContent = "パスワードは16文字以上で入力してください。";
    return;
  }
  if (newPassword !== confirmedPassword) {
    elements.passwordError.textContent = "パスワードが一致しません。";
    return;
  }

  elements.submitButton.disabled = true;
  elements.submitButton.textContent = "設定中...";
  try {
    await updateParentPassword(newPassword);
    passwordWasUpdated = true;
    elements.passwordForm.reset();
    showOnly(elements.successView);
  } catch (error) {
    elements.passwordError.textContent = safeErrorMessage(error, newPassword);
  } finally {
    elements.submitButton.disabled = false;
    elements.submitButton.textContent = "パスワードを設定";
  }
});

elements.goToLoginButton.addEventListener("click", () => { window.location.href = "/parent"; });
elements.goToParentButton.addEventListener("click", () => { window.location.href = "/parent"; });

async function init() {
  if (!isSupabaseConfigured() || !isStagingProject()) {
    showOnly(elements.configView);
    return;
  }
  try {
    onParentAuthStateChange((event, nextSession) => {
      queueMicrotask(() => handleSession(event, nextSession));
    });
    const { session } = await getParentSession();
    handleSession("INITIAL_SESSION", session);
  } catch (error) {
    showOnly(elements.loginRequiredView);
  }
}

init();
