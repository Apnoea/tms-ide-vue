/**
 * Откуда берутся диапазоны элемента.
 *
 * Зоны (границы и цвета) задаются В СИМВОЛЕ (`stencil.ranges`), а тег для них
 * привязывают на холсте в слот `range` — «на холсте только привязка». У шины символа
 * с зонами нет, там и зоны, и тег живут на элементе (`tms.rangeSource`).
 *
 * Провод и точка соединения своих диапазонов НЕ задают — они НАСЛЕДУЮТ источник по
 * цепи: провод → точка → провод → … до первого элемента с настройкой (шина, символ с
 * зонами и тегом, провод прошлых схем со своей настройкой). Собственная настройка у
 * провода/точки — только legacy: читается, пока лежит, но заново не создаётся.
 *
 * Результат везде одной формы `{ tag, ranges }`, что и `tms.rangeSource`, поэтому весь
 * конвейер (карточки экспорта, CSS-цвета, симуляция, полоска-превью) работает с любым
 * источником одинаково. Обход графа — через адаптер `access` (JointJS-граф или
 * graphJson формы): очистка на старте бежит по формам ДО их подъёма на холст.
 */

import { BUS_STENCIL_ID, NODE_STENCIL_ID, RANGE_SLOT } from '../constants/ids'

/**
 * Источник элемента без наследования.
 *
 * @param {object} tms — payload ячейки или провода
 * @param {object} [stencil] — определение символа (у провода/шины отсутствует)
 * @returns {{tag: string, ranges: Array}|null}
 */
export function effectiveRangeSource(tms, stencil) {
  const zones = stencil?.ranges
  if (!zones?.length) return tms?.rangeSource || null
  const tag = tms?.slots?.[RANGE_SLOT]
  if (tag) return { tag, ranges: zones }
  // Зоны в символе есть, но тег не привязан: пока у ячейки лежит собственный источник
  // прошлых схем, он и работает — иначе перенос диапазонов в символ погасил бы цвет на
  // уже нарисованных формах.
  return tms?.rangeSource || null
}

/** Предел обхода цепи: длиннее на схеме не бывает, а цикл защищён `visited`. */
const MAX_DEPTH = 16

/**
 * Узел графа в виде, общем для JointJS-ячейки и записи graphJson:
 * `{ id, isLink, tms, source, target }`.
 */
function nodeOfJoint(cell) {
  if (!cell) return null
  const isLink = cell.isLink ? !!cell.isLink() : !!(cell.get('source') || cell.get('target'))
  return {
    id: cell.id,
    isLink,
    tms: cell.get('tms') || {},
    source: isLink ? cell.get('source') : null,
    target: isLink ? cell.get('target') : null,
  }
}

function nodeOfJson(cell) {
  if (!cell) return null
  const isLink = cell.type === 'standard.Link'
  return {
    id: cell.id,
    isLink,
    tms: cell.tms || {},
    source: isLink ? cell.source : null,
    target: isLink ? cell.target : null,
  }
}

/**
 * Адаптер к живому графу холста. `getConnectedLinks` есть у dia.Graph; мок-граф
 * экспорта его не имеет — тогда провода отбираются перебором по концам.
 */
export function jointGraphAccess(graph) {
  const linksOf = (id) => {
    const cell = graph?.getCell?.(id)
    if (!cell) return []
    if (graph.getConnectedLinks) return graph.getConnectedLinks(cell).map(nodeOfJoint)
    return (graph.getLinks?.() || [])
      .filter((l) => l.get('source')?.id === id || l.get('target')?.id === id)
      .map(nodeOfJoint)
  }
  return { of: nodeOfJoint, node: (id) => nodeOfJoint(graph?.getCell?.(id)), linksOf }
}

/** Адаптер к graphJson формы (как лежит в сторе и IDB). Индексы строятся один раз. */
export function graphJsonAccess(graphJson) {
  const byId = new Map()
  const links = new Map()
  for (const cell of graphJson?.cells || []) {
    const node = nodeOfJson(cell)
    if (!node?.id) continue
    byId.set(node.id, node)
    if (!node.isLink) continue
    for (const end of [node.source, node.target]) {
      if (!end?.id) continue
      if (!links.has(end.id)) links.set(end.id, [])
      links.get(end.id).push(node)
    }
  }
  return {
    of: nodeOfJson,
    node: (id) => byId.get(id) || null,
    linksOf: (id) => links.get(id) || [],
  }
}

/** Провод и точка соединения — прозрачные звенья цепи: диапазоны наследуют. */
export function isPassThrough(node) {
  return !!node && (node.isLink || node.tms?.stencilId === NODE_STENCIL_ID)
}

/**
 * Источник самого элемента, без наследования: у провода — только legacy
 * `tms.rangeSource`, у ячейки — зоны символа с тегом слота либо `tms.rangeSource`.
 */
function ownRangeSource(node, getStencil) {
  if (!node) return null
  if (node.isLink) return node.tms?.rangeSource || null
  const stencilId = node.tms?.stencilId
  return effectiveRangeSource(node.tms, stencilId ? getStencil?.(stencilId) : null)
}

/** Соседи по цепи: у провода — ячейки на концах, у ячейки — подключённые провода. */
function neighbours(node, access) {
  if (node.isLink) {
    return [node.source?.id, node.target?.id].map((id) => (id ? access.node(id) : null))
  }
  return access.linksOf(node.id)
}

/**
 * Унаследованный источник провода или точки: обход в ширину от концов до первого
 * уровня, на котором нашёлся элемент с настроенным (с тегом) источником. Внутри уровня
 * шина сильнее прочих, дальше — порядок обхода (source раньше target). Своя настройка
 * стартового узла не учитывается — так очистка сравнивает её с унаследованной.
 *
 * @returns {{tag: string, ranges: Array, from: 'bus'|'symbol'|'wire'}|null}
 */
export function inheritedRangeSource(node, access, getStencil) {
  if (!node || !access) return null
  const visited = new Set([node.id])
  let frontier = neighbours(node, access)
  for (let depth = 0; depth < MAX_DEPTH && frontier.length; depth++) {
    const found = []
    const next = []
    for (const n of frontier) {
      if (!n || visited.has(n.id)) continue
      visited.add(n.id)
      const own = ownRangeSource(n, getStencil)
      if (own?.tag) {
        const from = n.isLink ? 'wire' : n.tms?.stencilId === BUS_STENCIL_ID ? 'bus' : 'symbol'
        found.push({ tag: own.tag, ranges: own.ranges, from })
        continue
      }
      if (isPassThrough(n)) next.push(...neighbours(n, access))
    }
    if (found.length) return found.find((f) => f.from === 'bus') || found[0]
    frontier = next
  }
  return null
}

/**
 * Действующий источник элемента: своя настройка с тегом, иначе у провода и точки —
 * унаследованная, у прочих — своя как есть (шина с тегом, но без строк, — тоже
 * «настройка», её показывает инспектор).
 */
export function resolveRangeSource(node, access, getStencil) {
  const own = ownRangeSource(node, getStencil)
  if (own?.tag) return own
  if (isPassThrough(node)) return inheritedRangeSource(node, access, getStencil)
  return own
}
