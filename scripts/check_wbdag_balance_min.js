const hre = require("hardhat");

async function main() {
  const [s] = await hre.ethers.getSigners();
  const WBDAG = "0xC97B4e92fB267bB11b1CD2d475F9E8c16b433289";

  const t = new hre.ethers.Contract(
    WBDAG,
    ["function balanceOf(address) view returns (uint256)"],
    hre.ethers.provider
  );

  const bal = await t.balanceOf(s.address);
  console.log("address:", s.address);
  console.log("WBDAG:", WBDAG);
  console.log("balance raw:", bal.toString());
}

main().catch((e) => { console.error(e); process.exit(1); });
