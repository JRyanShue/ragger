import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";

export async function POST(req: Request) {
  try {
    const { messages, model } = await req.json();

    const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const result = await generateText({
      model: openai(model ?? "gpt-4o"),
      messages,
    });

    return new Response(
      JSON.stringify({ text: result.text }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("/api/chat error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to generate response" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}


