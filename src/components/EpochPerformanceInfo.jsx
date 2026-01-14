import { useState } from "react";

export default function EpochPerformanceInfo() {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ marginTop: 6 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          color: "#9aa4b2",
          fontSize: "12px",
        }}
        aria-expanded={open}
      >
        ⓘ How this is calculated
      </button>

      {open && (
        <div
          style={{
            marginTop: 6,
            fontSize: "12px",
            color: "#9aa4b2",
            lineHeight: 1.4,
            maxWidth: 420,
          }}
        >
          Epoch performance (proxy) is estimated from validator credits earned
          during the current epoch, relative to the expected maximum.  
          This metric is indicative and intended for comparison, not an official
          Solana performance score.
        </div>
      )}
    </div>
  );
}
