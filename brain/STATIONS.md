# Stations (draft, as run on 2026-11-13)

Four prompts, run in order. Each station is a fresh reader that sees only the materials named in its own prompt and writes one or two files into the case folder. Words in {curly braces} are filled in per case. Stations 1 and 2 can run at the same time.

---

## Station 1 — Watch

You watch {a website} being used and write down what it does. Your notes go to a second reader who will never see the images.

Your materials: {the screenshot and the scroll filmstrip, listed by path, in order}.

Read all the images in one step, with the Read calls sent together.

Write one markdown file with three lists.

**Behaviour** — what a visitor meets, top to bottom. One line per section: what it is, what stands out in it, and where it sits. Then one line for each thing that repeats across sections, and one line for each thing that appears only once. eg. "The basket stays in view on every screen. [Seen: frames 2 to 9]"

**Maker says** — the thing's own words, quoted exactly: headlines, promises, labels, prices, small print. eg. "\"Fresh by seven, or it's free.\" [Seen: frame 1, headline]"

**Odd things** — anything that looks unfinished, repeated by accident, out of date, or that disagrees with something else. eg. "The opening hours differ between the top bar and the footer. [Seen: frames 1 and 9]"

End every line with a grip tag in square brackets: [Seen: where] when you can point at it, [Thin] for a hunch, [Unknown: what would reach it] when it is out of reach.

Write in plain words and short sentences.

Save the file to: {case}/stations/1-behaviour.md

Reply with the saved path only.

---

## Station 2 — Open

You open {a scan report of a website} and write down what the thing is made of. Your notes go to a second reader who will never see the report.

Your material: {the report path} — read it once, in full.

Write one markdown file with three lists.

**Build** — what it is made of: the tools and libraries, the fonts, the big images, and each distinct visual effect with its exact values and the number of elements that use it. eg. "Six cards share one look: a 2px grey border and 8px corners. [Seen: report lines 30 to 34]"

**Motion** — what the scan measured moving: what moves, when, and by how much. Put elements that share the same motion on one line with their count. eg. "Nine blocks share one entrance: each rises 20px and fades in as it reaches the screen. [Seen: report lines 50 to 58]"

**Out of reach** — everything the report says it could not see or test. eg. "Nothing was clicked, so menus were never opened. [Unknown: a scan that clicks]"

End every line with a grip tag in square brackets: [Seen: report line numbers] when the report states it, [Strong] when two or more separate lines agree on something the report does not state outright, [Thin] for a hunch, [Unknown: what would reach it] when it is out of reach.

Write in plain words and short sentences.

Save the file to: {case}/stations/2-build.md

Reply with the saved path only.

---

## Station 3 — Decide

You read two sets of notes about one {website} and work out the decisions its maker made. A watcher wrote the first set from screenshots. A second reader wrote the other from a scan report. You see only their notes.

Your materials — read both in one step, with two Read calls sent together:
- {case}/stations/1-behaviour.md
- {case}/stations/2-build.md

Write two files. Use plain words and short sentences in both.

**File one, the read.** Save to {case}/stations/3-read.md with three parts:

1. **Intent** — one line for each thing the maker seems to be steering the visitor toward. eg. "The maker wants the daily special ordered first. [Strong: it is largest, first, and the only item with a photo]"

2. **Decisions** — look in five places: Repeats (the same thing done many times), Exceptions (the one place a rule breaks), Gaps (something usual for this kind of thing that is missing), Effort (a spot where far more work went in), Mismatches (where the two sets of notes, or the maker's own words, disagree). Choose the {five} decisions that shaped the thing most. Write one card for each:
   - **Decided:** what was done.
   - **Kind:** chosen, default (a tool or habit supplied it), forced (a limit left one option), or leftover (unfinished or forgotten).
   - **Instead of:** the nearest other thing the maker could have done.
   - **Bought / cost:** what it gained and what it gave up.
   - **Why:** your best explanation. Try these lenses and use the ones that answer: Job (the task it does for the visitor), Pull (what it makes the visitor feel, notice, or do next), Gain (what the maker gets), Limits (the tools, time, team and skill the maker had), Voice (what it says about who made it). For a default or a leftover, write what it shows about how the maker works.
   - **Check next:** the one thing to go and look at that could overturn the Why. eg. "Last month's menu, to see whether the special always sits first."

3. **The maker** — one short paragraph on who built this and how they worked: how many people, with what tools, at what speed, what they cared about, what they let slide.

End every line in file one with a grip tag in square brackets: [Seen: which note and line] when a note states it, [Strong: the clues] when two or more separate clues agree, [Open: the other explanation] when another explanation also fits, [Thin] for one clue or a hunch, [Unknown: what would reach it] when it is out of reach.

**File two, the rules.** Save to {case}/stations/4-rules.md. Write four or five rules a builder could follow, each drawn from one card. Write this file in words only: describe every size, colour and amount in plain words, and call the maker "the maker". Give each rule three lines:
   - **Rule:** a choice a builder makes. eg. "Show one thing to buy first, and keep everything else one tap away."
   - **Worked because:** what it did for the visitor or the maker. eg. "A new visitor decides in seconds."
   - **Depended on:** what the maker had that made it work. eg. "A menu short enough to have one clear favourite."
Then add one last heading, **Slips to avoid**, with one line for each leftover the maker let through, in words only. eg. "Opening hours that differ between two places on the page."

Reply with the two saved paths only.

---

## Station 4 — Brief

You turn one maker's rules into a build plan for a different person, who is building her own thing.

Her destination: {a landing page for her own small software tool}.

Your material: {case}/stations/4-rules.md — the rules another maker followed on a thing of their own, why each worked, and what each depended on. Read it once.

Write one markdown file with two parts. Use plain words and short sentences.

**The basket** — sort every rule for her destination. Ask of each: "does she have what this depended on?"
- **Carry** — the choice holds for her as it is. Restate it as her choice.
- **Adapt** — the choice holds after a change. Name the change.
- **Needs their conditions** — the choice holds only with something the other maker had. Name it.
- **Leave** — theirs alone.
Then add **To test**: one or two ideas of your own that came up while sorting, each marked "unproven".

**The build order** — numbered steps for building her thing.
- Step 1 lists the choices she makes for herself before building, one per Carry or Adapt rule. eg. "Pick the one thing a visitor should do first."
- Each later step names one thing to build and the rule it serves. eg. "Build the first screen around that one action. (Rule 2)"
- The last step is a check against the slips to avoid.

End after the last step.

Save the file to: {case}/stations/5-brief.md

Reply with the saved path only.
