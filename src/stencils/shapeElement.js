// Фигура на холсте — разметка, а не оборудование: у неё нет стенсила, портов,
// слотов и анимаций. Поэтому это ОТДЕЛЬНЫЙ тип ячейки (`tms.Shape`), а не запись в
// реестре: палитра и `library/` архива от рисования не растут, а в экспорт фигура
// уезжает статичным SVG — карточки и id-конвенция ей не нужны.
//
// Геометрия хранится в РЕДАКТОРСКОМ формате (`tms.shape` — те же примитивы, что в
// useStencilEditor), а не выводится из `size`: иначе линия была бы только
// ортогональной, а ломаной не существовало бы вовсе. Рисует её тот же
// `serializeShape`, что и символы, — холст, `view.svg` и редактор не могут
// разойтись, потому что генератор один.
import {
  serializeShape,
  shapeBounds,
  translateShape,
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
 * и фигура на глазах «раздваивается». Появляются они на завершающем двойном клике
 * (это два pointerdown в одной точке) и в архивах, записанных до дедупа.
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
 * Фигура в локальных координатах ячейки + габарит. Держим фигуру прижатой к (0,0),
 * как `cropToContent` в редакторе: тогда `position` ячейки — единственное место, где
 * живёт её место на холсте, и перемещение не трогает геометрию.
 *
 * @returns {{shape: object, position: {x:number,y:number}, size: {width:number,height:number}}|null}
 */
export function placeShape(shape) {
  const box = shapeBounds(shape)
  if (!box) return null
  return {
    shape: translateShape(shape, -box.x, -box.y),
    position: { x: box.x, y: box.y },
    // Нулевой габарит бывает у горизонтальной линии — ячейку с ним не выделить
    // и не подцепить, поэтому даём минимальную толщину под клик.
    size: { width: Math.max(box.w, 1), height: Math.max(box.h, 1) },
  }
}

/** Разметка фигуры в body-группу cellView'а (тот же путь, что у стенсилов). */
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

  const doc = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg">${serializeShape(shape, false)}</svg>`,
    'image/svg+xml'
  )
  if (doc.getElementsByTagName('parsererror').length > 0) {
    console.error('[shapeElement] Не удалось собрать SVG фигуры', shape.type)
    return false
  }
  for (const child of Array.from(doc.documentElement.children)) target.appendChild(child)
  return true
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
 * Фигура из чужого архива → безопасная фигура или null. Экспорт кладёт геометрию в
 * `data-tms-meta` как JSON, то есть при импорте это НЕПРОВЕРЕННЫЕ данные: без
 * отбраковки `NaN` в размере уехал бы в `width="NaN"` (символ рисуется пустым), а
 * нечисловая толщина — в атрибут обводки. Правила те же, что у разбора чужого
 * `shape.svg` (см. stencilSvg.elementToShape): координаты не обязательны (дефолт 0),
 * размеры — обязательны.
 */
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
  // Заливка — только у замкнутых (линии заливать нечего, у подписи цвет лежит в
  // `stroke`). Скругления в модели по-прежнему нет: поле из чужого архива не
  // подхватываем, иначе оно жило бы без способа его изменить.
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
      const text = typeof raw.text === 'string' ? raw.text : ''
      if (!text) return null
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
 * Правка вида/содержимого фигуры (инспектор). Габарит пересчитываем каждый раз:
 * у подписи он зависит от текста и шрифта, и без пересчёта ячейка осталась бы
 * прежнего размера — hit-area и выделение разошлись бы с рисунком.
 *
 * @param {string[]} cellIds — правим пачкой: инспектор работает и на мультивыделении
 * @returns {number} сколько фигур изменено
 */
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
    // Геометрия в tms уже локальная, поэтому `placed.position` — это СДВИГ bbox
    // внутри ячейки, а не её место на холсте: у подписи (anchor=middle) он появляется
    // при смене текста/шрифта. Прибавляем к текущей позиции — иначе фигура улетала
    // бы в начало координат, а у подписи ещё и центр съезжал бы.
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
 * наклонной прямой или ломаной ничего не задаёт, форму держат сами вершины (так же
 * они правятся в редакторе символов).
 */
export function moveShapePoint(cell, paper, key, point) {
  const shape = cell.get('tms')?.shape
  if (!isShapeCell(cell) || !shape) return false
  const pos = cell.get('position')
  // Считаем в координатах холста: точка приходит из курсора, а геометрия локальная.
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
 * Прямая линия при растяжении по перпендикуляру прямой и остаётся — её локальные
 * координаты по этой оси нулевые, и любой множитель оставляет их нулями.
 *
 * Нулевой габарит нормальным путём не возникает (`placeShape` держит минимум 1), но
 * порченые данные из архива его дать могут — тогда ось просто не масштабируем,
 * иначе деление дало бы Infinity и геометрия превратилась бы в NaN.
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
  // (прижата к нулю, умножение нулей даёт нули). В applyShapePatch иначе — там
  // содержимое подписи меняет её bbox, и смещение приходится доучитывать.
  cell.set('position', { x: box.x, y: box.y })
  cell.set('size', placed.size)
  const view = paper?.findViewByModel(cell)
  if (view) injectShapeSvg(view)
  return true
}

/**
 * Перерисовать фигуры после `fromJSON` (загрузка формы, undo/redo) — как
 * `reinjectAllStencils` для символов: cellView создаётся пустым, JointJS про наш
 * markup ничего не знает.
 */
export function reinjectAllShapes(graph, paper) {
  if (!graph || !paper) return
  for (const cell of graph.getElements()) {
    if (!isShapeCell(cell)) continue
    const view = paper.findViewByModel(cell)
    if (view) injectShapeSvg(view)
  }
}
