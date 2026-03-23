// Voting consistency pill (FIXED TOOLTIP)
let vcText = "Voting consistency: unavailable";
let vcOk = false;

const vcTip =
  "Voting consistency is calculated from vote credits across recent epochs. It shows how stable the validator’s voting performance is over time. Higher values indicate more reliable behavior.";

if (Number.isFinite(nowUptime)) {
  if (nowUptime >= 95) {
    vcText = `Voting consistency: strong (${nowUptime.toFixed(2)}%)`;
    vcOk = true;
  } else if (nowUptime >= 90) {
    vcText = `Voting consistency: good (${nowUptime.toFixed(2)}%)`;
    vcOk = true;
  } else {
    vcText = `Voting consistency: needs attention (${nowUptime.toFixed(2)}%)`;
    vcOk = false;
  }
}

pills.push({ ok: vcOk, text: vcText, tip: vcTip });
