// Чтение данных до переименования доменных имён: `voltageSource` → `rangeSource`,
// `switchSources` → `boolSource`, класс `tms-voltage-fill` → `tms-range-fill`.
// Читаем оба формата, пишем только новый: открытая форма и поднятый оверрайд сразу
// перезаписываются в IDB — проект переезжает сам. Слой временный, удаляется целиком
// вместе с `legacyKey` в META_FIELDS и вызовами migrate* на входах.
import { RANGE_FILL_CLASS } from '../constants/animation'

/** Прежние имена payload-полей (сейчас `rangeSource` / `boolSource`). */
export const LEGACY_RANGE_KEY = 'voltageSource'
export const LEGACY_BOOL_KEY = 'switchSources'

/** Прежнее имя opt-in класса заливки (сейчас `tms-range-fill`). */
const LEGACY_FILL_CLASS = 'tms-voltage-fill'

// old → new для полей tms; порядок не важен, ключи не пересекаются.
const KEY_MAP = [
  [LEGACY_RANGE_KEY, 'rangeSource'],
  [LEGACY_BOOL_KEY, 'boolSource'],
]

/**
 * tms со старыми ключами → новый tms. null, если миграция не нужна (вызывающий
 * тогда не создаёт копию объекта). Новый ключ приоритетнее старого: если граф уже
 * пересохранён новой версией, а legacy-поле осело рядом — отбрасываем его.
 */
export function migrateTms(tms) {
  if (!tms) return null
  const legacy = KEY_MAP.filter(([old]) => tms[old] !== undefined)
  if (!legacy.length) return null
  const next = { ...tms }
  for (const [old, fresh] of legacy) {
    delete next[old]
    if (next[fresh] === undefined && tms[old]) next[fresh] = tms[old]
  }
  return next
}

/**
 * graphJson формы (из IndexedDB) → `{ json, changed }`. `changed: false` отдаёт
 * исходный объект без копирования — вызывающий по этому флагу решает, нужна ли
 * перезапись в IDB.
 */
export function migrateGraphJson(json) {
  const cells = json?.cells
  if (!Array.isArray(cells)) return { json, changed: false }
  let changed = false
  const next = cells.map((c) => {
    const tms = migrateTms(c?.tms)
    if (!tms) return c
    changed = true
    return { ...c, tms }
  })
  return changed ? { json: { ...json, cells: next }, changed: true } : { json, changed: false }
}

/** shape.svg символа (оверрайд в IDB / library в архиве): старый класс → новый. */
export function migrateStencilSvg(svg) {
  if (typeof svg !== 'string' || !svg.includes(LEGACY_FILL_CLASS)) {
    return { svg, changed: false }
  }
  return { svg: svg.split(LEGACY_FILL_CLASS).join(RANGE_FILL_CLASS), changed: true }
}
