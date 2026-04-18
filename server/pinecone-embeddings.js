/**
 * Custom Pinecone embeddings wrapper compatible with @pinecone-database/pinecone v7+
 *
 * @langchain/pinecone@1.0.1's PineconeEmbeddings passes positional args to
 * inference.embed(model, texts, params) — but the v7 SDK changed the signature
 * to inference.embed({ model, inputs, parameters }).  This class calls v7 correctly.
 */
import { Embeddings } from "@langchain/core/embeddings";
import { Pinecone } from "@pinecone-database/pinecone";

export class PineconeEmbeddingsV7 extends Embeddings {
  constructor(fields = {}) {
    super({ maxRetries: 3, ...fields });
    this.model = fields.model ?? "multilingual-e5-large";
    // Lazily create the Pinecone client so the class can be instantiated before
    // env vars are available, as long as embeddings aren't called before them.
    this._pc = null;
  }

  _getClient() {
    if (!this._pc) {
      const apiKey = process.env.PINECONE_API_KEY;
      if (!apiKey) throw new Error("Missing PINECONE_API_KEY");
      this._pc = new Pinecone({ apiKey });
    }
    return this._pc;
  }

  async embedDocuments(texts) {
    if (!texts || texts.length === 0)
      throw new Error("At least one document is required to generate embeddings");

    const pc = this._getClient();
    const result = await this.caller.call(() =>
      pc.inference.embed({
        model: this.model,
        inputs: texts,
        parameters: { inputType: "passage" },
      })
    );

    return result.data.map((item) => item.values ?? []);
  }

  async embedQuery(text) {
    if (!text) throw new Error("No query provided for embedding");

    const pc = this._getClient();
    const result = await this.caller.call(() =>
      pc.inference.embed({
        model: this.model,
        inputs: [text],
        parameters: { inputType: "query" },
      })
    );

    return result.data[0]?.values ?? [];
  }
}
