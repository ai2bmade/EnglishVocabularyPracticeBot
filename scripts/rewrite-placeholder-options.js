import fs from "node:fs";
import path from "node:path";

const sourceDir = process.argv[2] || "content/source";
const bannedPatterns = [
  /routine physical object/i,
  /brief practical task/i,
  /concrete household object/i,
  /unrelated/i,
  /distractor/i,
  /different academic idea/i,
  /different advanced concept/i,
  /scholarly meaning/i,
  /practical concept/i,
  /^absence of /i,
  /connected to to /i,
  /concerning to /i,
  /dealing with to /i,
  /caused by to /i,
  /involving to /i,
  /about to /i,
  /shaped by to /i
];

let changed = 0;

for (const fileName of fs.readdirSync(sourceDir).sort()) {
  if (!fileName.endsWith(".csv")) {
    continue;
  }

  const filePath = path.join(sourceDir, fileName);
  const records = parseRecords(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  const headers = records[0];
  const rows = records.slice(1).filter((record) => record.some((cell) => cell.trim() !== ""));
  const indexes = Object.fromEntries(headers.map((header, index) => [header, index]));

  for (const row of rows) {
    const answer = Number(row[indexes.answer]);
    const correct = row[indexes[`choice_${answer}`]];
    const wrongIndexes = [1, 2, 3].filter((choiceNumber) => choiceNumber !== answer);
    const hasPlaceholder = wrongIndexes.some((choiceNumber) => isPlaceholder(row[indexes[`choice_${choiceNumber}`]]));
    if (!hasPlaceholder) {
      continue;
    }

    row[indexes[`choice_${wrongIndexes[0]}`]] = oppositeChoice(correct);
    row[indexes[`choice_${wrongIndexes[1]}`]] = relatedChoice(correct);
    changed += 1;
  }

  const output = [headers, ...rows].map((record) => record.map(csvEscape).join(",")).join("\n");
  fs.writeFileSync(filePath, `${output}\n`);
}

console.log(`Rewrote ${changed} row(s) with placeholder options.`);

function isPlaceholder(value) {
  return bannedPatterns.some((pattern) => pattern.test(value));
}

function oppositeChoice(correct) {
  const text = clean(correct);
  const lower = text.toLowerCase();
  const direct = [
    [/lack of interest or concern/, "strong interest and active concern"],
    [/release from guilt blame or punishment/, "continued blame or punishment"],
    [/serious difficulty or misfortune/, "easy success or good fortune"],
    [/a natural liking or close connection/, "strong dislike or distance"],
    [/anxiety excitement or public disturbance/, "calm order and public peace"],
    [/unselfish concern for others/, "selfish disregard for others"],
    [/unclear meaning or more than one possible meaning/, "clear meaning with only one interpretation"],
    [/strong hostility or dislike/, "warm friendliness or support"],
    [/natural ability or talent/, "lack of natural skill"],
    [/honesty and directness/, "dishonesty and evasiveness"],
    [/logical clarity and connection/, "confusion and lack of connection"],
    [/general agreement/, "open disagreement"],
    [/sudden alarm or confusion/, "calm confidence"],
    [/disagreement or a disputed claim/, "agreement or an accepted claim"],
    [/a confident statement/, "a doubtful or hesitant statement"],
    [/gradual reduction through loss or wear/, "gradual growth or renewal"],
    [/the act of stopping/, "the act of continuing or beginning"],
    [/strong belief or legal finding of guilt/, "strong doubt or legal acquittal"],
    [/aggressive or hostile behavior/, "peaceful and friendly behavior"],
    [/self-satisfaction that prevents concern or effort/, "humble concern that encourages effort"]
  ].find(([pattern]) => pattern.test(lower));

  if (direct) {
    return direct[1];
  }

  if (lower.startsWith("lack of ")) {
    return `strong presence of ${text.slice(8)}`;
  }
  if (lower.startsWith("the lack of ")) {
    return `the strong presence of ${text.slice(12)}`;
  }
  if (lower.startsWith("release from ")) {
    return `continued burden of ${text.slice(13)}`;
  }
  if (lower.startsWith("to ")) {
    return oppositeAction(text);
  }
  if (lower.includes("agreement")) {
    return "clear disagreement or refusal to cooperate";
  }
  if (lower.includes("clarity") || lower.includes("clear")) {
    return "confusion or lack of clear understanding";
  }
  if (lower.includes("ability") || lower.includes("skill") || lower.includes("talent")) {
    return "inability or lack of skill";
  }
  if (lower.includes("increase") || lower.includes("growth")) {
    return "decrease or gradual loss";
  }
  if (lower.includes("reduction") || lower.includes("decline")) {
    return "increase or steady growth";
  }
  if (lower.includes("hostility") || lower.includes("dislike")) {
    return "friendliness or warm approval";
  }
  if (lower.includes("belief")) {
    return "doubt or refusal to accept";
  }
  if (lower.includes("freedom") || lower.includes("liberty")) {
    return "control or restriction";
  }
  if (lower.includes("order")) {
    return "disorder or confusion";
  }
  if (lower.includes("certainty")) {
    return "doubt or uncertainty";
  }
  if (lower.includes("stability")) {
    return "instability or sudden change";
  }

  return `lack of ${withoutLeadingArticle(text)}`;
}

function relatedChoice(correct) {
  const topic = topicPhrase(correct);
  if (clean(correct).toLowerCase().startsWith("to ")) {
    return relatedActionChoice(correct);
  }
  const templates = [
    `a formal decision about ${topic}`,
    `a public discussion about ${topic}`,
    `a written record concerning ${topic}`,
    `a social situation shaped by ${topic}`,
    `a personal reaction connected to ${topic}`,
    `a rule used when dealing with ${topic}`,
    `a long-term result caused by ${topic}`,
    `a careful judgment involving ${topic}`
  ];
  return templates[hash(topic) % templates.length];
}

function oppositeAction(value) {
  const lower = value.toLowerCase();
  const direct = [
    [/to agree/, "to refuse or disagree"],
    [/to accept/, "to reject or refuse"],
    [/to allow|to let/, "to prevent or forbid"],
    [/to begin|to start/, "to stop or finish"],
    [/to continue|to keep/, "to stop or pause"],
    [/to increase|to grow/, "to decrease or shrink"],
    [/to improve/, "to make worse"],
    [/to include/, "to leave out or exclude"],
    [/to enter/, "to leave or stay outside"],
    [/to reveal|to disclose/, "to hide or keep secret"],
    [/to retain|to keep/, "to give up or lose"],
    [/to revoke|to cancel/, "to approve or keep valid"],
    [/to restrict|to limit/, "to allow freely"],
    [/to resolve|to solve/, "to leave unsettled"],
    [/to support/, "to oppose or undermine"],
    [/to withdraw|to move back/, "to stay involved or move forward"],
    [/to separate|to isolate/, "to join or combine"],
    [/to intensify/, "to weaken or reduce"],
    [/to intercept/, "to let pass through"],
    [/to invoke/, "to ignore or avoid citing"],
    [/to intrude/, "to stay away respectfully"]
  ].find(([pattern]) => pattern.test(lower));

  return direct ? direct[1] : "to prevent or reverse that action";
}

function relatedActionChoice(value) {
  const action = value.replace(/^to\s+/i, "").slice(0, 70);
  const templates = [
    `a reason someone may ${action}`,
    `a result that may follow when people ${action}`,
    `a rule about when to ${action}`,
    `a plan made before people ${action}`,
    `a situation that makes people ${action}`,
    `a person responsible for deciding whether to ${action}`
  ];
  return templates[hash(action) % templates.length];
}

function topicPhrase(value) {
  return withoutLeadingArticle(clean(value))
    .replace(/^the act of\s+/i, "")
    .replace(/^the quality of\s+/i, "")
    .replace(/^the state of\s+/i, "")
    .replace(/^the process of\s+/i, "")
    .replace(/^a system where\s+/i, "")
    .replace(/^belief that\s+/i, "")
    .replace(/^belief in\s+/i, "")
    .replace(/^philosophy focused on\s+/i, "")
    .slice(0, 80);
}

function withoutLeadingArticle(value) {
  return value.replace(/^(a|an|the)\s+/i, "");
}

function clean(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function hash(text) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
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

function csvEscape(value) {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
