"use client";

import { useState, useEffect } from "react";
import { UserButton } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Send } from "lucide-react";

type Message = {
  id: string;
  content: string;
  role: "user" | "assistant";
  createdAt: Date;
};

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  // Initialize user and conversation on mount
  useEffect(() => {
    const initialize = async () => {
      try {
        // Ensure user exists in database
        await fetch('/api/users', { method: 'POST' });

        // Create a new conversation
        const convRes = await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'New Chat' }),
        });

        if (!convRes.ok) throw new Error('Failed to create conversation');

        const conversation = await convRes.json();
        setConversationId(conversation.id);

        // Load existing messages for this conversation
        const messagesRes = await fetch(`/api/messages?conversationId=${conversation.id}`);
        if (messagesRes.ok) {
          const data = await messagesRes.json();
          setMessages(data.messages.map((m: any) => ({
            ...m,
            createdAt: new Date(m.createdAt),
          })));
        }
      } catch (error) {
        console.error('Failed to initialize:', error);
      } finally {
        setIsInitializing(false);
      }
    };

    initialize();
  }, []);

  const handleSend = async () => {
    if (!input.trim() || isLoading || !conversationId) return;

    const userMessageContent = input;
    setInput("");
    setIsLoading(true);

    try {
      // Save user message to database
      const userMsgRes = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          role: 'user',
          content: userMessageContent,
        }),
      });

      if (!userMsgRes.ok) throw new Error('Failed to save user message');

      const userMessage = await userMsgRes.json();
      setMessages((prev) => [...prev, {
        ...userMessage,
        createdAt: new Date(userMessage.createdAt),
      }]);

      // Call backend API to generate AI response with conversation context
      const chatMessages = [
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: userMessageContent },
      ];

      const aiRes = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: chatMessages }),
      });
      if (!aiRes.ok) throw new Error('AI backend error');
      const { text: aiResponse } = await aiRes.json();

      // Save assistant message to database
      const assistantMsgRes = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          role: 'assistant',
          content: aiResponse,
        }),
      });

      if (!assistantMsgRes.ok) throw new Error('Failed to save assistant message');

      const assistantMessage = await assistantMsgRes.json();
      setMessages((prev) => [...prev, {
        ...assistantMessage,
        createdAt: new Date(assistantMessage.createdAt),
      }]);

      // Track query in database
      await fetch('/api/queries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          query: userMessageContent,
          response: aiResponse,
          tokensUsed: 0, // Update when you have actual token count
        }),
      });
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (isInitializing) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="border-b p-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Chat</h1>
        <UserButton />
      </header>

      <Card className="flex-1 m-4 flex flex-col border-0 shadow-none">
        <CardHeader className="border-b">
          <h2 className="text-lg font-semibold">Conversation</h2>
        </CardHeader>

        <CardContent className="flex-1 p-0">
          <ScrollArea className="h-full p-4">
            <div className="space-y-4">
              {messages.length === 0 ? (
                <div className="text-center text-muted-foreground mt-8">
                  <p>No messages yet. Start a conversation!</p>
                </div>
              ) : (
                messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex gap-3 ${
                      message.role === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    {message.role === "assistant" && (
                      <Avatar className="h-8 w-8">
                        <AvatarFallback>AI</AvatarFallback>
                      </Avatar>
                    )}
                    <div
                      className={`rounded-lg px-4 py-2 max-w-[70%] ${
                        message.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted"
                      }`}
                    >
                      <p className="text-sm">{message.content}</p>
                    </div>
                    {message.role === "user" && (
                      <Avatar className="h-8 w-8">
                        <AvatarFallback>U</AvatarFallback>
                      </Avatar>
                    )}
                  </div>
                ))
              )}
              {isLoading && (
                <div className="flex gap-3 justify-start">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback>AI</AvatarFallback>
                  </Avatar>
                  <div className="bg-muted rounded-lg px-4 py-2">
                    <p className="text-sm text-muted-foreground">Typing...</p>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </CardContent>

        <CardFooter className="border-t p-4">
          <div className="flex w-full gap-2">
            <Input
              placeholder="Type your message..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              disabled={isLoading}
              className="flex-1"
            />
            <Button onClick={handleSend} disabled={isLoading || !input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
