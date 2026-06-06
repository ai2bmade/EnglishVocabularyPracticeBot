import fs from "node:fs";
import path from "node:path";

const token = process.env.TELEGRAM_BOT_TOKEN;
const wordsPath = process.env.WORDS_PATH || "content/words.json";
const userDataPath = process.env.USER_DATA_PATH || "data/users.json";
const pollTimeoutSeconds = Number(process.env.POLL_TIMEOUT_SECONDS || 30);

const levels = {
  1: "Level 1 - Non-native Beginner",
  2: "Level 2 - Non-native Intermediate",
  3: "Level 3 - Non-native Advanced",
  4: "Level 4 - SAT Level",
  5: "Level 5 - GRE & Challenge Me Level"
};

if (!token) {
  console.error("Missing TELEGRAM_BOT_TOKEN.");
  process.exit(1);
}

const apiBase = `https://api.telegram.org/bot${token}`;
const words = loadWords(wordsPath);
const users = loadUsers(userDataPath);
let offset = 0;

console.log(`Loaded ${words.length} approved words.`);
poll().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function poll() {
  while (true) {
    try {
      const updates = await telegram("getUpdates", {
        offset,
        timeout: pollTimeoutSeconds,
        allowed_updates: ["message"]
      });

      for (const update of updates) {
        offset = update.update_id + 1;
        if (update.message) {
          await handleMessage(update.message);
        }
      }
    } catch (error) {
      console.error("Polling error:", error.message);
      await sleep(3000);
    }
  }
}

async function handleMessage(message) {
  const chatId = message.chat.id;
  const text = (message.text || "").trim();
  const user = getUser(chatId);

  if (text === "/start") {
    await sendMessage(chatId, [
      "English Vocabulary Choice",
      "",
      "Choose your level with /level, then start with /quiz."
    ].join("\n"), mainKeyboard());
    return;
  }

  if (text === "/level" || text === "Change Level") {
    user.awaitingLevel = true;
    saveUsers();
    await sendMessage(chatId, levelPrompt(), levelKeyboard());
    return;
  }

  if (text === "/quiz" || text === "Next Word") {
    await sendQuiz(chatId, user);
    return;
  }

  if (text === "/status" || text === "Status") {
    await sendMessage(chatId, statusText(user), mainKeyboard());
    return;
  }

  if (text === "/wrong" || text === "Wrong Words") {
    await sendWrongWords(chatId, user);
    return;
  }

  if (text === "/reset" || text === "Reset") {
    resetUser(user);
    saveUsers();
    await sendMessage(chatId, "Reset complete.", mainKeyboard());
    return;
  }

  if (user.awaitingLevel && /^[1-5]$/.test(text)) {
    user.level = Number(text);
    user.awaitingLevel = false;
    user.currentWordId = null;
    saveUsers();
    await sendMessage(
      chatId,
      `Great. Your level is set to ${levels[user.level]}.\nWe are going to practice Level ${user.level} vocabulary.`,
      mainKeyboard()
    );
    return;
  }

  if (/^[1-3]$/.test(text) && user.currentWordId) {
    await gradeAnswer(chatId, user, Number(text));
    return;
  }

  const wrongWord = findWrongWordByText(user, text);
  if (wrongWord) {
    await sendQuiz(chatId, user, wrongWord);
    return;
  }

  await sendMessage(chatId, "Use /level, /quiz, /status, or /reset.", mainKeyboard());
}

async function sendQuiz(chatId, user, fixedWord = null) {
  const levelWords = words.filter((word) => word.level === user.level);
  if (levelWords.length === 0) {
    await sendMessage(chatId, `No approved words found for ${levels[user.level]}.`, mainKeyboard());
    return;
  }

  const word = fixedWord || sample(levelWords);
  user.currentWordId = word.id;
  saveUsers();

  await sendMessage(chatId, quizText(word), answerKeyboard());
}

async function gradeAnswer(chatId, user, selectedAnswer) {
  const word = words.find((item) => item.id === user.currentWordId);
  if (!word) {
    user.currentWordId = null;
    saveUsers();
    await sendMessage(chatId, "That quiz item is no longer available. Try /quiz.", mainKeyboard());
    return;
  }

  user.completed += 1;
  const isCorrect = selectedAnswer === word.answer;
  if (isCorrect) {
    user.correct += 1;
  } else if (!user.wrongWordIds.includes(word.id)) {
    user.wrongWordIds.push(word.id);
  }
  user.currentWordId = null;
  saveUsers();

  const result = isCorrect
    ? "Correct."
    : `Not quite.\nAnswer: ${word.answer}. ${word.choices[word.answer - 1]}`;

  await sendMessage(chatId, `${result}\n\n${word.explanation || ""}`, mainKeyboard());
}

async function sendWrongWords(chatId, user) {
  const wrongWords = getWrongWords(user);
  if (wrongWords.length === 0) {
    await sendMessage(chatId, "No wrong words yet.", mainKeyboard());
    return;
  }

  const text = ["Wrong Words", "", ...wrongWords.map((word) => word.word)].join("\n");
  await sendMessage(chatId, text, wrongWordsKeyboard(wrongWords));
}

function quizText(word) {
  return [
    `Word:`,
    word.word,
    "",
    "Choose the closest meaning.",
    "",
    `1. ${word.choices[0]}`,
    `2. ${word.choices[1]}`,
    `3. ${word.choices[2]}`
  ].join("\n");
}

function levelPrompt() {
  return [
    "Choose your level:",
    "",
    "1. Level 1 - Non-native Beginner",
    "2. Level 2 - Non-native Intermediate",
    "3. Level 3 - Non-native Advanced",
    "4. Level 4 - SAT Level",
    "5. Level 5 - GRE & Challenge Me Level"
  ].join("\n");
}

function statusText(user) {
  const accuracy = user.completed === 0 ? 0 : Math.round((user.correct / user.completed) * 100);
  return [
    "Status",
    `Level: ${levels[user.level]}`,
    `Completed: ${user.completed}`,
    `Correct: ${user.correct}`,
    `Accuracy: ${accuracy}%`
  ].join("\n");
}

function mainKeyboard() {
  return keyboard([["Next Word", "Change Level"], ["Wrong Words", "Status"], ["Reset"]]);
}

function levelKeyboard() {
  return keyboard([["1", "2", "3"], ["4", "5"]]);
}

function answerKeyboard() {
  return keyboard([["1", "2", "3"], ["Next Word"]]);
}

function wrongWordsKeyboard(wrongWords) {
  const rows = wrongWords.map((word) => [word.word]);
  rows.push(["Next Word", "Change Level"], ["Status", "Reset"]);
  return keyboard(rows);
}

function keyboard(rows) {
  return {
    keyboard: rows,
    resize_keyboard: true,
    one_time_keyboard: false
  };
}

async function sendMessage(chatId, text, replyMarkup) {
  return telegram("sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: replyMarkup
  });
}

async function telegram(method, payload) {
  const response = await fetch(`${apiBase}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!data.ok) {
    throw new Error(`${method} failed: ${data.description || response.statusText}`);
  }
  return data.result;
}

function loadWords(filePath) {
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const parsed = JSON.parse(raw);
  return parsed.words
    .filter((word) => word.status === "approved")
    .map(validateWord);
}

function validateWord(word) {
  if (!word.id || !Number.isInteger(word.level) || !word.word) {
    throw new Error(`Invalid word record: ${JSON.stringify(word)}`);
  }
  if (!Array.isArray(word.choices) || word.choices.length !== 3) {
    throw new Error(`Word ${word.id} must have exactly 3 choices.`);
  }
  if (![1, 2, 3].includes(word.answer)) {
    throw new Error(`Word ${word.id} answer must be 1, 2, or 3.`);
  }
  return word;
}

function loadUsers(filePath) {
  ensureParentDir(filePath);
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  return raw.trim() ? JSON.parse(raw) : {};
}

function getUser(chatId) {
  const key = String(chatId);
  if (!users[key]) {
    users[key] = {
      level: 3,
      completed: 0,
      correct: 0,
      currentWordId: null,
      wrongWordIds: [],
      awaitingLevel: false
    };
  }
  users[key].wrongWordIds ||= [];
  return users[key];
}

function resetUser(user) {
  user.completed = 0;
  user.correct = 0;
  user.currentWordId = null;
  user.wrongWordIds = [];
  user.awaitingLevel = false;
}

function getWrongWords(user) {
  return user.wrongWordIds
    .map((id) => words.find((word) => word.id === id))
    .filter(Boolean);
}

function findWrongWordByText(user, text) {
  return getWrongWords(user).find((word) => word.word.toLowerCase() === text.toLowerCase());
}

function saveUsers() {
  ensureParentDir(userDataPath);
  const tempPath = `${userDataPath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(users, null, 2)}\n`);
  fs.renameSync(tempPath, userDataPath);
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function sample(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
