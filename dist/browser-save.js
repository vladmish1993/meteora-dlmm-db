import ClmmDb from "./clmm-db";
import { delay } from "./util";
let Dexie;
let db;
let table;
let saving = false;
let newData;
async function init() {
    if (!Dexie) {
        const dexie = await import("dexie");
        Dexie = dexie.Dexie;
    }
    if (!db) {
        db = new Dexie("raydium-clmm-db");
        db.version(1).stores({
            db: "id",
        });
        table = db.table("db");
    }
}
// Write function
export async function writeData(data) {
    if (saving) {
        newData = data;
        return;
    }
    saving = true;
    newData = data;
    await init();
    await table.put({ id: 1, data: newData });
    saving = false;
}
// Read function
export async function readData() {
    while (saving) {
        await delay(50);
    }
    await init();
    const record = await table.get(1);
    return ClmmDb.create(record?.data);
}
//# sourceMappingURL=browser-save.js.map