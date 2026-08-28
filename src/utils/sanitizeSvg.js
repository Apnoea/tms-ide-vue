/**
 * Whitelist тегов и атрибутов для чужого `shape.svg`: он приходит из .zip и уходит в
 * v-html и appendChild. Чистится на входе в реестр — дальше по конвейеру svgText
 * считается безопасным. Whitelist, а не blacklist: список нужного закрыт.
 */

// Сравниваем в нижнем регистре: у SVG имена camelCase (`viewBox`,
// `linearGradient`), а разметка бывает и в другом регистре.
const lower = (names) => new Set(names.map((n) => n.toLowerCase()))

// `defs`+градиенты не наш генератор, но частый приём в рукописных символах.
const ALLOWED_TAGS = lower([
  'svg',
  'g',
  'defs',
  'title',
  'desc',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'path',
  'text',
  'tspan',
  'linearGradient',
  'radialGradient',
  'stop',
])

// Геометрия и оформление. `style` не пускаем: через него идут url() и внешние
// ссылки, а символам он не нужен.
const ALLOWED_ATTRS = lower([
  'id',
  'class',
  'viewBox',
  'width',
  'height',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'fx',
  'fy',
  'd',
  'points',
  'transform',
  'gradientUnits',
  'gradientTransform',
  'spreadMethod',
  'offset',
  'stop-color',
  'stop-opacity',
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  'opacity',
  'vector-effect',
  'pointer-events',
  'font-size',
  'font-family',
  'font-weight',
  'font-style',
  'text-anchor',
  'dominant-baseline',
  'letter-spacing',
  'xmlns',
])

// Ссылка допустима только локальная: url(#grad), но не url(http://…)/javascript:.
const URL_VALUE_RE = /url\(\s*['"]?#[A-Za-z0-9_:.-]+['"]?\s*\)/

function isSafeValue(value) {
  const v = String(value)
  if (!/url\(|javascript:|data:/i.test(v)) return true
  return URL_VALUE_RE.test(v) && !/javascript:|data:/i.test(v)
}

/**
 * Чистит разметку символа.
 *
 * @param {string} svg — исходный `shape.svg`
 * @returns {{ svg: string, removed: string[] }} `removed` — что вырезано (для
 *   предупреждения). Непарсящийся SVG → пустая строка: лучше символ без рисунка,
 *   чем сырая строка в v-html.
 */
export function sanitizeSvgMarkup(svg) {
  if (!svg || typeof svg !== 'string') return { svg: '', removed: [] }
  // Без DOM (node-тесты) разметка никуда не вставляется — отдаём как есть.
  if (typeof DOMParser === 'undefined') return { svg, removed: [] }
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  if (doc.getElementsByTagName('parsererror').length > 0) {
    return { svg: '', removed: ['разметка не разобралась'] }
  }
  const removed = new Set()
  scrub(doc.documentElement, removed)
  return { svg: new XMLSerializer().serializeToString(doc.documentElement), removed: [...removed] }
}

/** Рекурсивная чистка узла на месте: сначала атрибуты, потом дети. */
function scrub(el, removed) {
  for (const attr of [...el.attributes]) {
    // localName, а не name: `xlink:href` и `href` — один и тот же вектор.
    const name = attr.localName.toLowerCase()
    // data-* — наш wire-protocol, не исполняется.
    if (name.startsWith('data-')) continue
    if (!ALLOWED_ATTRS.has(name) || !isSafeValue(attr.value)) {
      el.removeAttributeNode(attr)
      removed.add(name.startsWith('on') ? `${name}=` : name)
    }
  }
  for (const child of [...el.children]) {
    const tag = child.localName.toLowerCase()
    if (!ALLOWED_TAGS.has(tag)) {
      child.remove()
      removed.add(`<${tag}>`)
      continue
    }
    scrub(child, removed)
  }
}
