import dotenv from "dotenv";
dotenv.config({ override: true });

// Polyfill AbortSignal.any for Node.js < 20.3.0 (added in 20.3.0)
if (typeof AbortSignal.any !== "function") {
  AbortSignal.any = function any(signals) {
    const controller = new AbortController();
    for (const signal of signals) {
      if (signal.aborted) {
        controller.abort(signal.reason);
        return controller.signal;
      }
      signal.addEventListener(
        "abort",
        () => controller.abort(signal.reason),
        { once: true }
      );
    }
    return controller.signal;
  };
}

import express from "express";
import cors from "cors";
import multer from "multer";
import os from "node:os";
import path from "node:path";
import { unlink } from "node:fs/promises";
import { streamAgent } from "./agent.js";
import { ingestData } from "./ingest.js";

const app = express();
app.use(cors());
// Increase limit to 20 MB to support base64-encoded image payloads
app.use(express.json({ limit: "20mb" }));

// Multer for PDF uploads
const upload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || "");
      cb(null, `${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    const isPdf =
      file.mimetype === "application/pdf" ||
      (file.originalname || "").toLowerCase().endsWith(".pdf");
    cb(isPdf ? null : new Error("Only PDF files are allowed"), isPdf);
  },
  limits: { fileSize: 25 * 1024 * 1024 },
});

// Chat endpoint — streams response as Server-Sent Events (SSE)
app.post("/api/chat", async (req, res) => {
  const { message, sessionId, mode = "rag", imageData } = req.body;

  if (!message) return res.status(400).json({ error: "Message required" });

  // Set SSE headers (cors middleware has already set CORS headers via setHeader)
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);

  try {
    for await (const event of streamAgent({ message, sessionId, mode, imageData })) {
      if (res.writableEnded) break;
      send(event);
    }
  } catch (err) {
    console.error("❌ Stream error:", err);
    if (!res.writableEnded) {
      send({ type: "error", message: err.message });
    }
  } finally {
    if (!res.writableEnded) {
      res.write("data: [DONE]\n\n");
      res.end();
    }
  }
});

// Clear all vectors from Pinecone (reset knowledge base)
app.delete("/api/clear", async (_req, res) => {
  try {
    const { Pinecone } = await import("@pinecone-database/pinecone");
    const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
    const index = pc.Index(process.env.PINECONE_INDEX);

    // Discover all namespaces then delete each one
    const stats = await index.describeIndexStats();
    const namespaces = Object.keys(stats.namespaces ?? {});

    if (namespaces.length === 0) {
      // Index already empty — still try default namespace just in case
      await index.namespace("").deleteAll().catch(() => {});
    } else {
      for (const ns of namespaces) {
        await index.namespace(ns).deleteAll();
        console.log(`🗑️  Cleared namespace: "${ns || "(default)"}"`);
      }
    }

    console.log("✅ Knowledge base cleared");
    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Clear error:", err);
    res.status(500).json({ error: err.message });
  }
});

// PDF ingestion endpoint
app.post("/api/ingest", upload.single("file"), async (req, res) => {
  try {
    if (!req.file?.path) {
      return res.status(400).json({ error: "Missing PDF file" });
    }

    await ingestData(req.file.path);
    await unlink(req.file.path).catch(() => undefined);

    return res.json({ ok: true });
  } catch (err) {
    if (req.file?.path) {
      await unlink(req.file.path).catch(() => undefined);
    }
    return res.status(500).json({ error: err.message });
  }
});

app.listen(3001, () => console.log("🚀 Server running on port 3001"));
