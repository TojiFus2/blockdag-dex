// scripts/e2e_testnet_stack.js
//
// E2E TESTNET STACK (MANUAL LP SAFE MODE) - STABLE FIXED PAIR
// - Reuses existing Pair(0) to avoid createPair latency/flakiness on BlockDAG relayer
// - Wrap BDAG -> WBDAG
// - Transfer WBDAG + TST0 directly to pair
// - pair.mint() to mint LP
// - Print reserves + LP balance
//
// Known on-chain:
// Pair:   0xe0844f00C4a758b6462eBD768f3a13cc388C4117
// token0: 0x0FAcF9368ac69fD9F0A7e8F0B7A677378AA10738 (TST old)
// token1: 0xC97B4e92fB267bB11b1CD2d475F9E8c16b433289 (WBDAG)

const hre = require("hardhat");
const { ethers } = hre;

const CHAIN_ID = 1043;

const PAIR_ADDR = "0xe0844f00C4a758b6462eBD768f3a13cc388C4117";
const TST0 = "0x0FAcF9368ac69fD9F0A7e8F0B7A677378AA10738";
const WBDAG = "0xC97B4e92fB267bB11b1CD2d475F9E8c16b433289";

// Gas
const GAS_LIMIT_HEAVY = 2_800_000;
const GAS_LIMIT_LIGHT = 350_000;
const GAS_LIMIT_DEPOSIT = 250_000;
const GAS_PRICE_GWEI = null;

// Amounts
const WRAP_NATIVE_AMOUNT = ethers.parseEther("0.02");
const SEED_WBDAG_AMOUNT = ethers.parseEther("0.01");
const SEED_TST_UNITS = 500_000n;

// ABIs
const IWETH_ABI = [
  "function deposit() payable",
  "function balanceOf(address) view returns(uint256)",
  "function transfer(address to, uint256 value) returns(bool)",
];

const IERC20_ABI = [
  "function decimals() view returns(uint8)",
  "function balanceOf(address) view returns(uint256)",
  "function transfer(address to, uint256 value) returns(bool)",
];

const IPair_ABI = [
  "function token0() view returns(address)",
  "function token1() view returns(address)",
  "function getReserves() view returns(uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function mint(address to) returns(uint256 liquidity)",
  "function balanceOf(address) view returns(uint256)",
];

function gasOverrides(gasLimit) {
  const o = { gasLimit };
  if (GAS_PRICE_GWEI !== null) {
    o.gasPrice = ethers.parseUnits(String(GAS_PRICE_GWEI), "gwei");
  }
  return o;
}

function fmt(x) {
  return x.toString();
}

async function main() {
  console.log("========================================");
  console.log("E2E TESTNET STACK (MANUAL LP SAFE MODE)");
  console.log("Mode: STABLE FIXED PAIR (no createPair, no token deploy)");
  console.log("Network:", hre.network.name);
  const net = await ethers.provider.getNetwork();
  console.log("ChainId:", Number(net.chainId));
  console.log("========================================");

  if (Number(net.chainId) !== CHAIN_ID) {
    throw new Error(`Wrong chain. Expected ${CHAIN_ID}, got ${Number(net.chainId)}`);
  }

  const [me] = await ethers.getSigners();
  const meAddr = await me.getAddress();
  console.log("Me:", meAddr);

  console.log("PAIR:", PAIR_ADDR);
  console.log("TST0:", TST0);
  console.log("WBDAG:", WBDAG);

  const pair = await ethers.getContractAt(IPair_ABI, PAIR_ADDR, me);
  const token0 = await pair.token0();
  const token1 = await pair.token1();

  console.log("pair.token0:", token0);
  console.log("pair.token1:", token1);

  if (token0.toLowerCase() !== TST0.toLowerCase() || token1.toLowerCase() !== WBDAG.toLowerCase()) {
    throw new Error("Pair tokens mismatch vs expected. Stop and re-check addresses.");
  }

  // Wrap BDAG -> WBDAG
  const wbdag = await ethers.getContractAt(IWETH_ABI, WBDAG, me);
  console.log("Wrapping BDAG -> WBDAG (deposit)...");
  await (await wbdag.deposit({ value: WRAP_NATIVE_AMOUNT, ...gasOverrides(GAS_LIMIT_DEPOSIT) })).wait();
  console.log("WBDAG balance:", fmt(await wbdag.balanceOf(meAddr)));

  // Prepare TST seed
  const tst = await ethers.getContractAt(IERC20_ABI, TST0, me);
  const dec = Number(await tst.decimals());
  const seedTstAmount = SEED_TST_UNITS * 10n ** BigInt(dec);

  const tstBal = await tst.balanceOf(meAddr);
  console.log("TST0 decimals:", dec);
  console.log("TST0 balance:", fmt(tstBal));

  if (tstBal < seedTstAmount) {
    throw new Error(
      `Not enough TST0 to seed.\nNeed: ${seedTstAmount}\nHave: ${tstBal}\n` +
      `Use lower SEED_TST_UNITS or transfer more TST0 to your wallet.`
    );
  }

  console.log("Seeding pair via direct transfers...");
  await (await tst.transfer(PAIR_ADDR, seedTstAmount, gasOverrides(GAS_LIMIT_LIGHT))).wait();
  await (await wbdag.transfer(PAIR_ADDR, SEED_WBDAG_AMOUNT, gasOverrides(GAS_LIMIT_LIGHT))).wait();
  console.log("Transfers OK.");

  console.log("Minting LP...");
  const mintRc = await (await pair.mint(meAddr, gasOverrides(GAS_LIMIT_HEAVY))).wait();
  console.log("Mint LP OK tx:", mintRc.hash);

  console.log("LP balance:", fmt(await pair.balanceOf(meAddr)));

  const [r0, r1] = await pair.getReserves();
  console.log("Reserves:");
  console.log(" - reserve0:", r0.toString());
  console.log(" - reserve1:", r1.toString());

  console.log("DONE.");
}

main().catch((err) => {
  console.error("E2E SAFE MODE FAILED:");
  console.error(err);
  process.exitCode = 1;
});
