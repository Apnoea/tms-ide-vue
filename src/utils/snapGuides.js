/**
 * Направляющие при перетаскивании: сравниваем опорные линии двигаемого набора с
 * линиями остальных элементов и, если они почти совпали, притягиваем набор и рисуем
 * линию. Функции чистые — жест ведёт `useSnapGuides`.
 *
 * Опорные линии — края и центр габарита плюс координаты ПОРТОВ: на мнемосхеме провод
 * входит в порт по прямой, поэтому совпадение портов соседних аппаратов важнее
 * совпадения габаритов. Поэтому порты и габариты сравниваются отдельно, порты первыми:
 * иначе близкий край перебивал бы попадание порт-в-порт.
 */

/**
 * Опорные значения бокса по одной оси: два края, центр и порты.
 *
 * @param {{x: number, y: number, width: number, height: number, ports?: Array}} box
 * @param {'x'|'y'} axis
 */
function axisAnchors(box, axis) {
  const start = axis === 'x' ? box.x : box.y
  const size = (axis === 'x' ? box.width : box.height) || 0
  const edges = [start, start + size / 2, start + size]
  const ports = (box.ports || []).map((p) => (axis === 'x' ? p.x : p.y))
  return { edges, ports }
}

/** Протяжённость бокса по ПЕРПЕНДИКУЛЯРНОЙ оси — по ней рисуется линия. */
function axisSpan(box, axis) {
  const start = axis === 'x' ? box.y : box.x
  const size = (axis === 'x' ? box.height : box.width) || 0
  return { from: start, to: start + size }
}

/**
 * Линии-кандидаты неподвижных элементов: `{ xs, ys }`, в каждой записи координата
 * линии, её протяжённость и вид опоры. Собираются один раз на начало жеста — соседи
 * во время перетаскивания не двигаются.
 */
export function guideCandidates(boxes) {
  const xs = []
  const ys = []
  for (const box of boxes || []) {
    for (const axis of ['x', 'y']) {
      const { edges, ports } = axisAnchors(box, axis)
      const span = axisSpan(box, axis)
      const out = axis === 'x' ? xs : ys
      for (const v of edges) out.push({ v, kind: 'edge', ...span })
      for (const v of ports) out.push({ v, kind: 'port', ...span })
    }
  }
  return { xs, ys }
}

/** Ближайшее попадание среди опор одного вида; `null` — все дальше порога. */
function nearest(anchors, candidates, kind, threshold) {
  let best = null
  for (const anchor of anchors) {
    for (const cand of candidates) {
      if (cand.kind !== kind) continue
      const delta = cand.v - anchor
      const dist = Math.abs(delta)
      if (dist > threshold) continue
      if (!best || dist < best.dist) best = { delta, dist, v: cand.v }
    }
  }
  return best
}

/** Попадание по оси: сначала порт-в-порт, потом габариты. */
function axisHit(box, axis, candidates, threshold) {
  const { edges, ports } = axisAnchors(box, axis)
  return (
    nearest(ports, candidates, 'port', threshold) || nearest(edges, candidates, 'edge', threshold)
  )
}

/** Отрезок линии: от края самого дальнего участника до края набора. */
function lineSpan(candidates, v, movedSpan) {
  let from = movedSpan.from
  let to = movedSpan.to
  for (const cand of candidates) {
    if (cand.v !== v) continue
    from = Math.min(from, cand.from)
    to = Math.max(to, cand.to)
  }
  return { from, to }
}

/**
 * Притяжение набора к линиям соседей: сдвиг `{ dx, dy }` и линии для отрисовки
 * (координаты МОДЕЛЬНЫЕ, максимум по одной на ось).
 *
 * @param {object} box — габарит двигаемого набора с его портами
 * @param {{xs: Array, ys: Array}} candidates — от `guideCandidates`
 * @param {number} threshold — порог притяжения в МОДЕЛЬНЫХ единицах
 */
export function findGuides(box, candidates, threshold) {
  const hitX = box ? axisHit(box, 'x', candidates?.xs || [], threshold) : null
  const hitY = box ? axisHit(box, 'y', candidates?.ys || [], threshold) : null
  const dx = hitX ? hitX.delta : 0
  const dy = hitY ? hitY.delta : 0
  const lines = []
  if (hitX) {
    const span = axisSpan({ ...box, y: box.y + dy }, 'x')
    lines.push({ axis: 'x', v: hitX.v, ...lineSpan(candidates.xs, hitX.v, span) })
  }
  if (hitY) {
    const span = axisSpan({ ...box, x: box.x + dx }, 'y')
    lines.push({ axis: 'y', v: hitY.v, ...lineSpan(candidates.ys, hitY.v, span) })
  }
  return { dx, dy, lines }
}
