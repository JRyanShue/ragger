import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { Turbopuffer } from "@turbopuffer/turbopuffer";
import { OpenAI } from "openai";
import { db } from "@/db";
import { hoaDocMetadata } from "@/db/schema";
import { inArray } from "drizzle-orm";

const RAG_TOP_K = 3;
const FUSION_ALPHA = 0.5; // Weight for vector search (0-1), BM25 weight is (1 - alpha)

interface RankedResult {
  id: string;
  score: number;
}

function weightedFusion(
  vectorResults: any[],
  bm25Results: any[],
  alpha: number = FUSION_ALPHA
): RankedResult[] {
  const scores: { [key: string]: number } = {};

  const normalize = (arr: any[]) => {
    const scores = arr.map((r) => r.dist ?? 0);
    console.log("Scores before normalization:", scores);
    const max = Math.max(...scores);
    const min = Math.min(...scores);
    const range = max - min || 1; // Avoid division by zero

    console.log("Range:", range);

    return arr.map((r) => ({
      id: r.id,
      score: ((r.dist ?? 0) - min) / range
    }));
  };

  const vNorm = normalize(vectorResults);
  const bNorm = normalize(bm25Results);

  console.log("Vector results:", vNorm);
  console.log("BM25 results:", bNorm);

  for (const r of vNorm) {
    scores[r.id] = (scores[r.id] || 0) + alpha * r.score;
  }

  console.log("Scores:", scores);

  for (const r of bNorm) {
    scores[r.id] = (scores[r.id] || 0) + (1 - alpha) * r.score;
  }

  console.log("Scores 2:", scores);

  return Object.entries(scores)
    .sort(([, a], [, b]) => b - a)
    .map(([id, score]) => ({ id, score }));
}

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

    // Query turbopuffer for relevant context using hybrid search
    const tpuf = new Turbopuffer({
      apiKey: process.env.TURBOPUFFER_API_KEY,
      region: "gcp-us-central1",
    });

    const ns = tpuf.namespace(process.env.TURBOPUFFER_NAMESPACE || "default");

    // Multi-query: Vector Search + BM25
    const hybridResult = await ns.multiQuery({
      queries: [
        {
          rank_by: ["vector", "ANN", queryVector],
          top_k: RAG_TOP_K * 2, // Get more results for fusion
          include_attributes: ["text"],
        },
        {
          rank_by: ["text", "BM25", userQuery],
          top_k: RAG_TOP_K * 2, // Get more results for fusion
          include_attributes: ["text"],
        },
      ],
    });

    const vectorResults = hybridResult.results[0].rows || [];
    const bm25Results = hybridResult.results[1].rows || [];

    // Fuse results using weighted fusion
    const fusedResults = weightedFusion(vectorResults, bm25Results);

    // Take top K after fusion
    const topFusedIds = fusedResults.slice(0, RAG_TOP_K).map((r) => r.id);

    // Create a map to get full row data by ID
    const allRowsById = new Map();
    for (const row of vectorResults) {
      allRowsById.set(row.id, row);
    }
    for (const row of bm25Results) {
      if (!allRowsById.has(row.id)) {
        allRowsById.set(row.id, row);
      }
    }

    // Get the full rows for top fused results
    const ragResult = {
      rows: topFusedIds.map((id) => allRowsById.get(id)).filter(Boolean),
    };

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

    // Log hybrid search results
    console.log("\n=== Hybrid Search Results ===");
    console.log("Vector results:", vectorResults.map((r: any) => r.id));
    console.log("BM25 results:", bm25Results.map((r: any) => r.id));
    console.log("Fused results:", fusedResults.slice(0, RAG_TOP_K).map((r) => `${r.id} (score: ${r.score.toFixed(3)})`));
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


