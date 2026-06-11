const subscriptionsByUser = new Map();
function subscriptionId(endpoint) {
    return endpoint.slice(-48);
}
export function addPushSubscription(userId, subscription) {
    const current = subscriptionsByUser.get(userId) ?? [];
    const id = subscriptionId(subscription.endpoint);
    const next = current.filter((s) => s.endpoint !== subscription.endpoint);
    const stored = { ...subscription, id };
    next.push(stored);
    subscriptionsByUser.set(userId, next);
    return stored;
}
export function removePushSubscription(userId, endpoint) {
    if (!endpoint) {
        subscriptionsByUser.delete(userId);
        return;
    }
    const current = subscriptionsByUser.get(userId) ?? [];
    subscriptionsByUser.set(userId, current.filter((s) => s.endpoint !== endpoint));
}
export function getPushSubscriptionsForUsers(userIds) {
    const out = [];
    for (const userId of userIds) {
        out.push(...(subscriptionsByUser.get(userId) ?? []));
    }
    return out;
}
