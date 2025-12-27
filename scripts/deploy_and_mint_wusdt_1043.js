// scripts/deploy_and_mint_wusdt_1043.js
//
// Deploy a new MockWUSDT token (6 decimals) and mint to your wallet (owner).
//
// Run:
//   npx hardhat run --network bdagTestnet scripts/deploy_and_mint_wusdt_1043.js
//
// Optional ENV:
//   MINT_TO=0x...
//   MINT_AMOUNT=50000
//
// Output:
//   - prints deployed WUSDT address (use it in the seed script + UI token list)

const hre = require("hardhat");

async function main() {
  const { ethers, network } = hre;

  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);
  if (chainId !== 1043) throw new Error(`Run on chainId 1043 only. Got ${chainId}`);

  const [deployer] = await ethers.getSigners();
  const to = process.env.MINT_TO && ethers.isAddress(process.env.MINT_TO) ? process.env.MINT_TO : deployer.address;
  const human = process.env.MINT_AMOUNT ? String(process.env.MINT_AMOUNT) : "50000";

  console.log("========================================");
  console.log("DEPLOY + MINT WUSDT — TESTNET 1043");
  console.log("Network:", network.name);
  console.log("ChainId:", chainId);
  console.log("Deployer (owner):", deployer.address);
  console.log("Mint to:", to);
  console.log("Mint amount (human):", human);
  console.log("========================================");

  const MockWUSDT = await ethers.getContractFactory("MockWUSDT");
  const token = await MockWUSDT.deploy({ gasLimit: 3_000_000 });
  await token.waitForDeployment();

  const addr = await token.getAddress();
  console.log("WUSDT deployed at:", addr);

  const owner = await token.owner();
  console.log("owner():", owner);
  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error(`Unexpected owner. deployer=${deployer.address} owner=${owner}`);
  }

  const dec = Number(await token.decimals());
  const amount = ethers.parseUnits(human, dec);
  const tx = await token.mint(to, amount, { gasLimit: 500_000 });
  console.log("mint tx:", tx.hash);
  const rc = await tx.wait();
  console.log("mint status:", rc.status, "gasUsed:", rc.gasUsed.toString());

  console.log("DONE.");
}

main().catch((e) => {
  console.error("ERROR:", e?.shortMessage || e?.reason || e?.message || e);
  process.exit(1);
});

