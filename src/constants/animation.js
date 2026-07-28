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

// «Выключено»: slate-500, тот же уровень насыщенности, что у voltage-палитры.
// Красит контуры серым поверх voltage — правило объявляется ПОСЛЕ них (каскад).
// Не opacity: результат предсказуем независимо от родительских fill/stroke.
// Наружу отдаём не hex, а готовые правила из buildVoltageCssRules.
const ANIMATION_OFF_COLOR = '#64748b'

// Class-name'ы wire-protocol'а (voltage-классы уже есть ключами выше).
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

/** stateColors[key] → { stroke, fill }: строка = только контур, объект = оба. */
export function normalizeStateColor(value) {
  if (!value) return { stroke: '', fill: '' }
  if (typeof value === 'string') return { stroke: value, fill: '' }
  return { stroke: value.stroke || '', fill: value.fill || '' }
}

/**
 * CSS перекраса по состоянию — один источник для экспорта (scope '') и симуляции
 * (scope '.tms-simulating '). `:not(.animation-off)` — обесточивание бьёт цвет
 * состояния. Про scope/strokeExtra см. buildVoltageCssRules.
 *
 * @param {Array<{id:string, stateColors?:Object}>} stencils
 */
export function buildStateColorCssRules(stencils, { scope = '', strokeExtra = '' } = {}) {
  const rules = []
  for (const s of stencils || []) {
    const colors = s.stateColors
    if (!colors) continue
    for (const [key, value] of Object.entries(colors)) {
      const { stroke, fill } = normalizeStateColor(value)
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
 * CSS voltage/off для outer-g: stroke у потомков кроме text + opt-in fill; off
 * идёт ПОСЛЕ voltage и перебивает его каскадом. Один источник для экспорта и
 * симуляции — иначе превью расходится с view.svg. `!important` перебивает inline
 * presentation-атрибуты фигур.
 *
 * @param {object} [opts]
 * @param {string} [opts.scope] — префикс селектора ('.tms-simulating ' для превью)
 * @param {string} [opts.strokeExtra] — доп. `:not(...)` для живого DOM
 *        (joint-wrapper / hit-area), которых в экспортном SVG нет
 */
export function buildVoltageCssRules({ scope = '', strokeExtra = '' } = {}) {
  const rules = []
  const paint = (cls, hex) => {
    rules.push(
      `${scope}.${cls}, ${scope}.${cls} *:not(text)${strokeExtra} { stroke: ${hex} !important; }`,
      `${scope}.${cls} .tms-voltage-fill, ${scope}.${cls}.tms-voltage-fill { fill: ${hex} !important; }`
    )
  }
  for (const [cls, hex] of Object.entries(ANIMATION_CLASS_COLORS)) paint(cls, hex)
  paint(CLASS_OFF, ANIMATION_OFF_COLOR)
  return rules
}
