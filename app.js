// 🔽 ONLY showing changed part — BUT you will replace WHOLE FILE with this version

// FIND THIS FUNCTION:
function computeRecentPerformance({ live, ratings }) {

// 🔁 REPLACE IT COMPLETELY WITH THIS:

function computeRecentPerformance({ live, ratings }) {
  const series = Array.isArray(live?.epochConsistencySeries)
    ? live.epochConsistencySeries.filter((x) => Number.isFinite(x))
    : [];

  const windowCount = series.length;
  const avg = average(series);
  const volatility = stddev(series);

  const mid = Math.floor(windowCount / 2);
  const firstHalf = series.slice(0, mid);
  const secondHalf = series.slice(mid);

  const firstAvg = average(firstHalf);
  const secondAvg = average(secondHalf);
  const diff =
    Number.isFinite(firstAvg) && Number.isFinite(secondAvg)
      ? secondAvg - firstAvg
      : null;

  const reliability = getSampleReliability(windowCount);

  const apyMedian = Number(ratings?.derived?.apy_median);
  const sw = Number(ratings?.sources?.stakewiz?.total_apy);
  const tr = pickTrilliumApy(ratings?.sources?.trillium);
  const jito = !!live?.jito;

  const explainSample = `Based on ${windowCount} recent usable epochs (max 30). ${reliability.note}`;

  const out = {
    window: {
      value: "—",
      sub: "No recent data yet."
    },
    trend: {
      value: "—",
      sub: "Not enough recent data."
    },
    variability: {
      value: "—",
      sub: "Not enough recent data."
    },
    reward: {
      value: jito ? "Jito enabled" : "Jito not detected",
      sub: "Reward context from public APY data."
    }
  };

  // ───────────── WINDOW
  if (windowCount > 0) {
    out.window.value = `${windowCount} epochs`;
    out.window.sub = `${explainSample}`;
  }

  // ───────────── TREND
  if (windowCount >= 4 && Number.isFinite(diff)) {
    const strength = simplifyTrendDelta(diff);

    if (diff >= 3) {
      out.trend.value =
        reliability.level === "very_low" || reliability.level === "low"
          ? "Looks stronger"
          : "Improving";

      out.trend.sub =
        `${explainSample} We compare recent epochs vs earlier ones. ` +
        `Recent performance is ${strength || ""} stronger (higher vote credits).`;
    } else if (diff <= -3) {
      out.trend.value =
        reliability.level === "very_low" || reliability.level === "low"
          ? "Looks weaker"
          : "Weaker";

      out.trend.sub =
        `${explainSample} We compare recent epochs vs earlier ones. ` +
        `Recent performance is ${strength || ""} weaker (lower vote credits).`;
    } else {
      out.trend.value = "Stable";
      out.trend.sub =
        `${explainSample} No meaningful difference between recent and earlier epochs.`;
    }
  } else if (windowCount > 0) {
    out.trend.value = "Limited data";
    out.trend.sub = explainSample;
  }

  // ───────────── VARIABILITY
  if (windowCount >= 2 && Number.isFinite(volatility)) {
    if (volatility <= 5) {
      out.variability.value =
        reliability.level === "very_low" ? "Possibly low" : "Low";

      out.variability.sub =
        `${explainSample} Performance is consistent across epochs (low variation).`;
    } else if (volatility <= 12) {
      out.variability.value =
        reliability.level === "very_low" ? "Possibly medium" : "Medium";

      out.variability.sub =
        `${explainSample} Some variation between epochs, but still within normal range.`;
    } else {
      out.variability.value =
        reliability.level === "very_low" || reliability.level === "low"
          ? "Possibly high"
          : "High";

      out.variability.sub =
        `${explainSample} Large differences between epochs → inconsistent performance.`;
    }
  } else if (windowCount === 1) {
    out.variability.value = "Limited data";
    out.variability.sub = explainSample;
  }

  // ───────────── REWARD
  const rewardParts = [];

  rewardParts.push(
    jito
      ? "Jito MEV rewards detected."
      : "No Jito signal detected."
  );

  if (Number.isFinite(apyMedian)) {
    rewardParts.push(`Median APY: ${apyMedian.toFixed(2)}%.`);
  }

  if (Number.isFinite(sw) && Number.isFinite(tr)) {
    const delta = Math.abs(sw - tr);
    rewardParts.push(
      delta <= 1
        ? "APY sources match closely."
        : "APY sources differ."
    );
  } else if (Number.isFinite(sw) || Number.isFinite(tr)) {
    rewardParts.push("Only one APY source available.");
  } else {
    rewardParts.push("APY data unavailable.");
  }

  out.reward.sub =
    `${rewardParts.join(" ")} Derived from Stakewiz + Trillium + Jito.`;

  return out;
}
