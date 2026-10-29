import { isSupabaseConfigured } from "./lib/supabaseClient.js";
import { getParentSession } from "./services/api/authApi.js";
import { getCurrentHouseholds } from "./services/api/householdsApi.js";
import { getChildrenByHousehold } from "./services/api/childrenApi.js";
import { getChildBalances } from "./services/api/rewardsApi.js";

const core = window.HapichikeCloudMapping;
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
};

const state = { localChild: null, households: [], householdId: null, children: [], mappingDocument: null };

function text(value) {
  return String(value ?? "");
}

function setStatus(message, kind = "") {
  view.status.textContent = message;
  view.status.className = `edit-error${kind ? ` pay-message ${kind}` : ""}`;
}

function resetComparison(message = "対応するクラウドChildを選んでください。") {
  view.comparison.innerHTML = `<p class="parent-note">${text(message)}</p>`;
  view.readiness.textContent = "Mapping required";
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
  const verified = core.findVerifiedMapping(state.mappingDocument, state.localChild.localChildKey, state.householdId, state.children);
  view.child.value = verified?.supabaseChildId ?? "";
  view.save.disabled = !state.children.length;
}

function differenceLabel(row) {
  if (row.difference === null) return "欠損";
  if (row.difference === 0) return "±0";
  return `${row.difference > 0 ? "+" : ""}${row.difference}`;
}

async function renderComparison() {
  const childId = view.child.value;
  if (!childId) {
    resetComparison();
    return;
  }
  resetComparison("クラウド残高を読み込んでいます…");
  try {
    // Re-read the household-scoped child list before trusting either a saved or newly selected id.
    const visibleChildren = await getChildrenByHousehold(state.householdId);
    const child = visibleChildren.find(item => item.id === childId);
    if (!child) throw new Error("選択したChildは現在の家庭で確認できません。対応付けを保存・使用しません。");
    state.children = visibleChildren;
    const cloudBalance = await getChildBalances(childId);
    const rows = core.compareBalances(state.localChild, cloudBalance);
    view.comparison.innerHTML = `
      <div class="cloud-compare-row cloud-compare-head"><span>項目</span><span>Local</span><span>Cloud</span><span>差分</span></div>
      ${rows.map(row => `<div class="cloud-compare-row ${row.status}"><span>${text(row.label)}</span><span>${row.local}</span><span>${row.cloud ?? "欠損"}</span><span>${differenceLabel(row)}</span></div>`).join("")}
      <p class="parent-note">差分は Import candidate（Local − Cloud）です。表示のみで、送信・上書きはしません。</p>
    `;
    view.readiness.textContent = core.getImportReadiness(rows);
    setStatus(`接続中 / Parent login済み / household: ${state.households.find(item => item.id === state.householdId)?.name ?? "確認済み"}`, "success");
  } catch (error) {
    resetComparison("クラウド残高を比較できませんでした。");
    setStatus(error?.message || "ネットワークエラーが発生しました。");
  }
}

async function loadChildren() {
  state.children = await getChildrenByHousehold(state.householdId);
  renderChildren();
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
  view.householdRow.classList.add("hidden");
  view.child.innerHTML = '<option value="">明示的に選択してください</option>';
  view.save.disabled = true;
  setStatus("接続状態を確認しています…");
  resetComparison();
  try {
    state.localChild = core.readLocalChild(localStorage);
    state.mappingDocument = core.readMapping(localStorage);
    view.local.textContent = `${state.localChild.name}（単一ローカルプロフィール）`;
  } catch (error) {
    view.local.textContent = "読込不可";
    setStatus(error.message);
    view.save.disabled = true;
    return;
  }
  if (!isSupabaseConfigured()) {
    setStatus("Supabase未設定です。ローカルデータは変更していません。");
    return;
  }
  try {
    const { session } = await getParentSession();
    if (!session?.user) {
      setStatus("Parent未ログインです。親ダッシュボードでログインしてから戻ってください。");
      return;
    }
    state.households = await getCurrentHouseholds(session.user.id);
    if (!state.households.length) {
      setStatus("ログイン中ですが、所属householdがありません。");
      return;
    }
    const savedHouseholdId = state.mappingDocument.mappings.find(item => item.localChildKey === state.localChild.localChildKey)?.householdId;
    state.householdId = state.households.some(item => item.id === savedHouseholdId) ? savedHouseholdId : state.households[0].id;
    renderHouseholds();
    await loadChildren();
  } catch (error) {
    setStatus(error?.message || "Supabaseへの接続に失敗しました。");
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
    state.mappingDocument = core.saveMapping(localStorage, {
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

window.addEventListener("hapichike:open-cloud-mapping", openPanel);
