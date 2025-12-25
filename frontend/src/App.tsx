import { useMemo, useState } from "react";
import type { AnalysisResult } from "./types/analysis";

type Status = "idle" | "analyzing" | "done" | "error";

const API_BASE = "http://127.0.0.1:8000";

async function copyToClipboard(text: string) {
  await navigator.clipboard.writeText(text);
}

export default function App() {
  const [status, setStatus] = useState<Status>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [copied, setCopied] = useState<"" | "json" | "md">("");

  const canGenerate = useMemo(
    () => !!file && status !== "analyzing",
    [file, status]
  );

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setResult(null);
    setErrorMsg("");
    setCopied("");
    setStatus("idle");

    if (f) setVideoUrl(URL.createObjectURL(f));
    else setVideoUrl("");
  }

  async function onGenerate() {
    if (!file) return;

    setStatus("analyzing");
    setErrorMsg("");
    setResult(null);
    setCopied("");

    try {
      const form = new FormData();
      form.append("video", file); // must match FastAPI param name

      const resp = await fetch(`${API_BASE}/api/analyze`, {
        method: "POST",
        body: form,
      });

      if (!resp.ok) {
        const t = await resp.text();
        throw new Error(`API ${resp.status}: ${t}`);
      }

      const data = (await resp.json()) as AnalysisResult;
      setResult(data);
      setStatus("done");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }

  async function onCopyJSON() {
    if (!result) return;
    await copyToClipboard(JSON.stringify(result, null, 2));
    setCopied("json");
    setTimeout(() => setCopied(""), 1200);
  }

  async function onCopyMarkdown() {
    if (!result?.issue_markdown) return;
    await copyToClipboard(result.issue_markdown);
    setCopied("md");
    setTimeout(() => setCopied(""), 1200);
  }

  return (
    <div
      style={{
        padding: 24,
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial",
      }}
    >
      <h2 style={{ margin: 0 }}>Bug Hunter</h2>
      <p style={{ marginTop: 8, color: "#444" }}>
        Upload a 10–30s bug repro screen recording. Generate an issue draft
        (JSON + Markdown).
      </p>

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <input type="file" accept="video/*" onChange={onPickFile} />
        <button
          onClick={onGenerate}
          disabled={!canGenerate}
          style={{
            padding: "8px 14px",
            cursor: canGenerate ? "pointer" : "not-allowed",
          }}
        >
          {status === "analyzing" ? "Analyzing..." : "Generate Issue"}
        </button>
      </div>

      {status === "error" && (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            background: "#ffecec",
            border: "1px solid #ffb3b3",
          }}
        >
          <strong>Error:</strong> {errorMsg}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          marginTop: 16,
        }}
      >
        {/* Left: Video */}
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Video</h3>
          {videoUrl ? (
            <video
              src={videoUrl}
              controls
              style={{ width: "100%", borderRadius: 8 }}
            />
          ) : (
            <div style={{ color: "#666" }}>Pick a video to preview.</div>
          )}
        </div>

        {/* Right: Issue */}
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Issue Draft</h3>

          {status === "idle" && (
            <div style={{ color: "#666" }}>
              Upload a video and click Generate.
            </div>
          )}
          {status === "analyzing" && (
            <div style={{ color: "#666" }}>Generating draft...</div>
          )}

          {status === "done" && result && (
            <>
              <div
                style={{
                  padding: 12,
                  border: "1px solid #eee",
                  borderRadius: 8,
                  marginBottom: 12,
                }}
              >
                <div style={{ fontSize: 18, fontWeight: 700 }}>
                  {result.title}
                </div>

                <div style={{ marginTop: 12 }}>
                  <div style={{ fontWeight: 600 }}>Steps to Reproduce</div>
                  <ol style={{ marginTop: 6 }}>
                    {(result.steps ?? []).map((s, idx) => (
                      <li key={idx}>{s}</li>
                    ))}
                  </ol>
                </div>

                <div style={{ marginTop: 12 }}>
                  <div style={{ fontWeight: 600 }}>Error Log</div>
                  <pre
                    style={{
                      background: "#111",
                      color: "#f1f1f1",
                      padding: 12,
                      borderRadius: 8,
                      overflowX: "auto",
                      marginTop: 6,
                    }}
                  >
                    {(result.error_log ?? []).join("\n")}
                  </pre>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={onCopyJSON} style={{ padding: "8px 12px" }}>
                  {copied === "json" ? "Copied!" : "Copy JSON"}
                </button>
                <button
                  onClick={onCopyMarkdown}
                  disabled={!result.issue_markdown}
                  style={{
                    padding: "8px 12px",
                    cursor: result.issue_markdown ? "pointer" : "not-allowed",
                  }}
                >
                  {copied === "md" ? "Copied!" : "Copy Markdown"}
                </button>
              </div>

              <details style={{ marginTop: 12 }}>
                <summary>Issue Markdown</summary>
                <pre
                  style={{
                    background: "#f6f6f6",
                    padding: 12,
                    borderRadius: 8,
                    overflowX: "auto",
                  }}
                >
                  {result.issue_markdown ?? ""}
                </pre>
              </details>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
