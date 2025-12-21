const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

function getConstructorInputs(abi) {
  const ctor = abi.find((x) => x.type === "constructor");
  return ctor ? (ctor.inputs || []) : [];
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const net = await hre.ethers.provider.getNetwork();
  const chainId = Number(net.chainId);

  console.log("Deployer:", deployer.address);
  console.log("ChainId:", chainId);

  // ============================================================
  // Deploy WETH9 (Fully Qualified Name to avoid artifact collision)
  // ============================================================
  const WETH = await hre.ethers.getContractFactory("contracts/WETH9.sol:WETH9");
  const weth = await WETH.deploy();
  await weth.waitForDeployment();
  const WETH_ADDR = await weth.getAddress();
  console.log("WETH9:", WETH_ADDR);

  // ============================================================
  // Deploy Uniswap V2 Factory
  // ============================================================
  const Factory = await hre.ethers.getContractFactory("UniswapV2Factory");
  const factory = await Factory.deploy(deployer.address);
  await factory.waitForDeployment();
  const FACTORY_ADDR = await factory.getAddress();
  console.log("Factory:", FACTORY_ADDR);

  // ============================================================
  // Deploy V2RouterLite (auto-detect constructor args count)
  // ============================================================
  const routerArtifact = await hre.artifacts.readArtifact("V2RouterLite");
  const ctorInputs = getConstructorInputs(routerArtifact.abi);

  console.log("V2RouterLite constructor inputs:", ctorInputs.map(i => `${i.name || "(noname)"}:${i.type}`).join(", ") || "(none)");

  const Router = await hre.ethers.getContractFactory("V2RouterLite");

  let router;
  if (ctorInputs.length === 0) {
    router = await Router.deploy();
  } else if (ctorInputs.length === 1) {
    // Most common: constructor(address factory) OR constructor(address weth)
    // We try factory first (99% of router designs). If it reverts, we'll know and adjust.
    router = await Router.deploy(FACTORY_ADDR);
  } else if (ctorInputs.length === 2) {
    router = await Router.deploy(FACTORY_ADDR, WETH_ADDR);
  } else {
    throw new Error(`Unexpected V2RouterLite constructor inputs length: ${ctorInputs.length}`);
  }

  await router.waitForDeployment();
  const ROUTER_ADDR = await router.getAddress();
  console.log("V2RouterLite:", ROUTER_ADDR);

  // ============================================================
  // Save deployments per chainId
  // ============================================================
  const outDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

  const outPath = path.join(outDir, `${chainId}.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        chainId,
        WETH: WETH_ADDR,
        factory: FACTORY_ADDR,
        router: ROUTER_ADDR,
      },
      null,
      2
    )
  );

  console.log("Saved deployments to:", outPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
