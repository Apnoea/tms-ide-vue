/**
 * Подписи — на холсте и в редакторе символов: кегль по умолчанию, шрифты и опции
 * панели свойств.
 */

/** Кегль новой подписи на холсте. */
export const TEXT_FONT_SIZE = 14

/** Кегль подписи в символе: у новой в редакторе и у разобранной без `font-size`. */
export const TEXT_SHAPE_SIZE = 10

/**
 * Только CSS-generic: конкретный шрифт панель WebScada может не найти и подменить,
 * сломав метрики. Цена — гарнитуру под generic-именем выбирает ОС, поэтому ширины
 * IDE и панели расходятся на единицы процентов. Список — whitelist (значение
 * приходит из чужого архива).
 */
export const FONT_FAMILIES = [
  { value: 'sans-serif', label: 'Без засечек' },
  { value: 'serif', label: 'С засечками' },
  { value: 'monospace', label: 'Моноширинный' },
]

/** Шрифт по умолчанию (и он же — fallback для чужих значений). */
const DEFAULT_FONT = 'sans-serif'

/**
 * Значение из whitelist или дефолт. Единая точка проверки для рендера и замера: замер
 * обязан идти ТЕМ ЖЕ семейством, что уходит в font-family, иначе габарит разойдётся с
 * рендером.
 */
export function normalizeFont(font) {
  return FONT_FAMILIES.some((f) => f.value === font) ? font : DEFAULT_FONT
}

// Выравнивание = якорь блока при росте (точка привязки стоит на месте), а не
// раскладка строки внутри рамки.
export const ALIGN_OPTIONS = [
  { value: 'left', icon: 'pi pi-align-left', tip: 'Растёт вправо (левый край на месте)' },
  { value: 'center', icon: 'pi pi-align-center', tip: 'Растёт симметрично (центр на месте)' },
  { value: 'right', icon: 'pi pi-align-right', tip: 'Растёт влево (правый край на месте)' },
]

// Жирность — одиночный toggle-сегмент SelectButton (повторный клик снимает).
export const BOLD_OPTIONS = [{ value: 'bold' }]
