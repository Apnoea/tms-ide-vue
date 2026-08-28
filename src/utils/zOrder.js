/**
 * Планировщик z-порядка одного слоя: список переставляется и значения раздаются
 * заново (не арифметика над z) — слой остаётся компактным, а команда на границе
 * полосы возвращает пустой план.
 *
 * Полосы слоёв разведены: символы — `[0, ∞)`, провода — `[LINK_Z, LINK_Z_TOP]`
 * (linkDefaults), подложка — ниже проводов (только разметка).
 */

/** Полоса символов: дно 0 — ниже провода, у них своя полоса в минусах. */
export const ELEMENT_Z_BOUNDS = { min: 0, max: Infinity }

/**
 * Полоса подложки: фигура-разметка может уйти НИЖЕ проводов (плашка/зона под
 * схемой) — символы и провода туда не попадают.
 */
export const BACKGROUND_Z_BOUNDS = { min: -2000, max: -1900 }

/**
 * Порог «это подложка» — с зазором до дна полосы проводов (`LINK_Z` = -1000):
 * перенос между слоями ставит промежуточные значения, и они обязаны читаться как
 * подложка до перенумерации.
 */
export const BACKGROUND_Z_TOP = -1100

export const isBackgroundZ = (z) => Number.isFinite(z) && z <= BACKGROUND_Z_TOP

/**
 * Новый порядок id: выделенные двигаются как целое, их взаимный порядок цел. Тем же
 * порядком живут фигуры редактора символов, где z нет — слой задаёт позиция в массиве.
 */
export function reorderIds(ids, targetIds, mode) {
  const set = new Set(targetIds)
  // 'keep' — только перенумерация слоя в текущем порядке (фигуру уже переставили
  // между слоями, двигать её вторым шагом нельзя).
  if (mode === 'keep') return [...ids]
  if (mode === 'front') return [...ids.filter((i) => !set.has(i)), ...ids.filter((i) => set.has(i))]
  if (mode === 'back') return [...ids.filter((i) => set.has(i)), ...ids.filter((i) => !set.has(i))]
  const out = [...ids]
  if (mode === 'forward') {
    // С конца: иначе группа уехала бы на две позиции вместо одной.
    for (let i = out.length - 2; i >= 0; i--) {
      if (set.has(out[i]) && !set.has(out[i + 1])) [out[i], out[i + 1]] = [out[i + 1], out[i]]
    }
    return out
  }
  for (let i = 1; i < out.length; i++) {
    if (set.has(out[i]) && !set.has(out[i - 1])) [out[i], out[i - 1]] = [out[i - 1], out[i]]
  }
  return out
}

/**
 * План новых z для одного слоя.
 *
 * @param {{id: string|number, z: number}[]} items — слой В ТЕКУЩЕМ порядке
 *   (коллекция графа уже отсортирована по z)
 * @param {(string|number)[]} targetIds — что двигаем
 * @param {'front'|'back'|'forward'|'backward'} mode
 * @param {{min: number, max: number}} bounds — полоса слоя
 * @returns {{id: string|number, z: number}[]} только те, у кого z меняется
 */
export function planZOrder(items, targetIds, mode, bounds) {
  const ids = items.map((i) => i.id)
  const targets = targetIds.filter((id) => ids.includes(id))
  if (!targets.length) return []
  const order = reorderIds(ids, targets, mode)
  const { min, max } = bounds
  const span = max - min
  const n = order.length
  // Не помещаемся в полосу целыми — дробим равномерно: два элемента на одном z
  // отдали бы порядок очерёдности вставки.
  const step = Number.isFinite(span) && n - 1 > span ? span / (n - 1) : 1
  const before = new Map(items.map((i) => [i.id, i.z]))
  const plan = []
  order.forEach((id, i) => {
    const z = min + i * step
    if (before.get(id) !== z) plan.push({ id, z })
  })
  return plan
}
