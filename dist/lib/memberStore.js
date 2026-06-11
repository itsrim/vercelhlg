const membersByConversation = new Map();
function ensureSet(map, key) {
    let set = map.get(key);
    if (!set) {
        set = new Set();
        map.set(key, set);
    }
    return set;
}
export function syncUserConversations(userId, conversationIds) {
    const normalized = [...new Set(conversationIds.map((id) => id.trim()).filter(Boolean))];
    for (const [, members] of membersByConversation) {
        members.delete(userId);
    }
    for (const conversationId of normalized) {
        ensureSet(membersByConversation, conversationId).add(userId);
    }
}
export function addUserToConversation(userId, conversationId) {
    const id = conversationId.trim();
    if (!id)
        return;
    ensureSet(membersByConversation, id).add(userId);
}
export function getConversationMemberIds(conversationId) {
    return [...(membersByConversation.get(conversationId) ?? [])];
}
