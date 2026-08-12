// Цвета анимации напряжения — общие для свотчей в инспекторе и CSS в view.svg:
// разойдутся — превью в IDE начнёт врать о рантайме. Палитра Tailwind 500
// (emerald/amber/red); зелёный намеренно не primary темы (cyan), чтобы
// UI-акценты не путались с состоянием схемы.
export const ANIMATION_CLASS_COLORS = {
  'animation-low': '#10b981',
  'animation-mid': '#f59e0b',
  'animation-high': '#ef4444',
}

export const ANIMATION_CLASS_OPTIONS = Object.keys(ANIMATION_CLASS_COLORS)

// «Выключено»: slate-500, тот же уровень насыщенности, что у палитры диапазонов.
// Красит контуры серым поверх цветов диапазонов — правило объявляется ПОСЛЕ них (каскад).
// Не opacity: результат предсказуем независимо от родительских fill/stroke.
// Наружу отдаём не hex, а готовые правила из buildRangeCssRules.
const ANIMATION_OFF_COLOR = '#64748b'

// Class-name'ы wire-protocol'а (классы диапазонов уже есть ключами выше).
export const CLASS_OFF = 'animation-off'
export const CLASS_HIDDEN = 'animation-hidden'

// Перекрас символа по состоянию (stateColors): рантайм вешает класс на outer,
// CSS красит потомков. Класс несёт stencilId — глобально уникален, поэтому
// селектору не нужен data-tms-stencil (в живом DOM симуляции его нет).
export const STATE_COLOR_PREFIX = 'animation-color-'
export function stateColorClass(stencilId, key) {
  return `${STATE_COLOR_PREFIX}${stencilId}-${key}`
}

// Opt-in заливка для state-color: маркер ставит serializeSvg на фигуры с реальным
// fill. Красим только их — иначе контуры и hit-area залились бы «блобом».
export const STATE_FILL_CLASS = 'tms-state-fill'

// Opt-in заливка по диапазонам/off (сейчас — тело шины и точка соединения).
// Ставится и в экспортном SVG, и в живом DOM: иначе симуляция расходится с view.svg.
export const RANGE_FILL_CLASS = 'tms-range-fill'

/** stateColors[key] → { stroke, fill }: строка = только контур, объект = оба. */
export function normalizeStateColor(value) {
  if (!value) return { stroke: '', fill: '' }
  if (typeof value === 'string') return { stroke: value, fill: '' }
  return { stroke: value.stroke || '', fill: value.fill || '' }
}

// Ключ состояния и цвет уезжают в CSS-селектор и CSS-значение экспортного view.svg
// (внутри CDATA), а stateColors импортированного стенсила — чужой json: `}` в ключе
// или `; }` в цвете сломали бы весь <style> или подсунули своё правило. Редактор
// генерирует ключи сам (s1/true/false) и цвет пикером, так что маски отсекают только
// подделку. Цвет — hex или CSS-имя, ничего экзотичнее нам не нужно.
const STATE_KEY_RE = /^[A-Za-z0-9_-]+$/
const CSS_COLOR_RE = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+)$/
/** Цвет или '' — та же маска для CSS состояний и для стиля фигур из чужого архива. */
export const cssColor = (v) => (CSS_COLOR_RE.test(v) ? v : '')

/**
 * CSS перекраса по состоянию — один источник для экспорта (scope '') и симуляции
 * (scope '.tms-simulating '). `:not(.animation-off)` — обесточивание бьёт цвет
 * состояния. Про scope/strokeExtra см. buildRangeCssRules.
 *
 * @param {Array<{id:string, stateColors?:Object}>} stencils
 */
export function buildStateColorCssRules(stencils, { scope = '', strokeExtra = '' } = {}) {
  const rules = []
  for (const s of stencils || []) {
    const colors = s.stateColors
    if (!colors) continue
    for (const [key, value] of Object.entries(colors)) {
      if (!STATE_KEY_RE.test(key)) continue
      const norm = normalizeStateColor(value)
      const stroke = cssColor(norm.stroke)
      const fill = cssColor(norm.fill)
      const sel = `${scope}.${stateColorClass(s.id, key)}:not(.${CLASS_OFF})`
      if (stroke)
        rules.push(`${sel}, ${sel} *:not(text)${strokeExtra} { stroke: ${stroke} !important; }`)
      if (fill)
        rules.push(
          `${sel} .${STATE_FILL_CLASS}, ${sel}.${STATE_FILL_CLASS} { fill: ${fill} !important; }`
        )
    }
  }
  return rules
}

/**
 * CSS диапазонов/off для outer-g: stroke у потомков кроме text + opt-in fill; off
 * идёт ПОСЛЕ них и перебивает его каскадом. Один источник для экспорта и
 * симуляции — иначе превью расходится с view.svg. `!important` перебивает inline
 * presentation-атрибуты фигур.
 *
 * @param {object} [opts]
 * @param {string} [opts.scope] — префикс селектора ('.tms-simulating ' для превью)
 * @param {string} [opts.strokeExtra] — доп. `:not(...)` для живого DOM
 *        (joint-wrapper / hit-area), которых в экспортном SVG нет
 */
export function buildRangeCssRules({ scope = '', strokeExtra = '' } = {}) {
  const rules = []
  const paint = (cls, hex) => {
    rules.push(
      `${scope}.${cls}, ${scope}.${cls} *:not(text)${strokeExtra} { stroke: ${hex} !important; }`,
      `${scope}.${cls} .${RANGE_FILL_CLASS}, ${scope}.${cls}.${RANGE_FILL_CLASS} { fill: ${hex} !important; }`
    )
  }
  for (const [cls, hex] of Object.entries(ANIMATION_CLASS_COLORS)) paint(cls, hex)
  paint(CLASS_OFF, ANIMATION_OFF_COLOR)
  return rules
}
