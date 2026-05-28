// Цветовые классы анимации напряжения. Единый источник правды:
//   • UI-preview (InspectorPane / VoltageSourceBlock рисуют swatch'и этим цветом)
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

// Дефолтные диапазоны voltage-source при первом включении на элементе или
// применении из context-menu / multi-select picker'а. Юзер дальше тонит вручную.
// Внутреннее — используется только createDefaultVoltageConfig ниже.
const VOLTAGE_RANGE_DEFAULTS = [
  { min: 0, max: 4,  class: 'animation-low' },
  { min: 4, max: 7,  class: 'animation-mid' },
  { min: 7, max: 10, class: 'animation-high' },
]

/**
 * Конструктор дефолтного voltageSource-конфига: deep-копия ranges чтобы каждый
 * элемент получил свой массив (правка одного не задевала другие).
 * Используется на включении voltage-source и применении тега из picker'ов.
 */
export function createDefaultVoltageConfig(tag = '') {
  return {
    tag,
    ranges: VOLTAGE_RANGE_DEFAULTS.map((r) => ({ ...r })),
  }
}
