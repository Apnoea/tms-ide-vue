// Геометрия сетки и линеек холста редактора символов — чистые функции (без Vue и
// DOM), вынесены из StencilEditor.vue: там осталась только привязка к reactive-
// состоянию (размеры/зум/скролл), а расчёты тестируются отдельно.

// Шаг сетки холста редактора = 1px (= снап вершин фигур). Дефолт для range* —
// наружу не отдаём (снап фигур живёт в useStencilEditor.SHAPE_GRID).
const GRID_STEP = 1

/** Значения 0..max с шагом step (включая max). Эпсилон гасит float-накопление. */
export function range(max, step = GRID_STEP) {
  const out = []
  for (let v = 0; v <= max + 1e-6; v += step) out.push(v)
  return out
}

/** Значения from..to с шагом step — для сетки, продолженной за границы символа. */
export function rangeFromTo(from, to, step = GRID_STEP) {
  const out = []
  for (let v = from; v <= to + 1e-6; v += step) out.push(v)
  return out
}

/**
 * Цвет линии сетки: три уровня яркости, иначе сетка 1px читается плоским шумом —
 * еле видная на каждый 1px, заметнее на кратных 5, тёмная на кратных 10 (на десятки
 * садятся порты).
 */
export function gridLineColor(v) {
  if (v % 10 === 0) return '#cbd5e1'
  if (v % 5 === 0) return '#e2e8f0'
  return '#f1f5f9'
}

/** Длина штриха линейки по уровню деления. */
export function tickInset(level) {
  if (level === 'major') return 10
  if (level === 'medium') return 6
  return 3
}

// Ниже этого зума 1px-штрихи линейки слились бы (шаг < ~6px) — показываем только
// каждый 5-й.
const RULER_MINOR_MIN_SCALE = 6

/**
 * Деления линейки: major (÷10, длинный штрих + подпись), medium (÷5), minor (1).
 * `origin` — экранная позиция нуля SVG относительно stage (центрирование + скролл),
 * `scale` — текущий зум; `p` уже в экранных px, готово для рендера.
 */
export function rulerTicks(size, origin, scale) {
  const step = scale >= RULER_MINOR_MIN_SCALE ? 1 : 5
  const out = []
  for (let u = 0; u <= size + 1e-6; u += step) {
    const level = u % 10 === 0 ? 'major' : u % 5 === 0 ? 'medium' : 'minor'
    out.push({ u, p: origin + u * scale, level })
  }
  return out
}
