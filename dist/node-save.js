import ClmmDb from "./clmm-db";
let fs;
async function init() {
    if (!fs) {
        fs = await import("fs");
    }
}
// Write function
export async function writeData(data) {
    await init();
    fs.writeFileSync("./raydium-dlmm.db", data);
}
// Read function
export async function readData() {
    await init();
    try {
        const data = fs.readFileSync("./raydium-dlmm.db");
        return ClmmDb.create(data);
    }
    catch (err) {
        return ClmmDb.create();
    }
}
//# sourceMappingURL=node-save.js.map