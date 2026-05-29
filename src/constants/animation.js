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

// Цвет затемнения «выключено» (animation-off). Tailwind slate-500 — нейтральный
// серый того же уровня насыщенности что и voltage-палитра (все Tailwind 500).
// Применяется как stroke на элементах когда привязанный bool-тег = false:
// перекрашивает контуры в серый поверх любых voltage-классов (cascade-порядок:
// .animation-off декларируется ПОСЛЕ voltage-правил). В отличие от opacity 0.4
// эффект предсказуем независимо от родительских fill/stroke.
export const ANIMATION_OFF_COLOR = '#64748b'
