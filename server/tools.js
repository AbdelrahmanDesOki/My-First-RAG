import { tool } from "langchain";
import { z } from "zod";
import { similaritySearch } from "./pinecone-store.js";

// Raw search — returns full Document objects including metadata (used for citations)
export const rawSearch = async (query) => {
  console.log(`🔍 Searching Pinecone for: "${query}"`);
  const results = await similaritySearch(query, 5);
  results.forEach((r, i) =>
    console.log(`  [${i + 1}] ${r.pageContent.slice(0, 120)}…`)
  );
  return results;
};

// LangChain tool wrapper (kept for compatibility)
export const searchKnowledgeBase = tool(
  async ({ query }) => {
    const results = await rawSearch(query);
    if (results.length === 0)
      return "No relevant information found in the knowledge base.";
    return results.map((doc) => doc.pageContent).join("\n\n---\n\n");
  },
  {
    name: "search_knowledge_base",
    description:
      "Searches the internal knowledge base for information from uploaded PDF documents.",
    schema: z.object({
      query: z.string().describe("The search query to look up in the knowledge base"),
    }),
  }
);
