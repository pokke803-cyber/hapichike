(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.HapichikeProfileMigrationUi = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const BALANCE_FIELDS = Object.freeze([
    Object.freeze({ key: "tickets", cloud: "tickets", label: "Tickets" }),
    Object.freeze({ key: "starCoins", cloud: "star_coins", label: "Star Coins" }),
    Object.freeze({ key: "sweetsPay", cloud: "sweets_pay", label: "SweetsPAY" }),
    Object.freeze({ key: "toyPay", cloud: "toy_pay", label: "ToyPAY" }),
    Object.freeze({ key: "gamePay", cloud: "game_pay", label: "GamePAY" }),
    Object.freeze({ key: "happyChanceCards", cloud: "happy_chance_cards", label: "Happy Chance" }),
  ]);

  function backupBalances(balances) {
    return Object.fromEntries(BALANCE_FIELDS.map(field => [field.cloud, balances?.[field.key]]));
  }

  function compareBalances(localBalances, cloudBalances) {
    return BALANCE_FIELDS.map(field => {
      const local = localBalances?.[field.key];
      const cloud = cloudBalances?.[field.cloud];
      return { ...field, local, cloud, matches: Number.isFinite(local) && Number.isFinite(cloud) && local === cloud };
    });
  }

  function approvalsComplete(approvals) {
    return approvals?.owner === true
      && approvals?.backup === true
      && approvals?.preview === true
      && approvals?.cloudUnchanged === true;
  }

  function canApply(input = {}) {
    return input.sourceValid === true
      && input.selectedChildValid === true
      && input.previewCanApply === true
      && input.backupCurrent === true
      && approvalsComplete(input.approvals)
      && input.applying !== true
      && input.completed !== true;
  }

  function householdSelection(households = [], currentHouseholdId = null) {
    const householdId = households.some(household => household.id === currentHouseholdId)
      ? currentHouseholdId
      : households[0]?.id ?? null;
    return {
      householdId,
      showSelect: households.length >= 2,
      options: households.map(household => ({ value: household.id, label: household.name })),
    };
  }

  function childSelectOptions(children = []) {
    return [
      { value: "", label: "明示的に選択してください" },
      ...children.map(child => ({
        value: child.id,
        label: child.nickname ? `${child.name}（${child.nickname}）` : child.name,
      })),
    ];
  }

  function loadChildrenForHousehold(loader, householdId) {
    return loader(householdId);
  }

  function safeError(error) {
    const message = String(error?.message || "").toLowerCase();
    if (/backup missing|backup.*required/.test(message)) return "最新バックアップがありません。データ管理からバックアップを書き出してください。";
    if (/already been migrated|duplicate/.test(message)) return "この端末データは移行済みです。重複移行はできません。";
    if (/source state changed|preview token/.test(message)) return "確認後に元データが変更されました。もう一度プレビューしてください。";
    if (/conflict/.test(message)) return "現在のデータ構造に競合があります。移行前に確認が必要です。";
    if (/explicit scope|unknown legacy/.test(message)) return "分類が必要な旧データがあります。移行前に確認が必要です。";
    if (/safety.*readback|safety copy/.test(message)) return "安全用コピーを作成できなかったため、移行を中止しました。";
    if (/readback/.test(message)) return "移行後の確認に失敗しました。以前のv2データへ戻しました。";
    if (/rollback failed/.test(message)) return "移行と復元に失敗しました。旧データは変更せず保持されています。手動確認が必要です。";
    if (/migration failed|write|quota/.test(message)) return "書き込みに失敗しました。以前のv2データへ戻しました。";
    if (/targetdisplayname|explicitly selected/.test(message)) return "選択した子どもの情報が不正です。";
    if (/kidsvegascasino\.v1|invalid json|must be/.test(message)) return "移行元の旧データを安全に読み取れませんでした。";
    return "子どもデータの移行に失敗しました。旧データは保持されています。";
  }

  return Object.freeze({
    BALANCE_FIELDS,
    backupBalances,
    compareBalances,
    approvalsComplete,
    canApply,
    householdSelection,
    childSelectOptions,
    loadChildrenForHousehold,
    safeError,
  });
});
