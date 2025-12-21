const hre = require("hardhat");

async function main() {
  const addr = "0x971870797ffAA25caC23c22Fcf7ED2688E10d670"; // TST token
  const code = await hre.ethers.provider.getCode(addr);
  console.log("addr:", addr);
  console.log("codeLen:", (code.length - 2) / 2);
  console.log("codeHead:", code.slice(0, 20));
}

main().catch((e) => { console.error(e); process.exit(1); });
