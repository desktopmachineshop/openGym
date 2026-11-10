# Paste a workout: from text or a photo to exercises

A design note for a proposed feature, written before any code so it can be agreed on an issue
first. See [`CLAUDE.md`](../../CLAUDE.md) for the architecture; this covers only this feature.

## What it does

Someone has a workout somewhere else: a coach's message, a note on the phone, a screenshot of an
Instagram post, a photo of the gym's whiteboard, or openGym's own "Copy as text" from a friend.
Today they rebuild it by hand, one exercise and one set at a time. This lets them paste it (or
pick a photo) and get the exercises in the order written, with their sets, reps, times and
weights, after a check they can correct.

Two places take it:

- **The Start screen**: "Paste a workout" next to "Freestyle workout (pick as you go)". It opens
  a freestyle session already filled in.
- **The routine editor**: "Add from text or photo", which appends the exercises to the routine
  being edited.

Nothing is added without the review step, and nothing is logged as done: pasted sets arrive as
planned (unticked) sets, exactly as if they had been picked by hand.

## Three steps, each useful on its own

### 1. Text, no AI (`lib/workout-paste.js`)

A pure parser, with tests beside it, that reads:

- openGym's own "Copy as text" (`lib/workout-text.js`) back into entries: the round trip is a
  test (`workoutText` then `parseWorkoutText` gives the same exercises and sets);
- the common hand-written shapes, one exercise per line or block: `Bench press 3x8 @ 60kg`,
  `Squat 5x5 100`, `Pull-ups 3 x max`, `Plank 3x60s`, `RDL 3x10-12`, a set list
  `Curl 12, 12, 10 @ 12 kg`, and a header line followed by sets on the lines under it.

It returns an intermediate list (name as written, sets with reps or seconds and weight, the
unit when one is written) and the lines it could not read, which the review step shows rather
than drops. It works offline, on the phones and on a server with no Coach, and sends nothing
anywhere.

### 2. Free text through the Coach (a `transcribe` job)

For text the parser cannot read (prose, abbreviations, a coach's shorthand), a new Coach job
returns the same intermediate list. It follows the existing jobs:

- prompt in `api/coach/prompts/transcribe.md`, schema and validation beside the others in
  `api/coach/core/`; library ids only, as in `create` and `adapt`;
- the payload is the pasted text and what the matching needs, through the same allowlist
  (`payload.js`); the text is the person's data, never instructions;
- the consent screen already covers sending a person's training to the provider. If the
  maintainers prefer, "text you paste" becomes its own category.

### 3. A photo or screenshot (images to the Coach)

The Coach sent no images, so this is the largest step. It was built first, on its own branch,
with the Claude providers only:

- an `images` capability per provider (`api/coach/config.js`, `core/providers.js`), carried to
  the app as `images` in `/api/config` and the disclosure; the photo action shows only when the
  provider in use has it. Today that is the Anthropic API (server, and the phone's own key), the
  Claude Agent SDK and the fixture. Every Claude model reads images, so the check is per provider,
  not per model;
- the photo goes once, with the `transcribe` job, and is not stored on the server or in the
  profile: it is held on the in-memory job and dropped when the job ends, never in the Coach's
  file, the job log or the job directory. The app downscales it on a canvas first (1568 px on
  the longest edge, JPEG), and the server checks type, bytes and size (`core/photo.js`);
- a new consent category, "the photo or screenshot you pick, sent once and not kept"
  (`ON_REQUEST_CATEGORIES` in `core/categories.js`), named on the consent sheet before the first
  one is sent, and kept as its own yes beside the provider's.

How it came out, where it differs from the plan above:

- **The `transcribe` job of step 2 exists with it.** The job takes a photo, pasted text, or
  both, so free text already reaches the Coach this way; step 2 is then only about offering it
  without a photo on providers that take none. Its payload is the text, a "photo attached" flag,
  unit and language, and a library slice to match against, none of the person's training, so the
  pasted text is covered by "Anything you type to the Coach" on the consent sheet.
- **Ids only when sure.** The answer gives a library `id` only when the model is certain; an id
  that is not one is dropped rather than repaired, and every name without one goes through the
  importer's resolver (`resolveExercise`). A name with several matches shows them as choices.
- **The labels say "photo"** ("Freestyle from a photo or screenshot" on the Start screen, "From
  a photo" in the routine editor) while there is no parser to paste into; they widen to "Paste a
  workout" / "Add from text or photo" when step 1 lands.
- **The review step is its own sheet** (`components/TranscribeSheet.jsx`) until #931 lands. The
  rows and what they become are `lib/workout-transcribe.js`, tested beside it: units converted to
  the profile's, a weight that was not written opened at last time's, a "max" set opened at 0
  reps for the person to fill in, warm-ups and the meaning of a dumbbell weight as for an exercise
  picked by hand.
- **A reading waits a day, not two weeks**, in the Coach's pending slot, and gives back a review
  it stood in front of, as a question in the chat does.

## Matching and the review step

Every step ends in the same place: names matched to the library, then a review sheet.

- Matching reuses the importer's resolver (`lib/log-workout.js` and the CSV importer), so
  "shoulder press" resolves the way an import resolves it. When #931 (check each exercise's
  match before importing, and remember the pick) lands, the review step is that same sheet
  rather than a second one.
- Rows the parser or the Coach could not read, and names with no match or several, are shown
  for the person to fix or drop. A new custom exercise is only created when they say so.
- Order is kept as written. Units are converted to the profile's when the text names another.

## Not in scope

- CrossFit-style metcons (For Time, AMRAP, EMOM) wait for circuits (#765, #725, #560): until
  then a pasted metcon comes in as its movements with a note, not as a timed block.
- Supersets and drop-sets from text: possible later in the parser; not in the first version.
- Logging a past session from text: that is `log_workout` in the MCP server; this feature fills
  a session or a routine to train from.

## Guidelines this follows

- No new dependency on either side.
- Parsing and matching are pure helpers in `frontend/src/lib` with tests beside them.
- Every new UI string goes into every locale pack.
- Step 1 ships without the Coach; steps 2 and 3 are separate pull requests.
