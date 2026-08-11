// Мост «модель JointJS → DOM cellView»: порты, отражение, инъекция SVG стенсила
// и переинъекция после fromJSON. Разметку программных стенсилов (bus/text/value)
// строят busCell/textCell/valueCell — здесь только выбор нужного билдера.
import { instantiate } from './parser'
import { getStencilById } from './registry'
import { TMSStencil } from './tmsStencil'
import { normalizeLinkZ } from './linkDefaults'
import { svgEl } from '../utils/xml'
import { computeBusPorts, buildBusContent } from './busCell'
import { buildTextContent } from './textCell'
import { buildValueContent } from './valueCell'

/**
 * `ports.items` — общий билдер для палитры, paste и загрузки. Шина считает порты по
 * ширине (computeBusPorts), остальные берут из stencil.ports. `magnet: 'passive'`
 * (cell_node): подключаться К узлу можно, тащить ОТ него нельзя — он junction-точка
 * без направления.
 */
export function buildPortItems(stencil, width, height, flip = {}) {
  if (stencil.id === 'cell_bus') return computeBusPorts(width, height)
  const { flipH = false, flipV = false } = flip
  return (stencil.ports || []).map((p) => {
    const item = {
      id: p.name,
      group: 'port',
      // Порты отражаются вместе с символом; провод привязан по id и едет за портом.
      args: { x: flipH ? width - p.x : p.x, y: flipV ? height - p.y : p.y },
    }
    if (p.magnet) item.attrs = { portBody: { magnet: p.magnet } }
    return item
  })
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
 * Разметка стенсила → body-группа cellView'а. Старое содержимое чистим, поэтому
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

  // bus/text/value — программные: размер и содержимое динамические.
  if (stencil.id === 'cell_bus') {
    for (const el of buildBusContent(cellView)) target.appendChild(el)
  } else if (stencil.id === 'cell_text') {
    for (const el of buildTextContent(cellView)) target.appendChild(el)
  } else if (stencil.id === 'cell_value') {
    for (const el of buildValueContent(cellView)) target.appendChild(el)
  } else {
    const tms = cellView.model.get('tms') || {}
    const cellId = cellView.model.id
    const { svg } = instantiate(stencil, cellId, tms.slots || {})
    if (!svg) return false

    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
    // parseFromString не бросает исключение — ошибки приходят как parsererror-элемент
    if (doc.getElementsByTagName('parsererror').length > 0) {
      console.error('[svgInjector] Не удалось распарсить SVG стенсила', stencil.id)
      return false
    }
    for (const child of Array.from(doc.documentElement.children)) {
      target.appendChild(child)
    }
  }

  // flip — только визуал контента (порты отражает buildPortItems). Снимаем атрибут
  // явно, иначе старый transform завис бы после reinject.
  const tmsView = cellView.model.get('tms') || {}
  const ft = flipTransform(currentSize.width, currentSize.height, !!tmsView.flipH, !!tmsView.flipV)
  if (ft) target.setAttribute('transform', ft)
  else target.removeAttribute('transform')

  // Класс замка восстанавливаем после каждой пересборки DOM (при toggle его правит
  // useCanvas.toggleLocked). По нему CSS прячет bus-хэндлы и рисует индикатор.
  cellView.el?.classList?.toggle('tms-locked', !!cellView.model.get('tms')?.locked)

  return true
}

/**
 * Ячейка-стенсил в графе: порты с учётом flip, модель, инъекция SVG. Единая точка
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
 * Точка порта в координатах холста (с учётом поворота ячейки). Нужна, чтобы
 * отцепленный конец провода остался ровно там, где был порт: `args` в items — наши
 * же локальные координаты, поэтому считаем по ним, а не спрашиваем paper.
 */
function portPoint(cell, portId) {
  const item = (cell.get('ports')?.items || []).find((i) => i.id === portId)
  const pos = cell.get('position')
  const size = cell.get('size')
  const px = pos.x + (item?.args?.x ?? size.width / 2)
  const py = pos.y + (item?.args?.y ?? size.height / 2)
  const angle = cell.angle ? cell.angle() : 0
  if (!angle) return { x: px, y: py }
  const cx = pos.x + size.width / 2
  const cy = pos.y + size.height / 2
  const rad = (angle * Math.PI) / 180
  const dx = px - cx
  const dy = py - cy
  return {
    x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
    y: cy + dx * Math.sin(rad) + dy * Math.cos(rad),
  }
}

/**
 * Правка символа в редакторе → расставленные экземпляры на холсте. Обновляет то,
 * что задаёт стенсил: набор и позиции портов, габарит, рисунок. Провода следуют за
 * портом сами (ссылка по имени), поэтому «сдвинул порт» не требует ничего.
 *
 * Порт, которого в новой версии нет, оставил бы провод на несуществующей ссылке —
 * такой конец ОТЦЕПЛЯЕМ в точку, где порт был: провод остаётся на схеме и виден,
 * автор перецепит. Перевешивать на ближайший порт нельзя — это угадывание, а
 * неверное соединение на мнемосхеме молча выглядит рабочим.
 *
 * Габарит задаёт определение символа — кроме тех, у кого он свой: шина (ресайз,
 * `minWidth`) и подписи/значения (по содержимому, `static`). Когда доступна прежняя
 * версия (правка символа), критерий точнее: размер, совпадавший с прежним, был
 * дефолтным, а отличавшийся — выставлен пользователем и остаётся.
 *
 * @param {object} prev — определение ДО правки (null = сверка с реестром при загрузке формы)
 * @returns {{changed: number, detached: string[]}} сколько экземпляров реально изменено и id отцепленных проводов
 */
export function syncStencilInstances(graph, paper, stencil, prev = null) {
  const report = { changed: 0, detached: [] }
  if (!graph || !stencil) return report
  const cells = graph.getElements().filter((c) => c.get('tms')?.stencilId === stencil.id)
  if (!cells.length) return report
  const cellIds = new Set(cells.map((c) => c.id))
  const portNames = new Set((stencil.ports || []).map((p) => p.name))

  // Отцепляем ДО пересборки items — иначе позиция удалённого порта уже потеряна.
  for (const link of graph.getLinks()) {
    for (const end of ['source', 'target']) {
      const ref = link.get(end)
      if (!ref?.id || !ref.port || !cellIds.has(ref.id) || portNames.has(ref.port)) continue
      link.set(end, portPoint(graph.getCell(ref.id), ref.port))
      report.detached.push(link.id)
    }
  }

  // Габарит экземпляра — свой у шины (ресайз) и подписей/значений (по содержимому).
  const ownSize = !!stencil.minWidth || !!stencil.static
  for (const cell of cells) {
    const tms = cell.get('tms') || {}
    const size = cell.get('size')
    let { width, height } = size
    let touched = false
    const canResize = prev ? width === prev.width && height === prev.height : !ownSize
    if (canResize && (width !== stencil.width || height !== stencil.height)) {
      width = stencil.width
      height = stencil.height
      cell.resize(width, height)
      touched = true
    }
    const items = buildPortItems(stencil, width, height, {
      flipH: !!tms.flipH,
      flipV: !!tms.flipV,
    })
    // Через port-manager, а НЕ `set('ports', {items})`: тот заменяет объект целиком
    // и сносит `groups` из defaults TMSStencil, после чего JointJS падает на
    // расчёте позиций портов (нет layout-колбэка группы). Тот же приём в
    // useBusResize.syncBusPorts.
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
    const view = paper?.findViewByModel(cell)
    if (view) injectStencilSvg(view, stencil)
    if (touched) report.changed += 1
  }
  return report
}

/**
 * После `fromJSON` (restore, undo/redo, смена формы) cellView'ы пустые — JointJS не
 * знает наших стенсилов. Проходим элементы с `tms` и инъектим SVG заново; angle
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
  for (const link of graph.getLinks()) {
    const z = normalizeLinkZ(link.get('z'))
    if (link.get('z') !== z) link.set('z', z)
  }
  return report
}
