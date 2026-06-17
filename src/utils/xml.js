// XML/SVG-утилиты — единый источник правды для двух мест, которые пишут SVG
// в виде строк (exporter и svgInjector программные билдеры).

export const SVG_NS = 'http://www.w3.org/2000/svg'

/** Экранирует спецсимволы для вставки текста в XML/SVG-строку (& < >). */
export function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** То же + " ' для XML-attribute-значений (id, class, data-*). */
export function escapeAttr(s) {
  return escapeXml(s).replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}
