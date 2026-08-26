// XML/SVG-утилиты: экранирование для SVG-строк (exporter, программные билдеры
// символов) + создание SVG-узлов для живого DOM (те же билдеры на холсте).

export const SVG_NS = 'http://www.w3.org/2000/svg'

/** Экранирует спецсимволы для вставки текста в XML/SVG-строку (& < >). */
export function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** То же + " ' для XML-attribute-значений (id, class, data-*). */
export function escapeAttr(s) {
  return escapeXml(s).replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/**
 * Создаёт SVG-элемент с атрибутами одним вызовом. Значения приводятся к строке;
 * ключи со значением null/undefined пропускаются (удобно для опциональных атрибутов
 * вроде font-weight). Третий аргумент, если задан, идёт в textContent.
 */
export function svgEl(tag, attrs = {}, text) {
  const el = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue
    el.setAttribute(k, String(v))
  }
  if (text != null) el.textContent = text
  return el
}
