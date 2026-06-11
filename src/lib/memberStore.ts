const membersByConversation = new Map<string, Set<string>>();

function ensureSet(map: Map<string, Set<string>>, key: string): Set<string> {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  return set;
}

export function syncUserConversations(userId: string, conversationIds: string[]): void {
  const normalized = [...new Set(conversationIds.map((id) => id.trim()).filter(Boolean))];

  for (const [, members] of membersByConversation) {
    members.delete(userId);
  }

  for (const conversationId of normalized) {
    ensureSet(membersByConversation, conversationId).add(userId);
  }
}

export function addUserToConversation(userId: string, conversationId: string): void {
  const id = conversationId.trim();
  if (!id) return;
  ensureSet(membersByConversation, id).add(userId);
}

export function getConversationMemberIds(conversationId: string): string[] {
  return [...(membersByConversation.get(conversationId) ?? [])];
}
