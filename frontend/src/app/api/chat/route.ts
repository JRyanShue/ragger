import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { Turbopuffer } from "@turbopuffer/turbopuffer";
import { OpenAI } from "openai";
import { db } from "@/db";
import { hoaDocMetadata } from "@/db/schema";
import { inArray } from "drizzle-orm";

const RAG_TOP_K = 3;

export async function POST(req: Request) {
  try {
    const { messages, model } = await req.json();

    // Get the last user message for embedding
    const lastUserMessage = messages.filter((m: any) => m.role === "user").pop();
    const userQuery = lastUserMessage?.content || "";

    // Generate embedding for user query
    const openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const embeddingResponse = await openaiClient.embeddings.create({
      model: "text-embedding-3-large",
      input: userQuery,
    });
    const queryVector = embeddingResponse.data[0].embedding;

    // Query turbopuffer for relevant context
    const tpuf = new Turbopuffer({
      apiKey: process.env.TURBOPUFFER_API_KEY,
      region: "gcp-us-central1",
    });

    const ns = tpuf.namespace(process.env.TURBOPUFFER_NAMESPACE || "default");
    const ragResult = await ns.query({
      rank_by: ["vector", "ANN", queryVector],
      top_k: RAG_TOP_K,
      include_attributes: ["text"],
    });

    // Extract vector IDs from results
    const vectorIds = ragResult.rows?.map((row: any) => row.id) || [];

    // Query database for metadata
    let metadata: any[] = [];
    if (vectorIds.length > 0) {
      metadata = await db
        .select()
        .from(hoaDocMetadata)
        .where(inArray(hoaDocMetadata.vectorId, vectorIds));
    }

    // Create a map of vector_id -> metadata for easy lookup
    const metadataMap = new Map(
      metadata.map((m) => [m.vectorId, m])
    );

    // Log retrieved documents with their metadata
    console.log("\n=== Retrieved Documents ===");
    ragResult.rows?.forEach((row: any, index: number) => {
      const meta = metadataMap.get(row.id);
      console.log(`\nDocument ${index + 1}:`);
      console.log("Vector ID:", row.id);
      console.log(row);
      console.log("Text Preview:", row.text.substring(0, 200) + "...");
      console.log("Metadata:", meta ? {
        id: meta.id,
        communitySlug: meta.communitySlug,
        type: meta.type,
        title: meta.title,
        filePath: meta.filePath,
        contentHash: meta.contentHash,
        createdAt: meta.createdAt,
      } : "No metadata found");
    });
    console.log("\n========================\n");

    // Build context block from retrieved documents
    const contextItems = ragResult.rows
      ?.map((row: any) => row.text || "")
      .filter((text: string) => text.length > 0) || [];

    const contextBlock = contextItems.length > 0
      ? `START CONTEXT BLOCK\n${contextItems.join("\n\n")}\nEND OF CONTEXT BLOCK`
      : "";

    // Inject context into system prompt
    const systemPrompt = `You are a helpful HOA (Homeowners Association) assistant. You help residents with questions about HOA rules, regulations, amenities, maintenance requests, and community guidelines. Be professional, friendly, and informative in your responses.

${contextBlock}`;

    console.log("System prompt:", systemPrompt);

    const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const result = await generateText({
      model: openai(model ?? "gpt-4o"),
      system: systemPrompt,
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


