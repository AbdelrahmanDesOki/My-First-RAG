import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import "./App.css";

// ── Citations component ───────────────────────────────────────
function Citations({ citations }) {
  const [open, setOpen] = useState(false);
  if (!citations?.length) return null;

  return (
    <div className="citations">
      <button className="citationsToggle" onClick={() => setOpen((o) => !o)}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
        {citations.length} source{citations.length !== 1 ? "s" : ""}
        <span className="citationsChevron">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="citationsList">
          {citations.map((c) => (
            <div key={c.id} className="citationItem">
              <div className="citationMeta">
                <span className="citationNum">[{c.id}]</span>
                <span className="citationSource">{c.source}</span>
                {c.page && <span className="citationPage">p. {c.page}</span>}
              </div>
              <p className="citationSnippet">{c.snippet}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Image compression helper ─────────────────────────────────
function compressImage(file, maxBytes = 4.5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      // Start at full size, shrink until under maxBytes
      let scale = 1;
      let quality = 0.85;
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      const attempt = () => {
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        // Estimate byte size: base64 chars * 0.75
        const bytes = ((dataUrl.length - dataUrl.indexOf(",") - 1) * 3) / 4;

        if (bytes <= maxBytes || (scale <= 0.2 && quality <= 0.4)) {
          resolve(dataUrl);
        } else {
          // Reduce quality first, then scale
          if (quality > 0.4) {
            quality -= 0.15;
          } else {
            scale -= 0.1;
            quality = 0.7;
          }
          attempt();
        }
      };

      attempt();
    };

    img.onerror = reject;
    img.src = url;
  });
}

// ── Main app ──────────────────────────────────────────────────
function App() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [selectedImage, setSelectedImage] = useState(null); // { dataUrl }
  const [clearing, setClearing] = useState(false);

  const endOfMessagesRef = useRef(null);
  const textareaRef = useRef(null);
  const imageInputRef = useRef(null);

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }, [input]);

  const clearKnowledgeBase = async () => {
    if (!window.confirm("This will delete all uploaded documents from the knowledge base. Continue?")) return;
    setClearing(true);
    setUploadStatus(null);
    try {
      const res = await fetch("http://localhost:3001/api/clear", { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Clear failed");
      setUploadStatus({ ok: true, text: "Knowledge base cleared successfully." });
    } catch (err) {
      setUploadStatus({ ok: false, text: err?.message ?? "Clear failed" });
    } finally {
      setClearing(false);
    }
  };

  const onImageSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    try {
      const dataUrl = await compressImage(file);
      setSelectedImage({ dataUrl });
    } catch {
      alert("Could not process the image. Please try another file.");
    }
  };

  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    const imageData = selectedImage?.dataUrl ?? null;

    setLoading(true);
    setInput("");
    setSelectedImage(null);

    // Add user message immediately
    setMessages((prev) => [...prev, { role: "user", text: trimmed, image: imageData }]);
    // Add empty AI placeholder — typing dots show until first chunk arrives
    setMessages((prev) => [...prev, { role: "ai", text: "", citations: [] }]);

    try {
      const response = await fetch("http://localhost:3001/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, mode: "rag", imageData }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || "Chat request failed");
      }

      // Read SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? ""; // keep any incomplete line

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") break;

          try {
            const event = JSON.parse(raw);

            if (event.type === "chunk") {
              setMessages((prev) => {
                const msgs = [...prev];
                const last = { ...msgs[msgs.length - 1] };
                last.text += event.text;
                msgs[msgs.length - 1] = last;
                return msgs;
              });
            } else if (event.type === "citations") {
              setMessages((prev) => {
                const msgs = [...prev];
                const last = { ...msgs[msgs.length - 1] };
                last.citations = event.data;
                msgs[msgs.length - 1] = last;
                return msgs;
              });
            } else if (event.type === "error") {
              setMessages((prev) => {
                const msgs = [...prev];
                msgs[msgs.length - 1] = {
                  role: "ai",
                  text: event.message,
                  isError: true,
                  citations: [],
                };
                return msgs;
              });
            }
          } catch (_) {
            // malformed SSE line — skip
          }
        }
      }
    } catch (err) {
      setMessages((prev) => {
        const msgs = [...prev];
        msgs[msgs.length - 1] = {
          role: "ai",
          text: err?.message ?? "Request failed",
          isError: true,
          citations: [],
        };
        return msgs;
      });
    } finally {
      setLoading(false);
    }
  };

  const uploadDocument = async () => {
    if (!selectedFile) return;
    setUploading(true);
    setUploadStatus(null);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const response = await fetch("http://localhost:3001/api/ingest", {
        method: "POST",
        body: formData,
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Upload failed");

      setUploadStatus({ ok: true, text: `"${selectedFile.name}" ingested successfully.` });
      setSelectedFile(null);
    } catch (err) {
      setUploadStatus({ ok: false, text: err?.message ?? "Upload failed" });
    } finally {
      setUploading(false);
    }
  };

  const onComposerKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="shell">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebarLogo">
          <div className="logoMark">✦</div>
          <span className="logoText">Personal Assistant</span>
        </div>

        <div className="divider" />

        <div className="sidebarSection">
          <p className="sidebarLabel">Knowledge Base</p>
          <p className="sidebarHint">Upload PDFs to make them searchable by the assistant.</p>

          <label className="filePicker" htmlFor="pdf-upload">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="12" y1="18" x2="12" y2="12"/>
              <line x1="9" y1="15" x2="15" y2="15"/>
            </svg>
            <span className="filePickerName">
              {selectedFile ? selectedFile.name : "Choose a PDF file"}
            </span>
          </label>
          <input
            id="pdf-upload"
            type="file"
            accept="application/pdf,.pdf"
            style={{ display: "none" }}
            onChange={(e) => {
              setSelectedFile(e.target.files?.[0] ?? null);
              setUploadStatus(null);
            }}
          />

          <button
            className="uploadBtn"
            onClick={uploadDocument}
            disabled={!selectedFile || uploading}
          >
            {uploading ? (
              <><span className="spinner" />Uploading…</>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="16 16 12 12 8 16"/>
                  <line x1="12" y1="12" x2="12" y2="21"/>
                  <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
                </svg>
                Upload &amp; Ingest
              </>
            )}
          </button>

          {uploadStatus && (
            <p className={`uploadStatus ${uploadStatus.ok ? "isOk" : "isErr"}`}>
              {uploadStatus.ok ? "✓ " : "✗ "}{uploadStatus.text}
            </p>
          )}

          <button
            className="clearBtn"
            onClick={clearKnowledgeBase}
            disabled={clearing}
          >
            {clearing ? (
              <><span className="spinner spinnerRed" />Clearing…</>
            ) : (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                </svg>
                Clear knowledge base
              </>
            )}
          </button>
        </div>

        <div className="sidebarFooter">
          <span className="ragBadge">RAG mode</span>
        </div>
      </aside>

      {/* ── Chat area ── */}
      <div className="chatArea">
        <div className="messages">
          {messages.length === 0 && (
            <div className="emptyState">
              <div className="emptyIcon">✦</div>
              <p className="emptyTitle">Ask your knowledge base</p>
              <p className="emptyHint">
                Upload a PDF on the left, then ask anything about its contents.
                You can also attach an image to your question.
              </p>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`messageRow ${m.role === "user" ? "isUser" : "isAi"}`}>
              <div className="avatar">{m.role === "user" ? "U" : "✦"}</div>
              <div className="bubbleWrap">
                <div className={`bubble ${m.isError ? "isError" : ""}`}>
                  {/* Image attached by user */}
                  {m.role === "user" && m.image && (
                    <img src={m.image} className="msgImage" alt="Attached" />
                  )}
                  {/* Typing dots while waiting for first chunk */}
                  {m.role === "ai" && m.text === "" ? (
                    <span className="typingDots"><span /><span /><span /></span>
                  ) : m.role === "ai" ? (
                    <ReactMarkdown>{m.text}</ReactMarkdown>
                  ) : (
                    m.text
                  )}
                </div>
                {/* Citations below AI bubble */}
                {m.role === "ai" && m.text !== "" && (
                  <Citations citations={m.citations} />
                )}
              </div>
            </div>
          ))}

          <div ref={endOfMessagesRef} />
        </div>

        {/* ── Composer ── */}
        <div className="composer">
          {/* Image preview */}
          {selectedImage && (
            <div className="imagePreview">
              <img src={selectedImage.dataUrl} className="imagePreviewThumb" alt="Preview" />
              <button
                className="imagePreviewClear"
                onClick={() => setSelectedImage(null)}
                title="Remove image"
              >✕</button>
            </div>
          )}

          <div className="composerBox">
            {/* Image attach button */}
            <button
              className={`attachBtn${selectedImage ? " hasImage" : ""}`}
              title="Attach an image"
              onClick={() => imageInputRef.current?.click()}
              disabled={loading}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
            </button>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
              style={{ display: "none" }}
              onChange={onImageSelect}
            />

            <textarea
              ref={textareaRef}
              className="composerInput"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onComposerKeyDown}
              placeholder="Ask a question about your documents…"
              rows={1}
            />

            <button
              className="sendBtn"
              onClick={sendMessage}
              disabled={loading || !input.trim()}
              title="Send message"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
              </svg>
            </button>
          </div>
          <p className="composerHint">Enter to send · Shift+Enter for new line · 🖼 attach image</p>
        </div>
      </div>
    </div>
  );
}

export default App;
