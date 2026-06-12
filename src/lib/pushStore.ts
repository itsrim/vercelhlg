import type { PushSubscriptionPayload } from "./types.js";
import {
  isSheetsReadConfigured,
  isSheetsWriteConfigured,
  sheetGet,
  sheetPost,
  sheetPut,
} from "./googleSheets.js";

export interface StoredPushSubscription extends PushSubscriptionPayload {
  id: string;
}

type PushRow = Record<string, string>;

const memoryByUser = new Map<string, StoredPushSubscription[]>();

function subscriptionId(endpoint: string): string {
  return endpoint.slice(-48);
}

function rowToSubscription(row: PushRow): StoredPushSubscription | null {
  const endpoint = row.endpoint?.trim();
  if (!endpoint || row.deleted === "true") return null;
  return {
    id: row.id?.trim() || subscriptionId(endpoint),
    endpoint,
    expirationTime: row.expirationTime ? Number(row.expirationTime) : null,
    keys: {
      p256dh: row.p256dh?.trim() ?? "",
      auth: row.auth?.trim() ?? "",
    },
  };
}

async function loadUserSubscriptions(userId: string): Promise<StoredPushSubscription[]> {
  if (isSheetsReadConfigured()) {
    const rows = await sheetGet<PushRow>("push_subscriptions");
    return rows
      .filter((r) => r.userId?.trim() === userId)
      .map(rowToSubscription)
      .filter((s): s is StoredPushSubscription => s != null);
  }
  return memoryByUser.get(userId) ?? [];
}

export async function addPushSubscription(
  userId: string,
  subscription: PushSubscriptionPayload,
): Promise<StoredPushSubscription> {
  const id = subscriptionId(subscription.endpoint);
  const stored: StoredPushSubscription = { ...subscription, id };

  if (isSheetsWriteConfigured()) {
    const existing = await loadUserSubscriptions(userId);
    const prev = existing.find((s) => s.endpoint === subscription.endpoint);
    if (prev) {
      await sheetPut("push_subscriptions", prev.id, {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        expirationTime: subscription.expirationTime != null ? String(subscription.expirationTime) : "",
        deleted: "false",
      });
    } else {
      await sheetPost("push_subscriptions", {
        userId,
        id,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        expirationTime: subscription.expirationTime != null ? String(subscription.expirationTime) : "",
        deleted: "false",
      });
    }
    return stored;
  }

  const current = memoryByUser.get(userId) ?? [];
  const next = current.filter((s) => s.endpoint !== subscription.endpoint);
  next.push(stored);
  memoryByUser.set(userId, next);
  return stored;
}

export async function removePushSubscription(
  userId: string,
  endpoint?: string,
): Promise<void> {
  if (isSheetsWriteConfigured()) {
    const subs = await loadUserSubscriptions(userId);
    if (!endpoint) {
      for (const s of subs) {
        await sheetPut("push_subscriptions", s.id, { deleted: "true" });
      }
      return;
    }
    const match = subs.find((s) => s.endpoint === endpoint);
    if (match) {
      await sheetPut("push_subscriptions", match.id, { deleted: "true" });
    }
    return;
  }

  if (!endpoint) {
    memoryByUser.delete(userId);
    return;
  }
  const current = memoryByUser.get(userId) ?? [];
  memoryByUser.set(
    userId,
    current.filter((s) => s.endpoint !== endpoint),
  );
}

export async function getPushSubscriptionsForUsers(
  userIds: string[],
): Promise<StoredPushSubscription[]> {
  const out: StoredPushSubscription[] = [];
  for (const userId of userIds) {
    out.push(...(await loadUserSubscriptions(userId)));
  }
  return out;
}
