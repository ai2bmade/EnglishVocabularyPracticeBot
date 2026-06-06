import fs from "node:fs";
import path from "node:path";

const sourceDir = process.argv[2] || "content/source";
const issues = [];

for (const fileName of fs.readdirSync(sourceDir).sort()) {
  if (!fileName.endsWith(".csv")) {
    continue;
  }
  const filePath = path.join(sourceDir, fileName);
  const rows = parseCsv(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));

  rows.forEach((row, index) => {
    if (row.status !== "approved") {
      return;
    }
    const answer = Number(row.answer);
    const correctChoice = row[`choice_${answer}`] || "";
    const overlap = findGiveawayOverlap(row.word, correctChoice);
    if (overlap) {
      issues.push({
        file: filePath,
        line: index + 2,
        word: row.word,
        correctChoice,
        overlap
      });
    }
  });
}

if (issues.length > 0) {
  console.error(`Found ${issues.length} giveaway choice issue(s):`);
  for (const issue of issues.slice(0, 100)) {
    console.error(`${issue.file}:${issue.line} ${issue.word} -> "${issue.correctChoice}" (${issue.overlap})`);
  }
  if (issues.length > 100) {
    console.error(`...and ${issues.length - 100} more.`);
  }
  process.exit(1);
}

console.log("No giveaway choice issues found.");

function findGiveawayOverlap(word, choice) {
  const wordForms = forms(word);
  const choiceTokens = normalize(choice).split(/\s+/).filter(Boolean);
  const choiceForms = new Set(choiceTokens.flatMap((token) => forms(token)));

  for (const wordForm of wordForms) {
    if (wordForm.length < 4) {
      continue;
    }
    if (choiceForms.has(wordForm)) {
      return wordForm;
    }
  }

  return null;
}

function forms(value) {
  const normalized = normalize(value);
  const result = new Set([normalized]);
  const suffixes = [
    "ability",
    "ibility",
    "ization",
    "isation",
    "ational",
    "fulness",
    "iveness",
    "lessly",
    "ically",
    "ation",
    "ition",
    "sion",
    "tion",
    "ment",
    "ness",
    "ance",
    "ence",
    "ity",
    "ism",
    "ist",
    "ive",
    "ous",
    "ful",
    "less",
    "able",
    "ible",
    "ical",
    "ic",
    "al",
    "ly",
    "ed",
    "ing",
    "es",
    "s"
  ];

  for (const suffix of suffixes) {
    if (normalized.endsWith(suffix) && normalized.length > suffix.length + 3) {
      result.add(normalized.slice(0, -suffix.length));
    }
  }

  if (normalized.endsWith("y") && normalized.length > 4) {
    result.add(normalized.slice(0, -1));
  }

  return [...result].filter((item) => item.length >= 3);
}

function normalize(value) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseCsv(text) {
  const records = parseRecords(text);
  if (records.length === 0) {
    return [];
  }
  const headers = records.shift();
  return records
    .filter((record) => record.some((cell) => cell.trim() !== ""))
    .map((record) => Object.fromEntries(headers.map((header, index) => [header, record[index] || ""])));
}

function parseRecords(text) {
  const records = [];
  let record = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      record.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field || record.length) {
    record.push(field);
    records.push(record);
  }

  return records;
}
