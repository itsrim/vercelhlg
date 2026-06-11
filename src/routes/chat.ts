import type { FastifyInstance } from "fastify";
import { requireAuth } from "./auth.js";
import { addMessage, listMessages } from "../lib/chatStore.js";
import type { PostMessageBody } from "../lib/types.js";
import { isPushConfigured, notifyConversationMembers } from "../lib/pushService.js";

export async function chatRoutes(app: FastifyInstance) {
  app.get<{ Params: { conversationId: string }; Querystring: { since?: string } }>(
    "/api/chat/:conversationId",
    async (request, reply) => {
      await requireAuth(request, reply);
      if (reply.sent) return;

      const conversationId = request.params.conversationId.trim();
      if (!conversationId) {
        return reply.status(400).send({ error: "conversationId is required" });
      }

      const sinceRaw = request.query.since;
      const since =
        sinceRaw != null && sinceRaw !== "" ? Number(sinceRaw) : undefined;
      const sinceValid = since != null && Number.isFinite(since) ? since : undefined;

      try {
        const messages = await listMessages(conversationId, sinceValid);
        return { conversationId, messages };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unexpected error";
        return reply.status(500).send({ error: message });
      }
    },
  );

  app.post<{ Params: { conversationId: string }; Body: PostMessageBody }>(
    "/api/chat/:conversationId",
    async (request, reply) => {
      await requireAuth(request, reply);
      if (reply.sent || !request.authUser) return;

      const conversationId = request.params.conversationId.trim();
      if (!conversationId) {
        return reply.status(400).send({ error: "conversationId is required" });
      }

      try {
        const message = await addMessage(conversationId, request.body ?? {}, {
          id: request.authUser.id,
          displayName: request.authUser.displayName,
        });

        if (isPushConfigured()) {
          void notifyConversationMembers(conversationId, request.authUser.id, {
            title: message.authorName,
            body: message.text.slice(0, 140),
            url: `/?chat=${conversationId}`,
          });
        }

        return reply.status(201).send({ message });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unexpected error";
        const status = message.includes("required") ? 400 : 500;
        return reply.status(status).send({ error: message });
      }
    },
  );
}
