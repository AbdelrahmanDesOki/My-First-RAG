import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { rawSearch } from "./tools.js";

// Lazy singleton — created on first call so dotenv has already run
let model;
const getModel = () => {
  if (!model) {
    model = new ChatAnthropic({
      model: "claude-sonnet-4-6",
      temperature: 0,
    });
  }
  return model;
};

const SYSTEM_PROMPT = `You are a document assistant. Answer questions strictly based on the document context provided.

Rules:
1. Answer ONLY using information found in the provided context.
2. If the context does not contain a clear answer, respond with: "I don't have enough information in the provided documents to answer this question."
3. Do not use your general knowledge or make assumptions beyond what the context states.
4. Be concise, clear, and accurate.
5. If an image is provided, analyze it and relate it to the document context where relevant.`;

// Async generator — yields SSE-ready events for streaming
export async function* streamAgent({ sessionId = "default", message, imageData, mode = "rag" }) {
  console.log(`[agent] RAG stream — sessionId: ${sessionId}`);

  // Step 1: Retrieve relevant chunks from Pinecone (with metadata for citations)
  const results = await rawSearch(message);

  // Build citations from document metadata
  const citations = results.map((doc, i) => ({
    id: i + 1,
    source: doc.metadata?.source
      ? doc.metadata.source.split("/").pop()   // just the filename
      : "Document",
    page: doc.metadata?.loc?.pageNumber ?? doc.metadata?.page ?? null,
    snippet: doc.pageContent.slice(0, 180).trim() + "…",
  }));

  // Build numbered context string so Claude can reference sources
  const context =
    results.length > 0
      ? results.map((doc, i) => `[${i + 1}] ${doc.pageContent}`).join("\n\n---\n\n")
      : "No relevant documents found.";

  // Step 2: Build message content — text always, image optional
  const userContent = [];

  if (imageData) {
    // Parse "data:<mediaType>;base64,<data>" and normalise the media type
    const match = imageData.match(/^data:([^;]+);base64,(.+)$/s);
    if (match) {
      let mediaType = match[1].toLowerCase().trim();
      const base64Data = match[2];

      // Normalise non-standard aliases → Anthropic-accepted types
      if (mediaType === "image/jpg") mediaType = "image/jpeg";

      const VALID = ["image/jpeg", "image/png", "image/gif", "image/webp"];
      if (VALID.includes(mediaType)) {
        userContent.push({
          type: "image_url",
          image_url: { url: `data:${mediaType};base64,${base64Data}` },
        });
      } else {
        console.warn(`[agent] Unsupported image type "${mediaType}" — skipping image`);
      }
    }
  }

  userContent.push({
    type: "text",
    text: `Context from documents:\n\n${context}\n\n---\n\nQuestion: ${message}`,
  });

  // Step 3: Stream the response from Claude
  const stream = await getModel().stream([
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage({ content: userContent }),
  ]);

  for await (const chunk of stream) {
    const text =
      typeof chunk.content === "string"
        ? chunk.content
        : Array.isArray(chunk.content)
        ? chunk.content.map((c) => (typeof c === "string" ? c : (c?.text ?? ""))).join("")
        : "";

    if (text) yield { type: "chunk", text };
  }

  // Step 4: Send citations as the final event
  yield { type: "citations", data: citations };
}
