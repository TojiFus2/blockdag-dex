const hre = require("hardhat");

const FACTORY = "0x946C6Be92eFbA79dd8597d663653138dF725ca30";
const WBDAG   = "0xC97B4e92fB267bB11b1CD2d475F9E8c16b433289";
const TT      = "0x75eDCE8a6cE4479B49593CBA68b81438DF83aF27";
const TX_HASH = "0x5097571285f7b9372c26b1c3a18c314049d9e0500114478081d2fb7e4621bc2a";

const FACTORY_ABI = [
  "event PairCreated(address indexed token0, address indexed token1, address pair, uint)",
  "function getPair(address,address) view returns (address)",
  "function allPairs(uint) view returns (address)",
  "function allPairsLength() view returns (uint)",
];

async function main() {
  const [me] = await hre.ethers.getSigners();
  console.log("Me:", me.address);

  const factory = new hre.ethers.Contract(FACTORY, FACTORY_ABI, hre.ethers.provider);

  // 1) Verify factory has code
  const fCode = await hre.ethers.provider.getCode(FACTORY);
  console.log("Factory codeLen:", (fCode.length - 2) / 2);

  // 2) Read getPair both directions
  const p1 = await factory.getPair(WBDAG, TT);
  const p2 = await factory.getPair(TT, WBDAG);
  console.log("getPair(WBDAG,TT):", p1);
  console.log("getPair(TT,WBDAG):", p2);

  // 3) Try allPairsLength (if it reverts -> not UniswapV2Factory)
  try {
    const len = await factory.allPairsLength();
    console.log("allPairsLength():", len.toString());
    if (len > 0n) {
      const last = await factory.allPairs(len - 1n);
      const lastCode = await hre.ethers.provider.getCode(last);
      console.log("Last allPairs:", last, "codeLen:", (lastCode.length - 2) / 2);
    }
  } catch (e) {
    console.log("allPairsLength() REVERT/FAIL -> Factory NON standard:", e?.shortMessage || e?.message);
  }

  // 4) Parse receipt logs of the createPair tx (THIS IS THE KEY)
  const receipt = await hre.ethers.provider.getTransactionReceipt(TX_HASH);
  if (!receipt) throw new Error("Receipt not found. Controlla TX_HASH.");

  console.log("Receipt status:", receipt.status);
  console.log("Logs count:", receipt.logs.length);

  const iface = new hre.ethers.Interface(FACTORY_ABI);

  let found = false;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== FACTORY.toLowerCase()) continue;

    try {
      const parsed = iface.parseLog({ topics: log.topics, data: log.data });
      if (parsed?.name === "PairCreated") {
        found = true;
        const token0 = parsed.args.token0;
        const token1 = parsed.args.token1;
        const pair   = parsed.args.pair;

        console.log("✅ PairCreated event found!");
        console.log("  token0:", token0);
        console.log("  token1:", token1);
        console.log("  pair  :", pair);

        const pCode = await hre.ethers.provider.getCode(pair);
        console.log("  pair codeLen:", (pCode.length - 2) / 2);

        // sanity: check if factory now returns it
        try {
          const gp = await factory.getPair(WBDAG, TT);
          console.log("  getPair now:", gp);
        } catch {}
      }
    } catch (_) {}
  }

  if (!found) {
    console.log("❌ Nessun PairCreated nei log della tx.");
    console.log("=> Quella funzione createPair NON è UniswapV2Factory standard, o log differente.");
  }
}

main().catch((e) => {
  console.error("FAILED:", e?.shortMessage || e?.message || e);
  process.exit(1);
});
