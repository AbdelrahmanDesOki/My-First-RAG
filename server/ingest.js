import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { addDocuments } from "./pinecone-store.js";

export const ingestData = async (filePath) => {
  const loader = new PDFLoader(filePath);
  const docs = await loader.load();

  const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 1000, chunkOverlap: 200 });
  const chunks = await splitter.splitDocuments(docs);

  console.log(`📄 Ingesting ${chunks.length} chunks from "${filePath}"…`);
  await addDocuments(chunks);
  console.log("✅ Ingestion Complete!");
};
