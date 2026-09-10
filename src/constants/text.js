/** Подписи-разметка на холсте и в редакторе символов: кегль и опции панели свойств. */

/** Кегль новой подписи на холсте (в редакторе символов свой — `TEXT_SHAPE_SIZE`). */
export const TEXT_FONT_SIZE = 14

// Выравнивание = якорь блока при росте (точка привязки стоит на месте), а не
// раскладка строки внутри рамки.
export const ALIGN_OPTIONS = [
  { value: 'left', icon: 'pi pi-align-left', tip: 'Растёт вправо (левый край на месте)' },
  { value: 'center', icon: 'pi pi-align-center', tip: 'Растёт симметрично (центр на месте)' },
  { value: 'right', icon: 'pi pi-align-right', tip: 'Растёт влево (правый край на месте)' },
]

// Жирность — одиночный toggle-сегмент SelectButton (повторный клик снимает).
export const BOLD_OPTIONS = [{ value: 'bold' }]
