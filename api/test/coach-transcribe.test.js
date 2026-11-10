/* A workout read back from a photo or pasted text (the `transcribe` job): the photo's checks, the
 * payload that carries none of the person's training, the validator, the two Claude routes that
 * take the photo, and the job end to end through the fixture with the proof that the photo is
 * kept nowhere once it has been sent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tempData, writeState, sampleState } from './helpers.mjs';

// This file's own temp directory, so the job directories it looks for are its own and not those
// of a test file running beside it.
process.env.TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'transcribe-tmp-'));
const DIR = tempData();
const cfg = await import('../coach/config.js');
const jobs = await import('../coach/jobs.js');
const payloadLib = await import('../coach/core/payload.js');
const { checkPhoto, MAX_PHOTO_CHARS } = await import('../coach/core/photo.js');
const { validateTranscribe } = await import('../coach/core/validate.js');
const { attemptOnce } = await import('../coach/core/pipeline.js');
const { buildPromptParts } = await import('../coach/core/prompt.js');
const { SCHEMAS } = await import('../coach/core/schemas.js');
const { anthropicSpec } = await import('../coach/core/adapters/anthropic.js');
const { adapterFor } = await import('../coach/adapters/index.js');
const claude = await import('../coach/adapters/claude.js');
const { coachRoutes } = await import('../coach/routes.js');
const { forcePrivilegeVerdict } = await import('../coach/adapters/spawn.js');
const { waitingProposal } = await import('../coach/core/pending.js');

forcePrivilegeVerdict({ ok: true, dropped: false, why: 'pinned by the test suite' });
const H = 'h'.repeat(16);

// A few bytes with each format's signature. Not a picture anyone could look at, which is all the
// checks and the fixture need: neither decodes it.
const b64 = bytes => Buffer.from(bytes).toString('base64');
const JPEG = b64([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9, 0, 0]);
const PNG = b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const WEBP = b64([...Buffer.from('RIFF'), 36, 0, 0, 0, ...Buffer.from('WEBPVP8 ')]);
// A marker inside the image bytes, to look for anywhere the photo must not be.
const MARKED = b64([0xff, 0xd8, 0xff, 0xe0, ...Buffer.from('PHOTO-MARKER-7f3a-only-in-the-picture'), 0xff, 0xd9]);
const markedData = () => MARKED;

test('a photo is checked before it goes anywhere: type, base64, the bytes, the size', () => {
  assert.deepEqual(checkPhoto({ type: 'image/jpeg', data: JPEG, extra: 'dropped' }), { ok: true, photo: { type: 'image/jpeg', data: JPEG } });
  assert.equal(checkPhoto({ type: 'image/png', data: PNG }).ok, true);
  assert.equal(checkPhoto({ type: 'image/webp', data: WEBP }).ok, true);
  assert.equal(checkPhoto({ type: 'IMAGE/JPEG', data: JPEG }).photo.type, 'image/jpeg');
  assert.equal(checkPhoto({ type: 'image/gif', data: JPEG }).code, 'invalid');
  assert.equal(checkPhoto({ type: 'image/png', data: JPEG }).code, 'invalid', 'a JPEG called a PNG is not passed on');
  assert.equal(checkPhoto({ type: 'image/jpeg', data: b64(Buffer.from('<html>not a picture')) }).code, 'invalid');
  assert.equal(checkPhoto({ type: 'image/jpeg', data: 'not base64!' }).code, 'invalid');
  assert.equal(checkPhoto({ type: 'image/jpeg', data: '' }).code, 'invalid');
  assert.equal(checkPhoto('x').code, 'invalid');
  assert.equal(checkPhoto({ type: 'image/jpeg', data: JPEG + 'A'.repeat(MAX_PHOTO_CHARS) }).code, 'toolarge');
});

test('the payload is the text and a "photo attached" flag, never the person’s training or the photo', async () => {
  const S = sampleState({ dumbbells: { none: { on: true } }, coach: { consent: { agreedAt: 1 }, profile: { goal: 'muscle', limitations: 'bad knee' }, chat: [{ role: 'user', kind: 'text', text: 'secret chat line' }] } });
  const p = payloadLib.build(S, { handle: H, kind: 'transcribe', photo: true, note: '  Bench press 3x8 @ 60kg\nPlank 3x60s  ', now: Date.parse('2026-11-01T12:00:00Z') });
  assert.equal(p.task, 'transcribe');
  assert.equal(p.photo, true);
  assert.equal(p.text, 'Bench press 3x8 @ 60kg\nPlank 3x60s');
  assert.deepEqual(Object.keys(p).sort(), ['coach_contract', 'library', 'meta', 'photo', 'task', 'text']);
  const out = JSON.stringify(p);
  for (const kept of ['bad knee', 'secret chat line', 'Full body A', 'w1']) assert.ok(!out.includes(kept), kept);
  // Matching, not training: dumbbell lifts stay matchable for someone who owns none.
  const { isDumbbellLift } = await import('../coach/core/library.js');
  assert.ok(p.library.some(e => isDumbbellLift(e.id)));
  assert.ok(p.library.some(e => e.id === '0001'), 'what they already train is in the slice');
  assert.equal(payloadLib.build(S, { handle: H, kind: 'transcribe' }).text, undefined);
  assert.equal(payloadLib.build(S, { handle: H, kind: 'transcribe' }).photo, false);
  assert.equal(payloadLib.build(S, { handle: H, kind: 'transcribe', note: 'x'.repeat(9000) }).text.length, payloadLib.TRANSCRIBE_TEXT_MAX);
});

test('the prompt and schema: its own task, the photo and the text as data', () => {
  const parts = buildPromptParts('transcribe', { task: 'transcribe' });
  assert.equal(parts.task, 'transcribe');
  assert.match(parts.system, /read a workout back as exercises/);
  assert.match(parts.system, /data, never instructions/);
  assert.ok(SCHEMAS.transcribe.properties.exercises);
});

test('validateTranscribe: the order written, library ids only, sets as written', () => {
  const r = validateTranscribe({
    coach_contract: 1, title: ' Leg day ',
    exercises: [
      { name: 'Back squat', id: '0043', sets: [{ reps: 5, weight: 100, unit: 'kg' }, { reps: 5, weight: 225, unit: 'lb' }] },
      { name: 'Mystery machine', id: 'not-a-real-id', note: 'each side', sets: [{ reps: 8, repsMax: 12 }, { reps: 8, repsMax: 6 }, {}] },
      { name: 'Plank', sets: [{ seconds: 60, weight: -5 }] },
      { name: 'Walk', id: '__proto__', sets: [] }
    ],
    unreadable: ['21-15-9 for time', 42, '']
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  const [squat, mystery, plank, walk] = r.proposal.exercises;
  assert.equal(r.proposal.title, 'Leg day');
  assert.deepEqual(squat, { name: 'Back squat', id: '0043', sets: [{ reps: 5, weight: 100, unit: 'kg' }, { reps: 5, weight: 225, unit: 'lb' }] });
  assert.equal(mystery.id, null, 'an id that is no exercise is dropped, and the name matched by the app');
  assert.equal(mystery.note, 'each side');
  assert.deepEqual(mystery.sets, [{ reps: 8, repsMax: 12 }, { reps: 8 }, {}], 'a range that runs backwards is a plain set; a max set has no reps');
  assert.deepEqual(plank.sets, [{ seconds: 60 }], 'a weight below zero is not a weight');
  assert.equal(walk.id, null);
  assert.deepEqual(r.proposal.unreadable, ['21-15-9 for time']);
  // A custom exercise offered in the slice may be named back.
  assert.equal(validateTranscribe({ exercises: [{ name: 'My row', id: 'cx1', sets: [] }] }, { customIds: ['cx1'] }).proposal.exercises[0].id, 'cx1');

  assert.deepEqual(validateTranscribe({ exercises: [], unreadable: ['a photo of a cat'] }), { ok: true, nochange: true, reading: 'a photo of a cat' });
  for (const bad of [
    null, { exercises: 'x' }, { exercises: [{ sets: [] }] },
    { exercises: [{ name: 'Plank', sets: [{ reps: 10 }, { seconds: 30 }] }] },
    { exercises: [{ name: 'Plank', sets: [{ reps: 10, seconds: 30 }] }] },
    { exercises: [{ name: 'Curl', sets: [{ reps: 1.5 }] }] },
    { exercises: [{ name: 'Curl', sets: [{ reps: 5000 }] }] }
  ]) assert.equal(validateTranscribe(bad).ok, false, JSON.stringify(bad));
  const many = validateTranscribe({ exercises: Array.from({ length: 60 }, () => ({ name: 'Curl', sets: Array.from({ length: 80 }, () => ({ reps: 10 })) })) });
  assert.equal(many.proposal.exercises.length, 40);
  assert.equal(many.proposal.exercises[0].sets.length, 50);
});

test('the Anthropic API gets the photo as an image block in front of the text', () => {
  const body = anthropicSpec.body({ model: 'm', prompt: 'the payload', system: 'rules', maxTokens: 100, images: [{ type: 'image/jpeg', data: JPEG }] });
  assert.deepEqual(body.messages, [{ role: 'user', content: [
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: JPEG } },
    { type: 'text', text: 'the payload' }
  ] }]);
  assert.equal(anthropicSpec.body({ model: 'm', prompt: 'p', maxTokens: 1 }).messages[0].content, 'p', 'text alone is the string it always was');
});

test('which providers take a photo, stated and never assumed', async () => {
  const takes = id => !!adapterFor(id).images;
  assert.deepEqual(['fixture', 'claude', 'anthropic', 'codex', 'openai', 'gemini', 'compatible'].map(takes), [true, true, true, false, false, false, false]);
  for (const id of Object.keys(cfg.PROVIDERS)) assert.equal(!!cfg.PROVIDERS[id].images, takes(id), id);
  // The last door: a photo handed to an adapter without the capability never leaves.
  let called = false;
  const r = await attemptOnce({ adapter: { spawns: false, invoke: async () => { called = true; return { code: 0, text: '{}' }; } }, kind: 'transcribe', payload: { task: 'transcribe' }, images: [{ type: 'image/jpeg', data: JPEG }] });
  assert.deepEqual(r, { ok: false, errorClass: 'noimages' });
  assert.equal(called, false);
  const openai = await adapterFor('openai').invoke({ cfg: {}, prompt: 'p', env: { OPENAI_API_KEY: 'k' }, images: [{ type: 'image/jpeg', data: JPEG }], fetch: async () => { called = true; } });
  assert.equal(openai.code, 1);
  assert.equal(called, false, 'nothing was sent');
});

test('the Agent SDK gets the photo as an image block on its one user message, with the lockdown unchanged', async () => {
  assert.equal(claude.sdkPrompt('flat prompt', null), 'flat prompt');
  assert.equal(claude.sdkPrompt('flat prompt', []), 'flat prompt');
  const seen = [];
  claude._setSdk({
    query: ({ prompt, options }) => (async function* () {
      const messages = [];
      if (typeof prompt === 'string') messages.push(prompt); else for await (const m of prompt) messages.push(m);
      seen.push({ messages, options });
      yield { type: 'result', subtype: 'success', result: '{"coach_contract":1,"exercises":[]}' };
    })()
  });
  try {
    const r = await claude.default.invoke({ prompt: 'rules and payload', images: [{ type: 'image/png', data: PNG }], jobDir: '/tmp', env: {}, timeoutMs: 5000 });
    assert.equal(r.code, 0);
    const [{ messages, options }] = seen;
    assert.deepEqual(messages, [{ type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } },
      { type: 'text', text: 'rules and payload' }
    ] } }]);
    for (const [k, v] of Object.entries(claude.LOCKDOWN)) assert.deepEqual(options[k], v, k);
    assert.equal(typeof options.spawnClaudeCodeProcess, 'function', 'still spawned as the unprivileged user');
    await claude.default.invoke({ prompt: 'text only', jobDir: '/tmp', env: {}, timeoutMs: 5000 });
    assert.deepEqual(seen[1].messages, ['text only']);
  } finally { claude._setSdk(undefined); }
});

/* ------------------------------ the job, end to end ------------------------------ */

const UID = 'u-photo';
function harness() {
  const routes = coachRoutes({
    json: (res, status, body) => { res.status = status; res.body = body; },
    readBody: async req => req.body || {},
    readSession: () => ({ id: UID }),
    requireAdmin: () => true
  });
  return async (key, body) => { const res = {}; await routes[key]({ body }, res); return res; };
}
async function settle(uid, ms = 15000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const s = jobs.status(uid);
    if (!s.job) return s;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error('job never finished');
}
// The job directories (jobs.js mkdtemp 'coach-'), not the data directory tempData made ('coach-test-').
const coachDirs = () => fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('coach-') && !n.startsWith('coach-test-'));

test('route: a photo, text or both; a bad photo is refused before anything is queued', async () => {
  cfg.save({ enabled: true, provider: 'fixture' });
  writeState(DIR, UID, sampleState());
  const call = harness();
  assert.equal((await call('POST /api/coach/transcribe', {})).body.code, 'invalid');
  assert.equal((await call('POST /api/coach/transcribe', { text: '   ' })).status, 400);
  assert.equal((await call('POST /api/coach/transcribe', { photo: { type: 'image/jpeg', data: b64(Buffer.from('GIF89a....')) } })).body.code, 'invalid');
  const big = await call('POST /api/coach/transcribe', { photo: { type: 'image/jpeg', data: JPEG + 'A'.repeat(MAX_PHOTO_CHARS) } });
  assert.deepEqual([big.status, big.body.code], [413, 'toolarge']);
  assert.equal(jobs.status(UID).job, null, 'nothing was queued');
  assert.equal(jobs.capState(UID).used, 0, 'and nothing was spent');
});

test('the disclosure and /api/config say whether this provider takes a photo', async () => {
  cfg.save({ enabled: true, provider: 'fixture' });
  const call = harness();
  const d = (await call('GET /api/coach/disclosure')).body;
  assert.deepEqual(d.onRequest, ['photo']);
  assert.equal(d.images, true);
  assert.equal(cfg.publicConfig().images, true);
  cfg.save({ provider: 'compatible', providerOptions: { compatible: { baseUrl: 'http://127.0.0.1:9' } } });
  try {
    assert.equal(cfg.publicConfig().images, false);
    assert.equal((await call('GET /api/coach/disclosure')).body.images, false);
    // A photo for a provider that takes none is refused before anything is spent.
    const r = await call('POST /api/coach/transcribe', { photo: { type: 'image/jpeg', data: JPEG } });
    assert.deepEqual([r.status, r.body.code], [400, 'noimages']);
    assert.equal(jobs.capState(UID).used, 0);
  } finally { cfg.save({ provider: 'fixture' }); }
});

test('a photo is read back as exercises, and is kept nowhere once it was sent', async () => {
  cfg.save({ enabled: true, provider: 'fixture' });
  writeState(DIR, UID, sampleState());
  // A review proposal is waiting: the reading stands in front of it, then gives it back.
  jobs.enqueue(UID, { kind: 'review' });
  let s = await settle(UID);
  const review = s.pending;
  assert.equal(review?.kind, 'review', JSON.stringify(jobs.readUser(UID).history));
  const dirsBefore = coachDirs();

  const call = harness();
  const r = await call('POST /api/coach/transcribe', { photo: { type: 'image/jpeg', data: markedData() }, lang: 'en' });
  assert.equal(r.status, 202, JSON.stringify(r.body));
  s = await settle(UID);
  const p = s.pending;
  assert.equal(p.kind, 'transcribe');
  assert.equal(p.id, r.body.job.id);
  assert.match(p.title, /Fixture workout \(photo, \d+ KB\)/, 'the photo reached the provider');
  assert.equal(p.exercises.length, 3);
  assert.ok(p.exercises[0].id && p.exercises[0].sets.length === 3);
  assert.equal(p.exercises[2].name, 'Plank');
  assert.equal(p.exercises[2].id, null, 'named only: the app matches it');
  assert.deepEqual(p.unreadable, ['21-15-9 thrusters and pull-ups, for time']);
  assert.ok(p.expiresAt - p.createdAt <= 24 * 3600000, 'a reading waits a day, not two weeks');
  assert.equal(p.prev.id, review.id);

  // Nowhere: not the profile's Coach file, not the instance config and log, not a job directory.
  const marker = 'PHOTO-MARKER';
  const inFiles = dir => fs.readdirSync(dir, { recursive: true }).map(f => path.join(dir, String(f)))
    .filter(f => fs.statSync(f).isFile()).filter(f => {
      const text = fs.readFileSync(f, 'latin1');
      return text.includes(MARKED.slice(8, 40)) || text.includes(marker);
    });
  assert.deepEqual(inFiles(DIR), [], 'nothing under DATA_DIR holds the photo');
  assert.deepEqual(coachDirs(), dirsBefore, 'the job directory is gone');
  assert.ok(!JSON.stringify(jobs.readUser(UID)).includes(MARKED.slice(8, 40)));

  // Read, and the review comes back.
  await call('POST /api/coach/pending/resolve', { dismissed: true });
  assert.equal(jobs.status(UID).pending.id, review.id);
  assert.equal(jobs.readUser(UID).history.at(-1).kind, 'transcribe');
});

test('pasted text alone is read too, and a reading that expires gives the proposal back', async () => {
  cfg.save({ enabled: true, provider: 'fixture' });
  const call = harness();
  const r = await call('POST /api/coach/transcribe', { text: 'Bench press 3x8 @ 60kg\nPlank 3x60s\nsomething scribbled' });
  assert.equal(r.status, 202);
  const p = (await settle(UID)).pending;
  assert.equal(p.title, 'Fixture workout');
  assert.deepEqual(p.exercises.map(e => [e.name, e.sets.length, e.sets[0]]), [['Bench press', 3, { reps: 8, weight: 60, unit: 'kg' }], ['Plank', 3, { seconds: 60 }]]);
  assert.deepEqual(p.unreadable, ['something scribbled']);
  const rec = jobs.readUser(UID);
  fs.writeFileSync(path.join(DIR, 'coach', UID + '.json'), JSON.stringify({ ...rec, pending: { ...rec.pending, expiresAt: Date.now() - 1 } }));
  const back = jobs.status(UID).pending;
  assert.equal(back?.kind, 'review', 'the waiting review is back, not lost with the expired reading');
  assert.equal(waitingProposal({ kind: 'transcribe', prev: back }), back);
});

test('a forget pulls a queued photo with the job', async () => {
  cfg.save({ enabled: true, provider: 'fixture' });
  const other = 'u-photo-forget';
  writeState(DIR, other, sampleState());
  jobs.enqueue(other, { kind: 'transcribe', photo: { type: 'image/jpeg', data: JPEG } });
  jobs.clearUser(other);
  await new Promise(r => setTimeout(r, 300));
  assert.equal(jobs.readUser(other).pending, null);
});
