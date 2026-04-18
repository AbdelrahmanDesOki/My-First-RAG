import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import "./App.css";

function App() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState(null);

  const endOfMessagesRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }, [input]);

  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text: trimmed }]);

    try {
      const response = await fetch("http://localhost:3001/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, mode: "rag" }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data?.error || "Chat request failed");
      }

      setMessages((prev) => [
        ...prev,
        { role: "ai", text: data.answer },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "ai", text: err?.message ?? "Chat request failed", isError: true },
      ]);
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

      if (!response.ok) {
        throw new Error(data?.error || "Upload failed");
      }

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
              <p className="emptyHint">Upload a PDF on the left, then ask anything about its contents.</p>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`messageRow ${m.role === "user" ? "isUser" : "isAi"}`}>
              <div className="avatar">
                {m.role === "user" ? "U" : "✦"}
              </div>
              <div className={`bubble ${m.isError ? "isError" : ""}`}>
                {m.role === "ai"
                  ? <ReactMarkdown>{m.text}</ReactMarkdown>
                  : m.text}
              </div>
            </div>
          ))}

          {loading && (
            <div className="messageRow isAi">
              <div className="avatar">✦</div>
              <div className="bubble">
                <span className="typingDots">
                  <span /><span /><span />
                </span>
              </div>
            </div>
          )}

          <div ref={endOfMessagesRef} />
        </div>

        {/* Composer */}
        <div className="composer">
          <div className="composerBox">
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
          <p className="composerHint">Enter to send · Shift+Enter for new line</p>
        </div>
      </div>
    </div>
  );
}

export default App;
