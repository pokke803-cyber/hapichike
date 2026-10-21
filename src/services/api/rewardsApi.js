import { requireSupabase, unwrap } from "./apiClient.js";

export const getChildBalances = (childId) => unwrap(requireSupabase().from("child_balances").select("*").eq("child_id", childId).maybeSingle());

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
