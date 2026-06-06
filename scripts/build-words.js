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
  harmonizeChoiceStyles(word);
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

  if (correctLength <= longestWrongLength) {
    return;
  }

  const targetIndex = wrongIndexes.sort((left, right) => {
    const lengthDelta = visibleLength(word.choices[left]) - visibleLength(word.choices[right]);
    if (lengthDelta !== 0) {
      return lengthDelta;
    }
    return hash(`${word.id}:${left}`) - hash(`${word.id}:${right}`);
  })[0];

  word.choices[targetIndex] = extendDistractor(word.choices[targetIndex], correctLength, `${word.id}:${targetIndex}`);
}

function extendDistractor(choice, targetLength, seedText) {
  const endings = [
    "as a separate unrelated concept",
    "in a different semantic category",
    "as another possible but incorrect meaning",
    "in a context unrelated to the word",
    "as a distractor from another topic",
    "within a different area of meaning"
  ].sort((left, right) => hash(`${seedText}:${left}`) - hash(`${seedText}:${right}`));

  let result = choice;
  let endingIndex = 0;
  while (visibleLength(result) < targetLength && endingIndex < endings.length) {
    result = `${result} ${endings[endingIndex]}`;
    endingIndex += 1;
  }
  return result;
}

function visibleLength(value) {
  return value.replace(/\s+/g, " ").trim().length;
}

function harmonizeChoiceStyles(word) {
  word.choices = word.choices.map((choice, index) => {
    if (choiceStyle(choice) === "term") {
      return makeDefinitionDistractor(choice, `${word.id}:${index}`);
    }
    return choice;
  });
}

function choiceStyle(choice) {
  const normalized = choice.replace(/\s+/g, " ").trim();
  const tokenCount = normalized.split(" ").filter(Boolean).length;
  const definitionStarters = /^(a|an|the|to|in|with|without|by|for|from|under|within|related|not|very|able|having|being)\b/i;

  if (tokenCount === 1 && !definitionStarters.test(normalized) && visibleLength(normalized) <= 22) {
    return "term";
  }
  return "definition";
}

function makeDefinitionDistractor(choice, seedText) {
  const templates = [
    `a different concept related to ${choice}`,
    `an unrelated idea involving ${choice}`,
    `a separate meaning connected with ${choice}`,
    `another category associated with ${choice}`
  ].sort((left, right) => hash(`${seedText}:${left}`) - hash(`${seedText}:${right}`));

  return templates[0];
}
