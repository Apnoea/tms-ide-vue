// Правки проекта у символа поставляемого набора — ПАТЧ поверх исходника, а не снимок:
// новая версия набора приносит свой рисунок и порты, а патч ложится сверху. Храним
// только отличия от набора: значение, возвращённое к поставке, из патча выпадает, и
// следующая версия набора его обновит.
//
// Патч живёт в `stencil.json` полем `presetPatch`, рядом с меткой `preset`, и едет с
// символом в оверрайды проекта и в `library/` архива.
//
//   states       { <key>: { code?, label? } }   только у режима «по значению»
//   stateColors  { <key>: цвет | null }          null — у набора цвет есть, проект снял
//   ranges       [{ min?, max?, color }]         списком целиком; [] — проект снял зоны
//   quality / noRotate / noFlip                  галки символа
//   category / domains                           раскладка палитры
//   drawing      true                            видимость фигур своя; при обновлении
//                                                набора не переносится (рисунок новый)
//
// Смена режима и состав состояний у символа набора заперты, поэтому ключи патча — это
// ключи набора; пропавший в новой версии ключ отбрасывается с отчётом.
import { normalizeDomains } from '../constants/domains'
import { cssColor, normalizeStateColor, STATE_KEY_RE } from '../constants/animation'
import { RANGE_SLOT } from '../constants/ids'
import { cleanRangeRows } from './rangeRows'
import { hideCases, hideOnCodes } from './stencilSvg'

const FLAGS = ['quality', 'noRotate', 'noFlip']

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const clone = (v) => JSON.parse(JSON.stringify(v))
const oneLine = (v, max) =>
  String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)

/** Ключи состояний символа: объявленные у «по значению», `true`/`false` у булева. */
function stateKeysOf(json) {
  if (Array.isArray(json?.states) && json.states.length) return json.states.map((s) => s.key)
  const driver = (json?.slots || []).find((s) => s.type !== 'Text' && s.key !== RANGE_SLOT)
  return driver?.type === 'Boolean' ? ['true', 'false'] : []
}

/** Цвет состояния в компактной форме json (строка = контур) или null — цвета нет. */
function colorValue(v) {
  const { stroke, fill } = normalizeStateColor(v)
  const s = cssColor(stroke)
  const f = cssColor(fill)
  if (s && f) return { stroke: s, fill: f }
  if (f) return { fill: f }
  return s || null
}

/** Есть ли у символа правки проекта (не пустой патч). */
export function hasPresetPatch(patch) {
  return !!patch && Object.keys(patch).length > 0
}

/**
 * Отличия символа проекта от исходника набора. `drawing` решает вызывающий: видимость
 * фигур живёт в `shape.svg`, а здесь только json.
 *
 * @param {object} base — json символа из набора
 * @param {object} edited — json после правки
 * @returns {object} патч; пустой объект — символ совпадает с набором
 */
export function diffPresetPatch(base, edited, { drawing = false } = {}) {
  const patch = {}

  const baseStates = new Map((base.states || []).map((s) => [s.key, s]))
  const states = {}
  for (const s of edited.states || []) {
    const was = baseStates.get(s.key)
    if (!was) continue
    const d = {}
    if (String(s.code ?? '') !== String(was.code ?? '')) d.code = String(s.code ?? '')
    if ((s.label || '') !== (was.label || '')) d.label = s.label || ''
    if (Object.keys(d).length) states[s.key] = d
  }
  if (Object.keys(states).length) patch.states = states

  const stateColors = {}
  for (const key of stateKeysOf(base)) {
    const next = colorValue(edited.stateColors?.[key])
    if (!sameJson(colorValue(base.stateColors?.[key]), next)) stateColors[key] = next
  }
  if (Object.keys(stateColors).length) patch.stateColors = stateColors

  const ranges = cleanRangeRows(edited.ranges)
  if (!sameJson(cleanRangeRows(base.ranges), ranges)) patch.ranges = ranges

  for (const f of FLAGS) if (!!base[f] !== !!edited[f]) patch[f] = !!edited[f]

  if ((edited.category || '') !== (base.category || '')) patch.category = edited.category || ''
  const domains = normalizeDomains(edited.domains)
  if (!sameJson([...normalizeDomains(base.domains)].sort(), [...domains].sort())) {
    patch.domains = domains
  }

  if (drawing) patch.drawing = true
  return patch
}

/**
 * Патч проекта поверх json набора. Поля, которых патч не касается, приходят из набора
 * как есть; ключи состояний, которых в этой версии нет, отбрасываются — показать их
 * нечем. Исходник не мутируется.
 *
 * @returns {{ json: object, dropped: string[] }} dropped — ключи, не нашедшие места
 */
export function applyPresetPatch(base, patch) {
  const json = clone(base)
  const dropped = []
  if (!hasPresetPatch(patch)) return { json, dropped }
  const keys = new Set(stateKeysOf(base))

  if (patch.states) {
    const states = Array.isArray(json.states) ? json.states : []
    for (const [key, d] of Object.entries(patch.states)) {
      const st = states.find((s) => s.key === key)
      if (!st) {
        dropped.push(key)
        continue
      }
      if (d.code !== undefined) st.code = d.code
      if (d.label !== undefined) st.label = d.label
    }
    // Карточка прячет группу на кодах СОСЕДЕЙ: смена одного кода меняет все остальные.
    // Только `shape`-карточки: у подписи со значением тега (`text`) суффикс тоже с точкой.
    for (const card of json.animationTemplate || []) {
      if (card.type !== 'shape') continue
      const key = card.idSuffix?.startsWith('.') ? card.idSuffix.slice(1) : ''
      const when = card.bindings?.[0]?.when
      if (when && states.some((s) => s.key === key))
        when.cases = hideCases(hideOnCodes(states, key))
    }
  }

  if (patch.stateColors) {
    const colors = { ...json.stateColors }
    for (const [key, v] of Object.entries(patch.stateColors)) {
      if (!keys.has(key)) {
        if (!dropped.includes(key)) dropped.push(key)
        continue
      }
      if (v == null) delete colors[key]
      else colors[key] = v
    }
    if (Object.keys(colors).length) json.stateColors = colors
    else delete json.stateColors
  }

  if (patch.ranges) {
    const slots = (json.slots || []).filter((s) => s.key !== RANGE_SLOT)
    if (patch.ranges.length) {
      json.ranges = clone(patch.ranges)
      json.slots = [...slots, { key: RANGE_SLOT, type: 'Value' }]
    } else {
      delete json.ranges
      if (slots.length) json.slots = slots
      else delete json.slots
    }
  }

  for (const f of FLAGS) {
    if (patch[f] === undefined) continue
    if (patch[f]) json[f] = true
    else delete json[f]
  }
  if (patch.category !== undefined) json.category = patch.category
  if (patch.domains !== undefined) {
    if (patch.domains.length) json.domains = [...patch.domains]
    else delete json.domains
  }
  return { json, dropped }
}

/** JSON с ключами по алфавиту на любой глубине: порядок полей у моделей может плыть. */
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical)
  if (v && typeof v === 'object') {
    const out = {}
    for (const k of Object.keys(v).sort()) out[k] = canonical(v[k])
    return out
  }
  return v
}

/**
 * Совпадает ли видимость фигур по состояниям у двух наборов фигур. Фигура опознаётся
 * своей моделью без редакторского id и состояния: у символа набора геометрию править
 * нельзя, поэтому различаться может только то, в каком состоянии фигура видна.
 */
export function sameShapeStates(a, b) {
  const keys = (shapes) =>
    (shapes || [])
      .map(({ id: _id, state, ...rest }) => `${JSON.stringify(canonical(rest))}|${state || ''}`)
      .sort()
  return sameJson(keys(a), keys(b))
}

/**
 * Итог правки символа набора: в проект уходят только отличия от поставки. Рисунок —
 * из набора, пока видимость фигур не меняли (`drawing`), иначе свой.
 *
 * @param {{ stencilJson: object, shapeSvg: string }} base — исходник из набора
 * @returns {{ json: object, svg: string, pristine: boolean }} pristine — отличий нет,
 *   символ совпадает с набором, и правка проекта ему не нужна
 */
export function presetEditResult(base, edited, { editedSvg, drawing = false }) {
  const patch = diffPresetPatch(base.stencilJson, edited, { drawing })
  if (!hasPresetPatch(patch)) {
    return { json: clone(base.stencilJson), svg: base.shapeSvg, pristine: true }
  }
  // Свой рисунок — json из редактора: карточки есть только у состояний с фигурами, и
  // собранный из исходника json не знал бы о состоянии, куда фигуру переложили.
  const json = drawing ? clone(edited) : applyPresetPatch(base.stencilJson, patch).json
  json.presetPatch = patch
  return { json, svg: drawing ? editedSvg : base.shapeSvg, pristine: false }
}

/** Патч без ключей состояний, которых в этой версии набора нет. */
function withoutKeys(patch, keys) {
  if (!keys.length) return patch
  const out = { ...patch }
  for (const field of ['states', 'stateColors']) {
    if (!out[field]) continue
    const rest = Object.fromEntries(Object.entries(out[field]).filter(([k]) => !keys.includes(k)))
    if (Object.keys(rest).length) out[field] = rest
    else delete out[field]
  }
  return out
}

/**
 * Символ проекта (оверрайд) → на установленную версию набора.
 *
 * Та же версия: символ уже сверен с ней — остаётся как есть, в том числе со своим
 * рисунком. Другая версия: рисунок приходит новый, правки json ложатся сверху, а своя
 * видимость фигур НЕ переносится (`drawingReset`) — фигуры нового рисунка опознать
 * нечем. Ключи, которых в новой версии нет, выпадают из патча (`dropped`).
 *
 * Снимок прошлого формата (правка без патча) превращается в патч сравнением с
 * исходником; рисунок считаем своим, если разметка отличается.
 *
 * @param {{ stencilJson: object, shapeSvg: string }} base — исходник установленной версии
 * @param {{ stencilJson: object, shapeSvg: string }} project — символ в проекте
 * @returns {{ json, svg, pristine: boolean, dropped: string[], drawingReset: boolean }}
 */
export function rebaseOnPreset(base, project) {
  const patch =
    project.stencilJson.presetPatch ??
    diffPresetPatch(base.stencilJson, project.stencilJson, {
      drawing: project.shapeSvg !== base.shapeSvg,
    })
  const pristine = { json: clone(base.stencilJson), svg: base.shapeSvg, pristine: true }

  if (project.stencilJson.preset?.version === base.stencilJson.preset?.version) {
    if (!hasPresetPatch(patch)) return { ...pristine, dropped: [], drawingReset: false }
    const json = patch.drawing
      ? clone(project.stencilJson)
      : applyPresetPatch(base.stencilJson, patch).json
    json.presetPatch = patch
    const svg = patch.drawing ? project.shapeSvg : base.shapeSvg
    return { json, svg, pristine: false, dropped: [], drawingReset: false }
  }

  const { drawing, ...rest } = patch
  const { json, dropped } = applyPresetPatch(base.stencilJson, rest)
  const kept = withoutKeys(rest, dropped)
  const drawingReset = !!drawing
  if (!hasPresetPatch(kept)) return { ...pristine, dropped, drawingReset }
  json.presetPatch = kept
  return { json, svg: base.shapeSvg, pristine: false, dropped, drawingReset }
}

/**
 * Патч из чужого архива: ключи состояний — по маске CSS (они уходят в селекторы
 * экспорта), цвета — по маске цвета, зоны — каноном строк, домены — фиксированным
 * списком. Невалидный цвет пропускается, а не превращается в «снят»: подделка не должна
 * стирать цвет набора. Ничего годного — undefined.
 */
export function normalizePresetPatch(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out = {}

  if (raw.states && typeof raw.states === 'object') {
    const states = {}
    for (const [key, d] of Object.entries(raw.states)) {
      if (!STATE_KEY_RE.test(key) || !d || typeof d !== 'object') continue
      const e = {}
      if (d.code != null) e.code = oneLine(d.code, 60)
      if (d.label != null) e.label = oneLine(d.label, 60)
      if (Object.keys(e).length) states[key] = e
    }
    if (Object.keys(states).length) out.states = states
  }

  if (raw.stateColors && typeof raw.stateColors === 'object') {
    const colors = {}
    for (const [key, v] of Object.entries(raw.stateColors)) {
      if (!STATE_KEY_RE.test(key)) continue
      if (v === null) colors[key] = null
      else {
        const c = colorValue(v)
        if (c) colors[key] = c
      }
    }
    if (Object.keys(colors).length) out.stateColors = colors
  }

  if (Array.isArray(raw.ranges)) out.ranges = cleanRangeRows(raw.ranges)
  for (const f of FLAGS) if (typeof raw[f] === 'boolean') out[f] = raw[f]
  const category = typeof raw.category === 'string' ? oneLine(raw.category, 60) : ''
  if (category) out.category = category
  if (Array.isArray(raw.domains)) out.domains = normalizeDomains(raw.domains)
  if (raw.drawing === true) out.drawing = true

  return hasPresetPatch(out) ? out : undefined
}
