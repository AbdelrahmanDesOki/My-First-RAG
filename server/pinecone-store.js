/**
 * Custom Pinecone vector store compatible with @pinecone-database/pinecone v7+
 *
 * @langchain/pinecone@1.0.1 calls namespace.upsert(records[]) — the old v5/v6
 * positional-array signature.  Pinecone SDK v7 changed this to
 * namespace.upsert({ records: [...] }).  This module bypasses @langchain/pinecone
 * entirely for both writes (addDocuments) and reads (similaritySearch) so the app
 * works correctly with the v7 SDK.
 */
import { randomUUID } from "node:crypto";
import { Document } from "@langchain/core/documents";
import { Pinecone } from "@pinecone-database/pinecone";
import { PineconeEmbeddingsV7 } from "./pinecone-embeddings.js";
import flatLib from "flat";
const { flatten, unflatten } = flatLib;

const TEXT_KEY = "text"; // key used to store pageContent in Pinecone metadata

function getPineconeClient() {
  const apiKey = process.env.PINECONE_API_KEY;
  if (!apiKey) throw new Error("Missing PINECONE_API_KEY");
  return new Pinecone({ apiKey });
}

function getIndex(pc) {
  const indexName = process.env.PINECONE_INDEX;
  if (!indexName) throw new Error("Missing PINECONE_INDEX");
  return pc.Index(indexName);
}

function getEmbeddings() {
  return new PineconeEmbeddingsV7({ model: "llama-text-embed-v2" });
}

/**
 * Embed and upsert an array of LangChain Documents into Pinecone.
 * Batches in chunks of 96 (Pinecone's max batch size for inference).
 */
export async function addDocuments(docs) {
  if (!docs || docs.length === 0) return;

  const pc = getPineconeClient();
  const index = getIndex(pc);
  const embeddings = getEmbeddings();

  const BATCH = 96;

  for (let i = 0; i < docs.length; i += BATCH) {
    const batch = docs.slice(i, i + BATCH);
    const texts = batch.map((d) => d.pageContent);
    const vectors = await embeddings.embedDocuments(texts);

    const records = vectors.map((values, idx) => {
      // Pinecone only accepts flat metadata (no nested objects).
      // flatten() turns { loc: { pageNumber: 1 } } → { "loc.pageNumber": 1 }
      const flatMeta = flatten(batch[idx].metadata ?? {});
      // Strip any keys whose value is null/undefined/empty-object
      for (const k of Object.keys(flatMeta)) {
        const v = flatMeta[k];
        if (v == null) delete flatMeta[k];
        else if (typeof v === "object" && Object.keys(v).length === 0) delete flatMeta[k];
      }
      return {
        id: randomUUID(),
        values,
        metadata: { [TEXT_KEY]: batch[idx].pageContent, ...flatMeta },
      };
    });

    await index.namespace("").upsert({ records });
    console.log(`  ↑ upserted batch ${Math.floor(i / BATCH) + 1} (${records.length} docs)`);
  }
}

/**
 * Embed a query string and return the top-k most similar Documents from Pinecone.
 * Returns LangChain Document objects so the rest of the code is unchanged.
 */
export async function similaritySearch(query, k = 5) {
  const pc = getPineconeClient();
  const index = getIndex(pc);
  const embeddings = getEmbeddings();

  const queryVector = await embeddings.embedQuery(query);

  const results = await index.namespace("").query({
    topK: k,
    vector: queryVector,
    includeMetadata: true,
  });

  return (results.matches ?? []).map((match) => {
    // unflatten() restores { "loc.pageNumber": 1 } → { loc: { pageNumber: 1 } }
    const raw = unflatten(match.metadata ?? {});
    const pageContent = String(raw[TEXT_KEY] ?? "");
    delete raw[TEXT_KEY];
    return new Document({ pageContent, metadata: raw });
  });
}
