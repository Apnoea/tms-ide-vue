// Геометрия сетки и линеек холста редактора символов — чистые функции без Vue и DOM
// (привязка к размерам/зуму/скроллу живёт в StencilEditor.vue).

/**
 * Период сетки: линия на каждую единицу (= снап вершин фигур), и за 10 единиц
 * повторяются все три уровня яркости. Поэтому сетка — один SVG-паттерн с тайлом
 * GRID_PERIOD×GRID_PERIOD, а не элемент на каждую линию.
 */
export const GRID_PERIOD = 10

/** Уровень линии: еле видная на каждую единицу, заметнее на кратных 5, тёмная на 10. */
const gridLevel = (v) => (v % 10 === 0 ? 2 : v % 5 === 0 ? 1 : 0)
const GRID_COLORS = ['#f1f5f9', '#e2e8f0', '#cbd5e1']

/**
 * Линии одного тайла паттерна: позиции 0…GRID_PERIOD с цветом уровня. Линия на
 * границе тайла (0 и GRID_PERIOD) идёт дважды: тайл обрезает её пополам, вторую
 * половину дорисовывает соседний. Порядок — от светлых к тёмным: на пересечениях
 * сверху оказывается тёмная (на десятки садятся порты).
 */
export function gridPatternLines() {
  const out = []
  for (let v = 0; v <= GRID_PERIOD; v++) out.push({ p: v, color: GRID_COLORS[gridLevel(v)] })
  return out.sort((a, b) => gridLevel(a.p) - gridLevel(b.p))
}

/** Длина штриха линейки по уровню деления. */
export function tickInset(level) {
  if (level === 'major') return 10
  if (level === 'medium') return 6
  return 3
}

// Ниже этого зума 1px-штрихи слились бы (шаг < ~6px) — показываем каждый 5-й.
const RULER_MINOR_MIN_SCALE = 6

/**
 * Деления линейки: major (÷10, длинный штрих + подпись), medium (÷5), minor (1).
 * `p` — экранные px от нуля символа при зуме `scale`. Прокрутку сюда не передаём: её
 * вызывающий применяет сдвигом всей группы, иначе каждый скролл пересобирал бы
 * сотни делений.
 */
export function rulerTicks(size, scale) {
  const step = scale >= RULER_MINOR_MIN_SCALE ? 1 : 5
  const out = []
  for (let u = 0; u <= size + 1e-6; u += step) {
    const level = u % 10 === 0 ? 'major' : u % 5 === 0 ? 'medium' : 'minor'
    out.push({ u, p: u * scale, level })
  }
  return out
}
