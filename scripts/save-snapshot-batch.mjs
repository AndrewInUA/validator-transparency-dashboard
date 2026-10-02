import fs from "fs";
import path from "path";

const source = process.argv[2];
const outDir = path.resolve("data/snapshot-batches");
fs.mkdirSync(outDir, { recursive: true });

const text = fs.readFileSync(source, "utf8");
const start = text.indexOf("[");
const end = text.lastIndexOf("]");
if (start < 0 || end < start) {
  console.error("no json array in", source);
  process.exit(1);
}
const rows = JSON.parse(text.slice(start, end + 1));
let saved = 0;
for (const row of rows) {
  if (!row?.vote_key || !Array.isArray(row.rows)) continue;
  const safe = String(row.vote_key).replace(/[^A-Za-z0-9]/g, "");
  fs.writeFileSync(path.join(outDir, `${safe}.json`), JSON.stringify(row.rows));
  saved++;
}
console.log(saved);
