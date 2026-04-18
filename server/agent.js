import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { searchKnowledgeBase } from "./tools.js";

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

const SYSTEM_PROMPT = `You are a document assistant. You answer questions strictly based on the document context provided to you.

Rules you must follow:
1. Answer ONLY using information found in the provided context.
2. If the context does not contain a clear answer, respond with: "I don't have enough information in the provided documents to answer this question."
3. Do not use your general knowledge or make assumptions beyond what the context states.
4. Be concise, clear, and accurate.
5. If the context partially answers the question, share what you found and note what is missing.`;

export async function runAgent({
  sessionId = "default",
  message,
  mode = "rag",
}) {
  console.log(`[agent] RAG query — sessionId: ${sessionId}`);

  try {
    // Step 1: Retrieve relevant chunks from Pinecone
    console.log(`🔍 Searching knowledge base for: "${message}"`);
    const context = await searchKnowledgeBase.invoke({ query: message });

    // Step 2: Send context + question to Claude in a single call
    const response = await getModel().invoke([
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(
        `Here is the relevant context retrieved from the documents:\n\n${context}\n\n---\n\nQuestion: ${message}`,
      ),
    ]);

    const output =
      typeof response.content === "string"
        ? response.content
        : response.content.map((c) => c.text ?? "").join("");

    console.log(`✅ Response: ${output.slice(0, 100)}...`);

    return { output, mode };
  } catch (error) {
    console.error("❌ Error in runAgent:", error);
    throw error;
  }
}
