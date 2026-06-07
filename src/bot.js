import fs from "node:fs";
import path from "node:path";

const token = process.env.TELEGRAM_BOT_TOKEN;
const wordsPath = process.env.WORDS_PATH || "content/words.json";
const userDataPath = process.env.USER_DATA_PATH || "data/users.json";
const premiumDataPath = process.env.PREMIUM_DATA_PATH || "data/premium.json";
const pollTimeoutSeconds = Number(process.env.POLL_TIMEOUT_SECONDS || 30);
const freeQuizLimit = Number(process.env.FREE_QUIZ_LIMIT || 10);
const limitWindowMs = 24 * 60 * 60 * 1000;
const buyMeCoffeeUrl = process.env.BUY_ME_COFFEE_URL || "Buy me a coffee";
const premiumDays = Number(process.env.PREMIUM_DAYS || 31);
const freeReferralGoal = Number(process.env.FREE_REFERRAL_GOAL || 3);
const paidReferralExtensionDays = Number(process.env.PAID_REFERRAL_EXTENSION_DAYS || 5);
const botUsername = process.env.BOT_USERNAME || "EnglishVocabularyPracticeBot";
const premiumTelegramIds = new Set(
  (process.env.PREMIUM_TELEGRAM_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
);
const adminTelegramIds = new Set(
  (process.env.ADMIN_TELEGRAM_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
);

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
const premiumAccess = loadPremiumAccess(premiumDataPath);
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

  if (text.startsWith("/grant")) {
    await handleGrantCommand(chatId, text);
    return;
  }

  if (text.startsWith("/revoke")) {
    await handleRevokeCommand(chatId, text);
    return;
  }

  if (text.startsWith("/start")) {
    captureReferral(user, text);
    saveUsers();
    await sendMessage(chatId, [
      "English Vocabulary Choice",
      "",
      "Choose your level with /level, then start with /quiz.",
      "Daily Challenge gives you 10 words: 1 from Level 2, 2 from Level 3, 5 from Level 4, and 2 from Level 5."
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

  if (text === "/challenge" || text === "Daily Challenge") {
    await startDailyChallenge(chatId, user);
    return;
  }

  if (text === "/premium" || text === "Buy Premium") {
    await sendMessage(chatId, premiumInfoText(user), premiumKeyboard());
    return;
  }

  if (text === "/invite" || text === "Invite Friends") {
    await sendMessage(chatId, inviteText(user), inviteKeyboard());
    return;
  }

  if (text === "/paid" || text === "I Paid") {
    await notifyAdminsOfPayment(chatId, user, message);
    return;
  }

  if (text === "Pause" || text === "Take a Break") {
    user.currentWordId = null;
    user.mode = "idle";
    saveUsers();
    await sendMessage(chatId, "Paused. Come back anytime with Next Word or Daily Challenge.", mainKeyboard());
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

  await sendMessage(chatId, "Use /level, /quiz, /challenge, /status, or /reset.", mainKeyboard());
}

async function sendQuiz(chatId, user, fixedWord = null) {
  if (!canTakeFreeQuiz(user, chatId)) {
    await sendMessage(chatId, freeLimitText(user), mainKeyboard());
    return;
  }

  const levelWords = words.filter((word) => word.level === user.level);
  if (levelWords.length === 0) {
    await sendMessage(chatId, `No approved words found for ${levels[user.level]}.`, mainKeyboard());
    return;
  }

  const word = fixedWord || sample(levelWords);
  user.currentWordId = word.id;
  user.mode = "quiz";
  saveUsers();
  await markPracticeStarted(chatId, user);

  await sendMessage(chatId, quizText(word), answerKeyboard());
}

async function gradeAnswer(chatId, user, selectedAnswer) {
  if (user.mode === "challenge") {
    await gradeChallengeAnswer(chatId, user, selectedAnswer);
    return;
  }

  const word = words.find((item) => item.id === user.currentWordId);
  if (!word) {
    user.currentWordId = null;
    saveUsers();
    await sendMessage(chatId, "That quiz item is no longer available. Try /quiz.", mainKeyboard());
    return;
  }

  user.completed += 1;
  recordFreeQuiz(user, chatId);
  const isCorrect = selectedAnswer === word.answer;
  if (isCorrect) {
    user.correct += 1;
  } else if (!user.wrongWordIds.includes(word.id)) {
    user.wrongWordIds.push(word.id);
  }
  user.currentWordId = null;
  user.mode = "idle";
  saveUsers();

  const result = isCorrect
    ? "Correct."
    : `Not quite.\nAnswer: ${word.answer}. ${word.choices[word.answer - 1]}`;

  await sendMessage(chatId, `${result}\n\n${word.explanation || ""}`, mainKeyboard());
  await sendQuiz(chatId, user);
}

async function startDailyChallenge(chatId, user) {
  if (!canStartDailyChallenge(user)) {
    await sendMessage(chatId, dailyChallengeLimitText(user), mainKeyboard());
    return;
  }

  const challengeWords = makeDailyChallengeWords();
  if (!challengeWords) {
    await sendMessage(chatId, "Daily Challenge is not available yet because one or more levels need more approved words.", mainKeyboard());
    return;
  }

  user.mode = "challenge";
  user.currentChallenge = {
    ids: challengeWords.map((word) => word.id),
    index: 0,
    correct: 0,
    startedAt: Date.now()
  };
  user.currentWordId = challengeWords[0].id;
  user.challengeLastStartedAt = Date.now();
  saveUsers();
  await markPracticeStarted(chatId, user);

  await sendMessage(
    chatId,
    [
      "Daily Challenge",
      "10 words total: #1 from Level 2, #2-3 from Level 3, #4-8 from Level 4, and #9-10 from Level 5.",
      "Duplicate words are checked and replaced before the challenge starts.",
      "",
      quizText(challengeWords[0])
    ].join("\n"),
    answerKeyboard()
  );
}

async function gradeChallengeAnswer(chatId, user, selectedAnswer) {
  const challenge = user.currentChallenge;
  const word = words.find((item) => item.id === user.currentWordId);
  if (!challenge || !word) {
    user.mode = "idle";
    user.currentWordId = null;
    user.currentChallenge = null;
    saveUsers();
    await sendMessage(chatId, "That challenge item is no longer available. Try Daily Challenge again later.", mainKeyboard());
    return;
  }

  user.completed += 1;
  const isCorrect = selectedAnswer === word.answer;
  if (isCorrect) {
    user.correct += 1;
    challenge.correct += 1;
  } else if (!user.wrongWordIds.includes(word.id)) {
    user.wrongWordIds.push(word.id);
  }

  const result = isCorrect
    ? "Correct."
    : `Not quite.\nAnswer: ${word.answer}. ${word.choices[word.answer - 1]}`;

  challenge.index += 1;
  if (challenge.index >= challenge.ids.length) {
    const score = challenge.correct;
    user.mode = "idle";
    user.currentWordId = null;
    user.currentChallenge = null;
    saveUsers();
    await sendMessage(chatId, `${result}\n\n${word.explanation || ""}`, mainKeyboard());
    await sendMessage(chatId, dailyChallengeResultText(score), mainKeyboard());
    return;
  }

  const nextWord = words.find((item) => item.id === challenge.ids[challenge.index]);
  user.currentWordId = nextWord.id;
  saveUsers();
  await sendMessage(chatId, `${result}\n\n${word.explanation || ""}`, mainKeyboard());
  await sendMessage(
    chatId,
    [`Daily Challenge ${challenge.index + 1}/10`, "", quizText(nextWord)].join("\n"),
    answerKeyboard()
  );
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
  const plan = premiumStatus(user.chatId);
  const invite = inviteStatus(user);
  return [
    "Status",
    `Level: ${levels[user.level]}`,
    `Completed: ${user.completed}`,
    `Correct: ${user.correct}`,
    `Accuracy: ${accuracy}%`,
    `Telegram ID: ${user.chatId || "unknown"}`,
    `Plan: ${plan.label}`,
    plan.expiresText,
    invite
  ].join("\n");
}

function mainKeyboard() {
  return keyboard([["Next Word", "Daily Challenge"], ["Change Level", "Wrong Words"], ["Status", "Invite Friends"], ["Buy Premium", "Reset"]]);
}

function levelKeyboard() {
  return keyboard([["1", "2", "3"], ["4", "5"]]);
}

function answerKeyboard() {
  return keyboard([["1", "2", "3"], ["Take a Break"]]);
}

function wrongWordsKeyboard(wrongWords) {
  const rows = wrongWords.map((word) => [word.word]);
  rows.push(["Next Word", "Daily Challenge"], ["Change Level", "Status"], ["Buy Premium", "Reset"]);
  return keyboard(rows);
}

function premiumKeyboard() {
  return keyboard([["I Paid", "Invite Friends"], ["Status", "Next Word"], ["Daily Challenge"]]);
}

function inviteKeyboard() {
  return keyboard([["Next Word", "Daily Challenge"], ["Status", "Buy Premium"]]);
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

function loadPremiumAccess(filePath) {
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
      awaitingLevel: false,
      mode: "idle",
      currentChallenge: null,
      freeQuizWindowStartedAt: 0,
      freeQuizCount: 0,
      challengeLastStartedAt: 0,
      createdAt: Date.now(),
      practiceStartedAt: 0,
      referredBy: null,
      referralCreditedAt: 0,
      referralStats: {
        freeInvitees: [],
        freeRewardGrantedAt: 0,
        paidWeeklyCredits: [],
        paidRewardCount: 0
      }
    };
  }
  users[key].chatId = key;
  users[key].wrongWordIds ||= [];
  users[key].mode ||= "idle";
  users[key].currentChallenge ||= null;
  users[key].freeQuizWindowStartedAt ||= 0;
  users[key].freeQuizCount ||= 0;
  users[key].challengeLastStartedAt ||= 0;
  users[key].createdAt ||= Date.now();
  users[key].practiceStartedAt ||= 0;
  users[key].referredBy ||= null;
  users[key].referralCreditedAt ||= 0;
  users[key].referralStats ||= {};
  users[key].referralStats.freeInvitees ||= [];
  users[key].referralStats.freeRewardGrantedAt ||= 0;
  users[key].referralStats.paidWeeklyCredits ||= [];
  users[key].referralStats.paidRewardCount ||= 0;
  return users[key];
}

function resetUser(user) {
  user.completed = 0;
  user.correct = 0;
  user.currentWordId = null;
  user.wrongWordIds = [];
  user.awaitingLevel = false;
  user.mode = "idle";
  user.currentChallenge = null;
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

function savePremiumAccess() {
  ensureParentDir(premiumDataPath);
  const tempPath = `${premiumDataPath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(premiumAccess, null, 2)}\n`);
  fs.renameSync(tempPath, premiumDataPath);
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function sample(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function canTakeFreeQuiz(user, chatId) {
  if (isPremium(chatId)) {
    return true;
  }
  refreshFreeQuizWindow(user);
  return user.freeQuizCount < freeQuizLimit;
}

function recordFreeQuiz(user, chatId) {
  if (isPremium(chatId)) {
    return;
  }
  refreshFreeQuizWindow(user);
  user.freeQuizCount += 1;
}

function refreshFreeQuizWindow(user) {
  const now = Date.now();
  if (!user.freeQuizWindowStartedAt || now - user.freeQuizWindowStartedAt >= limitWindowMs) {
    user.freeQuizWindowStartedAt = now;
    user.freeQuizCount = 0;
  }
}

function freeLimitText(user) {
  const remaining = formatRemaining(user.freeQuizWindowStartedAt + limitWindowMs - Date.now());
  return [
    `Free practice is limited to ${freeQuizLimit} words every 24 hours.`,
    `You can practice again in ${remaining}.`,
    "",
    `Invite ${freeReferralGoal} friends who start practice and get ${premiumDays} days of Premium free.`,
    inviteLink(user),
    "",
    `Or get ${premiumDays} days of Premium here:`,
    buyMeCoffeeUrl
  ].join("\n");
}

function canStartDailyChallenge(user) {
  const lastStarted = Number(user.challengeLastStartedAt || 0);
  return !lastStarted || Date.now() - lastStarted >= limitWindowMs;
}

function dailyChallengeLimitText(user) {
  const remaining = formatRemaining(Number(user.challengeLastStartedAt || 0) + limitWindowMs - Date.now());
  return [
    "Daily Challenge can be taken once every 24 hours.",
    `You can try again in ${remaining}.`,
    "",
    `Premium gives you ${premiumDays} days of unlimited word practice.`,
    buyMeCoffeeUrl
  ].join("\n");
}

async function handleGrantCommand(chatId, text) {
  if (!isAdmin(chatId)) {
    await sendMessage(chatId, "Admin only.", mainKeyboard());
    return;
  }

  const [, targetId, daysText] = text.split(/\s+/);
  const days = Number(daysText || premiumDays);
  if (!targetId || !Number.isFinite(days) || days <= 0) {
    await sendMessage(chatId, "Use: /grant TELEGRAM_ID DAYS", mainKeyboard());
    return;
  }

  const expiresAt = Date.now() + Math.round(days * limitWindowMs);
  grantPremium(targetId, expiresAt, {
    grantedBy: String(chatId),
    status: "verified"
  });

  await sendMessage(chatId, `Premium granted to ${targetId} until ${formatDate(expiresAt)}.`, mainKeyboard());
  await sendMessage(targetId, `Premium is active until ${formatDate(expiresAt)}. Enjoy your study.`, mainKeyboard());
}

async function handleRevokeCommand(chatId, text) {
  if (!isAdmin(chatId)) {
    await sendMessage(chatId, "Admin only.", mainKeyboard());
    return;
  }

  const [, targetId] = text.split(/\s+/);
  if (!targetId) {
    await sendMessage(chatId, "Use: /revoke TELEGRAM_ID", mainKeyboard());
    return;
  }

  premiumAccess[String(targetId)] = {
    expiresAt: 0,
    revokedAt: Date.now(),
    revokedBy: String(chatId),
    status: "revoked"
  };
  savePremiumAccess();
  await sendMessage(chatId, `Premium revoked for ${targetId}.`, mainKeyboard());
}

async function notifyAdminsOfPayment(chatId, user, message) {
  if (isPremium(chatId)) {
    await sendMessage(chatId, "Your Premium is already active.", mainKeyboard());
    return;
  }

  const currentAccess = premiumAccess[String(chatId)];
  if (currentAccess?.status === "revoked") {
    await notifyAdmins([
      "Manual premium review needed",
      `Telegram ID: ${user.chatId}`,
      "This account was previously revoked, so it was not auto-activated.",
      "",
      `If payment is valid, send: /grant ${user.chatId} ${premiumDays}`
    ].join("\n"));
    await sendMessage(chatId, [
      "Thanks. Your payment notice was sent for manual review.",
      `Your Telegram ID: ${user.chatId}`,
      "Premium will be activated soon."
    ].join("\n"), mainKeyboard());
    return;
  }

  const expiresAt = Date.now() + Math.round(premiumDays * limitWindowMs);
  grantPremium(chatId, expiresAt, {
    grantedBy: "self_paid_button",
    status: "pending_payment_check"
  });

  if (adminTelegramIds.size === 0) {
    await sendMessage(chatId, [
      "Welcome to Premium!",
      `You now have unlimited word practice for ${premiumDays} days.`,
      `Telegram ID: ${user.chatId}`,
      `Expires: ${formatDate(expiresAt)}`,
      "",
      buyMeCoffeeUrl
    ].join("\n"), mainKeyboard());
    return;
  }

  const name = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") || "Unknown";
  const username = message.from?.username ? `@${message.from.username}` : "no username";
  const notice = [
    "Premium payment notice",
    `Student: ${name} (${username})`,
    `Telegram ID: ${user.chatId}`,
    `Premium is already active until ${formatDate(expiresAt)}.`,
    "",
    `If payment is valid, no action is needed.`,
    `If there is a problem, send: /revoke ${user.chatId}`
  ].join("\n");

  await notifyAdmins(notice);

  await sendMessage(chatId, [
    "Welcome to Premium!",
    `You now have unlimited word practice for ${premiumDays} days.`,
    `Expires: ${formatDate(expiresAt)}`,
    "You can start studying immediately."
  ].join("\n"), mainKeyboard());
}

async function notifyAdmins(text) {
  if (adminTelegramIds.size === 0) {
    return;
  }
  for (const adminId of adminTelegramIds) {
    await sendMessage(adminId, text, mainKeyboard());
  }
}

function premiumInfoText(user) {
  const plan = premiumStatus(user.chatId);
  if (plan.active) {
    return [
      "Premium",
      plan.expiresAt ? `Your plan is active until ${formatDate(plan.expiresAt)}.` : "Your Premium plan is active.",
      "",
      "Premium removes the regular 10-word free practice limit."
    ].join("\n");
  }

  return [
    "Premium",
    `$5 gives you ${premiumDays} days of study.`,
    `After payment, tap I Paid to start ${premiumDays} days of unlimited word practice.`,
    "",
    `Your Telegram ID: ${user.chatId}`,
    buyMeCoffeeUrl
  ].join("\n");
}

function inviteText(user) {
  const link = inviteLink(user);
  if (isPremium(user.chatId)) {
    const status = paidWeeklyStatus(user);
    return [
      "Invite Challenge",
      `Invite 1 friend each week. When that friend starts practice, Premium extends by ${paidReferralExtensionDays} days.`,
      `This week: ${status}`,
      "",
      "Your invite link:",
      link
    ].join("\n");
  }

  const count = user.referralStats.freeInvitees.length;
  return [
    "Invite Friends",
    `Invite ${freeReferralGoal} friends who start practice and get ${premiumDays} days of Premium free.`,
    `Progress: ${count}/${freeReferralGoal}`,
    "",
    "Your invite link:",
    link
  ].join("\n");
}

async function markPracticeStarted(chatId, user) {
  if (user.practiceStartedAt) {
    return;
  }
  user.practiceStartedAt = Date.now();
  saveUsers();
  await creditReferrer(user);
}

async function creditReferrer(invitee) {
  if (!invitee.referredBy || invitee.referralCreditedAt) {
    return;
  }

  const referrerId = String(invitee.referredBy);
  if (referrerId === String(invitee.chatId)) {
    return;
  }

  const referrer = getUser(referrerId);
  const inviteeId = String(invitee.chatId);
  invitee.referralCreditedAt = Date.now();

  if (isPremium(referrerId)) {
    await creditPaidWeeklyReferral(referrerId, referrer, inviteeId);
  } else {
    await creditFreeReferral(referrerId, referrer, inviteeId);
  }

  saveUsers();
}

async function creditFreeReferral(referrerId, referrer, inviteeId) {
  if (!referrer.referralStats.freeInvitees.includes(inviteeId)) {
    referrer.referralStats.freeInvitees.push(inviteeId);
  }

  const count = referrer.referralStats.freeInvitees.length;
  if (count >= freeReferralGoal && !referrer.referralStats.freeRewardGrantedAt && !isRevoked(referrerId)) {
    const expiresAt = Date.now() + Math.round(premiumDays * limitWindowMs);
    grantPremium(referrerId, expiresAt, {
      grantedBy: "free_referral_reward",
      status: "referral_reward"
    });
    referrer.referralStats.freeRewardGrantedAt = Date.now();
    await sendMessage(referrerId, [
      "Invite reward unlocked!",
      `You invited ${freeReferralGoal} friends who started practice.`,
      `Premium is active for ${premiumDays} days.`,
      `Expires: ${formatDate(expiresAt)}`
    ].join("\n"), mainKeyboard());
    return;
  }

  await sendMessage(referrerId, [
    "Invite progress updated.",
    `Friends started practice: ${count}/${freeReferralGoal}`,
    count >= freeReferralGoal ? "Your reward is being reviewed." : `Invite ${freeReferralGoal - count} more to unlock Premium.`
  ].join("\n"), mainKeyboard());
}

async function creditPaidWeeklyReferral(referrerId, referrer, inviteeId) {
  const weekKey = currentWeekKey();
  const credits = referrer.referralStats.paidWeeklyCredits;
  if (credits.some((credit) => credit.inviteeId === inviteeId)) {
    return;
  }

  if (credits.some((credit) => credit.weekKey === weekKey)) {
    await sendMessage(referrerId, [
      "Invite recorded.",
      "Your Premium invite challenge counts 1 friend per week.",
      "This week's credit is already complete."
    ].join("\n"), mainKeyboard());
    return;
  }

  credits.push({
    weekKey,
    inviteeId,
    creditedAt: Date.now()
  });

  const expiresAt = !isRevoked(referrerId)
    ? extendPremium(referrerId, paidReferralExtensionDays, {
        grantedBy: "paid_weekly_referral_reward",
        status: "referral_extension"
      })
    : null;
  referrer.referralStats.paidRewardCount += 1;
  await sendMessage(referrerId, [
    "Weekly invite reward unlocked!",
    `You earned a ${paidReferralExtensionDays}-day Premium extension.`,
    expiresAt ? `Premium expires: ${formatDate(expiresAt)}` : "Your account needs manual review."
  ].join("\n"), mainKeyboard());
}

function captureReferral(user, text) {
  const match = text.match(/^\/start\s+ref_(\d+)$/);
  if (!match || user.referredBy || user.practiceStartedAt) {
    return;
  }
  const referrerId = match[1];
  if (referrerId === String(user.chatId)) {
    return;
  }
  user.referredBy = referrerId;
}

function inviteStatus(user) {
  if (isPremium(user.chatId)) {
    return `Invite challenge: ${paidWeeklyStatus(user)}`;
  }
  return `Invite reward: ${user.referralStats.freeInvitees.length}/${freeReferralGoal} friends`;
}

function paidWeeklyStatus(user) {
  const weekKey = currentWeekKey();
  return user.referralStats.paidWeeklyCredits.some((credit) => credit.weekKey === weekKey)
    ? "completed this week"
    : "available this week";
}

function inviteLink(user) {
  return `https://t.me/${botUsername}?start=ref_${user.chatId}`;
}

function makeDailyChallengeWords() {
  const plan = [2, 3, 3, 4, 4, 4, 4, 4, 5, 5];
  let picked = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    picked = [];
    const usedIds = new Set();
    const usedWords = new Set();
    let failed = false;
    for (const level of plan) {
      const candidates = words.filter((word) => {
        const key = word.word.toLowerCase();
        return word.level === level && !usedIds.has(word.id) && !usedWords.has(key);
      });
      if (candidates.length === 0) {
        failed = true;
        break;
      }
      const word = sample(candidates);
      picked.push(word);
      usedIds.add(word.id);
      usedWords.add(word.word.toLowerCase());
    }
    if (!failed && new Set(picked.map((word) => word.word.toLowerCase())).size === picked.length) {
      return picked;
    }
  }
  return null;
}

function dailyChallengeResultText(score) {
  if (score === 10) {
    return [
      "Perfect!",
      "Congratulations. You answered all 10 Daily Challenge words correctly."
    ].join("\n");
  }
  if (score === 0) {
    return "Oops! You are in the bottom today for this specific set.";
  }

  const [lowRank, highRank, lowTotal, highTotal] = {
    9: [902, 965, 1002, 1098],
    8: [734, 865, 992, 1198],
    7: [502, 715, 1002, 1098],
    6: [302, 515, 1002, 1198],
    5: [202, 315, 992, 1198],
    4: [152, 215, 802, 1198],
    3: [102, 115, 802, 1198],
    2: [52, 94, 802, 1198],
    1: [12, 55, 972, 1298]
  }[score];

  return `Your score is in the bottom ${randomInt(lowRank, highRank)} out of ${randomInt(lowTotal, highTotal)} learners today for this specific set.`;
}

function isPremium(chatId) {
  const key = String(chatId);
  if (premiumTelegramIds.has(key)) {
    return true;
  }
  const access = premiumAccess[key];
  return Boolean(access && Number(access.expiresAt) > Date.now());
}

function grantPremium(chatId, expiresAt, details = {}) {
  premiumAccess[String(chatId)] = {
    expiresAt,
    grantedAt: Date.now(),
    ...details
  };
  savePremiumAccess();
}

function extendPremium(chatId, days, details = {}) {
  const key = String(chatId);
  const currentExpiresAt = Number(premiumAccess[key]?.expiresAt || 0);
  const baseTime = Math.max(Date.now(), currentExpiresAt);
  const expiresAt = baseTime + Math.round(days * limitWindowMs);
  grantPremium(key, expiresAt, details);
  return expiresAt;
}

function premiumStatus(chatId) {
  const key = String(chatId);
  if (premiumTelegramIds.has(key)) {
    return {
      active: true,
      label: "Premium",
      expiresAt: null,
      expiresText: "Expires: manually managed"
    };
  }
  const access = premiumAccess[key];
  if (access && Number(access.expiresAt) > Date.now()) {
    return {
      active: true,
      label: "Premium",
      expiresAt: Number(access.expiresAt),
      expiresText: `Expires: ${formatDate(access.expiresAt)}`
    };
  }
  return {
    active: false,
    label: "Free",
    expiresAt: null,
    expiresText: `Free limit: ${freeQuizLimit} regular words every 24 hours`
  };
}

function isAdmin(chatId) {
  return adminTelegramIds.has(String(chatId));
}

function isRevoked(chatId) {
  return premiumAccess[String(chatId)]?.status === "revoked";
}

function formatRemaining(ms) {
  const safeMs = Math.max(0, ms);
  const totalMinutes = Math.ceil(safeMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) {
    return `${minutes} minutes`;
  }
  return `${hours} hours ${minutes} minutes`;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function formatDate(value) {
  return new Date(Number(value)).toISOString().slice(0, 10);
}

function currentWeekKey() {
  const date = new Date();
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
