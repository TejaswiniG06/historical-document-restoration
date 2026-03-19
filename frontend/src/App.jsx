import { useState, useRef, useCallback } from "react";

const API_BASE = "http://localhost:8000";

const STEP_LABELS = {
  "1_perspective_corrected": "Perspective Correction",
  "5a_denoised": "Noise Removal",
  "5b_contrast_enhanced": "Contrast Enhancement",
  "5c_deblurred": "Deblurring",
  "7_stain_removed": "Stain Removal",
  "8_morphological_repair": "Morphological Repair",
  "9_inpainted": "Inpainting",
  "6_ocr_ready_binary": "OCR-Ready Binary",
};

const PROFILE_FIELDS = [
  { key: "blur_score",        label: "Blur Score",         flag: "is_blurry",         flagLabel: "Blurry" },
  { key: "noise_score",       label: "Noise Score",        flag: "is_noisy",          flagLabel: "Noisy" },
  { key: "contrast_score",    label: "Contrast Score",     flag: "is_low_contrast",   flagLabel: "Low Contrast" },
  { key: "stain_irregularity",label: "Stain Index",        flag: "has_stains",        flagLabel: "Stains Detected" },
  { key: "text_density",      label: "Text Density",       flag: "has_broken_text",   flagLabel: "Broken Text" },
];

const PIPELINE_LABELS = {
  denoise:              "Noise Removal",
  contrast_enhance:     "Contrast Enhancement",
  deblur:               "Deblurring",
  stain_removal:        "Stain Removal",
  morphological_repair: "Morphological Repair",
  inpainting:           "Inpainting",
};

function Badge({ active, label }) {
  return (
    <span style={{
      fontSize: 11,
      fontWeight: 500,
      padding: "2px 8px",
      borderRadius: 20,
      background: active ? "var(--color-background-success)" : "var(--color-background-secondary)",
      color: active ? "var(--color-text-success)" : "var(--color-text-tertiary)",
      border: `0.5px solid ${active ? "var(--color-border-success)" : "var(--color-border-tertiary)"}`,
      letterSpacing: "0.02em",
    }}>
      {active ? "✓ " : "– "}{label}
    </span>
  );
}

function MetricCard({ label, value, sub }) {
  return (
    <div style={{
      background: "var(--color-background-secondary)",
      borderRadius: "var(--border-radius-md)",
      padding: "12px 16px",
      minWidth: 110,
    }}>
      <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.07em" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 500, color: "var(--color-text-primary)" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function ImagePanel({ src, label, mono }) {
  return (
    <div style={{
      background: "var(--color-background-primary)",
      border: "0.5px solid var(--color-border-tertiary)",
      borderRadius: "var(--border-radius-lg)",
      overflow: "hidden",
    }}>
      <div style={{ padding: "8px 12px", borderBottom: "0.5px solid var(--color-border-tertiary)", fontSize: 12, color: "var(--color-text-secondary)", fontWeight: 500 }}>
        {label}
      </div>
      <img
        src={`data:image/png;base64,${src}`}
        alt={label}
        style={{ width: "100%", display: "block", filter: mono ? "grayscale(1)" : "none" }}
      />
    </div>
  );
}

function StepTimeline({ steps }) {
  const keys = Object.keys(steps);
  if (keys.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {keys.map((k, i) => (
        <div key={k} style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>
            <div style={{
              width: 28, height: 28, borderRadius: "50%",
              background: "var(--color-background-info)",
              color: "var(--color-text-info)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 12, fontWeight: 500, flexShrink: 0,
            }}>{i + 1}</div>
            {i < keys.length - 1 && <div style={{ width: 1, flex: 1, minHeight: 12, background: "var(--color-border-tertiary)", marginTop: 4 }} />}
          </div>
          <div style={{ flex: 1, paddingBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)", marginBottom: 8 }}>
              {STEP_LABELS[k] || k}
            </div>
            <img
              src={`data:image/png;base64,${steps[k]}`}
              alt={STEP_LABELS[k] || k}
              style={{ width: "100%", maxWidth: 480, display: "block", borderRadius: "var(--border-radius-md)", border: "0.5px solid var(--color-border-tertiary)" }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [activeTab, setActiveTab] = useState("results");
  const fileRef = useRef();

  const handleFile = useCallback((f) => {
    if (!f) return;
    setFile(f);
    setResult(null);
    setError(null);
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target.result);
    reader.readAsDataURL(f);
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const onSubmit = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    setResult(null);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch(`${API_BASE}/restore`, { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || "Server error");
      }
      const data = await res.json();
      setResult(data);
      setActiveTab("results");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const tabs = ["results", "steps", "ocr", "metrics"];

  return (
    <div style={{ fontFamily: "var(--font-sans)", maxWidth: 900, margin: "0 auto", padding: "2rem 1rem" }}>

      {/* Header */}
      <div style={{ marginBottom: "2rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: "var(--color-background-info)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="2" width="12" height="12" rx="2" stroke="var(--color-text-info)" strokeWidth="1.2" fill="none"/>
              <path d="M5 8h6M8 5v6" stroke="var(--color-text-info)" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>Document Restoration Pipeline</h1>
        </div>
        <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: 0 }}>
          Adaptive restoration: Analyze → Decide → Apply → Preserve text
        </p>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
        style={{
          border: `1.5px dashed ${dragOver ? "var(--color-border-info)" : "var(--color-border-secondary)"}`,
          borderRadius: "var(--border-radius-lg)",
          padding: "2.5rem 1.5rem",
          textAlign: "center",
          cursor: "pointer",
          background: dragOver ? "var(--color-background-info)" : "var(--color-background-secondary)",
          transition: "background 0.15s, border-color 0.15s",
          marginBottom: "1.5rem",
        }}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".jpg,.jpeg,.png,.pdf"
          style={{ display: "none" }}
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        {preview && file?.type?.startsWith("image/") ? (
          <img src={preview} alt="preview" style={{ maxHeight: 200, maxWidth: "100%", borderRadius: 6, marginBottom: 12 }} />
        ) : (
          <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.4 }}>
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none" style={{ display: "inline-block" }}>
              <rect x="4" y="4" width="32" height="32" rx="6" stroke="currentColor" strokeWidth="1.5" fill="none"/>
              <path d="M14 20h12M20 14v12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
        )}
        <div style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-primary)" }}>
          {file ? file.name : "Drop a document here"}
        </div>
        <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginTop: 4 }}>
          JPG · PNG · PDF — or click to browse
        </div>
      </div>

      {/* Submit */}
      <button
        onClick={onSubmit}
        disabled={!file || loading}
        style={{
          width: "100%",
          padding: "10px 0",
          fontSize: 14,
          fontWeight: 500,
          borderRadius: "var(--border-radius-md)",
          border: "0.5px solid var(--color-border-info)",
          background: (!file || loading) ? "var(--color-background-secondary)" : "var(--color-background-info)",
          color: (!file || loading) ? "var(--color-text-tertiary)" : "var(--color-text-info)",
          cursor: (!file || loading) ? "not-allowed" : "pointer",
          marginBottom: "1.5rem",
          transition: "background 0.15s",
        }}
      >
        {loading ? "Restoring document…" : "Run Restoration Pipeline"}
      </button>

      {/* Error */}
      {error && (
        <div style={{
          padding: "12px 16px",
          borderRadius: "var(--border-radius-md)",
          background: "var(--color-background-danger)",
          color: "var(--color-text-danger)",
          border: "0.5px solid var(--color-border-danger)",
          fontSize: 13,
          marginBottom: "1.5rem",
        }}>
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div style={{ textAlign: "center", padding: "2rem", color: "var(--color-text-secondary)", fontSize: 13 }}>
          <div style={{ marginBottom: 8 }}>Running adaptive pipeline…</div>
          <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>Analyzing → Deciding → Applying → Extracting text</div>
        </div>
      )}

      {/* Results */}
      {result && (
        <div>
          {/* Tab bar */}
          <div style={{ display: "flex", gap: 2, borderBottom: "0.5px solid var(--color-border-tertiary)", marginBottom: "1.5rem" }}>
            {tabs.map(t => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                style={{
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: activeTab === t ? 500 : 400,
                  background: "none",
                  border: "none",
                  borderBottom: activeTab === t ? "2px solid var(--color-text-primary)" : "2px solid transparent",
                  color: activeTab === t ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                  cursor: "pointer",
                  textTransform: "capitalize",
                  marginBottom: -1,
                }}
              >{t}</button>
            ))}
          </div>

          {/* RESULTS TAB */}
          {activeTab === "results" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              {/* Damage profile */}
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-secondary)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.07em" }}>Damage Profile</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {PROFILE_FIELDS.map(f => (
                    <div key={f.key} style={{
                      background: "var(--color-background-primary)",
                      border: "0.5px solid var(--color-border-tertiary)",
                      borderRadius: "var(--border-radius-md)",
                      padding: "8px 12px",
                      minWidth: 140,
                      flex: "1 1 140px",
                    }}>
                      <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 2 }}>{f.label}</div>
                      <div style={{ fontSize: 17, fontWeight: 500, marginBottom: 4 }}>{result.damage_profile[f.key]}</div>
                      <Badge active={result.damage_profile[f.flag]} label={f.flagLabel} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Pipeline decisions */}
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-secondary)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.07em" }}>Pipeline Applied</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {Object.entries(result.pipeline_applied).map(([k, v]) => (
                    <Badge key={k} active={v} label={PIPELINE_LABELS[k] || k} />
                  ))}
                </div>
              </div>

              {/* Image comparison */}
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-secondary)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.07em" }}>Before / After</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
                  <ImagePanel src={result.original} label="Original" />
                  <ImagePanel src={result.restored} label="Restored" />
                </div>
              </div>
            </div>
          )}

          {/* STEPS TAB */}
          {activeTab === "steps" && (
            <div>
              <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 20 }}>
                Only steps triggered by detected damage are shown. Steps skipped because no damage was detected are omitted.
              </div>
              {Object.keys(result.steps).length === 0 ? (
                <div style={{ color: "var(--color-text-tertiary)", fontSize: 14 }}>No processing steps were applied — document appears clean.</div>
              ) : (
                <StepTimeline steps={result.steps} />
              )}
            </div>
          )}

          {/* OCR TAB */}
          {activeTab === "ocr" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <ImagePanel src={result.binary} label="OCR-ready binary image" mono />
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-secondary)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.07em" }}>Extracted text</div>
                <textarea
                  readOnly
                  value={result.ocr_text || "(no text extracted)"}
                  style={{
                    width: "100%",
                    minHeight: 200,
                    fontFamily: "var(--font-mono)",
                    fontSize: 13,
                    lineHeight: 1.7,
                    background: "var(--color-background-secondary)",
                    border: "0.5px solid var(--color-border-tertiary)",
                    borderRadius: "var(--border-radius-md)",
                    padding: "12px",
                    color: "var(--color-text-primary)",
                    resize: "vertical",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </div>
          )}

          {/* METRICS TAB */}
          {activeTab === "metrics" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <MetricCard
                  label="PSNR"
                  value={result.metrics.psnr != null ? `${result.metrics.psnr} dB` : "N/A"}
                  sub="Higher = less signal distortion"
                />
                <MetricCard
                  label="SSIM"
                  value={result.metrics.ssim != null ? result.metrics.ssim.toFixed(4) : "N/A"}
                  sub="1.0 = structurally identical"
                />
                <MetricCard
                  label="Steps applied"
                  value={Object.values(result.pipeline_applied).filter(Boolean).length}
                  sub={`of ${Object.keys(result.pipeline_applied).length} possible`}
                />
              </div>
              {result.metrics.note && (
                <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>Note: {result.metrics.note}</div>
              )}
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-secondary)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.07em" }}>Full damage profile</div>
                <div style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  background: "var(--color-background-secondary)",
                  border: "0.5px solid var(--color-border-tertiary)",
                  borderRadius: "var(--border-radius-md)",
                  padding: "12px 16px",
                  whiteSpace: "pre",
                  overflowX: "auto",
                  color: "var(--color-text-primary)",
                }}>
                  {JSON.stringify(result.damage_profile, null, 2)}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
