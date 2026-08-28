// Фигура на холсте — разметка, а не оборудование: ни символа, ни портов, ни анимаций.
// Поэтому это ОТДЕЛЬНЫЙ тип ячейки (`tms.Shape`), а не запись в реестре: палитра и
// `library/` архива от рисования не растут, в экспорт фигура уезжает статичным SVG.
//
// Геометрия хранится в РЕДАКТОРСКОМ формате (`tms.shape` — те же примитивы, что в
// useStencilEditor), а не выводится из `size`: иначе линия была бы только
// ортогональной, а ломаной не существовало бы. Рисует её тот же `serializeShape`, что
// и символы.
import {
  serializeShape,
  shapeBounds,
  translateShape,
  rotateShape90,
  flipShape,
  canRotateShapes,
  canFlipShapes,
  scaleShape,
  TEXT_SHAPE_SIZE,
} from '../utils/stencilSvg'
import { TMSShape } from './tmsStencil'
import { cssColor } from '../constants/animation'
import { normalizeFont } from '../utils/textMetrics'
import { svgEl } from '../utils/xml'

/** Якорь роста подписи (как align у cell_text). Отсутствие = центр. */
const TEXT_ALIGNS = ['left', 'center', 'right']

/**
 * Подряд идущие совпадающие вершины ломаной — мусор: у них общая ручка, тянется одна,
 * и фигура «раздваивается». Приходят с завершающего двойного клика (два pointerdown в
 * одной точке) и из архивов.
 */
export function dedupeAdjacent(points) {
  const out = []
  for (const [x, y] of points || []) {
    const prev = out[out.length - 1]
    if (prev && prev[0] === x && prev[1] === y) continue
    out.push([x, y])
  }
  return out
}

/** Отличает фигуру от ячейки-символа: у символа в `tms` есть `stencilId`. */
export function isShapeCell(cell) {
  return cell?.get?.('type') === 'tms.Shape'
}

/**
 * Фигура в локальных координатах ячейки + габарит. Геометрия прижата к (0,0), как
 * после `cropToContent`: место на холсте живёт только в `position` ячейки, поэтому
 * перемещение геометрию не трогает.
 *
 * @returns {{shape: object, position: {x:number,y:number}, size: {width:number,height:number}}|null}
 */
export function placeShape(shape) {
  const box = shapeBounds(shape)
  if (!box) return null
  return {
    shape: translateShape(shape, -box.x, -box.y),
    position: { x: box.x, y: box.y },
    // Нулевой габарит бывает у горизонтальной линии: ячейку с ним не выделить,
    // поэтому держим минимальную толщину под клик.
    size: { width: Math.max(box.w, 1), height: Math.max(box.h, 1) },
  }
}

/** Разметка фигуры в body-группу cellView'а (тот же путь, что у символов). */
function injectShapeSvg(cellView) {
  if (!cellView) return false
  const shape = cellView.model.get('tms')?.shape
  if (!shape) return false
  const found = cellView.findBySelector('body')
  const bodyEl = found && typeof found.length === 'number' ? found[0] : found
  const target = bodyEl || cellView.el.firstElementChild
  if (!target) return false

  while (target.firstChild) target.removeChild(target.firstChild)

  // Hit-area по габариту: у контурной фигуры и линии кликать больше не за что.
  const { width, height } = cellView.model.size()
  target.appendChild(
    svgEl('rect', {
      class: 'tms-hit-area',
      x: 0,
      y: 0,
      width,
      height,
      fill: 'transparent',
      stroke: 'none',
      'pointer-events': 'all',
    })
  )

  const root = shapeMarkup(shape)
  if (!root) return false
  for (const child of Array.from(root.cloneNode(true).children)) target.appendChild(child)
  return true
}

/**
 * Разметка фигуры (корневой `<svg>`) с кэшем по её же сериализации: DOM собирается из
 * строки `serializeShape` — того же генератора, что рисует `view.svg`.
 *
 * Геометрия прижата к 0,0 (placeShape), поэтому однотипные фигуры дают одну строку и
 * парсятся один раз на всю схему.
 */
const SHAPE_MARKUP_LIMIT = 200
const shapeMarkupCache = new Map()

function shapeMarkup(shape) {
  const key = serializeShape(shape, false)
  const hit = shapeMarkupCache.get(key)
  if (hit) return hit
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg">${key}</svg>`,
    'image/svg+xml'
  )
  if (doc.getElementsByTagName('parsererror').length > 0) {
    console.error('[shapeElement] Не удалось собрать SVG фигуры', shape.type)
    return null
  }
  // Кэш ограничен по размеру; сброс целиком вместо LRU — попадания дают однотипные
  // фигуры одной схемы, после сброса они наберутся заново.
  if (shapeMarkupCache.size >= SHAPE_MARKUP_LIMIT) shapeMarkupCache.clear()
  shapeMarkupCache.set(key, doc.documentElement)
  return doc.documentElement
}

/** Создать фигуру в графе (жест рисования). Возвращает ячейку или null. */
export function materializeShape(graph, paper, shape) {
  const placed = placeShape(shape)
  if (!placed) return null
  const cell = new TMSShape({
    position: placed.position,
    size: placed.size,
    tms: { shape: placed.shape },
  })
  graph.addCell(cell)
  const view = paper?.findViewByModel(cell)
  if (view) injectShapeSvg(view)
  return cell
}

/**
 * Фигура из чужого архива → безопасная фигура или null. Геометрия приезжает в
 * `data-tms-meta` как JSON, то есть непроверенными данными: `NaN` в размере уехал бы
 * в `width="NaN"`, нечисловая толщина — в атрибут обводки. Правила как у разбора
 * чужого `shape.svg`: координаты необязательны (дефолт 0), размеры обязательны.
 */
// Предел строк в подписи: тысяча строк из битого архива раздула бы габарит на весь
// холст.
const MAX_TEXT_LINES = 32

export function sanitizeShape(raw) {
  if (!raw || typeof raw !== 'object') return null
  const num = (v, fallback = 0) => {
    const n = typeof v === 'number' ? v : Number.parseFloat(v)
    return Number.isFinite(n) ? n : fallback
  }
  const size = (v) => {
    const n = num(v, NaN)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  const style = {
    stroke: cssColor(raw.stroke) || '#000',
    strokeWidth: Math.min(40, Math.max(0.5, num(raw.strokeWidth, 2))),
  }
  // Заливка — только у замкнутых (у подписи цвет лежит в `stroke`). Скругление из
  // чужого архива не подхватываем: менять его на холсте нечем.
  const fill = { ...style, fill: cssColor(raw.fill) || 'none' }

  switch (raw.type) {
    case 'rect': {
      const w = size(raw.w)
      const h = size(raw.h)
      if (w === null || h === null) return null
      return { type: 'rect', x: num(raw.x), y: num(raw.y), w, h, ...fill }
    }
    case 'circle': {
      const rx = size(raw.rx ?? raw.r)
      const ry = size(raw.ry ?? raw.r)
      if (rx === null || ry === null) return null
      return {
        type: 'circle',
        cx: num(raw.cx),
        cy: num(raw.cy),
        rx,
        ry,
        ...fill,
      }
    }
    case 'line':
      return {
        type: 'line',
        x1: num(raw.x1),
        y1: num(raw.y1),
        x2: num(raw.x2),
        y2: num(raw.y2),
        ...style,
      }
    case 'polyline': {
      const points = dedupeAdjacent(
        (Array.isArray(raw.points) ? raw.points : [])
          .filter((p) => Array.isArray(p) && p.length >= 2)
          .map(([x, y]) => [num(x), num(y)])
      )
      // Одна точка — не фигура: ни нарисовать, ни выделить.
      if (points.length < 2) return null
      return {
        type: 'polyline',
        points,
        ...(raw.closed ? { closed: true } : {}),
        ...fill,
      }
    }
    case 'text': {
      const source = typeof raw.text === 'string' ? raw.text : ''
      if (!source) return null
      // Переносы приводятся к `\n` (из буфера и с Windows приходит `\r\n`), число
      // строк ограничено.
      const text = source.replace(/\r\n?/g, '\n').split('\n').slice(0, MAX_TEXT_LINES).join('\n')
      return {
        type: 'text',
        x: num(raw.x),
        y: num(raw.y),
        text,
        fontSize: Math.min(400, Math.max(1, num(raw.fontSize, TEXT_SHAPE_SIZE))),
        fontFamily: normalizeFont(raw.fontFamily),
        ...(raw.bold ? { bold: true } : {}),
        ...(TEXT_ALIGNS.includes(raw.align) ? { align: raw.align } : {}),
        stroke: style.stroke,
      }
    }
    default:
      return null
  }
}

/** Человекочитаемое имя типа — заголовок инспектора и подсказки. */
const SHAPE_LABELS = {
  rect: 'Прямоугольник',
  circle: 'Эллипс',
  line: 'Линия',
  polyline: 'Ломаная',
  text: 'Подпись',
}

export function shapeTypeLabel(shape) {
  if (shape?.type === 'polyline' && shape.closed) return 'Полигон'
  return SHAPE_LABELS[shape?.type] || 'Фигура'
}

/**
 * Правка вида/содержимого фигуры (инспектор). Габарит пересчитывается каждый раз: у
 * подписи он зависит от текста и шрифта, иначе hit-area разойдётся с рисунком.
 *
 * @param {string[]} cellIds — правим пачкой: инспектор работает и на мультивыделении
 * @returns {number} сколько фигур изменено
 */
/**
 * Можно ли повернуть / отразить фигуру — те же предикаты, что в редакторе символов: у
 * круга и квадрата поворот, у прямоугольника и ортогональной линии отражение ничего не
 * меняют. ПОДПИСЬ — исключение: её глифы горизонтальны, поэтому вращает её `angle`
 * ячейки, а отражение сводится к инверсии `align` (это делает flipShape).
 */
export function canRotateShapeGeometry(cell) {
  const shape = isShapeCell(cell) && !cell.get('tms')?.locked ? cell.get('tms')?.shape : null
  return !!shape && shape.type !== 'text' && canRotateShapes([shape])
}

export function canFlipShapeGeometry(cell, axis) {
  const shape = isShapeCell(cell) && !cell.get('tms')?.locked ? cell.get('tms')?.shape : null
  return !!shape && canFlipShapes([shape], axis)
}

/**
 * Поворот и отражение фигуры — преобразованием САМОЙ геометрии, а не трансформом на
 * группе: габарит остаётся в модельных осях (иначе габаритные ручки пришлось бы
 * маппить на локальные оси), а в `view.svg` уезжает готовая геометрия.
 *
 * Центр держится на месте вручную: `placeShape` внутри `applyShapePatch` прижимает
 * геометрию к (0,0) и сдвигает позицию, поэтому после поворота 20×40 → 40×20 фигура
 * иначе уехала бы вбок на половину разницы габаритов.
 *
 * @returns {number} сколько фигур изменено
 */
function transformShapeCells(graph, paper, cellIds, apply, allow) {
  if (!graph) return 0
  let changed = 0
  for (const id of cellIds) {
    const cell = graph.getCell(id)
    if (!isShapeCell(cell) || !allow(cell)) continue
    const shape = cell.get('tms')?.shape
    const box = shapeBounds(shape)
    if (!box) continue
    const center = { x: box.x + box.w / 2, y: box.y + box.h / 2 }
    const pos = cell.get('position')
    const size = cell.get('size')
    const visualCenter = { x: pos.x + size.width / 2, y: pos.y + size.height / 2 }
    if (!applyShapePatch(graph, paper, [id], apply(shape, center))) continue
    // Возвращаем центр на место (см. выше про placeShape).
    const next = cell.get('size')
    cell.set('position', {
      x: visualCenter.x - next.width / 2,
      y: visualCenter.y - next.height / 2,
    })
    changed += 1
  }
  return changed
}

export function rotateShapeCells(graph, paper, cellIds, dir = 1) {
  return transformShapeCells(
    graph,
    paper,
    cellIds,
    (shape, center) => rotateShape90(shape, center, dir),
    canRotateShapeGeometry
  )
}

export function flipShapeCells(graph, paper, cellIds, axis) {
  return transformShapeCells(
    graph,
    paper,
    cellIds,
    (shape, center) => flipShape(shape, center, axis),
    (cell) => canFlipShapeGeometry(cell, axis)
  )
}

export function applyShapePatch(graph, paper, cellIds, patch) {
  if (!graph) return 0
  let changed = 0
  for (const id of cellIds) {
    const cell = graph.getCell(id)
    if (!isShapeCell(cell)) continue
    const tms = cell.get('tms') || {}
    const next = { ...tms.shape, ...patch }
    const placed = placeShape(next)
    if (!placed) continue
    // Геометрия в tms локальная, поэтому `placed.position` — СДВИГ bbox внутри ячейки
    // (у подписи он появляется при смене текста), а не место на холсте: прибавляем к
    // текущей позиции.
    const pos = cell.get('position')
    cell.set('tms', { ...tms, shape: placed.shape })
    cell.set('position', { x: pos.x + placed.position.x, y: pos.y + placed.position.y })
    cell.set('size', placed.size)
    const view = paper?.findViewByModel(cell)
    if (view) injectShapeSvg(view)
    changed += 1
  }
  return changed
}

/**
 * Перенос ОДНОЙ точки геометрии в точку холста: концы линии (`p1`/`p2`) и вершины
 * ломаной (`v0`, `v1`, …). У этих типов тянут точки, а не габарит — рамка вокруг
 * наклонной линии ничего не задаёт.
 */
export function moveShapePoint(cell, paper, key, point) {
  const shape = cell.get('tms')?.shape
  if (!isShapeCell(cell) || !shape) return false
  const pos = cell.get('position')
  // Расчёт в координатах холста: точка приходит из курсора, геометрия локальная.
  const abs = translateShape(shape, pos.x, pos.y)
  let moved = null
  if (shape.type === 'line' && (key === 'p1' || key === 'p2')) {
    moved =
      key === 'p1' ? { ...abs, x1: point.x, y1: point.y } : { ...abs, x2: point.x, y2: point.y }
  } else if (shape.type === 'polyline' && key.startsWith('v')) {
    const i = Number(key.slice(1))
    if (!Number.isInteger(i) || !abs.points?.[i]) return false
    moved = {
      ...abs,
      points: abs.points.map((p, idx) => (idx === i ? [point.x, point.y] : p)),
    }
  }
  if (!moved) return false
  const placed = placeShape(moved)
  if (!placed) return false
  cell.set('tms', { ...cell.get('tms'), shape: placed.shape })
  cell.set('position', placed.position)
  cell.set('size', placed.size)
  const view = paper?.findViewByModel(cell)
  if (view) injectShapeSvg(view)
  return true
}

/** Габарит фигуры тянут ручками — у подписи его задаёт шрифт (правится полем). */
export function isShapeResizable(cell) {
  return isShapeCell(cell) && cell.get('tms')?.shape?.type !== 'text' && !cell.get('tms')?.locked
}

/**
 * Ресайз фигуры к новому габариту: геометрия масштабируется в те же пропорции.
 * Прямая линия при растяжении по перпендикуляру прямой и остаётся (её локальные
 * координаты по этой оси нулевые).
 *
 * Нулевой габарит нормальным путём не возникает (`placeShape` держит минимум 1), но
 * данные из архива его дать могут — такая ось не масштабируется, иначе деление даст
 * Infinity.
 *
 * @param {{x:number, y:number, width:number, height:number}} box — целевой габарит на холсте
 */
export function resizeShapeCell(cell, paper, box) {
  if (!isShapeCell(cell)) return false
  const shape = cell.get('tms')?.shape
  const size = cell.get('size')
  if (!shape) return false
  const sx = size.width > 0 ? box.width / size.width : 1
  const sy = size.height > 0 ? box.height / size.height : 1
  const scaled = scaleShape(shape, sx, sy)
  const placed = placeShape(scaled)
  if (!placed) return false
  cell.set('tms', { ...cell.get('tms'), shape: placed.shape })
  // Позиция — ровно запрошенный габарит: масштаб не сдвигает фигуру внутри ячейки
  // (она прижата к нулю). В applyShapePatch иначе: там bbox подписи меняет содержимое.
  cell.set('position', { x: box.x, y: box.y })
  cell.set('size', placed.size)
  const view = paper?.findViewByModel(cell)
  if (view) injectShapeSvg(view)
  return true
}

/**
 * Перерисовать фигуры после `fromJSON` (загрузка формы, undo/redo) — как
 * `reinjectAllStencils` для символов: cellView создаётся пустым.
 */
export function reinjectAllShapes(graph, paper) {
  if (!graph || !paper) return
  for (const cell of graph.getElements()) {
    if (!isShapeCell(cell)) continue
    const view = paper.findViewByModel(cell)
    if (view) injectShapeSvg(view)
  }
}
