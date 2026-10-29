import { requireSupabase, unwrap } from "./apiClient.js";

export const getChildBalances = (childId) => unwrap(requireSupabase().from("child_balances").select("child_id, tickets, star_coins, sweets_pay, toy_pay, game_pay, happy_chance_cards").eq("child_id", childId).maybeSingle());

function normalizeLogOptions(options) {
  if (typeof options === "string" || options === null) {
    return { title: null, message: options, metadata: {} };
  }

  return {
    title: options?.title ?? null,
    message: options?.message ?? null,
    metadata: options?.metadata ?? {},
  };
}

const rewardRpc = (name, args) => unwrap(requireSupabase().rpc(name, args));

export function addTicket(childId, amount, options = null) {
  const { title, message, metadata } = normalizeLogOptions(options);
  return rewardRpc("add_ticket", {
    p_child_id: childId,
    p_amount: amount,
    p_title: title,
    p_message: message,
    p_metadata: metadata,
  });
}

export function addStarCoin(childId, amount, options = null) {
  const { title, message, metadata } = normalizeLogOptions(options);
  return rewardRpc("add_star_coin", {
    p_child_id: childId,
    p_amount: amount,
    p_title: title,
    p_message: message,
    p_metadata: metadata,
  });
}

export function exchangeStarCoinsForTicket(childId, options = null) {
  const { title, message, metadata } = normalizeLogOptions(options);
  return rewardRpc("exchange_star_coins_for_ticket", {
    p_child_id: childId,
    p_title: title,
    p_message: message,
    p_metadata: metadata,
  });
}

export function adjustPayBalance(childId, payType, amount, options = null) {
  const { title, message, metadata } = normalizeLogOptions(options);
  return rewardRpc("adjust_pay_balance", {
    p_child_id: childId,
    p_pay_type: payType,
    p_amount: amount,
    p_title: title,
    p_message: message,
    p_metadata: metadata,
  });
}

export function adjustHappyChance(childId, amount, options = null) {
  const { title, message, metadata } = normalizeLogOptions(options);
  return rewardRpc("adjust_happy_chance", {
    p_child_id: childId,
    p_amount: amount,
    p_title: title,
    p_message: message,
    p_metadata: metadata,
  });
}

export function importInitialHapichikeSnapshot(preview, options = {}) {
  const balances = preview?.balances ?? {};
  return rewardRpc("import_initial_hapichike_snapshot", {
    p_child_id: preview?.child_id,
    p_import_id: preview?.import_id,
    p_import_version: preview?.import_version,
    p_source_snapshot_hash: preview?.source_snapshot_hash,
    p_tickets: balances.tickets,
    p_star_coins: balances.star_coins,
    p_sweets_pay: balances.sweets_pay,
    p_toy_pay: balances.toy_pay,
    p_game_pay: balances.game_pay,
    p_happy_chance_cards: balances.happy_chance_cards,
    p_backup_created_at: preview?.backup_created_at,
    p_parent_approved: preview?.parent_approved,
    p_title: options.title ?? "初回データ移行",
    p_metadata: options.metadata ?? {},
  });
}
