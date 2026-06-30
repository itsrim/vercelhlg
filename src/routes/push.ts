import type { FastifyInstance } from "fastify";
import { requireAuth } from "./auth.js";
import {
  addPushSubscription,
  removePushSubscription,
} from "../lib/pushStore.js";
import type { PushSubscriptionPayload } from "../lib/types.js";

export async function pushRoutes(app: FastifyInstance) {
  app.post<{ Body: PushSubscriptionPayload }>(
    "/api/push/subscribe",
    async (request, reply) => {
      await requireAuth(request, reply);
      if (reply.sent || !request.authUser) return;

      const body = request.body;
      if (!body?.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
        return reply.status(400).send({ error: "Invalid push subscription" });
      }

      const subscription = await addPushSubscription(request.authUser.id, body);
      return reply.status(201).send({ ok: true, subscriptionId: subscription.id });
    },
  );

  app.delete<{ Body: { endpoint?: string } }>(
    "/api/push/unsubscribe",
    async (request, reply) => {
      await requireAuth(request, reply);
      if (reply.sent || !request.authUser) return;

      await removePushSubscription(request.authUser.id, request.body?.endpoint);
      return { ok: true };
    },
  );
}
