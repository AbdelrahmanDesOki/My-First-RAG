# Personal Assistant

An agentic personal assistant powered by **Claude (claude-sonnet-4-6)** that lets you upload PDFs, chat with your knowledge base, attach images to questions, and get cited, streamed answers in real time.

---

## Capabilities

### 📄 PDF Knowledge Base (RAG)
Upload one or more PDF documents and ask questions about their contents. The assistant searches your documents using **Pinecone** vector search and answers strictly from what it finds — if the answer isn't in your documents, it says so clearly rather than guessing.

- Answers are grounded exclusively in your uploaded documents
- Uploading multiple PDFs accumulates them all in the knowledge base
- Use **"Clear knowledge base"** in the sidebar to wipe everything and start fresh

### 🖼 Image Understanding (Vision)
Attach an image to any question using the image button in the chat composer. Claude will analyse the image **and** cross-reference it with your uploaded documents simultaneously.

- Supports JPEG, PNG, GIF, and WebP (up to ~4.5 MB after auto-compression)
- Images are automatically compressed in the browser if they exceed the size limit
- Useful for: diagrams, screenshots, charts, photos — ask what they mean relative to your docs

### ⚡ Streaming Responses
Answers stream word-by-word in real time using **Server-Sent Events (SSE)** — no waiting for the full response to generate before you see anything.

### 📎 Source Citations
Every answer includes a collapsible **"N sources"** section showing exactly which document chunks were used, including the filename and page number where available.

### 🗑 Knowledge Base Management
A **"Clear knowledge base"** button in the sidebar deletes all vectors from Pinecone so you can start fresh with a new document without old content interfering.

---

## Architecture

| Component | Port | Details |
|---|---|---|
| React client (Vite) | 5173 | Chat UI with sidebar, image attach, citations |
| Express server | 3001 | `/api/chat` (SSE stream), `/api/ingest` (PDF upload), `/api/clear` (reset KB) |
| Pinecone | cloud | Vector store for document embeddings |
| Anthropic (Claude) | cloud | `claude-sonnet-4-6` for answers + vision |

### How a query works
1. User message (+ optional image) hits `POST /api/chat`
2. Server searches Pinecone for the 5 most relevant chunks
3. Chunks + image (if any) are sent to Claude in a single call
4. Claude's response streams back token-by-token via SSE
5. Document citations are sent as a final SSE event

---

## Prerequisites

- Node.js 20.19+ (or 20.2+ with the bundled polyfills)
- An **Anthropic API key** (`claude-sonnet-4-6`)
- A **Pinecone** account and index (for RAG)
- (Optional) A **LangSmith** API key for tracing

---

## Setup

1. **Install all dependencies:**
   ```bash
   npm run install:all
   ```

2. **Configure environment variables:**
   ```bash
   cp server/.env.example server/.env
   ```
   Then edit `server/.env`:
   ```
   ANTHROPIC_API_KEY=...
   PINECONE_API_KEY=...
   PINECONE_INDEX=...
   LANGSMITH_API_KEY=...     # optional
   LANGSMITH_PROJECT=...     # optional
   ```

3. **Start the app:**
   ```bash
   npm run dev
   ```
   Opens the React client at **http://localhost:5173** and the Express server at **http://localhost:3001**.

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/chat` | Stream a chat response (SSE). Body: `{ message, sessionId?, imageData? }` |
| `POST` | `/api/ingest` | Upload and ingest a PDF. Body: `multipart/form-data` with `file` field |
| `DELETE` | `/api/clear` | Delete all vectors from the Pinecone index |

---

## Tips

- **Stale answers after uploading a new document?** Click **"Clear knowledge base"** first, then re-upload the new PDF. Old and new documents coexist in Pinecone — clearing ensures only the document you want is searched.
- **Image too large?** The app auto-compresses images in the browser before sending. If an image is still rejected, try a smaller or lower-resolution version.
- **No answer found?** The assistant will explicitly say *"I don't have enough information in the provided documents to answer this question"* rather than hallucinating.
