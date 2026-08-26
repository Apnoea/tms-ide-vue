// Мост «модель JointJS → DOM cellView»: порты, отражение, инъекция SVG символа
// и переинъекция после fromJSON. Разметку программных символов (bus/text/value/node)
// строят busCell/textCell/valueCell/nodeCell — здесь только выбор нужного билдера.
import { instantiate } from './parser'
import { getStencilById } from './registry'
import { TMSStencil } from './tmsStencil'
import { normalizeLinkZ, syncLinkEndMarkers } from './linkDefaults'
import { svgEl } from '../utils/xml'
import { snapToGrid } from '../utils/grid'
import { portPointAt } from '../utils/portGeom'
import { CANVAS_GRID } from './canvasPaper'
import { computeBusPorts, buildBusContent } from './busCell'
import { reinjectAllShapes } from './shapeElement'
import { buildTextContent } from './textCell'
import { buildValueContent } from './valueCell'
import { buildNodeContent } from './nodeCell'

/**
 * Порты символа не описаны в определении, а вычисляются по размеру экземпляра
 * (шина: слот каждые BUS_PORT_SPACING). Сверка с реестром такие НЕ трогает: набор
 * держит `useBusResize.syncBusPorts`, а «нет в определении» там не значит «порт
 * удалили» — иначе на загрузке формы отцепились бы все линии шины.
 */
function hasComputedPorts(stencil) {
  return stencil?.id === 'cell_bus'
}

/**
 * Масштаб экземпляра символа: `tms.scale` — множитель к размеру из определения.
 * Уменьшать ниже родного нельзя (порты сошлись бы в одну клетку), потолок — чтобы
 * ручка не увела символ в бесконечность.
 */
export const STENCIL_SCALE_MAX = 4

export function stencilScale(tms) {
  const v = Number(tms?.scale)
  if (!Number.isFinite(v) || v <= 1) return 1
  return Math.min(v, STENCIL_SCALE_MAX)
}

/**
 * Размер экземпляра при масштабе. Снапим ОБЕ стороны к сетке холста: на клетках
 * обязаны стоять и габарит, и крайние порты (они лежат ровно на границах) — иначе
 * концы проводов слезут с сетки и `gridRightAngle`-роутер даст косые хвосты. Цена
 * снапа — коэффициенты по осям могут разойтись меньше чем на половину клетки, то
 * есть пропорция держится с точностью до 2.5px.
 */
export function scaledSize(stencil, scale) {
  const k = Math.max(1, Number(scale) || 1)
  const w = stencil?.width || 0
  const h = stencil?.height || 0
  if (k === 1) return { width: w, height: h }
  return {
    width: Math.max(w, snapToGrid(w * k, CANVAS_GRID)),
    height: Math.max(h, snapToGrid(h * k, CANVAS_GRID)),
  }
}

/**
 * Координата порта в масштабированном символе. Крайние порты ЛИПНУТ к границам (0 и
 * размер): округли их к ближайшей клетке — и вывод уехал бы внутрь тела, а провод
 * подключался бы «в символ». Внутренние снапим к сетке: у символа с портом на
 * нечётной клетке дробный масштаб иначе оставил бы порт между клетками.
 */
function scaledPortCoord(v, base, size) {
  if (!(v > 0)) return 0
  if (v >= base) return size
  const k = base ? size / base : 1
  return snapToGrid(v * k, CANVAS_GRID)
}

/**
 * `ports.items` — общий билдер для палитры, paste и загрузки. Шина считает порты по
 * ширине (computeBusPorts), остальные берут из stencil.ports. `magnet: 'passive'`
 * (cell_node): подключаться К узлу можно, тащить ОТ него нельзя — он junction-точка
 * без направления.
 */
export function buildPortItems(stencil, width, height, flip = {}) {
  if (hasComputedPorts(stencil)) return computeBusPorts(width, height)
  const { flipH = false, flipV = false } = flip
  return (stencil.ports || []).map((p) => {
    // Координаты в определении абсолютные, поэтому у масштабированного экземпляра
    // их надо пересчитать — иначе выводы остались бы внутри увеличенного рисунка.
    const x = scaledPortCoord(p.x, stencil.width, width)
    const y = scaledPortCoord(p.y, stencil.height, height)
    const item = {
      id: p.name,
      group: 'port',
      // Порты отражаются вместе с символом; провод привязан по id и едет за портом.
      args: { x: flipH ? width - x : x, y: flipV ? height - y : y },
    }
    if (p.magnet) item.attrs = { portBody: { magnet: p.magnet } }
    return item
  })
}

/**
 * Привести порты ячейки к `items`. Через port-manager, а НЕ `set('ports', {items})`:
 * тот заменяет объект целиком и сносит `groups` из defaults `TMSStencil`, после чего
 * JointJS падает на расчёте позиций портов (нет layout-колбэка группы). Тот же приём
 * в `useBusResize.syncBusPorts`.
 *
 * @returns {boolean} менялось ли что-то
 */
function applyPortItems(cell, items) {
  let touched = false
  const wanted = new Set(items.map((i) => i.id))
  for (const p of cell.getPorts()) {
    if (!wanted.has(p.id)) {
      cell.removePort(p.id)
      touched = true
    }
  }
  for (const item of items) {
    if (!cell.hasPort(item.id)) {
      cell.addPort(item)
      touched = true
      continue
    }
    const cur = cell.getPort(item.id)
    if (cur.args?.x !== item.args.x) {
      cell.portProp(item.id, 'args/x', item.args.x)
      touched = true
    }
    if (cur.args?.y !== item.args.y) {
      cell.portProp(item.id, 'args/y', item.args.y)
      touched = true
    }
  }
  return touched
}

/**
 * Отражение в пределах bbox: translate компенсирует scale, иначе зеркало уехало бы
 * в отрицательные координаты. null = flip'а нет (вызывающий снимает атрибут).
 */
export function flipTransform(width, height, flipH, flipV) {
  if (!flipH && !flipV) return null
  const tx = flipH ? width : 0
  const ty = flipV ? height : 0
  return `translate(${tx} ${ty}) scale(${flipH ? -1 : 1} ${flipV ? -1 : 1})`
}

/**
 * Трансформация КОНТЕНТА символа: отражение плюс масштаб. Рисунок лежит в координатах
 * определения, поэтому увеличенный экземпляр растягивается трансформом — сам
 * `shape.svg` не перерисовывается. Отражение считается в ИТОГОВЫХ размерах и идёт
 * первым (внешняя трансформация), масштаб — вторым.
 *
 * Одна функция на холст и экспорт: разойдись они, на схеме в IDE и в `view.svg`
 * оказался бы разный символ — худший класс ошибок в проекте.
 *
 * Обводка масштабируется вместе с рисунком: «символ крупнее» значит крупнее целиком.
 * (`vector-effect="non-scaling-stroke"` не годится — он привязывает толщину к экрану,
 * и при зуме холста или панели линии перестали бы масштабироваться вовсе.)
 *
 * null = ни отражения, ни масштаба (вызывающий снимает атрибут).
 */
export function contentTransform({ baseWidth, baseHeight, width, height, flipH, flipV }) {
  const parts = []
  const flip = flipTransform(width, height, flipH, flipV)
  if (flip) parts.push(flip)
  const kx = baseWidth ? width / baseWidth : 1
  const ky = baseHeight ? height / baseHeight : 1
  if (kx !== 1 || ky !== 1) parts.push(`scale(${round3(kx)} ${round3(ky)})`)
  return parts.length ? parts.join(' ') : null
}

// Коэффициент — результат деления, поэтому режем хвост float'а: он уезжает в атрибут
// экспортного SVG, а там `1.2000000000000002` только мусорит diff файла.
function round3(v) {
  return Number.parseFloat(v.toFixed(3))
}

/**
 * Разметка символа → body-группа cellView'а. Старое содержимое чистим, поэтому
 * функция годится и для первого рендера, и для перерисовки (правка слотов, undo,
 * загрузка формы).
 *
 * @param {dia.CellView} cellView
 * @param {object} stencil — определение из реестра
 * @returns {boolean} вставлено ли
 */
export function injectStencilSvg(cellView, stencil) {
  if (!cellView || !stencil) return false

  const found = cellView.findBySelector('body')
  const bodyEl = found && typeof found.length === 'number' ? found[0] : found
  const target = bodyEl || cellView.el.firstElementChild
  if (!target) return false

  while (target.firstChild) target.removeChild(target.firstChild)

  // Текущий размер, а не stencil.width: шина resizable.
  const currentSize = cellView.model?.size?.() || {
    width: stencil.width || 0,
    height: stencil.height || 0,
  }

  // Hit-area по всему bbox: клик мимо тонких линий тоже выделяет. stroke="none" —
  // иначе она подхватывает animation-color в симуляции.
  target.appendChild(
    svgEl('rect', {
      class: 'tms-hit-area',
      x: 0,
      y: 0,
      width: currentSize.width,
      height: currentSize.height,
      fill: 'transparent',
      stroke: 'none',
      'pointer-events': 'all',
    })
  )

  // bus/text/value/node — программные: размер и содержимое задаёт tms, не shape.svg.
  if (stencil.id === 'cell_bus') {
    for (const el of buildBusContent(cellView)) target.appendChild(el)
  } else if (stencil.id === 'cell_text') {
    for (const el of buildTextContent(cellView)) target.appendChild(el)
  } else if (stencil.id === 'cell_value') {
    // Рисуем в координатах определения: увеличенный экземпляр растягивает contentTransform.
    const box = { width: stencil.width, height: stencil.height }
    for (const el of buildValueContent(cellView, box)) target.appendChild(el)
  } else if (stencil.id === 'cell_node') {
    for (const el of buildNodeContent(cellView)) target.appendChild(el)
  } else {
    const tms = cellView.model.get('tms') || {}
    const cellId = cellView.model.id
    // Клон разобранного шаблона (см. parser.instantiate): ни строкового
    // промежутка, ни повторного парса — узлы сразу переезжают в DOM холста.
    const { root } = instantiate(stencil, cellId, tms.slots || {})
    if (!root) return false
    for (const child of Array.from(root.children)) {
      target.appendChild(child)
    }
  }

  // flip и масштаб — только визуал контента (порты считает buildPortItems). Снимаем
  // атрибут явно, иначе старый transform завис бы после reinject.
  const tmsView = cellView.model.get('tms') || {}
  // База масштаба — размер определения; у программных символов контент уже нарисован
  // по фактическому размеру, поэтому базой служит он сам (масштаб = 1).
  const scalesContent = contentScales(stencil)
  const ct = contentTransform({
    baseWidth: scalesContent ? stencil.width : currentSize.width,
    baseHeight: scalesContent ? stencil.height : currentSize.height,
    width: currentSize.width,
    height: currentSize.height,
    flipH: !!tmsView.flipH,
    flipV: !!tmsView.flipV,
  })
  if (ct) target.setAttribute('transform', ct)
  else target.removeAttribute('transform')

  // Класс замка восстанавливаем после каждой пересборки DOM (при toggle его правит
  // useCanvas.toggleLocked). По нему CSS прячет bus-хэндлы и рисует индикатор.
  cellView.el?.classList?.toggle('tms-locked', !!cellView.model.get('tms')?.locked)

  return true
}

/**
 * Ячейка-символ в графе: порты с учётом flip, модель, инъекция SVG. Единая точка
 * для drop'а из палитры и paste — иначе flip-порты и подобное забывались бы в одном
 * из путей. Позицию/размер/tms/angle готовит вызывающий (там своя специфика:
 * автосайз текста, defaults, remap groupId).
 */
export function materializeStencil(graph, paper, stencil, { position, size, tms, angle = 0 }) {
  const flip = { flipH: !!tms.flipH, flipV: !!tms.flipV }
  const cell = new TMSStencil({
    position,
    size,
    ...(angle ? { angle } : {}),
    tms,
    ports: { items: buildPortItems(stencil, size.width, size.height, flip) },
  })
  graph.addCell(cell)
  const view = paper.findViewByModel(cell)
  if (view) injectStencilSvg(view, stencil)
  return cell
}

/**
 * Нарисован ли контент символа в координатах ОПРЕДЕЛЕНИЯ. У программных (шина, подпись,
 * карточка значения, точка соединения) билдеры рисуют по ФАКТИЧЕСКОМУ размеру
 * экземпляра, поэтому масштабировать их трансформом нельзя — тело растянулось бы
 * второй раз (шина, которую тянули за края, уехала бы во всю ширину холста).
 */
export function contentScales(stencil) {
  if (!stencil?.width || !stencil?.height) return false
  // Шина (слоты по ширине), прошлая подпись (габарит по тексту) и точка соединения
  // (диаметр полем) рисуются билдерами ОТ фактического размера — их масштаб трансформом
  // растянул бы дважды. Карточки значения здесь нет: она рисуется в координатах
  // определения и масштабируется как обычный символ.
  return !PROGRAMMATIC_SIZE.has(stencil.id) && !stencil.minWidth
}

const PROGRAMMATIC_SIZE = new Set(['cell_bus', 'cell_text', 'cell_node'])

/**
 * Масштабируется ли символ ручками. Исключения по существу, а не по вкусу: у шины и
 * карточки значения габарит СВОЙ (ресайз / содержимое), у точки соединения диаметр
 * задаётся полем (`tms.dotSize`) — масштаб дрался бы с ними. Замок и повёрнутые
 * гейтит вызывающий (см. useCanvasResize).
 *
 * @returns {object|null} определение символа (вызывающему нужны его размеры) либо null
 */
export function scalableStencil(cell) {
  const tms = cell?.get?.('tms')
  if (!tms?.stencilId || tms.locked) return null
  const stencil = getStencilById(tms.stencilId)
  return contentScales(stencil) ? stencil : null
}

/**
 * Применить масштаб к экземпляру: размер, позиция, пересчёт портов и перерисовка
 * контента. Позицию считает вызывающий — у каждой ручки свой фиксированный угол, а
 * размер он получает тем же `scaledSize`; дублировать логику ручек здесь незачем.
 *
 * @param {{x: number, y: number}} [position] — новая позиция; без неё origin не двигаем
 * @returns {boolean} менялось ли что-то (false = вызывающему нечего писать в историю)
 */
export function applyStencilScale(cell, paper, scale, { position } = {}) {
  const stencil = scalableStencil(cell)
  if (!stencil) return false
  const next = Math.min(Math.max(1, Number(scale) || 1), STENCIL_SCALE_MAX)
  const tms = cell.get('tms') || {}
  const size = cell.get('size')
  const pos = cell.get('position')
  const target = scaledSize(stencil, next)
  const x = position ? position.x : pos.x
  const y = position ? position.y : pos.y
  const sameSize = size.width === target.width && size.height === target.height
  if (sameSize && stencilScale(tms) === next && x === pos.x && y === pos.y) return false

  // ×1 — дефолт: поле не держим, иначе оно уедет в meta и в снимки истории пустым фактом.
  if (next > 1) cell.set('tms', { ...tms, scale: next })
  else if (tms.scale !== undefined) {
    const rest = { ...tms }
    delete rest.scale
    cell.set('tms', rest)
  }
  if (!sameSize) cell.resize(target.width, target.height)
  if (x !== pos.x || y !== pos.y) cell.position(x, y)
  applyPortItems(
    cell,
    buildPortItems(stencil, target.width, target.height, {
      flipH: !!tms.flipH,
      flipV: !!tms.flipV,
    })
  )
  const view = paper?.findViewByModel?.(cell)
  if (view) injectStencilSvg(view, stencil)
  return true
}

/**
 * Правка символа в редакторе → расставленные экземпляры на холсте. Обновляет то,
 * что задаёт символ: набор и позиции портов, габарит, рисунок. Провода следуют за
 * портом сами (ссылка по имени), поэтому «сдвинул порт» не требует ничего.
 *
 * Порт, которого в новой версии нет, оставил бы провод на несуществующей ссылке —
 * такой конец ОТЦЕПЛЯЕМ в точку, где порт был: провод остаётся на схеме и виден,
 * автор перецепит. Перевешивать на ближайший порт нельзя — это угадывание, а
 * неверное соединение на мнемосхеме молча выглядит рабочим.
 *
 * Габарит задаёт определение символа (умноженное на `tms.scale` экземпляра) — кроме
 * тех, у кого он свой: шина (ресайз, `minWidth`) и подписи/значения (по содержимому,
 * `static`). Когда доступна прежняя версия (правка символа), критерий точнее: размер,
 * совпадавший с прежним, был дефолтным, а отличавшийся — выставлен пользователем и
 * остаётся. Масштаб при этом уважается: символ вырос — увеличенные экземпляры выросли
 * пропорционально, ×2 остаётся ×2.
 *
 * @param {object} prev — определение ДО правки (null = сверка с реестром при загрузке формы)
 * @returns {{changed: number, detached: string[]}} сколько экземпляров реально изменено и id отцепленных проводов
 */
export function syncStencilInstances(graph, paper, stencil, prev = null) {
  const report = { changed: 0, detached: [] }
  if (!graph || !stencil) return report
  const cells = graph.getElements().filter((c) => c.get('tms')?.stencilId === stencil.id)
  if (!cells.length) return report
  // Габарит экземпляра — свой у шины (ресайз) и подписей/значений (по содержимому).
  const ownSize = !!stencil.minWidth || !!stencil.static

  // Программные порты (шина) держит useBusResize — здесь только рисунок.
  const computedPorts = hasComputedPorts(stencil)

  // План по каждому экземпляру считаем ДО правок: целевой набор портов зависит от
  // размера ЭКЗЕМПЛЯРА, а не только от определения.
  const plans = cells.map((cell) => {
    const tms = cell.get('tms') || {}
    const size = cell.get('size')
    const scale = stencilScale(tms)
    const target = scaledSize(stencil, scale)
    const wasDefault = prev
      ? (({ width, height }) => size.width === width && size.height === height)(
          scaledSize(prev, scale)
        )
      : !ownSize
    const resize = wasDefault && (size.width !== target.width || size.height !== target.height)
    const width = resize ? target.width : size.width
    const height = resize ? target.height : size.height
    const items = computedPorts
      ? null
      : buildPortItems(stencil, width, height, { flipH: !!tms.flipH, flipV: !!tms.flipV })
    return { cell, resize, width, height, items }
  })

  // Отцепляем ДО пересборки портов — иначе позиция удалённого порта уже потеряна.
  if (!computedPorts) {
    const wantedByCell = new Map(plans.map((p) => [p.cell.id, new Set(p.items.map((i) => i.id))]))
    for (const link of graph.getLinks()) {
      for (const end of ['source', 'target']) {
        const ref = link.get(end)
        const wanted = ref?.id ? wantedByCell.get(ref.id) : null
        if (!wanted || !ref.port || wanted.has(ref.port)) continue
        link.set(end, portPointAt(graph.getCell(ref.id), ref.port))
        report.detached.push(link.id)
      }
    }
  }

  for (const { cell, resize, width, height, items } of plans) {
    let touched = false
    if (resize) {
      cell.resize(width, height)
      touched = true
    }
    if (items && applyPortItems(cell, items)) touched = true
    const view = paper?.findViewByModel(cell)
    if (view) injectStencilSvg(view, stencil)
    if (touched) report.changed += 1
  }
  return report
}

/**
 * После `fromJSON` (restore, undo/redo, смена формы) cellView'ы пустые — JointJS не
 * знает наших символов. Проходим элементы с `tms` и инъектим SVG заново; angle
 * восстанавливать не нужно, его JointJS держит на outer-`<g>`.
 *
 * Провода приводим к их полосе z: `fromJSON` шлёт `reset`, add-хендлер молчит, а у
 * импортированных проектов z нет — линии легли бы поверх ячеек. Нормализация, а не
 * константа: порядок внутри полосы задаёт пользователь. Пишем только при
 * расхождении — иначе z дрейфит и ломает undo/redo (см. LINK_Z).
 *
 * `sync: true` — ЗАГРУЗКА формы (restore, смена формы, импорт, прогон при экспорте):
 * заодно сверяем порты и габарит с реестром. Символ могли править, пока форма была
 * закрыта, а её порты лежат в сохранённом graphJson — без сверки новый порт не
 * появился бы до пересоздания символа руками. Для undo/redo флаг НЕ ставим: там
 * граф обязан стать ровно снимком, иначе Ctrl+Z не откатит правку портов.
 *
 * @returns {{changed: number, detached: string[]}} итог сверки (нули без `sync`)
 */
export function reinjectAllStencils(graph, paper, { sync = false } = {}) {
  const report = { changed: 0, detached: [] }
  if (!graph || !paper) return report
  if (sync) {
    for (const id of new Set(
      graph
        .getElements()
        .map((c) => c.get('tms')?.stencilId)
        .filter(Boolean)
    )) {
      const stencil = getStencilById(id)
      if (!stencil) continue
      // Инъекцию SVG делает она же — множество ячеек то же.
      const r = syncStencilInstances(graph, paper, stencil)
      report.changed += r.changed
      report.detached.push(...r.detached)
    }
  } else {
    for (const cell of graph.getElements()) {
      const tms = cell.get('tms')
      if (!tms?.stencilId) continue
      const stencil = getStencilById(tms.stencilId)
      if (!stencil) continue
      const cellView = paper.findViewByModel(cell)
      if (cellView) injectStencilSvg(cellView, stencil)
    }
  }
  // Фигуры-разметка (tms.Shape) после fromJSON тоже пустые — рисуем и их: это
  // единая точка «восстановить вид формы», иначе каждый вызывающий помнил бы про два.
  reinjectAllShapes(graph, paper)
  for (const link of graph.getLinks()) {
    const z = normalizeLinkZ(link.get('z'))
    if (link.get('z') !== z) link.set('z', z)
    // Маркеры концов — по фактической привязке: `attrs` приезжают из сохранённого
    // graphJson (или из архива), а точка свободного конца выводится из source/target,
    // поэтому пересобираем её здесь. Иначе на загруженной форме точка появлялась бы
    // только после того, как конец тронули.
    syncLinkEndMarkers(link)
  }
  return report
}
