const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const memoryStore = new Map();
function prune(messages) {
    const cutoff = Date.now() - RETENTION_MS;
    return messages.filter((m) => m.sentAt >= cutoff);
}
function sortMessages(messages) {
    return [...messages].sort((a, b) => a.sentAt - b.sentAt);
}
export function createMessageId() {
    return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
export async function listMessages(conversationId, since) {
    const all = sortMessages(prune(memoryStore.get(conversationId) ?? []));
    if (since == null || Number.isNaN(since))
        return all;
    return all.filter((m) => m.sentAt > since);
}
export async function addMessage(conversationId, body, author) {
    const text = body.text?.trim();
    if (!text)
        throw new Error("text is required");
    const message = {
        id: body.id?.trim() || createMessageId(),
        conversationId,
        authorId: author.id,
        authorName: author.displayName,
        text,
        sentAt: body.sentAt ?? Date.now(),
    };
    const current = sortMessages(prune(memoryStore.get(conversationId) ?? []));
    if (current.some((m) => m.id === message.id))
        return message;
    memoryStore.set(conversationId, sortMessages([...current, message]));
    return message;
}
export function storageMode() {
    return "memory";
}
