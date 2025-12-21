// scripts/drip_mockusdcv2_1043.js
const hre = require("hardhat");

async function main() {
  const { ethers, network } = hre;
  const provider = ethers.provider;

  const net = await provider.getNetwork();
  const chainId = Number(net.chainId);
  if (chainId !== 1043) throw new Error(`Run on chainId 1043 only. Got ${chainId}`);

  const FAUCET = "0x32671B72F3b17dE002b96ca66756e21ab46d2635";
  const USDC = "0x947eE27e29A0c95b0Ab4D8F494dC99AC3e8F2BA2";

  const [me] = await ethers.getSigners();

  console.log("========================================");
  console.log("DRIP MockUSDCv2 — TESTNET 1043");
  console.log("Network:", network.name);
  console.log("ChainId:", chainId);
  console.log("Me:", me.address);
  console.log("Faucet:", FAUCET);
  console.log("MockUSDCv2:", USDC);
  console.log("========================================");

  const f = await ethers.getContractAt(["function drip()"], FAUCET);
  const tx = await f.drip({ gasLimit: 500000 });
  console.log("drip tx:", tx.hash);

  const rc = await tx.wait();
  console.log("status:", rc.status, "gasUsed:", rc.gasUsed.toString());

  const u = await ethers.getContractAt(
    ["function balanceOf(address) view returns(uint256)", "function decimals() view returns(uint8)"],
    USDC
  );
  const dec = await u.decimals();
  const bal = await u.balanceOf(me.address);
  console.log("decimals:", Number(dec));
  console.log("balanceRaw:", bal.toString());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
