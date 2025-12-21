const fs = require("fs");
const path = require("path");

function main() {
  const root = path.resolve(__dirname, "..");
  const src = path.join(root, "deployments", "31337.json");
  const dstDir = path.join(root, "ui", "public", "deployments");
  const dst = path.join(dstDir, "31337.json");

  if (!fs.existsSync(src)) {
    console.error("Missing:", src);
    process.exit(1);
  }

  fs.mkdirSync(dstDir, { recursive: true });
  fs.copyFileSync(src, dst);

  console.log("✅ Synced deployments to UI:", dst);
}

main();
