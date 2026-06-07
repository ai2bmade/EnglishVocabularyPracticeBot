import fs from "node:fs";
import path from "node:path";

const sourceDir = process.argv[2] || "content/source";
const outputPath = process.argv[3] || "content/words.json";
const stopWords = new Set([
  "about",
  "action",
  "another",
  "brief",
  "category",
  "concept",
  "concrete",
  "context",
  "different",
  "everyday",
  "from",
  "into",
  "object",
  "physical",
  "practical",
  "routine",
  "separate",
  "simple",
  "task",
  "that",
  "thing",
  "this",
  "very",
  "with",
  "without"
]);
const bannedDistractorPatterns = [
  /unrelated/i,
  /distractor/i,
  /different advanced concept/i,
  /different academic idea/i,
  /scholarly meaning/i,
  /semantic category/i,
  /incorrect meaning/i,
  /concrete household object/i,
  /brief practical task/i,
  /practical concept/i
];
const naturalDistractors = [
  "a temporary pause caused by a scheduling problem",
  "a formal request made through an official process",
  "a small change in the condition of a system",
  "a careful record kept for later reference",
  "a short period of rest after repeated effort",
  "a public message shared with a large group",
  "a personal choice made after considering options",
  "a measured increase in cost or quantity",
  "a written plan prepared before an activity",
  "a quiet response to pressure or difficulty",
  "a standard rule used to guide behavior",
  "a useful supply kept for future need",
  "a detailed report about recent events",
  "a simple method for organizing information",
  "a sudden change in direction or position",
  "a shared agreement between several people",
  "a limited amount available for use",
  "a careful attempt to reduce possible risk",
  "a regular pattern repeated over time",
  "a private opinion based on personal judgment",
  "a clear sign that action may be needed",
  "a basic tool used to measure progress",
  "a local service provided for daily needs",
  "a minor problem that delays completion",
  "a strong preference for one possible option",
  "a planned meeting for discussing a topic",
  "a gradual improvement in skill or performance",
  "a short explanation given before a decision",
  "a stable condition that does not change quickly",
  "a careful comparison between two choices",
  "a formal decision made after reviewing several possible courses of action",
  "a temporary arrangement used until a more complete solution is ready",
  "a detailed record of changes made during a long administrative process",
  "a gradual increase in responsibility within a structured organization",
  "a public disagreement caused by competing interests and limited information",
  "a written explanation prepared to clarify a complicated practical situation",
  "a repeated pattern of behavior that affects future planning and decisions",
  "a careful effort to prevent mistakes before they create larger problems",
  "a measurable difference between expected results and actual performance",
  "a shared procedure used by several groups to coordinate their work",
  "a long-term plan designed to improve results under changing conditions",
  "a serious delay caused by confusion about roles and responsibilities",
  "a controlled process for checking whether a plan works as expected",
  "a broad change in policy that affects many people at the same time",
  "a specific requirement that must be satisfied before work can continue",
  "a complicated situation in which several conditions must change before any result can be accepted",
  "a long explanation about how several parts of a system depend on one another over time",
  "a formal belief about authority responsibility and the proper order of important institutions",
  "a careful description of how one condition may influence another under strict limits"
];

const rows = [];
for (const fileName of fs.readdirSync(sourceDir).sort()) {
  if (!fileName.endsWith(".csv")) {
    continue;
  }
  const filePath = path.join(sourceDir, fileName);
  rows.push(...parseCsv(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")));
}

const levelCounts = {};
const words = balanceAnswerPositions(rows
  .filter((row) => row.status === "approved")
  .map((row) => {
    const level = Number(row.level);
    levelCounts[level] = (levelCounts[level] || 0) + 1;

    return {
      id: `l${level}_${String(levelCounts[level]).padStart(6, "0")}`,
      level,
      word: row.word,
      choices: [row.choice_1, row.choice_2, row.choice_3],
      answer: Number(row.answer),
      explanation: row.explanation,
      status: row.status
    };
  })
  .map(validateWord));

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify({ words }, null, 2)}\n`);
console.log(`Wrote ${words.length} approved words to ${outputPath}`);

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

function validateWord(word) {
  if (!Number.isInteger(word.level) || word.level < 1 || word.level > 5) {
    throw new Error(`Invalid level for ${word.word}`);
  }
  if (!word.word || word.choices.some((choice) => !choice)) {
    throw new Error(`Missing word or choices for ${word.id}`);
  }
  if (![1, 2, 3].includes(word.answer)) {
    throw new Error(`Answer must be 1, 2, or 3 for ${word.id}`);
  }
  return word;
}

function balanceAnswerPositions(words) {
  const positions = words.map((_, index) => (index % 3) + 1);
  const randomizedWords = [...words].sort((left, right) => hash(left.id) - hash(right.id));

  randomizedWords.forEach((word, index) => {
    placeAnswerAt(word, positions[index]);
  });

  return words.map(validateWord);
}

function placeAnswerAt(word, targetAnswer) {
  const correctChoice = word.choices[word.answer - 1];
  const wrongChoices = word.choices
    .filter((choice, index) => index !== word.answer - 1)
    .sort((left, right) => hash(`${word.id}:${left}`) - hash(`${word.id}:${right}`));

  const newChoices = [];
  for (let position = 1; position <= 3; position += 1) {
    newChoices.push(position === targetAnswer ? correctChoice : wrongChoices.shift());
  }

  word.choices = newChoices;
  word.answer = targetAnswer;
  normalizeDistractors(word);
  balanceChoiceLengths(word);
}

function hash(text) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function balanceChoiceLengths(word) {
  const correctIndex = word.answer - 1;
  const correctLength = visibleLength(word.choices[correctIndex]);
  const wrongIndexes = [0, 1, 2].filter((index) => index !== correctIndex);
  const longestWrongLength = Math.max(...wrongIndexes.map((index) => visibleLength(word.choices[index])));

  if (correctLength <= longestWrongLength || correctLength <= 60) {
    return;
  }

  const targetIndex = wrongIndexes.sort((left, right) => {
    const lengthDelta = visibleLength(word.choices[left]) - visibleLength(word.choices[right]);
    if (lengthDelta !== 0) {
      return lengthDelta;
    }
    return hash(`${word.id}:${left}`) - hash(`${word.id}:${right}`);
  })[0];

  word.choices[targetIndex] = lengthMatchedDistractor(word, targetIndex, correctLength);
}

function lengthMatchedDistractor(word, choiceIndex, targetLength) {
  const candidates = sortedNaturalDistractors(`${word.id}:${choiceIndex}`)
    .filter((choice) => !sharesMeaningCue(word.word, choice));
  return candidates.find((choice) => visibleLength(choice) >= targetLength) || candidates[0];
}

function normalizeDistractors(word) {
  word.choices = word.choices.map((choice, index) => {
    if (index === word.answer - 1) {
      return choice;
    }
    if (isBannedDistractor(choice)) {
      return naturalDistractor(word, index);
    }
    return choice;
  });
}

function isBannedDistractor(choice) {
  return bannedDistractorPatterns.some((pattern) => pattern.test(choice));
}

function naturalDistractor(word, choiceIndex) {
  return sortedNaturalDistractors(`${word.id}:${choiceIndex}`)
    .find((choice) => !sharesMeaningCue(word.word, choice)) || naturalDistractors[0];
}

function sortedNaturalDistractors(seedText) {
  return [...naturalDistractors].sort((left, right) => hash(`${seedText}:${left}`) - hash(`${seedText}:${right}`));
}

function sharesMeaningCue(word, choice) {
  const wordForms = forms(word);
  const choiceForms = new Set(normalize(choice).split(/\s+/).flatMap((token) => forms(token)));
  return wordForms.some((form) => form.length >= 4 && choiceForms.has(form));
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
  return String(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function visibleLength(value) {
  return value.replace(/\s+/g, " ").trim().length;
}
