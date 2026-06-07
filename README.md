# EN_WORD_Practice Telegram Bot

Telegram long-polling bot for English vocabulary multiple-choice practice.

- Bot name: `EN_WORD_Practice`
- Telegram username: [@EnglishVocabularyPracticeBot](https://t.me/EnglishVocabularyPracticeBot)
- GitHub repo: [ai2bmade/EnglishVocabularyPracticeBot](https://github.com/ai2bmade/EnglishVocabularyPracticeBot)
- Coolify project: `EnglishVocabularyPracticeBot`

Students choose a level, answer one word at a time, and get immediate feedback. Practice uses only local `content/words.json`; no OpenAI API call is made during quizzes.

## Features

- `/start`, `/level`, `/quiz`, `/challenge`, `/wrong`, `/status`, `/reset`
- Five vocabulary levels
- Three choices per word, with answers shown as `1`, `2`, or `3`
- Immediate correct/not-quite feedback, optional explanation, and automatic next word delivery
- Daily Challenge: 10 words total, with 1 from Level 2, 2 from Level 3, 5 from Level 4, and 2 from Level 5
- Wrong-word list that stores missed words and lets students tap a word to retry it
- Per-chat progress: level, completed count, correct count, accuracy
- Free practice limit: 10 regular quiz words every 24 hours
- Premium unlock by Telegram numeric ID through `PREMIUM_TELEGRAM_IDS`
- Approved-only content from `content/words.json`
- CSV-to-JSON build script for content operations
- Docker and Coolify-ready long polling deployment

## Levels

1. Level 1 - Non-native Beginner
2. Level 2 - Non-native Intermediate
3. Level 3 - Non-native Advanced
4. Level 4 - SAT Level
5. Level 5 - GRE & Challenge Me Level

## Local Run

```powershell
Copy-Item .env.example .env
# Edit .env and set TELEGRAM_BOT_TOKEN from BotFather.
npm start
```

The bot does not need a public port or domain because it uses Telegram long polling.

## Content

Runtime content lives in:

```text
content/words.json
```

Each item uses a 1-based `answer` value:

```json
{
  "id": "l3_000001",
  "level": 3,
  "word": "abundant",
  "choices": ["rare", "plentiful", "careless"],
  "answer": 2,
  "explanation": "Abundant means existing in large amounts.",
  "status": "approved"
}
```

Only `status: "approved"` words are loaded by the bot.

The production target is 39,000 questions. See `content/CONTENT_PRODUCTION.md` and run `npm run content:report` to track progress by level.

## CSV Workflow

Source CSV files can be edited in `content/source`:

```text
level,word,choice_1,choice_2,choice_3,answer,explanation,status
1,happy,sad,glad,angry,2,Happy means feeling glad or pleased.,approved
```

Build `content/words.json` from CSV:

```powershell
npm run build:words
```

Optional external content folders can mirror this structure:

```text
G:\Codex\en_vocab_choice\source
G:\Codex\en_vocab_choice\exports
```

Example export command:

```powershell
node scripts/build-words.js G:\Codex\en_vocab_choice\source G:\Codex\en_vocab_choice\exports\words.json
```

Then copy the exported `words.json` into the repo `content` folder before deploying.

## Coolify

1. Push this project to `https://github.com/ai2bmade/EnglishVocabularyPracticeBot`.
2. In Coolify project `EnglishVocabularyPracticeBot`, create or connect a Docker Compose app from the repository.
3. Add environment variable:

```text
TELEGRAM_BOT_TOKEN=BotFather token
```

Optional environment variables:

```text
FREE_QUIZ_LIMIT=10
BUY_ME_COFFEE_URL=https://buymeacoffee.com/your-page
PREMIUM_TELEGRAM_IDS=123456789,987654321
```

Students can open `Status` in the bot to see their Telegram numeric ID. After payment, add that ID to `PREMIUM_TELEGRAM_IDS` in Coolify and redeploy.

4. Deploy. No exposed port is required because the bot uses Telegram long polling.

## Verify

```powershell
npm run check
npm run build:words
```
