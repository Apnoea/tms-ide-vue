/**
 * Символ + контекст ячейки (cellId + slots) → карточки animations.json и SVG с
 * финальными id (из `data-anim-suffix`, см. constants/ids).
 *
 * Слот без выбранного тега (`{slot.KEY}` не разрешился) убирает биндинг, а пустой
 * список биндингов — всю карточку: «нет тега = нет анимации = статика» — штатное
 * состояние, а рантайм на пустом теге ругается.
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
 * Шаблон символа + слоты ячейки → карточки `{ animation-<stencilId>-<cellId>[.suffix]: card }`.
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
 * Разобранный `shape.svg` — один на определение, дальше только клонируется (разбор XML
 * на каждый экземпляр стоил бы сотни парсов на форму).
 *
 * Ключ — сам объект символа: реестр на каждую правку кладёт НОВЫЙ объект, поэтому
 * WeakMap инвалидируется сам.
 */
const templateCache = new WeakMap()

function templateRoot(stencil) {
  if (!stencil?.svgText) return null
  const cached = templateCache.get(stencil)
  if (cached) return cached
  if (typeof DOMParser === 'undefined') {
    throw new Error('parser: DOMParser недоступен (среда — не браузер?)')
  }
  const doc = new DOMParser().parseFromString(stencil.svgText, 'image/svg+xml')
  const root = doc.documentElement
  if (root.nodeName === 'parsererror' || doc.getElementsByTagName('parsererror').length) {
    throw new Error(`parser: не удалось распарсить shape.svg символа "${stencil.id}"`)
  }
  templateCache.set(stencil, root)
  return root
}

/**
 * Клон разметки символа с проставленными id: `data-anim-suffix` → `id` (атрибут
 * снимается — экспортный SVG чист). Возвращается КОРНЕВОЙ `<svg>`-элемент клона;
 * вызывающий берёт его детей (в DOM холста или в сериализацию экспорта).
 *
 * Шаблон в кэше не мутируем — правки идут только по клону.
 */
function instantiateSvg(stencil, cellId) {
  const tpl = templateRoot(stencil)
  if (!tpl) return null
  const root = tpl.cloneNode(true)
  for (const el of root.querySelectorAll(`[${ATTR_SUFFIX}]`)) {
    el.setAttribute('id', innerKey(stencil.id, cellId, el.getAttribute(ATTR_SUFFIX) || ''))
    el.removeAttribute(ATTR_SUFFIX)
  }
  return root
}

/**
 * Карточки animations.json + разметка экземпляра.
 *
 * @returns {{ animations: object, root: Element|null }} `root` — корень клона
 *   разметки (null у символа без `shape.svg`: программные рисуются билдерами)
 */
export function instantiate(stencil, cellId, slots = {}) {
  return {
    animations: generateAnimations(stencil, cellId, slots),
    root: instantiateSvg(stencil, cellId),
  }
}
