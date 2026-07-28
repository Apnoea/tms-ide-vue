/**
 * Стенсил + контекст ячейки (cellId + slots) → карточки animations.json и SVG с
 * финальными id (из `data-anim-suffix`, см. constants/ids).
 *
 * Слот без выбранного тега (`{slot.KEY}` не разрешился) убивает биндинг, а пустой
 * биндинг-лист — всю карточку: рантайм на пустом теге ругается, а «нет тега = нет
 * анимации = статика» — штатный сценарий (юзер ещё не привязал).
 */

import { innerKey, resolveSlotTemplate, ATTR_SUFFIX } from '../constants/ids'

/** `{slot.KEY}` → тег из slots; неразрешённый слот → null. */
function interpolate(str, slots) {
  const { value, hadUnresolved } = resolveSlotTemplate(str, slots)
  return hadUnresolved ? null : value
}

/** Интерполяция дерева: неразрешённая строка становится null, решает родитель. */
function interpolateDeep(node, slots) {
  if (typeof node === 'string') return interpolate(node, slots)
  if (Array.isArray(node)) {
    return node.map((item) => interpolateDeep(item, slots))
  }
  if (node && typeof node === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(node)) out[k] = interpolateDeep(v, slots)
    return out
  }
  return node
}

/** Есть ли в дереве null после interpolateDeep — т.е. неразрешённый слот. */
function hasUnresolved(node) {
  if (node === null) return true
  if (Array.isArray(node)) return node.some(hasUnresolved)
  if (node && typeof node === 'object') {
    return Object.values(node).some(hasUnresolved)
  }
  return false
}

/**
 * Шаблон стенсила + слоты ячейки → карточки `{ animation-<stencilId>-<cellId>[.suffix]: card }`.
 *
 * @param {object} stencil
 * @param {string} cellId
 * @param {object} slots — slot.key → тег (из tms.slots)
 */
function generateAnimations(stencil, cellId, slots) {
  if (!stencil?.animationTemplate) return {}

  const result = {}
  for (const tpl of stencil.animationTemplate) {
    const bindings = []
    for (const binding of tpl.bindings || []) {
      const resolved = interpolateDeep(binding, slots)
      if (!hasUnresolved(resolved)) bindings.push(resolved)
    }
    if (bindings.length === 0) continue // все слоты пустые → карточки нет

    const finalId = innerKey(stencil.id, cellId, tpl.idSuffix)
    const card = { animation: tpl.type, bindings }
    if (tpl.detailTags) {
      const dt = interpolateDeep(tpl.detailTags, slots)
      if (!hasUnresolved(dt)) card.detailTags = dt
    }
    result[finalId] = card
  }
  return result
}

/**
 * `data-anim-suffix` → финальный `id` (атрибут снимается: экспортный SVG чист).
 *
 * @param {string} svgText — содержимое shape.svg
 * @param {string} cellId — короткий id ячейки
 * @param {string} stencilId
 */
function injectIds(svgText, cellId, stencilId) {
  if (typeof DOMParser === 'undefined') {
    throw new Error('injectIds: DOMParser недоступен (среда — не браузер?)')
  }
  const parser = new DOMParser()
  const doc = parser.parseFromString(svgText, 'image/svg+xml')

  const root = doc.documentElement
  if (root.nodeName === 'parsererror' || doc.getElementsByTagName('parsererror').length) {
    throw new Error('injectIds: не удалось распарсить shape.svg')
  }

  const els = doc.querySelectorAll(`[${ATTR_SUFFIX}]`)
  for (const el of els) {
    const suffix = el.getAttribute(ATTR_SUFFIX) || ''
    el.setAttribute('id', innerKey(stencilId, cellId, suffix))
    el.removeAttribute(ATTR_SUFFIX)
  }

  return new XMLSerializer().serializeToString(root)
}

/** Карточки animations.json + SVG с проставленными id. */
export function instantiate(stencil, cellId, slots = {}) {
  return {
    animations: generateAnimations(stencil, cellId, slots),
    svg: stencil.svgText ? injectIds(stencil.svgText, cellId, stencil.id) : null,
  }
}
