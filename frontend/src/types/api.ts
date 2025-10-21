import type { users, conversations, messages, queries } from '@/db/schema';

// Infer types from schema
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;

export type Query = typeof queries.$inferSelect;
export type NewQuery = typeof queries.$inferInsert;

// API request/response types
export interface CreateConversationRequest {
  title?: string;
}

export interface CreateMessageRequest {
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface CreateQueryRequest {
  query: string;
  conversationId?: string;
  response?: string;
  tokensUsed?: number;
}

export interface GetMessagesResponse {
  messages: Message[];
  conversation: Conversation;
}

export interface GetConversationsResponse {
  conversations: (Conversation & { messageCount: number })[];
}

export interface GetQueriesResponse {
  queries: Query[];
  total: number;
}
