// @vitest-environment happy-dom
// "From a photo" on the client: a phone with its own Anthropic key sends the photo as an image
// block and keeps only the reading; a yes to the Coach is not a yes to photos; and the photo
// action is offered only where the provider reads them.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const device = { data: null }
const files = {}
vi.mock('./mobile.js', async orig => ({
  ...(await orig()),
  MOBILE: true,
  readJsonFile: async name => (name === 'opengym-coach.json' ? device.data : (name in files ? JSON.parse(files[name]) : null)),
  writeJsonFile: async (name, d) => { if (name === 'opengym-coach.json') device.data = JSON.parse(JSON.stringify(d)); else files[name] = JSON.stringify(d) },
}))
vi.mock('./coach-secrets.js', () => ({ getApiKey: async () => 'sk-ant-test', setApiKey: async () => {}, clearApiKey: async () => {} }))
const wire = { calls: [], answer: null }
vi.mock('./capacitor-fetch.js', () => ({
  nativeFetch: async (url, init) => {
    wire.calls.push({ url, body: init.body ? JSON.parse(init.body) : null })
    return { ok: true, status: 200, text: async () => JSON.stringify(wire.answer), json: async () => wire.answer }
  },
}))

const local = await import('./coach-local.js')
const { _resetCoachDevice } = await import('./coach-device.js')
const { consentTarget, hasAiConsent, allowAi, _resetAiConsent } = await import('./coach-consent.js')
const { coachTakesPhotos } = await import('./coach-api.js')

// A few bytes with a JPEG's signature: the checks look at those, nobody decodes the picture.
const JPEG = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, ...'MARKER-only-in-the-photo'.split('').map(c => c.charCodeAt(0)), 0xff, 0xd9, 0))
const S = () => ({ unit: 'kg', lang: 'en', routines: [], workouts: [], customEx: [], coach: { consent: { agreedAt: '2026-11-01T00:00:00Z', version: 2 } } })
const answer = obj => ({ content: [{ type: 'text', text: JSON.stringify(obj) }], stop_reason: 'end_turn' })
async function settle() {
  for (let i = 0; i < 200; i++) {
    const s = await local.localStatus()
    if (!s.job) return s
    await new Promise(r => setTimeout(r, 5))
  }
  throw new Error('never settled')
}

describe('a phone with its own Anthropic key reads a photo', () => {
  beforeEach(() => {
    _resetCoachDevice(); local._resetLocal()
    device.data = { mode: 'byok', provider: 'anthropic', model: 'claude-test', baseUrl: null }
    wire.calls = []
    wire.answer = answer({ coach_contract: 1, title: 'WOD', exercises: [{ name: 'Back squat', id: '0043', sets: [{ reps: 5, weight: 100, unit: 'kg' }] }], unreadable: ['21-15-9'] })
  })

  it('sends the photo as an image block in front of the payload, and keeps only the reading', async () => {
    await local.localTranscribe(S(), { photo: { type: 'image/jpeg', data: JPEG }, text: 'Leg day' })
    const s = await settle()
    expect(s.pending).toMatchObject({ kind: 'transcribe', title: 'WOD', unreadable: ['21-15-9'] })
    expect(s.pending.exercises[0]).toMatchObject({ name: 'Back squat', id: '0043' })
    expect(s.pending.expiresAt - s.pending.createdAt).toBeLessThanOrEqual(24 * 3600000)
    const [call] = wire.calls
    expect(call.url).toBe('https://api.anthropic.com/v1/messages')
    const [img, text] = call.body.messages[0].content
    expect(img).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: JPEG } })
    expect(text.text).toContain('"task":"transcribe"')
    expect(text.text).toContain('"photo":true')
    expect(text.text).toContain('"text":"Leg day"')
    expect(text.text).not.toContain(JPEG)
    // The device file holds the reading, never the photo.
    expect(JSON.stringify(device.data)).not.toContain(JPEG.slice(4, 30))
  })

  it('refuses what it cannot send before anything goes, and a provider without photos', async () => {
    await expect(local.localTranscribe(S(), {})).rejects.toMatchObject({ code: 'invalid' })
    await expect(local.localTranscribe(S(), { photo: { type: 'image/png', data: JPEG } })).rejects.toMatchObject({ code: 'invalid' })
    device.data = { ...device.data, provider: 'openai' }
    _resetCoachDevice()
    await expect(local.localTranscribe(S(), { photo: { type: 'image/jpeg', data: JPEG } })).rejects.toMatchObject({ code: 'noimages' })
    expect(wire.calls).toHaveLength(0)
  })

  it('the disclosure names the photo as its own category, and whether this provider takes one', async () => {
    const d = await local.localDisclosure()
    expect(d.onRequest).toEqual(['photo'])
    expect(d.images).toBe(true)
  })
})

describe('a photo is its own yes', () => {
  beforeEach(() => { localStorage.clear(); _resetAiConsent() })
  it('a yes for training data is not a yes for photos; a yes for photos keeps the yes for training', async () => {
    const target = consentTarget({ provider: 'anthropic', host: 'api.anthropic.com' }, 'device')
    await allowAi(target)
    expect(await hasAiConsent(target)).toBe(true)
    expect(await hasAiConsent(target, { photo: true })).toBe(false)
    await allowAi(target, { photo: true })
    expect(await hasAiConsent(target, { photo: true })).toBe(true)
    await allowAi(target)
    expect(await hasAiConsent(target, { photo: true }), 'asking again for training alone does not drop it').toBe(true)
  })
})

describe('where the photo action is offered', () => {
  it('only where the provider reads photos', () => {
    expect(coachTakesPhotos({ coach: { enabled: true, images: true } }, null, { mobile: false, demo: false })).toBe(true)
    expect(coachTakesPhotos({ coach: { enabled: true, provider: 'openai' } }, null, { mobile: false, demo: false })).toBe(false)
    expect(coachTakesPhotos({ coach: { images: true } }, null, { demo: true })).toBe(false)
    expect(coachTakesPhotos(null, { mode: 'byok', provider: 'anthropic' }, { mobile: true, demo: false })).toBe(true)
    expect(coachTakesPhotos(null, { mode: 'byok', provider: 'gemini' }, { mobile: true, demo: false })).toBe(false)
    expect(coachTakesPhotos({ coach: { images: true } }, { mode: 'server' }, { mobile: true, demo: false })).toBe(true)
  })
})
