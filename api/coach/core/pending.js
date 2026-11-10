/* The pending slot: one proposal per profile, waiting for a decision. Shared by the server's job
   queue, the phone's own Coach and the demo, so all three hand back the same thing. Kept apart
   from validate.js so the demo can use it without loading the exercise library. */

/* Answers that hold the slot only for as long as it takes to read them, and then give back the
   proposal that was waiting before them: a question in the chat (`ask`), changes for the workout
   in progress (`adapt`), and a workout read from a photo or text (`transcribe`). */
export const PASSING_KINDS = Object.freeze(['ask', 'adapt', 'transcribe']);
export const isPassing = p => !!p && PASSING_KINDS.includes(p.kind);

/* A question is often about the suggestion on screen ("why one set less?"), so the proposal still
   waiting for a decision rides along on the answer (`prev`) and comes back once it is read.
   Never an older answer, and never one that has run out meanwhile. */
export function waitingProposal(p, now = Date.now()) {
  if (!p) return null;
  // Changes for a workout in progress (`adapt`) belong to that workout, not to the next question.
  if (isPassing(p)) return waitingProposal(p.prev, now);
  return p.expiresAt && p.expiresAt < now ? null : p;
}
