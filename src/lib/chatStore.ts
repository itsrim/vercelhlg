import type { ChatMessage, PostMessageBody } from "./types.js";

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const memoryStore = new Map<string, ChatMessage[]>();

function prune(messages: ChatMessage[]): ChatMessage[] {
  const cutoff = Date.now() - RETENTION_MS;
  return messages.filter((m) => m.sentAt >= cutoff);
}

function sortMessages(messages: ChatMessage[]): ChatMessage[] {
  return [...messages].sort((a, b) => a.sentAt - b.sentAt);
}

export function createMessageId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function listMessages(
  conversationId: string,
  since?: number,
): Promise<ChatMessage[]> {
  const all = sortMessages(prune(memoryStore.get(conversationId) ?? []));

  if (since == null || Number.isNaN(since)) return all;
  return all.filter((m) => m.sentAt > since);
}

export async function addMessage(
  conversationId: string,
  body: PostMessageBody,
  author: { id: string; displayName: string },
): Promise<ChatMessage> {
  const text = body.text?.trim();
  if (!text) throw new Error("text is required");

  const message: ChatMessage = {
    id: body.id?.trim() || createMessageId(),
    conversationId,
    authorId: author.id,
    authorName: author.displayName,
    text,
    sentAt: body.sentAt ?? Date.now(),
  };

  const current = sortMessages(prune(memoryStore.get(conversationId) ?? []));
  if (current.some((m) => m.id === message.id)) return message;

  memoryStore.set(conversationId, sortMessages([...current, message]));
  return message;
}

export function storageMode(): "memory" {
  return "memory";
}
