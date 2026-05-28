import { instantiate } from './parser'
import { getStencilById } from './registry'

const SVG_NS = 'http://www.w3.org/2000/svg'

/** CSS-класс редактор-only меток (prefix-лейблов) — exporter их игнорирует
 *  через свежий instantiate(), поэтому в view.svg они не попадают. */
const PREFIX_LABEL_CLASS = 'tms-prefix-label'

/** Ширина resize-хэндлов шины (см. buildBusContent). */
const BUS_HANDLE_WIDTH = 6

/** Шаг между портами шины — 2 клетки сетки (gridSize=10). Количество портов
 *  зависит от ширины: чем шире шина, тем больше точек подключения. */
const BUS_PORT_SPACING = 20

/** X-координата порта шины по его индексу (0-based). Первый порт отступает
 *  на один шаг от левого края, дальше — каждые BUS_PORT_SPACING. */
export function busPortX(index) {
  return (index + 1) * BUS_PORT_SPACING
}

/** Сколько портов помещается в шину данной ширины. Минимум 1; крайние порты
 *  не доходят до resize-хэндлов (последний на расстоянии шага от правого края). */
export function desiredBusPortCount(width) {
  return Math.max(1, Math.floor(width / BUS_PORT_SPACING) - 1)
}

/**
 * Items-массив портов шины для начального создания (cell с ports.items).
 * Стабильные id (`top_i`, `bot_i`) — при resize порты досоздаются/удаляются,
 * а подключённые провода переживают это (см. syncBusPorts в CanvasPane).
 */
export function computeBusPorts(width, height) {
  const items = []
  const count = desiredBusPortCount(width)
  for (let i = 0; i < count; i++) {
    const x = busPortX(i)
    items.push({ id: `top_${i}`, group: 'port', args: { x, y: 0 } })
    items.push({ id: `bot_${i}`, group: 'port', args: { x, y: height } })
  }
  return items
}

/**
 * SVG-строка шины для экспорта: только чёрное тело по реальному размеру,
 * без зелёных resize-хэндлов (они редактор-only). Формат совпадает с тем,
 * что отдаёт parser.instantiate(), поэтому exporter обрабатывает её единообразно.
 */
export function buildBusExportSvg(width, height) {
  // class="tms-voltage-fill" — opt-in для voltage-цвета заливки (см. inlineStyles
  // в exporter.js). Без этого класса fill шины не перекрасится.
  return `<svg xmlns="${SVG_NS}"><rect class="tms-voltage-fill" x="0" y="0" width="${width}" height="${height}" fill="#000"/></svg>`
}

/** Параметры рендера текстового стенсила (общие для редактора и экспорта). */
export const TEXT_FONT_SIZE = 14 // дефолт (= пресет M)
const TEXT_PADDING_X = 4

/** Lookup лейблов и единиц измерения для cell_value по суффиксу выбранного тега.
 *  Известные суффиксы маппятся в физические имена и СИ-единицы; неизвестные —
 *  показываются как есть (суффикс без точки) с пустой единицей. */
const VALUE_LABEL_BY_SUFFIX = {
  '.IA': 'Ia',  '.IB': 'Ib',  '.IC': 'Ic',
  '.UA': 'Ua',  '.UB': 'Ub',  '.UC': 'Uc',
  '.UAB': 'Uab', '.UBC': 'Ubc', '.UCA': 'Uca',
  '.PW': 'P',   '.QW': 'Q',   '.SW': 'S',
  '.COSF': 'cosφ',
  '.F': 'f',    '.T': 't',
}

const VALUE_UNIT_BY_SUFFIX = {
  '.IA': 'А', '.IB': 'А', '.IC': 'А',
  '.UA': 'В', '.UB': 'В', '.UC': 'В',
  '.UAB': 'В', '.UBC': 'В', '.UCA': 'В',
  '.PW': 'кВт', '.QW': 'квар', '.SW': 'кВА',
  '.COSF': '',
  '.F': 'Гц', '.T': '°C',
}

function suffixOfTag(tag) {
  const dotIdx = (tag || '').indexOf('.')
  return dotIdx >= 0 ? tag.slice(dotIdx) : ''
}

/** Лейбл и единица для cell_value по полному тегу. */
export function resolveValueDisplay(tag) {
  const suffix = suffixOfTag(tag)
  const label = VALUE_LABEL_BY_SUFFIX[suffix] ?? suffix.replace(/^\./, '')
  const unit = VALUE_UNIT_BY_SUFFIX[suffix] ?? ''
  return { label: label || '?', unit }
}

/** Пресеты размера шрифта для текстового поля (S/M/L). */
export const TEXT_SIZE_PRESETS = [
  { label: 'S', size: 11 },
  { label: 'M', size: 14 },
  { label: 'L', size: 20 },
]

/** Высота cell'а под заданный размер шрифта — чтобы hit-area совпадала с текстом. */
export function textCellHeight(fontSize) {
  return fontSize + 6
}

/** Экранирует спецсимволы для вставки текста в XML/SVG-строку. */
function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * SVG-строка текстового поля для экспорта. Текст вертикально по центру,
 * с небольшим отступом слева. Формат как у parser.instantiate().
 */
export function buildTextExportSvg(text, height, { fontSize = TEXT_FONT_SIZE, bold = false } = {}) {
  const y = height / 2
  const weight = bold ? ' font-weight="bold"' : ''
  // class="tms-voltage-fill" — текст красится цветом напряжения (это его основная заливка).
  return `<svg xmlns="${SVG_NS}"><text class="tms-voltage-fill" x="${TEXT_PADDING_X}" y="${y}" dominant-baseline="central" font-size="${fontSize}" font-family="sans-serif"${weight} fill="#000">${escapeXml(text)}</text></svg>`
}

/**
 * SVG-строка cell_value для экспорта: label + value (динамический) + единица.
 * Value-элемент получает id="animation-{prefix}" — рантайм обновляет его
 * содержимое из тега tms.valueTag (text-анимация, см. exporter).
 */
export function buildValueExportSvg(prefix, valueTag, width = 100, height = 18) {
  const { label, unit } = resolveValueDisplay(valueTag)
  const unitText = unit
    ? `<text x="72" y="13" font-size="9" font-family="sans-serif" fill="#888">${escapeXml(unit)}</text>`
    : ''
  const frame = `<rect x="0" y="0" width="${width}" height="${height}" fill="#fff" stroke="#000" stroke-width="1.5"/>`
  return `<svg xmlns="${SVG_NS}">${frame}<text x="2" y="13" font-size="11" font-family="sans-serif" fill="#666">${escapeXml(label)}</text><text id="animation-${prefix}" x="68" y="13" text-anchor="end" font-size="11" font-family="sans-serif" font-weight="bold" fill="#222">--</text>${unitText}</svg>`
}

/**
 * Динамический контент шины: чёрная полоса в середине + два зелёных
 * resize-хэндла на краях. Размер берётся из cellView.model.size(),
 * пересчитывается каждый раз при injectStencilSvg.
 */
function buildBusContent(cellView) {
  const { width, height } = cellView.model.size()
  const hw = BUS_HANDLE_WIDTH
  const overhang = 2 // насколько хэндл выпирает по Y за тело шины

  const out = []

  const body = document.createElementNS(SVG_NS, 'rect')
  body.setAttribute('x', String(hw))
  body.setAttribute('y', '0')
  body.setAttribute('width', String(Math.max(0, width - hw * 2)))
  body.setAttribute('height', String(height))
  body.setAttribute('fill', '#000')
  out.push(body)

  for (const edge of ['left', 'right']) {
    const h = document.createElementNS(SVG_NS, 'rect')
    h.setAttribute('class', 'tms-resize-handle')
    h.setAttribute('data-edge', edge)
    h.setAttribute('x', String(edge === 'left' ? 0 : width - hw))
    h.setAttribute('y', String(-overhang))
    h.setAttribute('width', String(hw))
    h.setAttribute('height', String(height + overhang * 2))
    h.setAttribute('fill', '#10b981') // emerald-500
    h.style.cursor = 'ew-resize'
    out.push(h)
  }

  return out
}

/**
 * Контент текстового поля: одна <text>-нода с содержимым из tms.text,
 * вертикально по центру cell'а. Статичный стенсил — без анимаций и портов.
 */
function buildTextContent(cellView) {
  const { height } = cellView.model.size()
  const tms = cellView.model.get('tms') || {}
  const fontSize = tms.fontSize ?? TEXT_FONT_SIZE

  const t = document.createElementNS(SVG_NS, 'text')
  t.setAttribute('x', String(TEXT_PADDING_X))
  t.setAttribute('y', String(height / 2))
  t.setAttribute('dominant-baseline', 'central')
  t.setAttribute('font-size', String(fontSize))
  t.setAttribute('font-family', 'sans-serif')
  if (tms.bold) t.setAttribute('font-weight', 'bold')
  t.setAttribute('fill', '#000')
  t.textContent = tms.text ?? ''
  return [t]
}

/**
 * Контент cell_value для редактора: 3 text-ноды (label, value-placeholder, unit).
 * Label/unit подбираются по суффиксу tms.valueTag (см. resolveValueDisplay).
 * В редакторе value показывает «--» — реальное значение появится при экспорте/runtime.
 */
function buildValueContent(cellView) {
  const tms = cellView.model.get('tms') || {}
  const { label, unit } = resolveValueDisplay(tms.valueTag)
  const { width, height } = cellView.model.size()

  const out = []

  // Рамка с белой заливкой и чёрной обводкой. В редакторе окраска от
  // voltage-source не применяется (это runtime-only через CSS classes).
  const frame = document.createElementNS(SVG_NS, 'rect')
  frame.setAttribute('x', '0')
  frame.setAttribute('y', '0')
  frame.setAttribute('width', String(width))
  frame.setAttribute('height', String(height))
  frame.setAttribute('fill', '#fff')
  frame.setAttribute('stroke', '#000')
  frame.setAttribute('stroke-width', '1.5')
  out.push(frame)

  const labelEl = document.createElementNS(SVG_NS, 'text')
  labelEl.setAttribute('x', '2')
  labelEl.setAttribute('y', '13')
  labelEl.setAttribute('font-size', '11')
  labelEl.setAttribute('font-family', 'sans-serif')
  labelEl.setAttribute('fill', '#666')
  labelEl.textContent = label
  out.push(labelEl)

  const valueEl = document.createElementNS(SVG_NS, 'text')
  valueEl.setAttribute('x', '68')
  valueEl.setAttribute('y', '13')
  valueEl.setAttribute('text-anchor', 'end')
  valueEl.setAttribute('font-size', '11')
  valueEl.setAttribute('font-family', 'sans-serif')
  valueEl.setAttribute('font-weight', 'bold')
  valueEl.setAttribute('fill', '#222')
  valueEl.textContent = '--'
  out.push(valueEl)

  if (unit) {
    const unitEl = document.createElementNS(SVG_NS, 'text')
    unitEl.setAttribute('x', '72')
    unitEl.setAttribute('y', '13')
    unitEl.setAttribute('font-size', '9')
    unitEl.setAttribute('font-family', 'sans-serif')
    unitEl.setAttribute('fill', '#888')
    unitEl.textContent = unit
    out.push(unitEl)
  }

  return out
}

/**
 * Впихивает SVG-разметку стенсила в body-группу cellView'а + добавляет
 * маленький prefix-лейбл над ячейкой (виден только в редакторе, экспортёр
 * вырежет элементы с классом PREFIX_LABEL_CLASS).
 *
 * Сначала очищает старое содержимое body — это позволяет переиспользовать
 * функцию и для первого рендера ячейки, и для перерисовки после смены prefix'а
 * или восстановления из history.
 *
 * @param {dia.CellView} cellView — JointJS CellView выбранной ячейки
 * @param {object} stencil — определение стенсила из реестра
 * @param {string} prefix — текущий prefix логического объекта
 * @returns {boolean} true если SVG был успешно вставлен, false если что-то пошло не так
 */
export function injectStencilSvg(cellView, stencil, prefix) {
  if (!cellView || !stencil) return false

  const found = cellView.findBySelector('body')
  const bodyEl =
    found && typeof found.length === 'number' ? found[0] : found
  const target = bodyEl || cellView.el.firstElementChild
  if (!target) return false

  // Чистим старое содержимое body-группы
  while (target.firstChild) target.removeChild(target.firstChild)

  // Текущий размер cell'а (может отличаться от stencil.width для resizable шин).
  const currentSize = cellView.model?.size?.() || {
    width: stencil.width || 0,
    height: stencil.height || 0,
  }

  // Невидимая «hit area» по всему bbox ячейки — чтобы клик мимо тонких линий
  // (например, в углах cell_vk или cell_rz) всё равно выделял ячейку.
  // pointer-events="all" — прозрачный rect ловит события несмотря на отсутствие fill'а.
  const hit = document.createElementNS(SVG_NS, 'rect')
  hit.setAttribute('x', '0')
  hit.setAttribute('y', '0')
  hit.setAttribute('width', String(currentSize.width))
  hit.setAttribute('height', String(currentSize.height))
  hit.setAttribute('fill', 'transparent')
  hit.setAttribute('pointer-events', 'all')
  target.appendChild(hit)

  // Стенсилы вроде шины рендерятся программно из cell.size(), а не из
  // shape.svg — у них размер меняется в редакторе. Остальные берут готовый
  // SVG из шаблона с подстановкой animation-id'ов.
  if (stencil.id === 'cell_bus') {
    for (const el of buildBusContent(cellView)) target.appendChild(el)
  } else if (stencil.id === 'cell_text') {
    for (const el of buildTextContent(cellView)) target.appendChild(el)
  } else if (stencil.id === 'cell_value') {
    for (const el of buildValueContent(cellView)) target.appendChild(el)
  } else {
    const { svg } = instantiate(stencil, prefix)
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

  // Prefix-лейбл показываем только для стенсилов, привязанных к tag-list
  // (есть tagSuffixes). У декоративных шин/заземлений auto-prefix — лейбл
  // только засоряет вид.
  const hasTagBinding = (stencil.tagSuffixes || []).length > 0
  if (!hasTagBinding) return true

  // Prefix-лейбл как tooltip: тёмный плашка сверху-справа над ячейкой.
  // Виден только на hover/selected (CSS в style.css), pointer-events отключён.
  // Не попадает в export — exporter дёргает свежий instantiate(), не читает живой DOM.
  const fontSize = 9
  const paddingX = 4
  const paddingY = 2
  const textW = prefix.length * fontSize * 0.6 // приближение для моноширинного шрифта
  const rectW = textW + paddingX * 2
  const rectH = fontSize + paddingY * 2
  const rectX = currentSize.width - rectW
  const rectY = -rectH - 2 // 2px зазор над ячейкой

  const labelGroup = document.createElementNS(SVG_NS, 'g')
  labelGroup.setAttribute('class', PREFIX_LABEL_CLASS)
  labelGroup.setAttribute('pointer-events', 'none')

  const bg = document.createElementNS(SVG_NS, 'rect')
  bg.setAttribute('x', String(rectX))
  bg.setAttribute('y', String(rectY))
  bg.setAttribute('width', String(rectW))
  bg.setAttribute('height', String(rectH))
  bg.setAttribute('rx', '3')
  bg.setAttribute('fill', '#334155') // slate-700
  labelGroup.appendChild(bg)

  const text = document.createElementNS(SVG_NS, 'text')
  text.setAttribute('x', String(rectX + paddingX))
  text.setAttribute('y', String(rectY + paddingY + fontSize - 1))
  text.setAttribute('font-size', String(fontSize))
  text.setAttribute('font-family', 'ui-monospace, monospace')
  text.setAttribute('fill', '#ffffff')
  text.textContent = prefix
  labelGroup.appendChild(text)

  target.appendChild(labelGroup)

  return true
}

/**
 * После graph.fromJSON() cellView'ы рендерятся без SVG-контента — JointJS
 * не знает про наши стенсилы. Пробегает по всем элементам с мета `tms` и
 * переинжектит SVG по сохранённому stencilId/prefix.
 *
 * Используется и для restore из autosave, и для undo/redo.
 */
export function reinjectAllStencils(graph, paper) {
  if (!graph || !paper) return
  for (const cell of graph.getElements()) {
    const tms = cell.get('tms')
    if (!tms?.stencilId) continue
    const stencil = getStencilById(tms.stencilId)
    if (!stencil) continue
    const cellView = paper.findViewByModel(cell)
    if (cellView) injectStencilSvg(cellView, stencil, tms.prefix)
  }
}
