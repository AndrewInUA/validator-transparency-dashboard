/**
 * Validator Transparency Dashboard – app.js
 */

const USE_LIVE = true;

const VALIDATOR = {
  name: "AndrewInUA",
  voteKey: "3QPGLackJy5LKctYYoPGmA4P8ncyE197jdxr1zP2ho8K"
};

const HELIUS_RPC =
  "https://mainnet.helius-rpc.com/?api-key=REDACTED";

const JITO_PROXY =
  "https://validator-transparency-dashboard.vercel.app/api/jito";

// ──────────────────────────────────────────────
// URL PARAMS
// ──────────────────────────────────────────────

function getParam(name) {
  const qs = new URLSearchParams(window.location.search);
  if (qs.has(name)) return qs.get(name);

  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const hs = new URLSearchParams(hash);
  if (hs.has(name)) return hs.get(name);

  return null;
}

function computeCurrentValidator() {
  const voteRaw = getParam("vote");
  const nameRaw = getParam("name");

  return {
    voteKey: voteRaw?.trim() || VALIDATOR.voteKey,
    name: nameRaw?.trim() || VALIDATOR.name,
    voteFromUrl: voteRaw || null,
    nameFromUrl: nameRaw || null
  };
}

const CURRENT = computeCurrentValidator();

function shortKey(k) {
  if (!k) return "—";
  return k.length > 12 ? `${k.slice(0, 4)}…${k.slice(-4)}` : k;
}

// ──────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────

function fmtPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—%";
  return `${n.toFixed(2)}%`;
}

function fmtSol(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n >= 1000 ? n.toFixed(0) : n.toFixed(2);
}

// ──────────────────────────────────────────────
// API
// ──────────────────────────────────────────────

async function fetchRatings(voteKey) {
  const res = await fetch(`/api/ratings?vote=${voteKey}`);
  if (!res.ok) throw new Error("ratings failed");
  return res.json();
}

function pickTrilliumApy(obj) {
  return obj?.average_delegator_total_apy ??
         obj?.delegator_total_apy ??
         obj?.total_overall_apy ??
         null;
}

// ──────────────────────────────────────────────
// RENDER RATINGS
// ──────────────────────────────────────────────

function renderRatings(r) {
  const elMedian = document.getElementById("apy-median");
  const elStakewiz = document.getElementById("apy-stakewiz");
  const elTrillium = document.getElementById("apy-trillium");
  const elSourcesNote = document.getElementById("apy-sources-note");

  if (elMedian) elMedian.textContent = fmtPct(r?.derived?.apy_median);
  if (elStakewiz) elStakewiz.textContent = fmtPct(r?.sources?.stakewiz?.total_apy);

  const trilliumObj = r?.sources?.trillium;
  const trilliumApy = pickTrilliumApy(trilliumObj);

  if (elTrillium) elTrillium.textContent = fmtPct(trilliumApy);

  // ⭐ UPDATED BLOCK (clear source status)

  if (elSourcesNote) {
    const sw = r?.sources?.stakewiz;
    const trOk = trilliumObj && !trilliumObj?.error && trilliumApy !== null;

    let swStatus = "OK";

    if (!sw || sw.error) {
      const err = (sw?.error || "").toLowerCase();

      if (err.includes("timeout")) {
        swStatus = "unavailable (timeout)";
      } else if (err) {
        swStatus = "unavailable";
      } else {
        swStatus = "—";
      }
    }

    let trStatus = trOk ? "OK" : "unavailable";

    elSourcesNote.textContent =
      `Sources: Stakewiz ${swStatus} • Trillium ${trStatus}`;
  }
}

// ──────────────────────────────────────────────
// LIVE DATA (simplified for stability)
// ──────────────────────────────────────────────

async function fetchLive(voteKey) {
  try {
    const res = await fetch(HELIUS_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getVoteAccounts"
      })
    });

    const json = await res.json();
    const all = [...json.result.current, ...json.result.delinquent];
    return all.find(v => v.votePubkey === voteKey);
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────────

async function main() {
  const nameEl = document.getElementById("validator-name");

  if (nameEl) {
    nameEl.textContent = `Validator: ${CURRENT.name}`;
  }

  // Load ratings (fast path)
  try {
    const ratings = await fetchRatings(CURRENT.voteKey);
    renderRatings(ratings);
  } catch (e) {
    console.warn("ratings failed", e);
  }

  // Load live data (non-critical)
  fetchLive(CURRENT.voteKey).then(live => {
    if (!live) return;

    const commissionEl = document.getElementById("commission");
    if (commissionEl) {
      commissionEl.textContent = `${live.commission ?? 0}%`;
    }
  });
}

main();
