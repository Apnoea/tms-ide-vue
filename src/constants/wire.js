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
