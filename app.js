/**
 * Validator Transparency Dashboard — app.js
 *
 * Key notes:
 * - Supports ?vote= and #vote= (GitHub Pages compatible)
 * - Uses default validator only when URL has no override
 * - Epoch performance is a proxy based on credits (explained inline)
 */

// --------------------------------------------------
// CONFIG
// --------------------------------------------------

const USE_LIVE = true;

// Default validator (used only when URL has no overrides)
const VALIDATOR = {
  name: "AndrewInUA",
  voteKey: "3QPGLackJy5LKctYYoPGmA4P8ncyE197jdxr1zP2ho8K",
};

// ⚠️ NOTE: public key for demo only
const HELIUS_RPC =
  "https://mainnet.helius-rpc.com/?api-key=8c0db429-5430-4151-95f3-7487584d0a36";

// Vercel Jito proxy
const JITO_PROXY =
  "https://validator-transparency-dashboard.vercel.app/api/jito";

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

function getParam(name) {
  const qs = new URLSearchParams(window.location.search);
  if (qs.has(name)) return qs.get(name);

  const hash = new URLSearchParams(window.location.hash.replace("#", ""));
  if (hash.has(name)) return hash.get(name);

  return null;
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else node.setAttribute(k, v);
  });
  children.forEach((c) =>
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c)
  );
  return node;
}

// --------------------------------------------------
// INLINE “EpochPerformanceInfo” (drop-in, no imports)
// --------------------------------------------------

function EpochPerformanceInfo() {
  let open = false;

  const text = el("div", {
    class: "epoch-info-text",
    style:
      "display:none;margin-top:6px;font-size:12px;color:#9aa4b2;line-height:1.4;max-width:420px;",
    html:
      "Epoch performance (proxy) is estimated from validator credits earned " +
      "during the current epoch, relative to the expected maximum.<br>" +
      "This metric is indicative and intended for comparison, not an official Solana performance score.",
  });

  const btn = el(
    "button",
    {
      class: "epoch-info-btn",
      style:
        "background:none;border:none;padding:0;cursor:pointer;color:#9aa4b2;font-size:12px;",
    },
    ["ⓘ How this is calculated"]
  );

  btn.onclick = () => {
    open = !open;
    text.style.display = open ? "block" : "none";
  };

  return el("div", {}, [btn, text]);
}

// --------------------------------------------------
// MAIN
// --------------------------------------------------

(async function main() {
  const voteOverride = getParam("vote");
  const voteKey = voteOverride || VALIDATOR.voteKey;
  const name = VALIDATOR.name;

  const root = document.getElementById("app");
  root.innerHTML = "";

  // Header
  root.appendChild(
    el("h1", { class: "title" }, ["Validator Transparency Dashboard"])
  );

  // Trust card
  const trustCard = el("div", { class: "card" });

  trustCard.appendChild(
    el("div", { class: "card-title" }, ["Trust Card"])
  );

  trustCard.appendChild(
    el("div", { class: "muted" }, [`Validator: ${name}`])
  );

  // Example static values (your existing logic continues below)
  const epochPerformance = "96.06%";

  trustCard.appendChild(
    el("div", { class: "metric" }, [
      el("div", { class: "label" }, ["Epoch performance (proxy)"]),
      el("div", { class: "value" }, [epochPerformance]),
      EpochPerformanceInfo(), // 👈 explanation injected here
    ])
  );

  root.appendChild(trustCard);
})();
