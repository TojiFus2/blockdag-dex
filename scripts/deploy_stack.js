// scripts/deploy_stack.js
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

function mustEnv(name) {
  const v = process.env[name];
  if (!v || String(v).trim() === "") throw new Error(`Missing env var: ${name}`);
  return v.trim();
}

function writeDeployments(chainId, obj) {
  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${chainId}.json`);
  fs.writeFileSync(outPath, JSON.stringify(obj, null, 2), "utf-8");
  return outPath;
}

async function getSafeNonce(provider, address) {
  // Alcuni RPC ritornano pending=0 anche quando latest è alto.
  // Quindi prendiamo il MAX tra latest e pending, ma se pending è sospetto (0), usiamo latest.
  const latest = await provider.getTransactionCount(address, "latest");
  const pending = await provider.getTransactionCount(address, "pending");

  // euristica: se pending == 0 ma latest > 0, pending è rotto
  const safe = (pending === 0 && latest > 0) ? latest : Math.max(latest, pending);

  return { latest, pending, safe };
}

async function main() {
  const { ethers, network } = hre;
  const provider = ethers.provider;

  const net = await provider.getNetwork();
  const chainId = Number(net.chainId);

  console.log("========================================");
  console.log("DEPLOY STACK");
  console.log(`Network: ${network.name}`);
  console.log(`ChainId: ${chainId}`);
  console.log("========================================");

  const [deployer] = await ethers.getSigners();
  const deployerAddr = await deployer.getAddress();

  const nonceInfo = await getSafeNonce(provider, deployerAddr);
  console.log(`Deployer: ${deployerAddr}`);
  console.log(`Nonce latest=${nonceInfo.latest} pending=${nonceInfo.pending}`);

  const isLocal = (network.name === "localhost" || chainId === 31337);

  let nonce = nonceInfo.safe;

  let wrappedNative;
  if (isLocal) {
    console.log("Mode: LOCAL (deploying WETH9 mock) ...");

    const WETH9 = await ethers.getContractFactory("WETH9");
    const weth = await WETH9.deploy({ nonce });
    nonce++;
    await weth.waitForDeployment();
    wrappedNative = await weth.getAddress();

    console.log(`WETH9: ${wrappedNative}`);
  } else {
    console.log("Mode: TESTNET/REMOTE (using wrappedNative from env) ...");
    wrappedNative = mustEnv("WBDAG_OFFICIAL"); // 0xC97B...
    console.log(`wrappedNative: ${wrappedNative}`);
  }

  // Factory (UniswapV2Factory)
  const Factory = await ethers.getContractFactory("UniswapV2Factory");
  const factory = await Factory.deploy(deployerAddr, { nonce });
  nonce++;
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();

  // RouterLite2
  const RouterLite2 = await ethers.getContractFactory("V2RouterLite2");
  const router = await RouterLite2.deploy(factoryAddr, wrappedNative, { nonce });
  nonce++;
  await router.waitForDeployment();
  const routerAddr = await router.getAddress();

  console.log(`Factory: ${factoryAddr}`);
  console.log(`RouterLite2: ${routerAddr}`);
  console.log("========================================");

  const deployments = {
    network: network.name,
    chainId,
    deployer: deployerAddr,
    factory: factoryAddr,
    router: routerAddr,
    wrappedNative,
    wrapped: wrappedNative,
    weth: wrappedNative,
    timestamp: new Date().toISOString(),
  };

  const outPath = writeDeployments(chainId, deployments);
  console.log(`DEPLOYMENTS WRITTEN: ${outPath}`);
  console.log(JSON.stringify(deployments, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
