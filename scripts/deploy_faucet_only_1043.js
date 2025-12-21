// scripts/deploy_faucet_only_1043.js
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

function writeJson(chainId, obj) {
  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${chainId}.mockusdc.faucet.json`);
  fs.writeFileSync(outPath, JSON.stringify(obj, null, 2), "utf-8");
  return outPath;
}

function mustAddr(label, a) {
  if (!a || typeof a !== "string" || !a.startsWith("0x") || a.length !== 42) {
    throw new Error(`Bad address for ${label}: ${a}`);
  }
  return a;
}

async function main() {
  const { ethers, network } = hre;
  const provider = ethers.provider;

  const net = await provider.getNetwork();
  const chainId = Number(net.chainId);
  if (chainId !== 1043) throw new Error(`Run this only on chainId 1043. Got ${chainId}`);

  const [deployer] = await ethers.getSigners();
  const me = await deployer.getAddress();

  // Your already deployed MockUSDC from the output
  const MOCK_USDC = mustAddr("MOCK_USDC", "0xCFB61e3AA4319A280577577d6463536215541fB7");

  console.log("========================================");
  console.log("DEPLOY FAUCET ONLY (MockUSDC already deployed)");
  console.log(`Network: ${network.name}`);
  console.log(`ChainId: ${chainId}`);
  console.log("========================================");
  console.log("Deployer:", me);
  console.log("MockUSDC:", MOCK_USDC);

  // dripAmount = 1000 USDC (6 decimals => 1000 * 1e6)
  const dripAmount = 1000n * 1_000_000n;
  const cooldown = 30; // seconds

  const Faucet = await ethers.getContractFactory("TokenFaucet");
  const faucet = await Faucet.deploy(MOCK_USDC, dripAmount, cooldown, { gasLimit: 4_000_000 });
  await faucet.waitForDeployment();
  const faucetAddr = await faucet.getAddress();

  console.log("Faucet:", faucetAddr);

  const out = {
    network: network.name,
    chainId,
    deployer: me,
    mockUSDC: MOCK_USDC,
    faucet: faucetAddr,
    dripAmount: dripAmount.toString(),
    cooldownSeconds: cooldown,
    timestamp: new Date().toISOString(),
  };

  const outPath = writeJson(chainId, out);
  console.log("WRITTEN:", outPath);
  console.log(JSON.stringify(out, null, 2));

  console.log("========================================");
  console.log("NEXT (get USDC):");
  console.log(`npx hardhat console --network ${network.name}`);
  console.log(`const f = await ethers.getContractAt(["function drip()"], "${faucetAddr}")`);
  console.log("await (await f.drip({ gasLimit: 500000 })).wait()");
  console.log("========================================");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
