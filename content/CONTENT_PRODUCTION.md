# Content Production Plan

The production target is 39,000 vocabulary-choice questions:

- Level 1 - Non-native Beginner: 1,000
- Level 2 - Non-native Intermediate: 3,000
- Level 3 - Non-native Advanced: 5,000
- Level 4 - SAT Level: 10,000
- Level 5 - GRE & Challenge Me Level: 20,000

Student practice should remain cheap: the bot reads prebuilt content from `content/words.json` and does not call AI during quizzes.

## Workflow

1. Create or expand CSV files in `content/source`.
2. Mark unreviewed rows as `pending`.
3. Promote good rows to `approved`.
4. Run `npm run build:words`.
5. Run `npm run content:report`.
6. Deploy the updated `content/words.json`.

## CSV Schema

```text
level,word,choice_1,choice_2,choice_3,answer,explanation,status
```

Rules:

- Each row has one word and exactly three choices.
- `answer` is always `1`, `2`, or `3`.
- Wrong choices should be plausible but clearly wrong.
- Level 4 and Level 5 should use English definition-style options.
- Only `status=approved` rows are exported into the live quiz DB.
