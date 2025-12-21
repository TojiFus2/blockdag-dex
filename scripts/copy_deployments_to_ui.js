const fs = require("fs");
const path = require("path");

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function main() {
  const chainId = process.argv[2];
  if (!chainId) {
    console.error("Usage: node scripts/copy_deployments_to_ui.js <chainId>");
    process.exit(1);
  }

  const src = path.resolve(__dirname, "..", "deployments", `${chainId}.json`);
  const dstDir = path.resolve(__dirname, "..", "ui", "public", "deployments");
  const dst = path.resolve(dstDir, `${chainId}.json`);

  if (!fs.existsSync(src)) {
    console.error(`Source deployments not found: ${src}`);
    process.exit(1);
  }

  ensureDir(dstDir);
  fs.copyFileSync(src, dst);

  console.log("========================================");
  console.log("COPY DEPLOYMENTS -> UI");
  console.log(`chainId: ${chainId}`);
  console.log(`from:   ${src}`);
  console.log(`to:     ${dst}`);
  console.log("========================================");
}

main();
