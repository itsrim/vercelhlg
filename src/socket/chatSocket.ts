import type { Server, Socket } from "socket.io";
import { verifyToken } from "../lib/authStore.js";
import { addMessage, listMessages } from "../lib/chatStore.js";
import {
  addUserToConversation,
  syncUserConversations,
} from "../lib/memberStore.js";
import { isPushConfigured, notifyConversationMembers } from "../lib/pushService.js";
import type { AuthUser, PostMessageBody } from "../lib/types.js";
import { broadcastNewMessage } from "../lib/messageBroadcast.js";

function roomName(conversationId: string): string {
  return `conversation:${conversationId}`;
}

function userRoom(userId: string): string {
  return `user:${userId}`;
}

export function registerChatSocket(io: Server) {
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (typeof token !== "string" || !token.trim()) {
      next(new Error("Unauthorized"));
      return;
    }

    const user = await verifyToken(token);
    if (!user) {
      next(new Error("Unauthorized"));
      return;
    }

    socket.data.user = user satisfies AuthUser;
    next();
  });

  io.on("connection", (socket: Socket) => {
    const user = socket.data.user as AuthUser;
    void socket.join(userRoom(user.id));

    socket.on("user:sync", (payload: { conversationIds?: string[] }) => {
      const conversationIds = Array.isArray(payload?.conversationIds)
        ? payload.conversationIds
        : [];
      syncUserConversations(user.id, conversationIds);

      for (const conversationId of conversationIds) {
        const id = conversationId.trim();
        if (!id) continue;
        void socket.join(roomName(id));
      }
    });

    socket.on("conversation:join", async (payload: { conversationId?: string }) => {
      const conversationId = payload?.conversationId?.trim();
      if (!conversationId) {
        socket.emit("chat:error", { error: "conversationId is required" });
        return;
      }

      addUserToConversation(user.id, conversationId);
      await socket.join(roomName(conversationId));

      try {
        const messages = await listMessages(conversationId);
        socket.emit("message:history", { conversationId, messages });
      } catch (err) {
        const error = err instanceof Error ? err.message : "Unexpected error";
        socket.emit("chat:error", { error });
      }
    });

    socket.on("conversation:leave", (payload: { conversationId?: string }) => {
      const conversationId = payload?.conversationId?.trim();
      if (!conversationId) return;
      void socket.leave(roomName(conversationId));
    });

    socket.on(
      "friend-request:send",
      (payload: {
        recipientUserId?: string;
        visit?: {
          id?: string;
          name?: string;
          age?: number;
          avatarUrl?: string;
          lastVisitAt?: number;
          friendRequest?: boolean;
        };
        notification?: {
          id?: string;
          createdAt?: number;
          kind?: string;
          inviteeProfilId?: string;
          inviteeName?: string;
          senderName?: string;
        };
      }) => {
        const recipientUserId = payload?.recipientUserId?.trim();
        const visit = payload?.visit;
        const notification = payload?.notification;
        if (!recipientUserId || recipientUserId === user.id) return;
        if (!visit?.id || visit.id !== user.id) return;
        if (!notification?.id || notification.kind !== "friend_request_received") return;

        io.to(userRoom(recipientUserId)).emit("friend-request:new", {
          visit: {
            id: visit.id,
            name: visit.name?.trim() || user.displayName,
            age: typeof visit.age === "number" ? visit.age : 25,
            avatarUrl: visit.avatarUrl?.trim() || "",
            lastVisitAt: visit.lastVisitAt ?? Date.now(),
            friendRequest: true,
          },
          notification: {
            id: notification.id,
            createdAt: notification.createdAt ?? Date.now(),
            kind: "friend_request_received",
            inviteeProfilId: visit.id,
            inviteeName: notification.inviteeName?.trim() || user.displayName,
            senderName: notification.senderName?.trim() || user.displayName,
          },
        });
      },
    );

    socket.on(
      "friend-request:respond",
      (payload: {
        recipientUserId?: string;
        action?: string;
        notification?: {
          id?: string;
          createdAt?: number;
          kind?: string;
          inviteeProfilId?: string;
          inviteeName?: string;
          senderName?: string;
        };
      }) => {
        const recipientUserId = payload?.recipientUserId?.trim();
        const action = payload?.action?.trim();
        const notification = payload?.notification;
        if (!recipientUserId || recipientUserId === user.id) return;
        if (action !== "accepted" && action !== "rejected") return;
        if (!notification?.id) return;

        const expectedKind =
          action === "accepted"
            ? "friend_request_accepted"
            : "friend_request_rejected";
        if (notification.kind !== expectedKind) return;
        if (notification.inviteeProfilId?.trim() !== user.id) return;

        const eventName =
          action === "accepted" ? "friend-request:accepted" : "friend-request:rejected";

        io.to(userRoom(recipientUserId)).emit(eventName, {
          notification: {
            id: notification.id,
            createdAt: notification.createdAt ?? Date.now(),
            kind: expectedKind,
            inviteeProfilId: user.id,
            inviteeName:
              notification.inviteeName?.trim() || user.displayName,
            senderName: notification.senderName?.trim() || user.displayName,
          },
        });
      },
    );

    socket.on(
      "friend:remove",
      (payload: {
        recipientUserId?: string;
        removerUserId?: string;
        removerName?: string;
      }) => {
        const recipientUserId = payload?.recipientUserId?.trim();
        const removerUserId = payload?.removerUserId?.trim();
        if (!recipientUserId || recipientUserId === user.id) return;
        if (!removerUserId || removerUserId !== user.id) return;

        io.to(userRoom(recipientUserId)).emit("friend:removed", {
          removerUserId: user.id,
          removerName: payload?.removerName?.trim() || user.displayName,
        });
      },
    );

    socket.on(
      "event-invite:send",
      (payload: {
        recipientUserId?: string;
        notification?: {
          id?: string;
          createdAt?: number;
          kind?: string;
          eventId?: string;
          eventTitle?: string;
          inviteeProfilId?: string;
          inviteeName?: string;
          senderName?: string;
        };
      }) => {
        const recipientUserId = payload?.recipientUserId?.trim();
        const notification = payload?.notification;
        if (!recipientUserId || recipientUserId === user.id) return;
        if (!notification?.id || notification.kind !== "event_invite_received") return;
        if (notification.inviteeProfilId?.trim() !== recipientUserId) return;
        if (!notification.eventId?.trim()) return;

        io.to(userRoom(recipientUserId)).emit("event-invite:new", {
          notification: {
            id: notification.id,
            createdAt: notification.createdAt ?? Date.now(),
            kind: "event_invite_received",
            eventId: notification.eventId.trim(),
            eventTitle: notification.eventTitle?.trim() || "",
            inviteeProfilId: recipientUserId,
            inviteeName: notification.inviteeName?.trim() || "",
            senderName: notification.senderName?.trim() || user.displayName,
          },
        });
      },
    );

    socket.on(
      "waitlist:respond",
      (payload: {
        recipientUserId?: string;
        action?: "accepted" | "rejected";
        eventId?: string;
        eventTitle?: string;
      }) => {
        const recipientUserId = payload?.recipientUserId?.trim();
        const action = payload?.action?.trim();
        const eventId = payload?.eventId?.trim();
        const eventTitle = payload?.eventTitle?.trim();
        if (!recipientUserId || recipientUserId === user.id) return;
        if (action !== "accepted" && action !== "rejected") return;
        if (!eventId) return;

        const eventName = action === "accepted" ? "waitlist:accepted" : "waitlist:rejected";

        io.to(userRoom(recipientUserId)).emit(eventName, {
          eventId,
          eventTitle: eventTitle || "un événement",
          organizerName: user.displayName,
        });
      },
    );

    socket.on("group:member-added", (payload: { conversationId?: string; targetUserId?: string; conversation?: { id: string; title: string } }) => {
      const conversationId = payload?.conversationId?.trim();
      const targetUserId = payload?.targetUserId?.trim();
      if (!conversationId || !targetUserId || targetUserId === user.id) return;

      // Le créateur rejoint la room de la conversation
      void socket.join(roomName(conversationId));
      addUserToConversation(user.id, conversationId);

      // Notifie le nouveau membre
      io.to(userRoom(targetUserId)).emit("group:you-added", {
        conversationId,
        addedByUserId: user.id,
        addedByName: user.displayName,
        conversation: payload.conversation ?? { id: conversationId, title: "" },
      });
    });

    socket.on(
      "badge:seen",
      (payload: {
        key?: string;
        lastSeenAt?: Record<string, number>;
        updatedAt?: number;
      }) => {
        const key = payload?.key?.trim();
        const updatedAt = payload?.updatedAt;
        if (!key || typeof updatedAt !== "number") return;

        socket.to(userRoom(user.id)).emit("badge:seen", {
          key,
          lastSeenAt: payload.lastSeenAt ?? {},
          updatedAt,
        });
      },
    );

    socket.on("message:send", async (payload: PostMessageBody & { conversationId?: string }) => {
      const conversationId = payload?.conversationId?.trim();
      if (!conversationId) {
        socket.emit("chat:error", { error: "conversationId is required" });
        return;
      }

      try {
        addUserToConversation(user.id, conversationId);
        const message = await addMessage(conversationId, payload, {
          id: user.id,
          displayName: user.displayName,
        });

        const recipientUserIds = Array.isArray(payload.recipientUserIds)
          ? payload.recipientUserIds.filter((id): id is string => typeof id === "string")
          : [];

        broadcastNewMessage(io, message, user.id, recipientUserIds);

        if (isPushConfigured()) {
          void notifyConversationMembers(conversationId, user.id, {
            title: message.authorName,
            body: message.text.slice(0, 140),
            url: `/?chat=${conversationId}`,
          });
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : "Unexpected error";
        socket.emit("chat:error", { error });
      }
    });
  });
}

export type { AuthUser };
