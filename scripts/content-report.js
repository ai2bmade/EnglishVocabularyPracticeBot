import fs from "node:fs";

const wordsPath = process.argv[2] || "content/words.json";
const targetsPath = process.argv[3] || "content/targets.json";

const words = JSON.parse(fs.readFileSync(wordsPath, "utf8").replace(/^\uFEFF/, "")).words;
const targets = JSON.parse(fs.readFileSync(targetsPath, "utf8").replace(/^\uFEFF/, "")).levels;
const approved = words.filter((word) => word.status === "approved");

let totalCurrent = 0;
let totalTarget = 0;

console.log("Content Target Report");
console.log("=====================");

for (const [level, config] of Object.entries(targets)) {
  const current = approved.filter((word) => word.level === Number(level)).length;
  const target = config.target;
  const remaining = Math.max(target - current, 0);
  totalCurrent += current;
  totalTarget += target;
  console.log(`${config.name}: ${current}/${target} approved (${remaining} remaining)`);
}

console.log("---------------------");
console.log(`Total: ${totalCurrent}/${totalTarget} approved (${Math.max(totalTarget - totalCurrent, 0)} remaining)`);
