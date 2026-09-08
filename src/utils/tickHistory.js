/**
 * История тиков симуляции: `{ ticks, index }` — наборы значений прошедших тиков и
 * позиция просмотра в них. Функции чистые (отдают новое состояние), сами значения
 * считает `useSimulation`.
 *
 * Шаг назад применяет сохранённый набор, поэтому картинка возвращается ровно та же;
 * шаг вперёд с конца истории требует нового тика (`needsNew`).
 */

export const EMPTY_TICKS = { ticks: [], index: -1 }

/** Набор текущей позиции — `null`, пока не было ни одного тика. */
export function currentTick(state) {
  return state?.ticks?.[state.index] ?? null
}

/** Новый тик последним шагом; за пределом глубины уходит самый старый. */
export function pushTick(state, values, max) {
  const ticks = [...(state?.ticks || []), values]
  if (ticks.length > max) ticks.splice(0, ticks.length - max)
  return { ticks, index: ticks.length - 1 }
}

/** Шаг назад; `null` — дальше некуда (первый тик или пустая история). */
export function backTick(state) {
  if (!state || state.index <= 0) return null
  return { ticks: state.ticks, index: state.index - 1 }
}

/** Шаг вперёд по истории; с её конца — `needsNew`, набор придётся сгенерировать. */
export function forwardTick(state) {
  const last = (state?.ticks?.length || 0) - 1
  if (!state || state.index >= last) return { state, needsNew: true }
  return { state: { ticks: state.ticks, index: state.index + 1 }, needsNew: false }
}

/** Обрезать всё после текущей позиции: дальше прогон идёт от неё. */
export function truncateAfterCurrent(state) {
  if (!state || state.index >= state.ticks.length - 1) return state
  return { ticks: state.ticks.slice(0, state.index + 1), index: state.index }
}

/** Заменить набор текущей позиции — новым шагом правка не становится. */
export function replaceCurrentTick(state, values) {
  if (!state || state.index < 0) return state
  const ticks = [...state.ticks]
  ticks[state.index] = values
  return { ticks, index: state.index }
}
