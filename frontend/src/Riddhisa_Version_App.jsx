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
  { key: "blur_score",         label: "Blur Score",      flag: "is_blurry",        flagLabel: "Blurry" },
  { key: "noise_score",        label: "Noise Score",     flag: "is_noisy",         flagLabel: "Noisy" },
  { key: "contrast_score",     label: "Contrast Score",  flag: "is_low_contrast",  flagLabel: "Low Contrast" },
  { key: "stain_irregularity", label: "Stain Index",     flag: "has_stains",       flagLabel: "Stains Detected" },
  { key: "text_density",       label: "Text Density",    flag: "has_broken_text",  flagLabel: "Broken Text" },
];

const PIPELINE_LABELS = {
  denoise:              "Noise Removal",
  contrast_enhance:     "Contrast Enhancement",
  deblur:               "Deblurring",
  stain_removal:        "Stain Removal",
  morphological_repair: "Morphological Repair",
  inpainting:           "Inpainting",
};

/* ─────────────────────────── GLOBAL STYLES ─────────────────────────────── */
const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Mono:ital,wght@0,400;0,700;1,400&family=Syne:wght@400;600;700;800&family=DM+Mono:wght@400;500&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:          #0a0c0f;
    --bg2:         #0f1216;
    --bg3:         #151a20;
    --bg4:         #1c232c;
    --border:      #1e2833;
    --border2:     #2a3544;
    --amber:       #e8a020;
    --amber-dim:   #a06a10;
    --amber-glow:  rgba(232,160,32,0.12);
    --cyan:        #1dd4c8;
    --cyan-dim:    #0d8a82;
    --red:         #e05050;
    --red-dim:     #7a2020;
    --green:       #3dd68c;
    --green-dim:   #1a6040;
    --text:        #e8e2d8;
    --text2:       #8a9ab0;
    --text3:       #4a5a6a;
    --font-head:   'Syne', sans-serif;
    --font-mono:   'Space Mono', monospace;
    --font-ui:     'DM Mono', monospace;
  }

  html, body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-ui);
    min-height: 100vh;
    line-height: 1.5;
  }

  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: var(--bg2); }
  ::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 3px; }

  ::selection { background: var(--amber); color: var(--bg); }

  @keyframes pulse-border {
    0%, 100% { border-color: var(--border2); }
    50%       { border-color: var(--amber-dim); }
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes slide-right {
    0%   { transform: translateX(-100%); }
    100% { transform: translateX(400%); }
  }
`;

/* ─────────────────────────── SUB-COMPONENTS ────────────────────────────── */

function Badge({ active, label }) {
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      fontSize: 10,
      fontFamily: "var(--font-mono)",
      letterSpacing: "0.06em",
      padding: "4px 10px",
      borderRadius: 2,
      textTransform: "uppercase",
      background: active ? "rgba(61,214,140,0.08)" : "var(--bg3)",
      color: active ? "var(--green)" : "var(--text3)",
      border: `1px solid ${active ? "var(--green-dim)" : "var(--border)"}`,
    }}>
      <span style={{
        width: 5, height: 5, borderRadius: "50%",
        background: active ? "var(--green)" : "var(--text3)",
        flexShrink: 0,
        boxShadow: active ? "0 0 6px var(--green)" : "none",
      }} />
      {label}
    </span>
  );
}

function MetricCard({ label, value, sub }) {
  return (
    <div style={{
      background: "var(--bg3)",
      border: "1px solid var(--border2)",
      borderTop: "2px solid var(--amber)",
      padding: "16px 20px",
      minWidth: 130,
      flex: "1 1 130px",
    }}>
      <div style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.15em", marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontFamily: "var(--font-head)", fontWeight: 700, color: "var(--amber)", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 6, fontFamily: "var(--font-mono)" }}>{sub}</div>}
    </div>
  );
}

function ImagePanel({ src, label, mono }) {
  return (
    <div style={{
      background: "var(--bg2)",
      border: "1px solid var(--border2)",
      borderRadius: 3,
      overflow: "hidden",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "8px 14px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg3)",
      }}>
        <div style={{ display: "flex", gap: 5 }}>
          {["#e05050","#e8a020","#3dd68c"].map(c => (
            <div key={c} style={{ width: 7, height: 7, borderRadius: "50%", background: c }} />
          ))}
        </div>
        <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text3)", letterSpacing: "0.1em", textTransform: "uppercase" }}>{label}</span>
      </div>
      <div style={{ background: "#000" }}>
        <img
          src={`data:image/png;base64,${src}`}
          alt={label}
          style={{ width: "100%", display: "block", filter: mono ? "grayscale(1) brightness(1.1)" : "none" }}
        />
      </div>
    </div>
  );
}

function StepTimeline({ steps }) {
  const keys = Object.keys(steps);
  if (keys.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {keys.map((k, i) => (
        <div key={k} style={{ display: "flex", gap: 0, animation: "fadeIn 0.35s ease both", animationDelay: `${i * 0.07}s` }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 52, flexShrink: 0 }}>
            <div style={{
              width: 28, height: 28, borderRadius: "50%",
              background: "var(--bg4)",
              border: "1.5px solid var(--amber)",
              color: "var(--amber)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700,
              boxShadow: "0 0 12px var(--amber-glow)",
              zIndex: 1,
            }}>{String(i + 1).padStart(2, "0")}</div>
            {i < keys.length - 1 && (
              <div style={{ width: 1, flex: 1, minHeight: 20, background: "var(--border2)", marginTop: 4 }} />
            )}
          </div>
          <div style={{ flex: 1, paddingBottom: 28, paddingLeft: 8, paddingTop: 2 }}>
            <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--amber)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 10 }}>
              {STEP_LABELS[k] || k}
            </div>
            <img
              src={`data:image/png;base64,${steps[k]}`}
              alt={STEP_LABELS[k] || k}
              style={{ width: "100%", maxWidth: 500, display: "block", border: "1px solid var(--border2)", background: "#000" }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
      <div style={{ width: 3, height: 14, background: "var(--amber)", flexShrink: 0 }} />
      <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.18em", whiteSpace: "nowrap" }}>
        {children}
      </span>
      <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
    </div>
  );
}

/* ────────────────────────────── MAIN APP ───────────────────────────────── */
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
    <>
      <style>{GLOBAL_CSS}</style>

      {/* ── TOP NAV BAR ── */}
      <div style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
        height: 46,
        background: "var(--bg2)",
        borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center",
        padding: "0 24px",
        gap: 16,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <rect x="1.5" y="1.5" width="19" height="19" rx="3" stroke="var(--amber)" strokeWidth="1.3"/>
            <path d="M5.5 7h11M5.5 11h8M5.5 15h5.5" stroke="var(--amber)" strokeWidth="1.2" strokeLinecap="round"/>
            <circle cx="16" cy="14.5" r="3.5" fill="none" stroke="var(--cyan)" strokeWidth="1"/>
            <circle cx="16" cy="14.5" r="1.2" fill="var(--cyan)"/>
          </svg>
          <span style={{ fontFamily: "var(--font-head)", fontWeight: 800, fontSize: 14, color: "var(--text)", letterSpacing: "0.06em" }}>
            ARCHIVUM
          </span>
        </div>

        <div style={{ width: 1, height: 20, background: "var(--border)" }} />
        <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text3)", letterSpacing: "0.1em" }}>
          DOCUMENT RESTORATION PIPELINE
        </span>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 7 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green)", boxShadow: "0 0 8px var(--green)" }} />
          <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text3)" }}>SYSTEM ONLINE</span>
        </div>
      </div>

      {/* ── PAGE BODY ── */}
      <div style={{ paddingTop: 46, minHeight: "100vh" }}>
        <div style={{ maxWidth: 960, margin: "0 auto", padding: "2.5rem 1.5rem 5rem" }}>

          {/* ── HERO ── */}
          <div style={{ marginBottom: "3rem", animation: "fadeIn 0.5s ease" }}>
            <div style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--amber)", letterSpacing: "0.25em", textTransform: "uppercase", marginBottom: 12 }}>
              ◈ &nbsp; Historical Archive · Digital Restoration Lab
            </div>
            <h1 style={{
              fontFamily: "var(--font-head)",
              fontWeight: 800,
              fontSize: "clamp(30px, 5vw, 52px)",
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
              color: "var(--text)",
              marginBottom: 16,
            }}>
              Document{" "}
              <span style={{ color: "var(--amber)", position: "relative", display: "inline-block" }}>
                Restoration
                <span style={{
                  position: "absolute", bottom: -2, left: 0, right: 0,
                  height: 2, background: "linear-gradient(90deg, var(--amber), transparent)"
                }} />
              </span>
            </h1>
            <p style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text3)", letterSpacing: "0.06em", lineHeight: 2 }}>
              ANALYZE &nbsp;/&nbsp; DAMAGE PROFILE &nbsp;/&nbsp; ADAPTIVE PIPELINE &nbsp;/&nbsp; OCR EXTRACTION
            </p>
          </div>

          {/* ── UPLOAD ZONE ── */}
          <div style={{ marginBottom: "1.5rem" }}>
            <SectionLabel>Input Document</SectionLabel>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileRef.current?.click()}
              style={{
                border: `1.5px dashed ${dragOver ? "var(--amber)" : "var(--border2)"}`,
                borderRadius: 4,
                padding: "2.5rem 1.5rem",
                textAlign: "center",
                cursor: "pointer",
                background: dragOver ? "rgba(232,160,32,0.05)" : "var(--bg2)",
                transition: "all 0.2s",
                position: "relative",
                overflow: "hidden",
                animation: !file ? "pulse-border 3s ease infinite" : "none",
              }}
            >
              {/* corner brackets */}
              {[{t:8,l:8,bt:true,bl:true},{t:8,r:8,bt:true,br:true},{b:8,l:8,bb:true,bl:true},{b:8,r:8,bb:true,br:true}].map((c, i) => (
                <div key={i} style={{
                  position: "absolute",
                  top: c.t, bottom: c.b, left: c.l, right: c.r,
                  width: 12, height: 12,
                  borderTop:    c.bt ? `1.5px solid var(--amber)` : "none",
                  borderBottom: c.bb ? `1.5px solid var(--amber)` : "none",
                  borderLeft:   c.bl ? `1.5px solid var(--amber)` : "none",
                  borderRight:  c.br ? `1.5px solid var(--amber)` : "none",
                  opacity: dragOver ? 1 : 0.6,
                  transition: "opacity 0.2s",
                }} />
              ))}

              <input
                ref={fileRef}
                type="file"
                accept=".jpg,.jpeg,.png,.pdf"
                style={{ display: "none" }}
                onChange={(e) => handleFile(e.target.files?.[0])}
              />

              {preview && file?.type?.startsWith("image/") ? (
                <div>
                  <img src={preview} alt="preview" style={{ maxHeight: 180, maxWidth: "100%", marginBottom: 12, border: "1px solid var(--border2)" }} />
                  <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--cyan)", letterSpacing: "0.06em" }}>
                    ✓ &nbsp; {file.name}
                  </div>
                </div>
              ) : (
                <>
                  <svg width="36" height="36" viewBox="0 0 36 36" fill="none" style={{ marginBottom: 12, opacity: dragOver ? 1 : 0.45 }}>
                    <rect x="2" y="2" width="32" height="32" rx="3" stroke="var(--amber)" strokeWidth="1.2" fill="none"/>
                    <path d="M18 10v16M10 18h16" stroke="var(--amber)" strokeWidth="1.4" strokeLinecap="round"/>
                  </svg>
                  <div style={{ fontSize: 13, fontFamily: "var(--font-mono)", color: "var(--text2)", marginBottom: 6 }}>
                    {file ? file.name : "Drop document or click to browse"}
                  </div>
                  <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text3)", letterSpacing: "0.1em" }}>
                    ACCEPTS &nbsp;·&nbsp; JPG &nbsp;·&nbsp; PNG &nbsp;·&nbsp; PDF
                  </div>
                </>
              )}
            </div>
          </div>

          {/* ── SUBMIT BUTTON ── */}
          <button
            onClick={onSubmit}
            disabled={!file || loading}
            style={{
              width: "100%",
              padding: "14px 0",
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              fontWeight: 700,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              borderRadius: 3,
              border: `1px solid ${(!file || loading) ? "var(--border)" : "var(--amber)"}`,
              background: (!file || loading)
                ? "var(--bg3)"
                : "linear-gradient(135deg, rgba(232,160,32,0.14), rgba(232,160,32,0.04))",
              color: (!file || loading) ? "var(--text3)" : "var(--amber)",
              cursor: (!file || loading) ? "not-allowed" : "pointer",
              marginBottom: "1.5rem",
              transition: "all 0.2s",
              boxShadow: (!file || loading) ? "none" : "0 0 24px var(--amber-glow)",
              position: "relative",
              overflow: "hidden",
            }}
          >
            {loading ? (
              <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
                <span style={{
                  display: "inline-block", width: 12, height: 12,
                  border: "2px solid var(--amber)", borderTopColor: "transparent",
                  borderRadius: "50%", animation: "spin 0.7s linear infinite",
                }} />
                Restoring document…
              </span>
            ) : "⬡  Run Restoration Pipeline"}
          </button>

          {/* ── ERROR ── */}
          {error && (
            <div style={{
              padding: "12px 16px",
              background: "rgba(224,80,80,0.07)",
              border: "1px solid var(--red-dim)",
              borderLeft: "3px solid var(--red)",
              color: "var(--red)",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              marginBottom: "1.5rem",
              animation: "fadeIn 0.3s ease",
            }}>
              ✕ &nbsp; {error}
            </div>
          )}

          {/* ── LOADING STATE ── */}
          {loading && (
            <div style={{ textAlign: "center", padding: "3rem 1rem", animation: "fadeIn 0.3s ease" }}>
              <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--amber)", letterSpacing: "0.2em", marginBottom: 14 }}>
                RUNNING ADAPTIVE PIPELINE
              </div>
              <div style={{ height: 2, background: "var(--border)", borderRadius: 1, overflow: "hidden", maxWidth: 320, margin: "0 auto 14px", position: "relative" }}>
                <div style={{
                  position: "absolute", top: 0, left: 0, height: "100%", width: "33%",
                  background: "linear-gradient(90deg, transparent, var(--amber), var(--cyan), transparent)",
                  animation: "slide-right 1.4s ease infinite",
                }} />
              </div>
              <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text3)", letterSpacing: "0.08em" }}>
                ANALYZING → PROFILING → APPLYING FILTERS → EXTRACTING TEXT
              </div>
            </div>
          )}

          {/* ── RESULTS ── */}
          {result && (
            <div style={{ animation: "fadeIn 0.4s ease" }}>

              {/* Tab bar */}
              <div style={{ display: "flex", borderBottom: "1px solid var(--border2)", marginBottom: "1.5rem" }}>
                {tabs.map(t => (
                  <button key={t} onClick={() => setActiveTab(t)} style={{
                    padding: "10px 22px",
                    fontSize: 10,
                    fontFamily: "var(--font-mono)",
                    textTransform: "uppercase",
                    letterSpacing: "0.12em",
                    background: "transparent",
                    color: activeTab === t ? "var(--amber)" : "var(--text3)",
                    border: "none",
                    borderBottom: activeTab === t ? "2px solid var(--amber)" : "2px solid transparent",
                    cursor: "pointer",
                    transition: "all 0.15s",
                    marginBottom: -1,
                  }}>{t}</button>
                ))}
              </div>

              {/* RESULTS TAB */}
              {activeTab === "results" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 28, animation: "fadeIn 0.3s ease" }}>
                  <div>
                    <SectionLabel>Damage Profile</SectionLabel>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {PROFILE_FIELDS.map(f => (
                        <div key={f.key} style={{
                          background: "var(--bg3)",
                          border: "1px solid var(--border)",
                          borderLeft: `3px solid ${result.damage_profile[f.flag] ? "var(--red)" : "var(--border2)"}`,
                          padding: "10px 14px",
                          minWidth: 145,
                          flex: "1 1 145px",
                        }}>
                          <div style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 5 }}>{f.label}</div>
                          <div style={{ fontSize: 24, fontFamily: "var(--font-head)", fontWeight: 700, color: "var(--text)", marginBottom: 8, lineHeight: 1 }}>
                            {result.damage_profile[f.key]}
                          </div>
                          <Badge active={result.damage_profile[f.flag]} label={f.flagLabel} />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <SectionLabel>Pipeline Applied</SectionLabel>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {Object.entries(result.pipeline_applied).map(([k, v]) => (
                        <Badge key={k} active={v} label={PIPELINE_LABELS[k] || k} />
                      ))}
                    </div>
                  </div>

                  <div>
                    <SectionLabel>Before / After</SectionLabel>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
                      <ImagePanel src={result.original} label="Original" />
                      <ImagePanel src={result.restored} label="Restored" />
                    </div>
                  </div>
                </div>
              )}

              {/* STEPS TAB */}
              {activeTab === "steps" && (
                <div style={{ animation: "fadeIn 0.3s ease" }}>
                  <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text3)", marginBottom: 24, lineHeight: 1.8, borderLeft: "2px solid var(--border2)", paddingLeft: 12 }}>
                    Only steps triggered by detected damage are shown.
                  </div>
                  {Object.keys(result.steps).length === 0 ? (
                    <div style={{ color: "var(--green)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                      ✓ &nbsp; No processing steps applied — document appears clean.
                    </div>
                  ) : (
                    <StepTimeline steps={result.steps} />
                  )}
                </div>
              )}

              {/* OCR TAB */}
              {activeTab === "ocr" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 20, animation: "fadeIn 0.3s ease" }}>
                  <ImagePanel src={result.binary} label="OCR-ready binary" mono />
                  <div>
                    <SectionLabel>Extracted Text</SectionLabel>
                    <textarea
                      readOnly
                      value={result.ocr_text || "(no text extracted)"}
                      style={{
                        width: "100%",
                        minHeight: 220,
                        fontFamily: "var(--font-mono)",
                        fontSize: 12,
                        lineHeight: 1.8,
                        background: "var(--bg2)",
                        border: "1px solid var(--border2)",
                        borderRadius: 3,
                        padding: "14px 16px",
                        color: "var(--cyan)",
                        resize: "vertical",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                </div>
              )}

              {/* METRICS TAB */}
              {activeTab === "metrics" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 24, animation: "fadeIn 0.3s ease" }}>
                  <div>
                    <SectionLabel>Quality Metrics</SectionLabel>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
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
                        label="Steps Applied"
                        value={Object.values(result.pipeline_applied).filter(Boolean).length}
                        sub={`of ${Object.keys(result.pipeline_applied).length} possible`}
                      />
                    </div>
                  </div>

                  {result.metrics.note && (
                    <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text3)", borderLeft: "2px solid var(--border2)", paddingLeft: 12 }}>
                      NOTE: {result.metrics.note}
                    </div>
                  )}

                  <div>
                    <SectionLabel>Full Damage Profile · JSON</SectionLabel>
                    <pre style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      background: "var(--bg2)",
                      border: "1px solid var(--border2)",
                      padding: "14px 18px",
                      overflowX: "auto",
                      color: "var(--cyan)",
                      lineHeight: 1.8,
                    }}>
                      {JSON.stringify(result.damage_profile, null, 2)}
                    </pre>
                  </div>
                </div>
              )}

            </div>
          )}

          {/* ── FOOTER ── */}
          <div style={{
            marginTop: "4rem", paddingTop: "1.5rem",
            borderTop: "1px solid var(--border)",
            display: "flex", justifyContent: "space-between", alignItems: "center",
            flexWrap: "wrap", gap: 8,
          }}>
            <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text3)", letterSpacing: "0.1em" }}>ARCHIVUM · RESTORATION ENGINE</span>
            <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text3)", letterSpacing: "0.1em" }}>FASTAPI · OPENCV · TESSERACT · OCR</span>
          </div>

        </div>
      </div>
    </>
  );
}
