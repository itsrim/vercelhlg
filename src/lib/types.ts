export interface ChatMessage {
  id: string;
  conversationId: string;
  authorId: string;
  authorName: string;
  text: string;
  sentAt: number;
}

export interface PostMessageBody {
  id?: string;
  text: string;
  sentAt?: number;
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  emailVerified?: boolean;
}

export interface PushSubscriptionPayload {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}
