import webpush from "web-push";
import { getConversationMemberIds } from "./memberStore.js";
import { getPushSubscriptionsForUsers } from "./pushStore.js";

let configured = false;

function ensureConfigured(): boolean {
  if (configured) return true;

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:hello@hlg.app";

  if (!publicKey || !privateKey) return false;

  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export function isPushConfigured(): boolean {
  return ensureConfigured();
}

export async function notifyConversationMembers(
  conversationId: string,
  excludeUserId: string,
  payload: { title: string; body: string; url?: string },
): Promise<void> {
  if (!ensureConfigured()) return;

  const memberIds = getConversationMemberIds(conversationId).filter(
    (id) => id !== excludeUserId,
  );
  if (memberIds.length === 0) return;

  const subscriptions = await getPushSubscriptionsForUsers(memberIds);
  const data = JSON.stringify(payload);

  await Promise.allSettled(
    subscriptions.map((subscription) =>
      webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          expirationTime: subscription.expirationTime ?? undefined,
          keys: subscription.keys,
        },
        data,
      ),
    ),
  );
}
