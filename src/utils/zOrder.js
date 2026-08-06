/**
 * Планировщик z-порядка одного слоя: переставляем список и раздаём значения
 * заново, а не считаем арифметику над z — так слой остаётся компактным, а
 * команда на границе полосы честно ничего не делает.
 *
 * Полосы разведены, чтобы порядок внутри слоя не перемешал слои: символы —
 * `[0, ∞)`, провода — `[LINK_Z, LINK_Z_TOP]` (см. linkDefaults).
 */

/** Полоса символов: дно 0 — ниже провода, у них своя полоса в минусах. */
export const ELEMENT_Z_BOUNDS = { min: 0, max: Infinity }

/** Новый порядок id: выделенные двигаются как целое, их взаимный порядок цел. */
function reorderIds(ids, targetIds, mode) {
  const set = new Set(targetIds)
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
  // Не помещаемся в полосу целыми — дробим равномерно: лучше некруглые z, чем
  // два провода на одном уровне, где порядок решает очерёдность вставки.
  const step = Number.isFinite(span) && n - 1 > span ? span / (n - 1) : 1
  const before = new Map(items.map((i) => [i.id, i.z]))
  const plan = []
  order.forEach((id, i) => {
    const z = min + i * step
    if (before.get(id) !== z) plan.push({ id, z })
  })
  return plan
}
