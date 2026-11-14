# The brain: read the maker before you rebuild

The gun reports how a thing was built. The brain reads why it was built that way, and turns that into a build plan for something of the person's own. It works on a case folder, one step at a time, and any reader can pick it up from the folder alone.

## Run it

```
node <skill>/brain/next.mjs <case> --target <file|folder|url> --question "<what the person wants to learn>" --destination "<what the person is building>" [--keep close|numbers|words]
```

That writes `NEXT.md` in the case folder. From then on the whole method is one loop:

1. Open `NEXT.md` in the case folder and do the step under **Now**.
2. Run the command under **Then**. It writes the next `NEXT.md`.
3. Repeat until `NEXT.md` says **Done**.

`NEXT.md` carries the full instructions for its step, with every path filled in. Follow it as written.

## The sequence

| Step | Reads | Writes |
|---|---|---|
| Frame | the person's two answers | `0-frame.md` |
| Scan | the target, with the gun or an outside tool | `scans/<date>-<tool>/` |
| Survey | the scans, and nothing about what the person hopes to find | `1-survey.md`, `glossary.md` |
| Watch | the survey's Watch list | `2-behaviour.md` |
| Open | the survey's Open list | `3-build.md` |
| Decide | the survey and both sets of notes | `4-read.md` |
| Challenge | both sets of notes and the read, with fresh eyes | `5-challenge.md`, `6-rules.md` |
| Brief | the frame and the rules, plus the build notes and scan reports as far as Keep allows | `7-brief.md` |

Watch and Open can run at the same time. Challenge and Brief each run in a fresh conversation or with a helper.

## How it stays honest

- **The question waits.** The person's question and destination sit in `0-frame.md`, and only Brief opens it. `NEXT.md` names the case and the target and leaves the question out until the read is complete, and the gun's notebook holds scans only. Every step before Brief studies the thing without knowing what anyone hopes to find.
- **The survey is a first impression.** Watch and Open correct it where what they see differs, and rename any part it named wrongly. The old name stays in the glossary beside the new one.
- **Every decision keeps its rivals.** Decide writes two or more explanations for each feature, with what supports each and what counts against it. "The notes cannot settle this" is a full answer.
- **A second reader tries to break the read.** Challenge argues against each conclusion, checks it against the notes, and writes rules only from what survives.

## How much of the look the plan keeps

The rules always reach Brief in words. The look travels beside them, set by `--keep` and saved in `0-frame.md`:

- **close** (the default): Brief also reads `3-build.md`, the scan reports and five pictures of the page. It sets down the page from top to bottom (base colours, fonts, each section), then each treatment's full measured style.
- **numbers**: Brief also reads `3-build.md`, and sets down each treatment in words with the two or three values that make it.
- **words**: Brief reads the frame and the rules alone.

Run `next.mjs <case> --keep <setting>` to change it at any point before Brief. The two look instructions live in `stations/look/`.

## The case folder

```
<case>/
  NEXT.md        the pointer: what is done, and the step to do now
  0-frame.md     the question, the destination, and the Keep setting
  1-survey.md    kind, shape, and who reads what
  glossary.md    this case's names for its parts
  2-behaviour.md what it does
  3-build.md     what it is made of
  4-read.md      where it steers, features with rival explanations, the maker
  5-challenge.md each conclusion tested: stands, weakened, or cannot tell
  6-rules.md     the rules that survived, in words only
  7-brief.md     the basket, the look, and the build order
  notebook.md    the gun's log of scans, one line each
  scans/         one folder per scan, from the gun or an outside tool
  scripts/       one-off scripts written for this case
```

Every file has one writer and one job. Keep new material inside `scans/` or `scripts/`.

## Ways to run it

- **Helpers.** Hand each helper one line: "Open `<case>/NEXT.md` and do the step under Now, then run the command under Then." One helper per step.
- **One reader.** Follow the loop yourself through Decide. Start Challenge in a fresh conversation with the same one line, and Brief in another.
- **Across days.** Stop anywhere. The next reader runs `next.mjs <case>` and continues.

Each station's instructions live in `stations/`, one file per step.
