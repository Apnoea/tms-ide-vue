// Чтение данных прошлых форматов: читаем старое, пишем только новое. Изменённая
// форма сразу перезаписывается в IDB, при импорте конвертация идёт на входе — проект
// переезжает сам, слой потом удаляется целиком вместе с вызовами.
//
// В слое две миграции:
//  • символ-подпись `cell_text` → фигура-разметка (`tms.Shape`): подпись перестала быть
//    оборудованием — у неё нет ни портов, ни анимаций, её место среди фигур;
//  • порты шины `top_i`/`bot_i` → единственный ряд `p_i` в середине толщины.
import { TEXT_FONT_SIZE, TEXT_PADDING_X } from '../stencils/textCell'
import { placeShape } from '../stencils/shapeElement'
import { computeBusPorts } from '../stencils/busCell'
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

const BUS_PORT_LEGACY_RE = /^(?:top|bot)_(\d+)$/

/**
 * Порт шины прошлой схемы (два ряда по краям) → единственный `p_i`; null, если id не
 * из той схемы. Оба ряда сходятся в один порт: слот всегда был одной точкой цепи, а
 * `top_i` и `bot_i` — лишь двумя способами в неё войти.
 *
 * Проверять, что цель именно шина, обязан вызывающий: у символа из редактора порт
 * может называться как угодно, в том числе `top_1`.
 */
export function legacyBusPortId(portId) {
  const m = BUS_PORT_LEGACY_RE.exec(String(portId ?? ''))
  return m ? `p_${m[1]}` : null
}

/** Шина ли эта ячейка graphJson (для сбора id перед миграцией порт-рефов). */
function isBusCellJson(cell) {
  return cell?.tms?.stencilId === 'cell_bus'
}

/**
 * Линк-json: концы, привязанные к портам шины прошлой схемы, → новые id. null, если
 * менять нечего (вызывающий оставляет объект как есть, без копии).
 */
function relinkBusPorts(cell, busIds) {
  if (cell?.type && cell.type !== 'standard.Link') return null
  let next = null
  for (const end of ['source', 'target']) {
    const ref = cell?.[end]
    if (!ref?.id || !busIds.has(ref.id)) continue
    const port = legacyBusPortId(ref.port)
    if (!port) continue
    next = next || { ...cell }
    next[end] = { ...ref, port }
  }
  return next
}

/**
 * Шина прошлой схемы: пересобрать `ports.items`. Обязательно — `fromJSON` берёт порты
 * из сохранённого json как есть, а sync с реестром для шины набор не трогает
 * (см. hasComputedPorts): без пересборки на холсте остались бы два ряда по краям.
 */
function rebuildBusPorts(cell) {
  const items = cell?.ports?.items
  if (!Array.isArray(items) || !items.some((p) => BUS_PORT_LEGACY_RE.test(String(p?.id)))) {
    return null
  }
  const { width = 0, height = 0 } = cell.size || {}
  return { ...cell, ports: { ...cell.ports, items: computeBusPorts(width, height) } }
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
  // id шин собираем ДО обхода: порт-рефы линков переписываем только для них, а линк
  // в списке может стоять раньше своей шины.
  const busIds = new Set(cells.filter(isBusCellJson).map((c) => c.id))
  const next = cells.map((c) => {
    const shapeCell = textCellToShape(c)
    if (shapeCell) {
      changed = true
      return shapeCell
    }
    const migrated = isBusCellJson(c) ? rebuildBusPorts(c) : relinkBusPorts(c, busIds)
    if (!migrated) return c
    changed = true
    return migrated
  })
  return changed ? { json: { ...json, cells: next }, changed: true } : { json, changed: false }
}
