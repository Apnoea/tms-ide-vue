// Цветовые классы анимации напряжения. Единый источник правды:
//   • UI-preview (CanvasInspector / RangeBlock рисуют swatch'и этим цветом)
//   • Экспорт view.svg (CSS-правила .animation-low/mid/high → stroke/fill)
// При расхождении preview в IDE врёт о том, как будет выглядеть рантайм. Поэтому
// и опции, и hex'ы держим здесь.
//
// Палитра — Tailwind 500: emerald-500 (low ≈ «нормально»), amber-500 (mid =
// warning), red-500 (high = danger). Зелёный намеренно отделён от primary темы
// (cyan) — чтобы UI-акценты и power-flow цвета не путались.
export const ANIMATION_CLASS_COLORS = {
  'animation-low': '#10b981',
  'animation-mid': '#f59e0b',
  'animation-high': '#ef4444',
}

export const ANIMATION_CLASS_OPTIONS = Object.keys(ANIMATION_CLASS_COLORS)

// Цвет затемнения «выключено» (animation-off). Tailwind slate-500 — нейтральный
// серый того же уровня насыщенности что и voltage-палитра (все Tailwind 500).
// Применяется как stroke на элементах когда привязанный bool-тег = false:
// перекрашивает контуры в серый поверх любых voltage-классов (cascade-порядок:
// .animation-off декларируется ПОСЛЕ voltage-правил). В отличие от opacity 0.4
// эффект предсказуем независимо от родительских fill/stroke.
// Локальна (не экспортируется): наружу нужен не сам hex, а готовые CSS-правила
// из buildVoltageCssRules — единственный потребитель off-цвета вне этого файла.
const ANIMATION_OFF_COLOR = '#64748b'

// Class-name константы wire-protocol'а с WebScada-рантаймом. Литералы не
// плодим — синхронизировано с CSS в exporter inlineStyles и useSimulation.
// Voltage-классы (animation-low/-mid/-high) уже фигурируют как ключи
// ANIMATION_CLASS_COLORS — отдельные константы для них не нужны.
export const CLASS_OFF = 'animation-off'
export const CLASS_HIDDEN = 'animation-hidden'

// Класс перекраса всего символа по состоянию (stateColors в stencil.json). Вешается
// рантаймом на outer при совпадении значения слота с кодом состояния; CSS красит
// потомков. Класс несёт stencilId — так он глобально уникален и селектор НЕ зависит
// от data-tms-stencil (в живом DOM симуляции этого атрибута нет, только в экспорте).
// Синхронизировано: buildStateColorCard (exporter) + buildStateColorCssRules.
export const STATE_COLOR_PREFIX = 'animation-color-'
export function stateColorClass(stencilId, key) {
  return `${STATE_COLOR_PREFIX}${stencilId}-${key}`
}

/**
 * CSS-правила перекраса символа по состоянию. Единый источник для экспорта
 * (scope '') и симуляции (scope '.tms-simulating '). Для каждого (стенсил, ключ):
 * при классе `animation-color-<ключ>` на outer красим stroke всех потомков и fill
 * там, где он не none. `:not(.animation-off)` — обесточивание (серый) бьёт цвет
 * состояния. `strokeExtra`/`scope` — как в buildVoltageCssRules (живой DOM редактора).
 *
 * @param {Array<{id:string, stateColors?:Object}>} stencils
 */
export function buildStateColorCssRules(stencils, { scope = '', strokeExtra = '' } = {}) {
  const rules = []
  for (const s of stencils || []) {
    const colors = s.stateColors
    if (!colors) continue
    for (const [key, color] of Object.entries(colors)) {
      const sel = `${scope}.${stateColorClass(s.id, key)}:not(.${CLASS_OFF})`
      // strokeExtra (исключения wrapper/hit-area живого DOM) нужны и для fill —
      // иначе прозрачный хит-бокс-rect ячейки (fill ≠ none) заливается целиком.
      rules.push(
        `${sel}, ${sel} *:not(text)${strokeExtra} { stroke: ${color} !important; }`,
        `${sel} *:not(text):not([fill="none"])${strokeExtra} { fill: ${color} !important; }`
      )
    }
  }
  return rules
}

/**
 * CSS-правила voltage/off для outer-g: stroke по всем потомкам кроме text +
 * opt-in fill (`.tms-voltage-fill`), и `animation-off` серым ПОСЛЕ voltage
 * (перебивает по каскаду). Единый источник для экспорта (чистый SVG) и симуляции
 * (живой DOM редактора) — чтобы превью совпадало с экспортом. Контексты разводят:
 *   • scope       — префикс селектора ('.tms-simulating ' для превью, '' для SVG);
 *   • strokeExtra — доп. `:not(...)`-исключения для live-DOM (joint-wrapper /
 *     hit-area), которых в экспортном SVG нет.
 * `!important` везде — перебить inline presentation-атрибуты внутри ячеек.
 * Возвращает массив строк-правил (caller сам джойнит и обрамляет hidden/quality).
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
