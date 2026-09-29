import { cssColor } from './animation'

/**
 * Допуски вида провода — единый источник для поля инспектора, санитайзера meta
 * (`LINK_META_FIELDS`) и валидации «липких» настроек нового провода.
 */
export const WIRE_STROKE_MIN = 0.5
export const WIRE_STROKE_MAX = 20

/** Виды наконечника: `solid` — треугольник, `open` — две линии под 45°. */
export const ARROW_KINDS = ['solid', 'open']

/**
 * Маршрут провода. По умолчанию (поля нет) — по сетке: ортогонально, с учётом сторон
 * портов и мостиками на пересечениях. `straight` — напрямую от порта к порту через
 * ручные изломы, без мостиков: так рисуют сети.
 */
export const WIRE_ROUTE_STRAIGHT = 'straight'
export const WIRE_ROUTES = [WIRE_ROUTE_STRAIGHT]

/**
 * Чужой/произвольный вид провода → только годные поля. Одна проверка на оба входа
 * «липких» настроек: правку из инспектора и чтение меты проекта.
 */
export function normalizeWireStyle(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const out = {}
  const width = Number(src.strokeWidth)
  if (Number.isFinite(width) && width >= WIRE_STROKE_MIN && width <= WIRE_STROKE_MAX) {
    out.strokeWidth = width
  }
  const color = cssColor(src.strokeColor)
  if (color) out.strokeColor = color
  for (const key of ['arrowStart', 'arrowEnd']) {
    if (ARROW_KINDS.includes(src[key])) out[key] = src[key]
  }
  if (WIRE_ROUTES.includes(src.route)) out.route = src.route
  return out
}
