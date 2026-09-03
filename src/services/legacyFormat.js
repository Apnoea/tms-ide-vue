// Чтение данных прошлых форматов: читаем старое, пишем только новое. Изменённая форма
// сразу перезаписывается в IDB, при импорте конвертация идёт на входе. Слой удаляется
// целиком вместе с вызовами.
//
// Что конвертируется:
//  • символ-подпись `cell_text` → фигура-разметка (`tms.Shape`): подпись перестала быть
//    оборудованием — у неё нет ни портов, ни анимаций, её место среди фигур;
//  • порты шины `top_i`/`bot_i` → единственный ряд `p_i` в середине толщины;
//  • строки диапазонов: class-имя палитры (`animation-low`) → свой цвет.
import { TEXT_FONT_SIZE, TEXT_PADDING_X } from '../stencils/textCell'
import { placeShape } from '../stencils/shapeElement'
import { computeBusPorts } from '../stencils/busCell'
import { getStencilById } from '../stencils/registry'
import { rangeRowColor } from '../constants/animation'
import { measureTextWidth } from '../utils/textMetrics'

/**
 * Карточка значения ПРОШЛОГО формата: тег в `tms.valueTag`, подпись и единица —
 * своими полями, рисунок программный. Теперь это обычный символ: тег живёт в слоте
 * `value_text`, подписи — в `params`. null — ячейка не такая, вызывающий оставляет
 * её как есть.
 *
 * Ключи параметров берутся из ОПРЕДЕЛЕНИЯ (первый по порядку — величина, второй —
 * единица), а не из константы: их выдаёт редактор символов, и у пересохранённой
 * карточки они другие. Конвертация одноразовая (`valueLabel`/`valueUnit` удаляются),
 * поэтому ключ мимо определения = подпись, которую уже нечем восстановить.
 *
 * Размер не переносим: у растянутой карточки габарит вернётся к определению — своей
 * ширины у неё больше нет, растёт весь символ масштабом.
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
 * Ячейка `cell_text` (graphJson) → ячейка-фигура. null, если это не подпись —
 * вызывающий тогда оставляет ячейку как есть.
 *
 * Геометрия переводится так, чтобы надпись осталась на месте: у `cell_text` текст идёт
 * от левого края с отступом `TEXT_PADDING_X` и центрируется по вертикали, а у фигуры
 * точка привязки — baseline и якорь по `align`. Поэтому baseline опускается на ~0.3em
 * ниже центра, а x сдвигается под якорь.
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
  // Ширина нужна только якорям center/right. Без canvas (замер < 0) сдвиг не считаем и
  // оставляем подпись у левого края — это лучше, чем NaN в геометрии.
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
    // Дефолтное семейство не пишем: у фигуры отсутствие поля и есть дефолт.
    ...(tms.fontFamily ? { fontFamily: tms.fontFamily } : {}),
    stroke: tms.color || '#000',
    ...(tms.bold ? { bold: true } : {}),
    // Якорь роста пишется всегда: он задаёт, в какую сторону подпись растёт при правке.
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
  // Замок и группа — свойства ячейки, переносятся как есть.
  if (tms.locked) next.tms.locked = true
  if (tms.groupId) next.tms.groupId = tms.groupId
  if (cell.angle) next.angle = cell.angle
  if (cell.z != null) next.z = cell.z
  return next
}

const BUS_PORT_LEGACY_RE = /^(?:top|bot)_(\d+)$/

/**
 * Порт шины прошлой схемы (два ряда по краям) → единственный `p_i`; null, если id не
 * из той схемы. Оба ряда сходятся в один порт: слот — одна точка цепи.
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
 * Шина прошлой схемы: пересобрать `ports.items`. Обязательно: `fromJSON` берёт порты
 * из json как есть, а sync с реестром набор шины не трогает (hasComputedPorts).
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
 * Строки источника значения с class-именем палитры (`animation-low`) → свой цвет
 * (его задаёт автор пикером). null, если менять нечего.
 */
function recolorRanges(cell) {
  const rows = cell?.tms?.rangeSource?.ranges
  if (!Array.isArray(rows) || !rows.some((r) => r?.class)) return null
  const next = rows.map((r) => {
    if (!r?.class) return r
    const out = { ...r, ...(rangeRowColor(r) ? { color: rangeRowColor(r) } : {}) }
    delete out.class
    return out
  })
  return { ...cell, tms: { ...cell.tms, rangeSource: { ...cell.tms.rangeSource, ranges: next } } }
}

/**
 * Символ «точка соединения» (`cell_node`) → точка на свободном конце провода.
 *
 * Конец провода, оставленный на холсте, помечает себя сам (linkDefaults.endMarker),
 * поэтому отдельная ячейка с портом не нужна: узел с 0 или 1 проводом растворяется —
 * конец встаёт свободной точкой в центр узла.
 *
 * Узел с ДВУМЯ и более проводами остаётся ячейкой: он держит соединение, а растворение
 * дало бы несколько свободных концов в одной точке. Провода не сращиваются, число
 * таких узлов возвращается вызывающему.
 *
 * @returns {{ cells: Array, changed: boolean, kept: number }}
 */
export function dissolveNodeCells(cells) {
  if (!Array.isArray(cells)) return { cells, changed: false, kept: 0 }
  const centers = new Map()
  for (const c of cells) {
    if (c?.tms?.stencilId !== 'cell_node') continue
    const p = c.position || { x: 0, y: 0 }
    const s = c.size || { width: 0, height: 0 }
    centers.set(c.id, { x: p.x + s.width / 2, y: p.y + s.height / 2 })
  }
  if (!centers.size) return { cells, changed: false, kept: 0 }

  const uses = new Map([...centers.keys()].map((id) => [id, 0]))
  for (const c of cells) {
    for (const end of [c?.source, c?.target]) {
      if (end?.id && uses.has(end.id)) uses.set(end.id, uses.get(end.id) + 1)
    }
  }
  const dissolved = new Set([...uses].filter(([, n]) => n <= 1).map(([id]) => id))
  const kept = uses.size - dissolved.size
  if (!dissolved.size) return { cells, changed: false, kept }

  const next = []
  for (const c of cells) {
    if (dissolved.has(c.id)) continue
    const src = c?.source?.id && dissolved.has(c.source.id) ? centers.get(c.source.id) : null
    const tgt = c?.target?.id && dissolved.has(c.target.id) ? centers.get(c.target.id) : null
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
  return { cells: next, changed: true, kept }
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
  // id шин собираются ДО обхода: линк в списке может стоять раньше своей шины.
  const busIds = new Set(cells.filter(isBusCellJson).map((c) => c.id))
  const next = cells.map((c) => {
    const shapeCell = textCellToShape(c)
    if (shapeCell) {
      changed = true
      return shapeCell
    }
    const valueCell = valueCellToParams(c)
    if (valueCell) {
      changed = true
      return valueCell
    }
    const migrated = isBusCellJson(c) ? rebuildBusPorts(c) : relinkBusPorts(c, busIds)
    const recolored = recolorRanges(migrated || c)
    if (!migrated && !recolored) return c
    changed = true
    return recolored || migrated
  })
  // Точки соединения растворяются на наборе целиком: нужны и ячейки, и линки.
  const nodes = dissolveNodeCells(next)
  if (nodes.changed) changed = true
  return changed
    ? { json: { ...json, cells: nodes.cells }, changed: true }
    : { json, changed: false }
}
