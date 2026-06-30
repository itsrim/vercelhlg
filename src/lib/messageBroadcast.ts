import type { Server } from "socket.io";
import type { ChatMessage } from "./types.js";
import {
  addUserToConversation,
  getConversationMemberIds,
} from "./memberStore.js";

function roomName(conversationId: string): string {
  return `conversation:${conversationId}`;
}

function userRoom(userId: string): string {
  return `user:${userId}`;
}

function parseDmParticipantIds(
  conversationId: string,
  senderUserId: string,
): string[] {
  if (!conversationId.startsWith("dm-")) return [];
  const rest = conversationId.slice(3);
  if (rest.includes("__")) {
    return rest.split("__").filter(Boolean);
  }
  if (rest && rest !== senderUserId) {
    return [senderUserId, rest];
  }
  return rest ? [senderUserId, rest] : [senderUserId];
}

export function broadcastNewMessage(
  io: Server,
  message: ChatMessage,
  senderUserId: string,
  recipientUserIds: string[] = [],
): void {
  io.to(roomName(message.conversationId)).emit("message:new", { message });

  const targets = new Set<string>();

  for (const id of getConversationMemberIds(message.conversationId)) {
    targets.add(id);
  }
  for (const id of parseDmParticipantIds(message.conversationId, senderUserId)) {
    targets.add(id);
    addUserToConversation(id, message.conversationId);
  }
  for (const raw of recipientUserIds) {
    const id = raw.trim();
    if (!id) continue;
    targets.add(id);
    addUserToConversation(id, message.conversationId);
  }

  for (const memberId of targets) {
    if (memberId === senderUserId) continue;
    io.to(userRoom(memberId)).emit("message:new", { message });
  }
}
