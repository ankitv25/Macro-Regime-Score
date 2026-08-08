import { loadJSON } from "./data.js";
import { setAppbarStatus, footerText } from "./shell.js";

async function main() {
  const [composite, metadata] = await Promise.all([
    loadJSON("composite_history.json"),
    loadJSON("metadata.json"),
  ]);

  const latest = composite[composite.length - 1];
  setAppbarStatus(latest, latest.regime_confirmed || latest.regime_raw, metadata);

  // Describes the pipeline as it actually runs today: a daily GitHub Actions job
  // (.github/workflows/mrs-full-refresh.yml → src/mrs_gha_runner.py), not the
  // older manual mrs_monitoring_store.py → export_dashboard_data.py sequence.
  document.getElementById("cadence-text").textContent =
    `The pipeline re-pulls FRED/Yahoo and rebuilds this dashboard daily at 14:30 UTC (~10:30 AM ET), ` +
    `after the 08:30 ET and 09:15 ET release windows. ` +
    `A new month is only scored once all of its binding releases have landed — core PCE, ` +
    `around the 27th of the following month, is the last to arrive and is the effective gate. ` +
    `So "Updated" moves daily while "Data through" moves once a month. ` +
    `Current data covers ${metadata.data_from} through ${metadata.data_through} ` +
    `(${metadata.n_months} months); last rebuilt ${metadata.generated_at} UTC, MRS methodology ${metadata.version}.`;

  document.getElementById("status-footer").textContent = footerText(metadata);
}

main().catch((err) => {
  document.body.insertAdjacentHTML("beforeend", `<p style="color:#c62828;padding:1rem;">Error: ${err.message}</p>`);
  console.error(err);
});
