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
    for (const el of buildValueContent(cellView, stencil.valuePresets)) target.appendChild(el)
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
 * После `fromJSON` (restore, undo/redo, смена формы) cellView'ы пустые — JointJS не
 * знает наших стенсилов. Проходим элементы с `tms` и инъектим SVG заново; angle
 * восстанавливать не нужно, его JointJS держит на outer-`<g>`.
 *
 * Провода приводим к их полосе z: `fromJSON` шлёт `reset`, add-хендлер молчит, а у
 * импортированных проектов z нет — линии легли бы поверх ячеек. Нормализация, а не
 * константа: порядок внутри полосы задаёт пользователь. Пишем только при
 * расхождении — иначе z дрейфит и ломает undo/redo (см. LINK_Z).
 */
export function reinjectAllStencils(graph, paper) {
  if (!graph || !paper) return
  for (const cell of graph.getElements()) {
    const tms = cell.get('tms')
    if (!tms?.stencilId) continue
    const stencil = getStencilById(tms.stencilId)
    if (!stencil) continue
    const cellView = paper.findViewByModel(cell)
    if (cellView) injectStencilSvg(cellView, stencil)
  }
  for (const link of graph.getLinks()) {
    const z = normalizeLinkZ(link.get('z'))
    if (link.get('z') !== z) link.set('z', z)
  }
}
