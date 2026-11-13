# The brain: read the maker before you rebuild

The gun reports how a thing was built. The brain reads why it was built that way, and turns that into a build plan for something of the person's own. It works on a case folder, one step at a time, and any reader can pick it up from the folder alone.

## Run it

```
node <skill>/brain/next.mjs <case> --target <file|folder|url> --question "<what the person wants to learn>" --destination "<what the person is building>"
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
| Survey | the frame and the scans | `1-survey.md`, `glossary.md` |
| Watch | the survey's Watch list | `2-behaviour.md` |
| Open | the survey's Open list | `3-build.md` |
| Decide | the survey and both sets of notes | `4-read.md`, `5-rules.md` |
| Brief | the frame and the rules, nothing else | `6-brief.md` |

Watch and Open can run at the same time. Brief runs in a fresh conversation or with a helper.

## The case folder

```
<case>/
  NEXT.md        the pointer: what is done, and the step to do now
  0-frame.md     the question and the destination
  1-survey.md    kind, shape, and who reads what
  glossary.md    this case's names for its parts
  2-behaviour.md what it does
  3-build.md     what it is made of
  4-read.md      intent, decisions, the maker
  5-rules.md     the maker's rules, in words only
  6-brief.md     the basket and the build order
  notebook.md    the gun's log of scans
  scans/         one folder per scan, from the gun or an outside tool
  scripts/       one-off scripts written for this case
```

Every file has one writer and one job. Keep new material inside `scans/` or `scripts/`.

## Ways to run it

- **Helpers.** Hand each helper one line: "Open `<case>/NEXT.md` and do the step under Now, then run the command under Then." One helper per step.
- **One reader.** Follow the loop yourself through Decide. Start Brief in a fresh conversation with the same one line.
- **Across days.** Stop anywhere. The next reader runs `next.mjs <case>` and continues.

Each station's instructions live in `stations/`, one file per step.
