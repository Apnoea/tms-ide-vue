import { instantiate } from './parser'
import { getStencilById } from './registry'

const SVG_NS = 'http://www.w3.org/2000/svg'

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
 * Унифицированный билдер `ports.items` для cell.ports — общий для drag-drop
 * из палитры, paste и round-trip-load. Шина — спецслучай (см. computeBusPorts).
 * У остальных — из stencil.ports + опциональный per-port `magnet` ('passive'
 * для cell_node: можно подключаться К узлу, но не таскать ОТ него — узел не
 * имеет «направления», это junction-точка).
 */
export function buildPortItems(stencil, width, height) {
  if (stencil.id === 'cell_bus') return computeBusPorts(width, height)
  return (stencil.ports || []).map((p) => {
    const item = {
      id: p.name,
      group: 'port',
      args: { x: p.x, y: p.y },
    }
    if (p.magnet) item.attrs = { portBody: { magnet: p.magnet } }
    return item
  })
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
export const TEXT_PADDING_X = 4

/** Lookup лейблов и единиц измерения для cell_value по суффиксу выбранного тега.
 *  Известные суффиксы маппятся в физические имена и СИ-единицы; неизвестные —
 *  показываются как есть (суффикс без точки) с пустой единицей. */
const VALUE_LABEL_BY_SUFFIX = {
  '.IA': 'Ia',
  '.IB': 'Ib',
  '.IC': 'Ic',
  '.UA': 'Ua',
  '.UB': 'Ub',
  '.UC': 'Uc',
  '.UAB': 'Uab',
  '.UBC': 'Ubc',
  '.UCA': 'Uca',
  '.PW': 'P',
  '.QW': 'Q',
  '.SW': 'S',
  '.COSF': 'cosφ',
  '.F': 'f',
  '.T': 't',
}

const VALUE_UNIT_BY_SUFFIX = {
  '.IA': 'А',
  '.IB': 'А',
  '.IC': 'А',
  '.UA': 'В',
  '.UB': 'В',
  '.UC': 'В',
  '.UAB': 'В',
  '.UBC': 'В',
  '.UCA': 'В',
  '.PW': 'кВт',
  '.QW': 'квар',
  '.SW': 'кВА',
  '.COSF': '',
  '.F': 'Гц',
  '.T': '°C',
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

// Canvas-контекст для measureText. Один на модуль, чтобы не плодить
// detached canvas'ы на каждый вызов textCellWidth.
let _measureCtx = null
function getMeasureCtx() {
  if (!_measureCtx && typeof document !== 'undefined') {
    _measureCtx = document.createElement('canvas').getContext('2d')
  }
  return _measureCtx
}

/**
 * Ширина cell'а под текущий текст + шрифт + bold. Меряем через Canvas API
 * (не точно, но довольно близко к реальному рендеру в SVG), добавляем
 * паддинги по бокам. Минимум — 24px чтобы пустой текст не схлопывался в 0.
 */
export function textCellWidth(text, fontSize, bold = false) {
  const ctx = getMeasureCtx()
  if (!ctx) return 100 // SSR fallback
  ctx.font = `${bold ? 'bold ' : ''}${fontSize}px sans-serif`
  const w = ctx.measureText(text || '').width
  return Math.max(24, Math.ceil(w) + TEXT_PADDING_X * 2)
}

/** Экранирует спецсимволы для вставки текста в XML/SVG-строку. */
function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
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
 * Value-элемент получает id="animation-{animId}" — рантайм обновляет его
 * содержимое из тега tms.valueTag (text-анимация, см. exporter). animId
 * обычно равен tms.valueTag (рантайм-конвенция {prefix}.SUFFIX), fallback
 * на cell.id если valueTag не задан.
 */
export function buildValueExportSvg(animId, valueTag, width = 100, height = 20) {
  const { label, unit } = resolveValueDisplay(valueTag)
  const by = height - 5
  // Геометрия и цвета — синхронны с buildValueContent (см. константы VALUE_*).
  // Меняем здесь — меняй там, иначе editor-preview и export разойдутся.
  const stripe = `<rect x="0" y="0" width="3" height="${height}" fill="#000"/>`
  const bg = `<rect x="3" y="0" width="${Math.max(0, width - 3)}" height="${height}" fill="#fafafa"/>`
  const labelText = `<text x="8" y="${by}" font-size="10" font-family="sans-serif" fill="#71717a">${escapeXml(label)}</text>`
  const valueText = `<text id="animation-${animId}" x="${width - 32}" y="${by}" text-anchor="end" font-size="12" font-family="sans-serif" font-weight="bold" fill="#18181b">--</text>`
  const unitText = unit
    ? `<text x="${width - 5}" y="${by}" text-anchor="end" font-size="9" font-family="sans-serif" fill="#a1a1aa">${escapeXml(unit)}</text>`
    : ''
  return `<svg xmlns="${SVG_NS}">${stripe}${bg}${labelText}${valueText}${unitText}</svg>`
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
    h.setAttribute('fill', '#06b6d4') // cyan-500 (= primary темы)
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

// ─── cell_value: «card с accent-полоской» ───
// Сетка (width=100, height=20): [0..3] stripe, [3..100] surface-50,
// x=8 label, x=68 value-end, x=95 unit-end, baseline y=height-5.
// Фиксированные value-end/unit-end — чтобы колонки не разъезжались при стеке.
// UNIT_ZONE = 32 рассчитано на самый широкий unit «квар» (~22px @9px) + gap.
const VALUE_STRIPE_W = 3
const VALUE_BG_COLOR = '#fafafa'
const VALUE_STRIPE_COLOR = '#000' // нейтральный — не конкурирует с voltage-цветами стенсилов и не выделяется по теме
const VALUE_LABEL_COLOR = '#71717a' // zinc-500
const VALUE_TEXT_COLOR = '#18181b' // zinc-900
const VALUE_UNIT_COLOR = '#a1a1aa' // zinc-400
const VALUE_PAD_LEFT = 8 // label-start от левого края
const VALUE_UNIT_RIGHT_PAD = 5 // unit-end от правого края
const VALUE_UNIT_ZONE = 32 // зарезервировано на unit + gap до value
const VALUE_BASELINE_PAD = 5 // расстояние от пола ячейки до общей baseline

/**
 * Контент cell_value для редактора: stripe + bg + 3 text-ноды (label, value,
 * unit). Label/unit подбираются по суффиксу tms.valueTag. В редакторе value
 * показывает «--» — реальное значение появится при экспорте/runtime через
 * text-анимацию (id="animation-{valueTag}").
 */
function buildValueContent(cellView) {
  const tms = cellView.model.get('tms') || {}
  const { label, unit } = resolveValueDisplay(tms.valueTag)
  const { width, height } = cellView.model.size()
  // Общая baseline для label/value/unit — alphabetic-выравнивание «по полу».
  // y-координата это baseline-line; descender'ы (например φ в cosφ) уходят
  // ниже на 2-3px, паддинг VALUE_BASELINE_PAD рассчитан с запасом под них.
  const by = height - VALUE_BASELINE_PAD

  const out = []

  // Stripe-маркер слева
  const stripe = document.createElementNS(SVG_NS, 'rect')
  stripe.setAttribute('x', '0')
  stripe.setAttribute('y', '0')
  stripe.setAttribute('width', String(VALUE_STRIPE_W))
  stripe.setAttribute('height', String(height))
  stripe.setAttribute('fill', VALUE_STRIPE_COLOR)
  out.push(stripe)

  // Светлый фон (от stripe до правого края). Окраска от voltage-source в
  // редакторе не применяется (это runtime-only через CSS classes).
  const bg = document.createElementNS(SVG_NS, 'rect')
  bg.setAttribute('x', String(VALUE_STRIPE_W))
  bg.setAttribute('y', '0')
  bg.setAttribute('width', String(Math.max(0, width - VALUE_STRIPE_W)))
  bg.setAttribute('height', String(height))
  bg.setAttribute('fill', VALUE_BG_COLOR)
  out.push(bg)

  // Label — приглушённый, слева
  const labelEl = document.createElementNS(SVG_NS, 'text')
  labelEl.setAttribute('x', String(VALUE_PAD_LEFT))
  labelEl.setAttribute('y', String(by))
  labelEl.setAttribute('font-size', '10')
  labelEl.setAttribute('font-family', 'sans-serif')
  labelEl.setAttribute('fill', VALUE_LABEL_COLOR)
  labelEl.textContent = label
  out.push(labelEl)

  // Value — фокус блока: жирно, near-black, чуть крупнее label/unit
  const valueEl = document.createElementNS(SVG_NS, 'text')
  valueEl.setAttribute('x', String(width - VALUE_UNIT_ZONE))
  valueEl.setAttribute('y', String(by))
  valueEl.setAttribute('text-anchor', 'end')
  valueEl.setAttribute('font-size', '12')
  valueEl.setAttribute('font-family', 'sans-serif')
  valueEl.setAttribute('font-weight', 'bold')
  valueEl.setAttribute('fill', VALUE_TEXT_COLOR)
  valueEl.textContent = '--'
  out.push(valueEl)

  if (unit) {
    const unitEl = document.createElementNS(SVG_NS, 'text')
    unitEl.setAttribute('x', String(width - VALUE_UNIT_RIGHT_PAD))
    unitEl.setAttribute('y', String(by))
    unitEl.setAttribute('text-anchor', 'end')
    unitEl.setAttribute('font-size', '9')
    unitEl.setAttribute('font-family', 'sans-serif')
    unitEl.setAttribute('fill', VALUE_UNIT_COLOR)
    unitEl.textContent = unit
    out.push(unitEl)
  }

  return out
}

/**
 * Впихивает SVG-разметку стенсила в body-группу cellView'а. Сначала очищает
 * старое содержимое — позволяет переиспользовать функцию и для первого
 * рендера ячейки, и для перерисовки после правки слотов / восстановления из
 * history. Hover-tooltip с лейблом и счётчиком анимаций живёт в HTML
 * (CanvasPane.cellHoverTooltip), отдельно от SVG-разметки ячейки.
 *
 * @param {dia.CellView} cellView — JointJS CellView выбранной ячейки
 * @param {object} stencil — определение стенсила из реестра
 * @returns {boolean} true если SVG был успешно вставлен
 */
export function injectStencilSvg(cellView, stencil) {
  if (!cellView || !stencil) return false

  const found = cellView.findBySelector('body')
  const bodyEl = found && typeof found.length === 'number' ? found[0] : found
  const target = bodyEl || cellView.el.firstElementChild
  if (!target) return false

  // Чистим старое содержимое body-группы
  while (target.firstChild) target.removeChild(target.firstChild)

  // Текущий размер cell'а (может отличаться от stencil.width для resizable шин).
  const currentSize = cellView.model?.size?.() || {
    width: stencil.width || 0,
    height: stencil.height || 0,
  }

  // Невидимая hit-area по всему bbox — клик мимо тонких линий всё равно
  // выделяет ячейку. stroke="none" — иначе подхватывает animation-color в симуляции.
  const hit = document.createElementNS(SVG_NS, 'rect')
  hit.setAttribute('class', 'tms-hit-area')
  hit.setAttribute('x', '0')
  hit.setAttribute('y', '0')
  hit.setAttribute('width', String(currentSize.width))
  hit.setAttribute('height', String(currentSize.height))
  hit.setAttribute('fill', 'transparent')
  hit.setAttribute('stroke', 'none')
  hit.setAttribute('pointer-events', 'all')
  target.appendChild(hit)

  // Bus/text/value рендерятся программно (размер/контент динамические).
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

  return true
}

/**
 * После graph.fromJSON() cellView'ы рендерятся без SVG-контента — JointJS не
 * знает про наши стенсилы. Пробегаем по всем элементам с мета `tms` и
 * переинжектим SVG. Используется для restore из autosave и undo/redo.
 *
 * Angle хранится в `cell.angle()` и JointJS сам применяет его на outer-`<g>`
 * через transform — отдельно тут восстанавливать не нужно.
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
}
