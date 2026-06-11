import { verifyToken } from "../lib/authStore.js";
import { addMessage, listMessages } from "../lib/chatStore.js";
import { addUserToConversation, syncUserConversations, } from "../lib/memberStore.js";
import { isPushConfigured, notifyConversationMembers } from "../lib/pushService.js";
function roomName(conversationId) {
    return `conversation:${conversationId}`;
}
function userRoom(userId) {
    return `user:${userId}`;
}
export function registerChatSocket(io) {
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
        socket.data.user = user;
        next();
    });
    io.on("connection", (socket) => {
        const user = socket.data.user;
        void socket.join(userRoom(user.id));
        socket.on("user:sync", (payload) => {
            const conversationIds = Array.isArray(payload?.conversationIds)
                ? payload.conversationIds
                : [];
            syncUserConversations(user.id, conversationIds);
            for (const conversationId of conversationIds) {
                const id = conversationId.trim();
                if (!id)
                    continue;
                void socket.join(roomName(id));
            }
        });
        socket.on("conversation:join", async (payload) => {
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
            }
            catch (err) {
                const error = err instanceof Error ? err.message : "Unexpected error";
                socket.emit("chat:error", { error });
            }
        });
        socket.on("conversation:leave", (payload) => {
            const conversationId = payload?.conversationId?.trim();
            if (!conversationId)
                return;
            void socket.leave(roomName(conversationId));
        });
        socket.on("message:send", async (payload) => {
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
                io.to(roomName(conversationId)).emit("message:new", { message });
                if (isPushConfigured()) {
                    void notifyConversationMembers(conversationId, user.id, {
                        title: message.authorName,
                        body: message.text.slice(0, 140),
                        url: `/?chat=${conversationId}`,
                    });
                }
            }
            catch (err) {
                const error = err instanceof Error ? err.message : "Unexpected error";
                socket.emit("chat:error", { error });
            }
        });
    });
}
