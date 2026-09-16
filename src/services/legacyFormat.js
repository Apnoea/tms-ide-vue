// Чтение данных прошлых форматов: читаем старое, пишем только новое. Изменённая форма
// сразу перезаписывается в IDB, при импорте конвертация идёт на входе. Слой рассчитан
// на удаление целиком — вместе со своими вызовами.
//
// Что конвертируется:
//  • карточка значения: `valueTag`/`valueLabel`/`valueUnit` → слот и `params`;
//  • символ-точка `cell_node` → свободный конец провода.
//
// Символ-подпись `cell_text` НЕ поддерживается: определения у него нет, такие ячейки
// отбрасываются (`dropTextCells`) — рисунок задавался кодом, восстановить надпись нечем.
import { getStencilById } from '../stencils/registry'

/**
 * Карточка значения ПРОШЛОГО формата: тег в `tms.valueTag`, подпись и единица —
 * своими полями, рисунок программный. В текущем формате это обычный символ: тег в слоте
 * `value_text`, подписи — в `params`. null — ячейка не такая, вызывающий оставляет
 * её как есть.
 *
 * Ключи параметров берутся из ОПРЕДЕЛЕНИЯ (первый по порядку — величина, второй —
 * единица): их выдаёт редактор символов, и у пересохранённой карточки они другие.
 * Конвертация одноразовая, поэтому ключ мимо определения = потерянная подпись.
 *
 * Размер не переносим: у растянутой карточки габарит вернётся к определению — своей
 * ширины у неё нет, растёт весь символ масштабом.
 */
export function valueCellToParams(cell) {
  const tms = cell?.tms
  if (tms?.stencilId !== 'cell_value') return null
  if (!tms.valueTag && !tms.valueLabel && !tms.valueUnit) return null

  const declared = (getStencilById('cell_value')?.params || []).map((p) => p.key)
  // Символа нет в реестре (чужой архив без library) — прежние ключи как запасные.
  const labelKey = declared[0] || 'p1'
  const unitKey = declared[1] || 'p2'

  const next = { ...tms }
  delete next.valueTag
  delete next.valueLabel
  delete next.valueUnit
  if (tms.valueTag) next.slots = { ...(tms.slots || {}), value_text: tms.valueTag }
  const params = { ...(tms.params || {}) }
  if (tms.valueLabel) params[labelKey] = String(tms.valueLabel)
  if (tms.valueUnit) params[unitKey] = String(tms.valueUnit)
  if (Object.keys(params).length) next.params = params
  return { ...cell, tms: next }
}

/**
 * Выбрасывает ячейки символа-подписи `cell_text`: определения у него нет, и на схеме
 * такая ячейка была бы пустым невидимым прямоугольником. Портов у подписи нет, поэтому
 * связи проводов от её удаления не рвутся.
 *
 * @returns {{cells: Array, dropped: number}} `dropped` вызывающий показывает
 *   предупреждением — потеря подписи должна быть видна.
 */
export function dropTextCells(cells) {
  if (!Array.isArray(cells)) return { cells, dropped: 0 }
  const next = cells.filter((c) => c?.tms?.stencilId !== 'cell_text')
  return { cells: next, dropped: cells.length - next.length }
}

/**
 * Символ «точка соединения» (`cell_node`) → точки на свободных концах проводов.
 *
 * Связности провод-провод в модели нет (провод держится за ПОРТ символа), поэтому узел
 * ничего не соединял: концы, сходящиеся в его центре, и есть соединение. Конец,
 * оставленный на холсте, помечает себя сам (`linkDefaults.renderEndDots`), и несколько
 * совпавших точек рисуют одну — вид схемы не меняется.
 *
 * @returns {{ cells: Array, changed: boolean }}
 */
export function dissolveNodeCells(cells) {
  if (!Array.isArray(cells)) return { cells, changed: false }
  const centers = new Map()
  for (const c of cells) {
    if (c?.tms?.stencilId !== 'cell_node') continue
    const p = c.position || { x: 0, y: 0 }
    const s = c.size || { width: 0, height: 0 }
    centers.set(c.id, { x: p.x + s.width / 2, y: p.y + s.height / 2 })
  }
  if (!centers.size) return { cells, changed: false }

  const next = []
  for (const c of cells) {
    if (centers.has(c.id)) continue
    const src = c?.source?.id ? centers.get(c.source.id) : null
    const tgt = c?.target?.id ? centers.get(c.target.id) : null
    if (!src && !tgt) {
      next.push(c)
      continue
    }
    next.push({
      ...c,
      ...(src ? { source: { x: src.x, y: src.y } } : {}),
      ...(tgt ? { target: { x: tgt.x, y: tgt.y } } : {}),
    })
  }
  return { cells: next, changed: true }
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
    const valueCell = valueCellToParams(c)
    if (!valueCell) return c
    changed = true
    return valueCell
  })
  // Точки соединения растворяются на наборе целиком: нужны и ячейки, и линки.
  const nodes = dissolveNodeCells(next)
  if (nodes.changed) changed = true
  // Подписи снятого символа выбрасываем: рисовать их больше нечем.
  const texts = dropTextCells(nodes.cells)
  if (texts.dropped) changed = true
  return changed
    ? { json: { ...json, cells: texts.cells }, changed: true }
    : { json, changed: false }
}
