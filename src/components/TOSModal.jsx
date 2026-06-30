import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

// Version strings — bump these when TOS content changes to require re-acceptance.
export const TOS_VERSIONS = {
  base:       "2026-06-30",
  billing:    "2026-06-30",
  submission: "2026-06-30",
};

const TOS_TITLES = {
  base:       "Terms of Service",
  billing:    "Subscription, Credits & Billing Terms",
  submission: "Beat & Loop Submission Agreement",
};

const storageKey = (tosKey) => `pb_tos_${tosKey}_${TOS_VERSIONS[tosKey]}`;

export function hasTOSAccepted(tosKey) {
  try { return localStorage.getItem(storageKey(tosKey)) === "1"; } catch { return false; }
}

export function markTOSAccepted(tosKey) {
  try { localStorage.setItem(storageKey(tosKey), "1"); } catch {}
}

// Simple markdown renderer covering h1/h2/h3, bullet lists, and paragraphs.
// Sufficient for the legal doc structure — no inline formatting needed.
function renderMarkdown(text) {
  const blocks = text.split(/\n{2,}/);
  return blocks.map((block, i) => {
    const trimmed = block.trim();
    if (!trimmed) return null;

    if (trimmed.startsWith("# ")) {
      return <h1 key={i} className="mb-3 text-[15px] font-bold text-[#e8e0d0]">{trimmed.slice(2)}</h1>;
    }
    if (trimmed.startsWith("## ")) {
      return <h2 key={i} className="mb-2 mt-5 text-[13px] font-semibold uppercase tracking-wide text-[#f2ca50]">{trimmed.slice(3)}</h2>;
    }
    if (trimmed.startsWith("### ")) {
      return <h3 key={i} className="mb-1 mt-4 text-[12px] font-semibold text-[#e8e0d0]">{trimmed.slice(4)}</h3>;
    }

    // Bullet list block
    const lines = trimmed.split("\n");
    if (lines.every((l) => l.startsWith("- "))) {
      return (
        <ul key={i} className="mb-3 ml-4 list-disc space-y-1">
          {lines.map((l, j) => (
            <li key={j} className="text-[12px] leading-relaxed text-[#99907c]">{l.slice(2)}</li>
          ))}
        </ul>
      );
    }

    // Mixed block — might start with bullets after a paragraph line
    if (lines.some((l) => l.startsWith("- "))) {
      return (
        <div key={i} className="mb-3">
          {lines.map((l, j) =>
            l.startsWith("- ")
              ? <div key={j} className="ml-4 text-[12px] leading-relaxed text-[#99907c]">• {l.slice(2)}</div>
              : <p key={j} className="text-[12px] leading-relaxed text-[#99907c]">{l}</p>
          )}
        </div>
      );
    }

    return <p key={i} className="mb-3 text-[12px] leading-relaxed text-[#99907c]">{trimmed}</p>;
  });
}

export default function TOSModal({ tosKey, open, onAccept, onClose }) {
  const [content, setContent] = useState(null);
  const [error, setError]     = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (!open || !tosKey) return;
    setContent(null);
    setError(null);
    fetch(`/legal/tos-${tosKey}.md`)
      .then((r) => { if (!r.ok) throw new Error("Could not load terms."); return r.text(); })
      .then(setContent)
      .catch(() => setError("Could not load the terms. Please try again."));
  }, [open, tosKey]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const title = TOS_TITLES[tosKey] || "Terms";

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/70 sm:items-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex max-h-[92dvh] w-full max-w-2xl flex-col border border-[#262626] bg-[#0e0e0e] sm:max-h-[80dvh]">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-[#262626] px-5 py-4">
          <div>
            <div className="mb-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[#f2ca50]">Legal</div>
            <h2 className="text-[14px] font-semibold text-[#e8e0d0]">{title}</h2>
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center text-[#4d4635] transition hover:text-[#e8e0d0]"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Scrollable content */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4">
          {error && <p className="text-[13px] text-red-400">{error}</p>}
          {!content && !error && (
            <div className="flex items-center gap-2 text-[12px] text-[#4d4635]">
              <span className="h-3 w-3 animate-spin rounded-full border border-[#262626] border-t-[#f2ca50]" />
              Loading…
            </div>
          )}
          {content && renderMarkdown(content)}
        </div>

        {/* Footer */}
        {onAccept && (
          <div className="shrink-0 border-t border-[#262626] bg-[#131313] px-5 py-4">
            <p className="mb-3 text-[11px] text-[#4d4635]">
              By clicking "I Accept" you agree to the above terms. This acceptance is recorded with your account.
            </p>
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 border border-[#4d4635] px-4 py-2 text-[12px] uppercase tracking-wider text-[#99907c] transition hover:border-[#f2ca50]/40 hover:text-[#e8e0d0]"
              >
                Cancel
              </button>
              <button
                onClick={onAccept}
                disabled={!content}
                className="flex-1 border border-[#f2ca50] bg-[#f2ca50] px-4 py-2 text-[12px] font-semibold uppercase tracking-wider text-[#3c2f00] transition hover:bg-[#f2ca50]/90 disabled:opacity-40"
              >
                I Accept
              </button>
            </div>
          </div>
        )}

        {/* Read-only footer (no onAccept — view-only mode from AuthModal link) */}
        {!onAccept && (
          <div className="shrink-0 border-t border-[#262626] px-5 py-3">
            <button
              onClick={onClose}
              className="w-full border border-[#4d4635] px-4 py-2 text-[12px] uppercase tracking-wider text-[#99907c] transition hover:border-[#f2ca50]/40 hover:text-[#e8e0d0]"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
