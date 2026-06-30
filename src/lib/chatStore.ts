import type { ChatMessage, PostMessageBody } from "./types.js";
import {
  isSheetsReadConfigured,
  isSheetsWriteConfigured,
  sheetGet,
  sheetPost,
} from "./googleSheets.js";

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const memoryStore = new Map<string, ChatMessage[]>();

type MessageRow = Record<string, string>;

function prune(messages: ChatMessage[]): ChatMessage[] {
  const cutoff = Date.now() - RETENTION_MS;
  return messages.filter((m) => m.sentAt >= cutoff);
}

function sortMessages(messages: ChatMessage[]): ChatMessage[] {
  return [...messages].sort((a, b) => a.sentAt - b.sentAt);
}

function rowToMessage(row: MessageRow): ChatMessage | null {
  const id = row.id?.trim();
  const conversationId = row.conversationId?.trim();
  if (!id || !conversationId) return null;
  return {
    id,
    conversationId,
    authorId: row.authorId?.trim() || "",
    authorName: row.authorName?.trim() || "",
    text: row.text ?? "",
    sentAt: Number(row.sentAt) || 0,
  };
}

export function createMessageId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

async function loadConversationMessages(
  conversationId: string,
): Promise<ChatMessage[]> {
  if (isSheetsReadConfigured()) {
    const rows = await sheetGet<MessageRow>("messages");
    const messages = rows
      .filter((r) => r.conversationId?.trim() === conversationId)
      .map(rowToMessage)
      .filter((m): m is ChatMessage => m != null);
    return sortMessages(prune(messages));
  }
  return sortMessages(prune(memoryStore.get(conversationId) ?? []));
}

export async function listMessages(
  conversationId: string,
  since?: number,
): Promise<ChatMessage[]> {
  const all = await loadConversationMessages(conversationId);
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

  const current = await loadConversationMessages(conversationId);
  if (current.some((m) => m.id === message.id)) return message;

  if (isSheetsWriteConfigured()) {
    await sheetPost("messages", {
      conversationId,
      id: message.id,
      authorId: message.authorId,
      authorName: message.authorName,
      text: message.text,
      sentAt: String(message.sentAt),
      userId: message.authorId,
    });
  } else {
    memoryStore.set(conversationId, sortMessages([...current, message]));
  }

  return message;
}

export function storageMode(): "sheets" | "memory" {
  return isSheetsReadConfigured() ? "sheets" : "memory";
}
