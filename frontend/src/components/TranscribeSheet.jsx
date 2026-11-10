// "From a photo": a workout found somewhere else (a gym's whiteboard, a screenshot of a post or a
// coach's message, a note) read back by the Coach as exercises (the `transcribe` job), checked
// here, then added as planned sets. Two places open it: the Start screen, which starts a freestyle
// session already filled in, and the routine editor, which appends to the routine.
//
// It goes through the same door as every Coach job (lib/coach-api.js): the data-sharing question
// first, with the photo as its own line the first time one would go; the same polling; the same
// failures in the app's voice. The photo is made small here (lib/photo-upload.js), sent once with
// the job and kept nowhere: it lives in this sheet's state until the sheet closes.
//
// The review is the person's: each exercise shows what was written and what it matched, the
// match can be changed with the exercise picker, sets edited or dropped, exercises dropped. What
// the rows become is lib/workout-transcribe.js, pure and tested.
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, tn } from '../lib/i18n.js'
import { exTitle } from '../lib/coach.js'
import { useCoachStatus, requestTranscribe, resolvePending, jobErrorText, isDeclined } from '../lib/coach-api.js'
import { photoForCoach } from '../lib/photo-upload.js'
import { reviewRows, readyRows, sessionEntries } from '../lib/workout-transcribe.js'
import { exercisePicker, startFilledWorkout } from '../sheets.jsx'
import Icon from './Icon.jsx'
import { Button, NumberField, TextArea } from './ui.jsx'
import '../coach.css'

const TEXT_MAX = 4000

/** One set as an editable line: reps (or seconds) and a weight, and a way to drop it. */
function SetLine({ s, timed, unit, onChange, onRemove, n }) {
  return <div className="tr-set">
    <span className="tr-set-n">{n}</span>
    {timed
      ? <label className="tr-num"><NumberField decimal={false} nullable value={s.seconds ?? null} aria-label={t('Seconds')} onChange={v => onChange({ ...s, seconds: v || undefined })} /><span>{t('sec')}</span></label>
      : <label className="tr-num"><NumberField decimal={false} nullable value={s.reps ?? null} placeholder={t('max')} aria-label={t('Reps')} onChange={v => onChange({ ...s, reps: v || undefined, repsMax: undefined })} /><span>{t('reps')}</span></label>}
    <label className="tr-num"><NumberField nullable value={s.weight ?? null} placeholder="–" aria-label={t('Weight')} onChange={v => onChange({ ...s, weight: v == null ? undefined : v })} /><span>{unit}</span></label>
    <button type="button" className="iconbtn tr-x" aria-label={t('Remove set')} onClick={onRemove}><Icon name="xmark" /></button>
  </div>
}

/** One exercise as written, its match, and its sets. */
function ExerciseRow({ row, unit, onChange, onDrop }) {
  const pick = () => {
    const picker = exercisePicker(ex => { onChange({ ...row, id: ex.id, match: 'picked', candidates: [] }); picker.close() }, { title: t('Change exercise') })
  }
  const timed = row.sets.some(s => s.seconds != null)
  const setAt = (i, next) => onChange({ ...row, sets: row.sets.map((s, j) => (j === i ? next : s)) })
  const addSet = () => onChange({ ...row, sets: [...row.sets, { ...(row.sets[row.sets.length - 1] || {}) }] })
  return <div className={'tr-ex' + (row.id ? '' : ' unmatched')}>
    <div className="tr-ex-hd">
      <div className="grow">
        <div className="tr-written">{t('Written: {0}', row.name)}</div>
        <button type="button" className={'tr-match' + (row.id ? '' : ' none')} onClick={pick}>
          <span className={row.id ? 'capitalize' : undefined}>{row.id ? exTitle(row.id) : t('Pick an exercise')}</span>
          <Icon name="chevronRight" />
        </button>
      </div>
      <button type="button" className="iconbtn" aria-label={t('Remove')} onClick={onDrop}><Icon name="trash" /></button>
    </div>
    {!row.id && (row.candidates.length
      ? <div className="tr-cands">
        <span className="small dim">{t('Which one?')}</span>
        {row.candidates.map(id => <button key={id} type="button" className="chip capitalize" onClick={() => onChange({ ...row, id, match: 'picked', candidates: [] })}>{exTitle(id)}</button>)}
      </div>
      : <div className="small tr-warn">{t('No match in the library. Pick one, or remove it.')}</div>)}
    {!!row.note && <div className="small dim tr-note">{row.note}</div>}
    <div className="tr-sets">
      {row.sets.map((s, i) => <SetLine key={i} n={i + 1} s={s} timed={timed} unit={unit} onChange={next => setAt(i, next)}
        onRemove={() => onChange({ ...row, sets: row.sets.filter((_, j) => j !== i) })} />)}
      <Button size="sm" variant="ghost" icon="plus" onClick={addSet}>{t('Add set')}</Button>
    </div>
  </div>
}

/** The reading, for checking. `onConfirm(rows, reading)` adds them; the sheet closes after. */
export function TranscribeReview({ p, confirmLabel, onConfirm, onDone }) {
  const S = useStore(s => s.S)
  const unit = S.unit === 'lb' ? 'lb' : 'kg'
  const [rows, setRows] = useState(() => reviewRows(S, p))
  const ready = readyRows(rows)
  const finish = () => { try { onDone?.() } catch { /* the sheet may be gone */ } }
  const confirm = () => {
    if (!ready.length) return
    onConfirm(rows, p)
    resolvePending({ accepted: ready.map(r => r.key), rejected: rows.filter(r => !r.id).map(r => r.key) }).catch(() => {})
    finish()
  }
  const dismiss = () => { resolvePending({ dismissed: true }).catch(() => {}); finish() }
  return <div className="pcard tr-card">
    <div className="pcard-hd">
      <div className="pcard-eyebrow"><Icon name="camera" /> {t('From a photo')}</div>
      <h2 className="pcard-h">{p.title || tn('{0} exercise', '{0} exercises', rows.length)}</h2>
      <p className="pcard-sum">{t('Check what the Coach read. Fix a match, a set or a weight, or remove what is wrong. Nothing is logged: every set is added unticked.')}</p>
    </div>
    {rows.map(row => <ExerciseRow key={row.key} row={row} unit={unit}
      onChange={next => setRows(list => list.map(r => (r.key === row.key ? next : r)))}
      onDrop={() => setRows(list => list.filter(r => r.key !== row.key))} />)}
    {!rows.length && <p className="pcard-sum">{t('Nothing left to add.')}</p>}
    {!!p.unreadable?.length && <div className="tr-unread">
      <div className="tr-unread-h"><Icon name="warning" /> {t('Couldn’t read')}</div>
      {p.unreadable.map((line, i) => <div key={i} className="small">{line}</div>)}
    </div>}
    <div className="pcard-ft">
      <Button variant="primary" icon="check" onClick={confirm} disabled={!ready.length}>{confirmLabel(ready.length)}</Button>
      <Button onClick={dismiss}>{t('Cancel')}</Button>
    </div>
  </div>
}

/** The sheet: pick a photo (and paste, if you like), the wait, the review. */
export default function TranscribeSheet({ close, confirmLabel, onConfirm }) {
  const { job, pending, last, lastError, refresh } = useCoachStatus(true)
  const [photo, setPhoto] = useState(null)       // { type, data, preview }: in this sheet only
  const [text, setText] = useState('')
  const [sent, setSent] = useState(null)         // the job this sheet started
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const fileRef = useRef(null)
  // A reading still waiting from before (closed mid-wait, or opened from the Coach) is shown too.
  const mine = pending?.kind === 'transcribe' && (!sent || sent === 'started' || pending.id === sent) ? pending : null
  const ended = sent && !job && !mine && last?.id && last.id === sent
  useEffect(() => { if (sent && !job) refresh() }, [sent, !!job])

  const choose = async e => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    try { setPhoto(await photoForCoach(file)) } catch (err) {
      setError(err?.code === 'toolarge' ? t('That photo is too large to send. Try a smaller one or a screenshot.') : t('That file isn’t a photo the Coach can read.'))
    }
  }
  const send = async () => {
    if (busy || (!photo && !text.trim())) return
    setBusy(true); setError(null)
    try {
      const r = await requestTranscribe({ photo: photo ? { type: photo.type, data: photo.data } : null, text: text.slice(0, TEXT_MAX) })
      setSent(r?.job?.id || 'started')
      // Sent: the picture is not needed again, and is not kept for a retry either.
      setPhoto(null)
      refresh()
    } catch (err) {
      if (isDeclined(err)) return
      const code = err?.data?.code || err?.code || (err?.status === 413 ? 'toolarge' : null)
      setError(code === 'toolarge' ? t('That photo is too large to send. Try a smaller one or a screenshot.') : code ? jobErrorText(code) : (err?.message || t('Something went wrong on the server.')))
    } finally { setBusy(false) }
  }
  const again = () => { setSent(null); setError(null) }

  if (mine) return <div className="workout-coach"><TranscribeReview p={mine} confirmLabel={confirmLabel} onConfirm={onConfirm} onDone={close} /></div>
  return <div className="workout-coach tr-sheet">
    <div className="pcard-eyebrow"><Icon name="camera" /> {t('From a photo')}</div>
    <h2 className="pcard-h" style={{ margin: '4px 0 8px' }}>{t('Turn a workout into exercises')}</h2>
    {job || (sent && !ended)
      ? <div className="adapt-wait" role="status">
        <div className="bub typing"><i /><i /><i /></div>
        <p className="small dim">{t('Reading the workout…')} {t('This usually takes a minute or two.')}</p>
      </div>
      : ended
        ? <div className="adapt-ended">
          <p className="pcard-sum">{last.outcome === 'nochange'
            ? [t('No workout found in it.'), last.reading].filter(Boolean).join(' ')
            : jobErrorText(last.errorClass, lastError?.detail)}</p>
          <div className="row" style={{ gap: 8 }}>
            <Button variant="tinted" onClick={again}>{t('Try again')}</Button>
            <Button onClick={close}>{t('Done')}</Button>
          </div>
        </div>
        : <>
          <p className="small dim" style={{ marginBottom: 12 }}>{t('Pick a photo or screenshot of a workout: a whiteboard, a post, a message from your coach. The Coach reads the exercises and sets, and you check them before anything is added. The photo is sent once and not kept.')}</p>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={choose} data-testid="transcribe-file" />
          {photo
            ? <div className="tr-photo">
              <img src={photo.preview} alt={t('The photo you picked')} />
              <Button size="sm" variant="ghost" icon="image" onClick={() => fileRef.current?.click()}>{t('Pick another photo')}</Button>
            </div>
            : <Button variant="tinted" icon="camera" onClick={() => fileRef.current?.click()}>{t('Pick a photo')}</Button>}
          <TextArea className="tr-text" rows={3} value={text} maxLength={TEXT_MAX} placeholder={t('Or paste the workout, or add a note about the photo (optional)')}
            onChange={e => setText(e.target.value)} />
          {error && <p className="small" style={{ color: 'var(--red)' }}>{error}</p>}
          <div className="pcard-ft" style={{ paddingInline: 0 }}>
            <Button variant="primary" icon="sparkles" onClick={send} disabled={busy || (!photo && !text.trim())}>{t('Read it')}</Button>
            <Button onClick={close}>{t('Cancel')}</Button>
          </div>
        </>}
  </div>
}

/** Opens the sheet. `confirmLabel(n)` names what the confirm does; `onConfirm(rows, reading)` does it. */
export function transcribeSheet({ confirmLabel, onConfirm }) {
  useUI.getState().openSheet(close => <TranscribeSheet close={close} confirmLabel={confirmLabel} onConfirm={onConfirm} />)
}

/** From the Start screen (and the Coach's chat): the reading, checked, starts a freestyle session filled in. */
export function photoWorkoutSheet() {
  transcribeSheet({
    confirmLabel: () => t('Start this workout'),
    onConfirm: (rows, reading) => startFilledWorkout({ name: reading?.title || t('From a photo'), entries: sessionEntries(useStore.getState().S, rows) }),
  })
}
