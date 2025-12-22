// scripts/mint_new_wusdc_1043.js
// Mint NEW WUSDC (you are owner). Minimal calls to avoid flaky eth_call decode.
//
// Run:
//   npx hardhat run --network bdagTestnet scripts/mint_new_wusdc_1043.js
//
// Optional ENV:
//   MINT_TO=0x...
//   MINT_AMOUNT=50000

const hre = require("hardhat");

async function main() {
  const { ethers, network } = hre;

  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);
  if (chainId !== 1043) throw new Error(`Run on chainId 1043 only. Got ${chainId}`);

  const NEW_WUSDC = "0xd7eFc4e37306b379C88DBf8749189C480bfEA340";

  const [me] = await ethers.getSigners();
  const to = process.env.MINT_TO && ethers.isAddress(process.env.MINT_TO) ? process.env.MINT_TO : me.address;
  const human = process.env.MINT_AMOUNT ? String(process.env.MINT_AMOUNT) : "50000";

  console.log("========================================");
  console.log("MINT NEW WUSDC — TESTNET 1043");
  console.log("Network:", network.name);
  console.log("ChainId:", chainId);
  console.log("Signer:", me.address);
  console.log("To:", to);
  console.log("Token:", NEW_WUSDC);
  console.log("Amount (human):", human);
  console.log("========================================");

  const u = await ethers.getContractAt(
    [
      "function owner() view returns(address)",
      "function decimals() view returns(uint8)",
      "function mint(address to, uint256 value) external",
    ],
    NEW_WUSDC,
    me
  );

  const owner = await u.owner();
  if (owner.toLowerCase() !== me.address.toLowerCase()) {
    throw new Error(`Signer is NOT owner. signer=${me.address} owner=${owner}`);
  }

  const dec = Number(await u.decimals());
  const amount = ethers.parseUnits(human, dec);

  const tx = await u.mint(to, amount, { gasLimit: 500_000 });
  console.log("mint tx:", tx.hash);
  const rc = await tx.wait();
  console.log("status:", rc.status, "gasUsed:", rc.gasUsed.toString());

  console.log("DONE (mint mined).");
}

main().catch((e) => {
  console.error("ERROR:", e?.shortMessage || e?.reason || e?.message || e);
  process.exit(1);
});
