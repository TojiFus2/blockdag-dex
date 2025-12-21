const hre = require("hardhat");

async function main() {
  const [s] = await hre.ethers.getSigners();
  const p = hre.ethers.provider;

  const WBDAG = "0xC97B4e92fB267bB11b1CD2d475F9E8c16b433289";

  const t = new hre.ethers.Contract(
    WBDAG,
    [
      "function balanceOf(address) view returns (uint256)",
      "function decimals() view returns (uint8)",
      "function symbol() view returns (string)",
    ],
    p
  );

  const dec = Number(await t.decimals());
  const sym = await t.symbol();
  const bal = await t.balanceOf(s.address);

  console.log("address:", s.address);
  console.log("WBDAG:", WBDAG);
  console.log("symbol/dec:", sym, dec);
  console.log("balance raw:", bal.toString());
  console.log("balance fmt:", hre.ethers.formatUnits(bal, dec));
}

main().catch((e) => { console.error(e); process.exit(1); });
