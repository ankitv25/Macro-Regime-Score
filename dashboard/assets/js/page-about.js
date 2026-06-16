import { loadJSON } from "./data.js";
import { setAppbarStatus, footerText } from "./shell.js";

async function main() {
  const [composite, metadata] = await Promise.all([
    loadJSON("composite_history.json"),
    loadJSON("metadata.json"),
  ]);

  const latest = composite[composite.length - 1];
  setAppbarStatus(latest, latest.regime_confirmed || latest.regime_raw, metadata);

  document.getElementById("cadence-text").textContent =
    `Updated monthly, after month-end FRED/Yahoo data postings. Current data covers ` +
    `${metadata.data_from} through ${metadata.data_through} (${metadata.n_months} months). ` +
    `Last generated ${metadata.generated_at}, MRS methodology ${metadata.version}. The monthly ` +
    `refresh runs mrs_monitoring_store.py → export_dashboard_data.py; the analyst note is then edited by hand.`;

  document.getElementById("status-footer").textContent = footerText(metadata);
}

main().catch((err) => {
  document.body.insertAdjacentHTML("beforeend", `<p style="color:#c62828;padding:1rem;">Error: ${err.message}</p>`);
  console.error(err);
});
