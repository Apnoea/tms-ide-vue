// Чтение данных, сохранённых до переименования «voltage» → «диапазоны»: старый
// payload-ключ `tms.voltageSource` и старый класс заливки `tms-voltage-fill`.
// Читаем оба формата, пишем ТОЛЬКО новый — открытая форма и поднятый оверрайд
// сразу перезаписываются в IDB, так проект переезжает сам, без ручных действий.
//
// Слой временный: когда старых архивов не останется, удаляется целиком — вместе
// с `legacyKey` в META_FIELDS (constants/ids) и вызовами migrate* на входах.
import { RANGE_FILL_CLASS } from '../constants/animation'

/** Прежнее имя payload-поля диапазонов (сейчас `rangeSource`). */
export const LEGACY_RANGE_KEY = 'voltageSource'

/** Прежнее имя opt-in класса заливки (сейчас `tms-range-fill`). */
const LEGACY_FILL_CLASS = 'tms-voltage-fill'

/**
 * tms со старым ключом → новый tms. null, если миграция не нужна (вызывающий
 * тогда не создаёт копию объекта). Новый ключ приоритетнее старого: если граф
 * уже пересохранён новой версией, а legacy-поле осело рядом — отбрасываем его.
 */
export function migrateTms(tms) {
  if (!tms || tms[LEGACY_RANGE_KEY] === undefined) return null
  const next = { ...tms }
  delete next[LEGACY_RANGE_KEY]
  if (next.rangeSource === undefined && tms[LEGACY_RANGE_KEY]) {
    next.rangeSource = tms[LEGACY_RANGE_KEY]
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
