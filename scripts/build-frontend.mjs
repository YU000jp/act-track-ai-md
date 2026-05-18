import { buildDashboard, productionOutputRoot } from "./frontend-core.mjs";

async function main() {
  await buildDashboard(productionOutputRoot);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
