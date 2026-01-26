"use client";

import React, { useEffect, useMemo, useState } from "react";

type TrilliumState =
  | { status: "idle" | "loading"; apy: null; error?: string }
  | { status: "ok"; apy: number; error?: string }
  | { status: "error" | "not_found"; apy: null; error?: string };

function getVoteFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  return url.searchParams.get("vote");
}

async function fetchTrilliumDelegatorTotalApy(voteAccount: string): Promise<TrilliumState> {
  const url = "https://api.trillium.so/recency_weighted_average_validator_rewards";

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      return { status: "error", apy: null, error: `Trillium HTTP ${res.status}` };
    }

    const arr = await res.json();

    // Trillium returns an ARRAY of objects
    if (!Array.isArray(arr)) {
      return { status: "error", apy: null, error: "Trillium response is not an array" };
    }

    const row = arr.find((r: any) => r?.vote_account_pubkey === voteAccount);
    if (!row) {
      return { status: "not_found", apy: null, error: "Vote account not found in Trillium dataset" };
    }

    // ✅ Correct field for your UI (total APY for delegators)
    const apy =
      typeof row.average_delegator_total_apy === "number"
        ? row.average_delegator_total_apy
        : null;

    if (apy === null) {
      return { status: "error", apy: null, error: "Missing average_delegator_total_apy field" };
    }

    return { status: "ok", apy };
  } catch (e: any) {
    return { status: "error", apy: null, error: e?.message || String(e) };
  }
}

function formatPercent(value: number | null): string {
  if (value === null) return "—";
  return `${value.toFixed(2)}%`;
}

/**
 * Drop-in section: Trillium APY (fixes your 0.00% issue).
 * - Reads `?vote=` from URL
 * - Fetches Trillium
 * - Shows — instead of fake 0.00% on failures
 */
export default function ProfitabilityApySection() {
  const vote = useMemo(() => getVoteFromUrl(), []);
  const [trillium, setTrillium] = useState<TrilliumState>({
    status: "idle",
    apy: null,
  });

  useEffect(() => {
    if (!vote) {
      setTrillium({ status: "error", apy: null, error: "Missing ?vote= in URL" });
      return;
    }

    let cancelled = false;

    (async () => {
      setTrillium({ status: "loading", apy: null });
      const result = await fetchTrilliumDelegatorTotalApy(vote);
      if (!cancelled) setTrillium(result);
    })();

    return () => {
      cancelled = true;
    };
  }, [vote]);

  const trilliumOk = trillium.status === "ok";

  return (
    <section
      style={{
        borderRadius: 18,
        padding: 18,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        marginTop: 16,
      }}
    >
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
        Profitability (APY) &amp; Pool presence
      </h2>

      <p style={{ opacity: 0.75, marginBottom: 14 }}>
        APY is aggregated from public sources (Stakewiz + Trillium). Pool presence shows stake pools
        delegating to this validator (via Trillium).
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: 14,
        }}
      >
        {/* You can keep your existing cards for Stakewiz median/total/pools here.
            This file provides Trillium card turnkey to fix 0.00%.
        */}

        <div
          style={{
            borderRadius: 14,
            padding: 14,
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <div style={{ opacity: 0.75, fontSize: 13, marginBottom: 6 }}>
            Trillium delegator total APY
          </div>

          <div style={{ fontSize: 36, fontWeight: 800, lineHeight: 1.1 }}>
            {trillium.status === "loading" ? "…" : formatPercent(trillium.apy)}
          </div>

          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
            Source:{" "}
            <span style={{ opacity: 1 }}>
              {trilliumOk ? "Trillium OK" : "Trillium Error"}
            </span>
            {trillium.status !== "ok" && trillium.error ? (
              <span style={{ display: "block", marginTop: 6, opacity: 0.65 }}>
                {trillium.error}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
