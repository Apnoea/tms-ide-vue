// Чтение данных прошлых форматов: читаем старое, пишем только новое. Изменённая
// форма сразу перезаписывается в IDB, при импорте конвертация идёт на входе — проект
// переезжает сам, слой потом удаляется целиком вместе с вызовами.
//
// Сейчас в слое одна миграция: символ-подпись `cell_text` → фигура-разметка
// (`tms.Shape`). Подпись перестала быть оборудованием: у неё нет ни портов, ни
// анимаций, поэтому её место — среди фигур, а не в палитре символов.
import { TEXT_FONT_SIZE, TEXT_PADDING_X } from '../stencils/textCell'
import { placeShape } from '../stencils/shapeElement'
import { measureTextWidth } from '../utils/textMetrics'

/**
 * Ячейка `cell_text` (graphJson) → ячейка-фигура. null, если это не подпись —
 * вызывающий тогда оставляет ячейку как есть.
 *
 * Геометрия переводится так, чтобы надпись осталась на месте: у `cell_text` текст
 * рисуется от левого края ячейки с отступом `TEXT_PADDING_X` и центрируется по
 * вертикали (`dominant-baseline: central`), а у фигуры точка привязки — это baseline
 * и якорь по `align`. Поэтому baseline опускаем на ~0.3em ниже центра (середина
 * em-box лежит примерно на этой высоте), а x сдвигаем под якорь.
 */
export function textCellToShape(cell) {
  const tms = cell?.tms
  if (tms?.stencilId !== 'cell_text') return null

  const fontSize = tms.fontSize ?? TEXT_FONT_SIZE
  const text = tms.text ?? ''
  const align = tms.align === 'center' || tms.align === 'right' ? tms.align : 'left'
  const pos = cell.position || { x: 0, y: 0 }
  const height = cell.size?.height ?? fontSize + 6

  const left = pos.x + TEXT_PADDING_X
  // Ширина нужна только якорям center/right, чтобы найти точку привязки. Без canvas
  // (замер < 0) сдвиг не считаем и оставляем подпись у левого края: уехать на пол-ширины
  // лучше, чем отдать в геометрию NaN.
  const measured = measureTextWidth(text, fontSize, !!tms.bold, -1, tms.fontFamily)
  const width = measured > 0 ? measured : 0
  const x =
    align === 'right' && width
      ? left + width
      : align === 'center' && width
        ? left + width / 2
        : left

  const shape = {
    type: 'text',
    x,
    y: pos.y + height / 2 + fontSize * 0.3,
    text,
    fontSize,
    // Дефолтное семейство не пишем: у фигуры отсутствие поля и есть дефолт
    // (`normalizeFont` на рендере), а `undefined` в tms уехал бы в следующий экспорт.
    ...(tms.fontFamily ? { fontFamily: tms.fontFamily } : {}),
    stroke: tms.color || '#000',
    ...(tms.bold ? { bold: true } : {}),
    // Якорь роста — свойство самой подписи, а не следствие замера: при правке текста
    // она будет расти в ту же сторону, что и раньше.
    align,
  }
  const placed = placeShape(shape)
  if (!placed) return null

  const next = {
    type: 'tms.Shape',
    id: cell.id,
    position: placed.position,
    size: placed.size,
    tms: { shape: placed.shape },
  }
  // Замок и группа — свойства ячейки, а не подписи: переносим как есть.
  if (tms.locked) next.tms.locked = true
  if (tms.groupId) next.tms.groupId = tms.groupId
  if (cell.angle) next.angle = cell.angle
  if (cell.z != null) next.z = cell.z
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
    const shapeCell = textCellToShape(c)
    if (!shapeCell) return c
    changed = true
    return shapeCell
  })
  return changed ? { json: { ...json, cells: next }, changed: true } : { json, changed: false }
}
