import ClmmDb from "./clmm-db";

let fs: any;
async function init() {
  if (!fs) {
    fs = await import("fs");
  }
}

// Write function
export async function writeData(data: Uint8Array): Promise<void> {
  await init();

  fs.writeFileSync("./raydium-dlmm.db", data);
}

// Read function
export async function readData(): Promise<ClmmDb> {
  await init();
  try {
    const data = fs.readFileSync("./raydium-dlmm.db");
    return ClmmDb.create(data);
  } catch (err) {
    return ClmmDb.create();
  }
}
