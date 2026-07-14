import type { PushSubscriptionPayload } from "./types.js";

export interface StoredPushSubscription extends PushSubscriptionPayload {
  id: string;
}

const subscriptionsByUser = new Map<string, StoredPushSubscription[]>();

function subscriptionId(endpoint: string): string {
  return endpoint.slice(-48);
}

export function addPushSubscription(
  userId: string,
  subscription: PushSubscriptionPayload,
): StoredPushSubscription {
  const current = subscriptionsByUser.get(userId) ?? [];
  const id = subscriptionId(subscription.endpoint);
  const next = current.filter((s) => s.endpoint !== subscription.endpoint);
  const stored: StoredPushSubscription = { ...subscription, id };
  next.push(stored);
  subscriptionsByUser.set(userId, next);
  return stored;
}

export function removePushSubscription(userId: string, endpoint?: string): void {
  if (!endpoint) {
    subscriptionsByUser.delete(userId);
    return;
  }
  const current = subscriptionsByUser.get(userId) ?? [];
  subscriptionsByUser.set(
    userId,
    current.filter((s) => s.endpoint !== endpoint),
  );
}

export function getPushSubscriptionsForUsers(userIds: string[]): StoredPushSubscription[] {
  const out: StoredPushSubscription[] = [];
  for (const userId of userIds) {
    out.push(...(subscriptionsByUser.get(userId) ?? []));
  }
  return out;
}
