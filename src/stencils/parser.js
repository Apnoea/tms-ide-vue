/**
 * Stencil parser & generator
 * ──────────────────────────
 *
 * Принимает определение стенсила (JSON) + prefix логического объекта и
 * производит:
 *   • объект карточек для animations.json
 *   • SVG-разметку с проставленными финальными id
 *
 * Подстановка переменных: в строках шаблона `{prefix}` заменяется на значение
 * переменной (рекурсивно по всему JSON). Сейчас единственная переменная — prefix
 * (идентификатор логического объекта, напр. `PS031VK001`).
 *
 * Формат стенсила (упрощённо):
 *
 *   {
 *     "id":          "cell_vk",                // уникальный в реестре
 *     "label":       "Выключатель",            // для палитры
 *     "category":    "Коммутация",
 *     "version":     "0.1.0",
 *
 *     // tagPattern + tagSuffixes — нужны для UI выбора объекта при drop'е
 *     "tagPattern":  "^PS\\d+\\w+\\d+$",       // regex, матчит префикс из tag-list
 *     "tagSuffixes": [
 *       { "suffix": ".ONOFF", "type": "Boolean", "required": true }
 *     ],
 *
 *     // shapeFile + размеры + порты — для SVG-редактора
 *     "shapeFile":   "shape.svg",
 *     "width":       40,
 *     "height":      40,
 *     "ports":       [{ "name": "top", "x": 20, "y": 0, "type": "io" }, ...],
 *
 *     // animationTemplate — список карточек, подстановка через {prefix}
 *     "animationTemplate": [
 *       {
 *         "idSuffix":   ".VK",                // финальный id = "animation-{prefix}{idSuffix}"
 *         "type":       "shape",
 *         "bindings":   [{ "tag": "{prefix}.ONOFF", ... }]
 *       }
 *     ]
 *   }
 *
 * SVG-разметка (shape.svg) — обычный SVG, в котором элементы для анимации
 * помечены атрибутом data-anim-suffix:
 *
 *   <g data-anim-suffix="">              ← корень = idSuffix ""
 *     <text data-anim-suffix=".IA">--</text>  ← попадёт в id="animation-{prefix}.IA"
 *     ...
 *   </g>
 */

/**
 * Подставляет переменные в строку: `{prefix}.ONOFF` + {prefix: 'PS031VK001'} → 'PS031VK001.ONOFF'
 */
function interpolate(str, vars) {
  return str.replace(/\{(\w+)\}/g, (_, key) =>
    vars[key] !== undefined ? String(vars[key]) : `{${key}}`
  )
}

/**
 * Рекурсивная интерполяция всех строковых значений в произвольной структуре
 * (объекты, массивы, строки, примитивы).
 */
function interpolateDeep(node, vars) {
  if (typeof node === 'string') return interpolate(node, vars)
  if (Array.isArray(node)) return node.map(item => interpolateDeep(item, vars))
  if (node && typeof node === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(node)) {
      out[k] = interpolateDeep(v, vars)
    }
    return out
  }
  return node
}

/**
 * Из шаблона стенсила и prefix логического объекта строит карточки animations.json.
 *
 * @param {object} stencil — определение стенсила (из stencil.json)
 * @param {string} prefix  — идентификатор логического объекта, напр. 'PS031VK001'
 * @returns {Object<string, object>} карточки в формате { 'animation-PREFIX[.suffix]': cardConfig }
 */
function generateAnimations(stencil, prefix) {
  if (!stencil?.animationTemplate) return {}

  const result = {}
  for (const tpl of stencil.animationTemplate) {
    const finalId = `animation-${prefix}${tpl.idSuffix || ''}`
    const card = {
      animation: tpl.type,
      bindings: interpolateDeep(tpl.bindings ?? [], { prefix }),
    }
    if (tpl.detailTags) {
      card.detailTags = interpolateDeep(tpl.detailTags, { prefix })
    }
    if (tpl.navigation) {
      card.navigation = interpolate(tpl.navigation, { prefix })
    }
    result[finalId] = card
  }
  return result
}

/**
 * Заменяет data-anim-suffix="..." на id="animation-{prefix}{suffix}" в SVG-разметке.
 * Атрибут data-anim-suffix удаляется — итоговый SVG чист и готов к использованию
 * в WebScada-рантайме / Inkscape.
 *
 * @param {string} svgText — содержимое shape.svg
 * @param {string} prefix  — идентификатор логического объекта
 * @returns {string} новая SVG-разметка
 */
function injectIds(svgText, prefix) {
  if (typeof DOMParser === 'undefined') {
    throw new Error('injectIds: DOMParser недоступен (среда — не браузер?)')
  }
  const parser = new DOMParser()
  const doc = parser.parseFromString(svgText, 'image/svg+xml')

  const root = doc.documentElement
  if (root.nodeName === 'parsererror' || doc.getElementsByTagName('parsererror').length) {
    throw new Error('injectIds: не удалось распарсить shape.svg')
  }

  const els = doc.querySelectorAll('[data-anim-suffix]')
  for (const el of els) {
    const suffix = el.getAttribute('data-anim-suffix') || ''
    el.setAttribute('id', `animation-${prefix}${suffix}`)
    el.removeAttribute('data-anim-suffix')
  }

  return new XMLSerializer().serializeToString(root)
}

/**
 * Полная инстанциация стенсила: вернёт и список карточек для animations.json,
 * и финальный SVG. Удобно вызывать одной функцией при drop'е стенсила на холст.
 */
export function instantiate(stencil, prefix) {
  return {
    animations: generateAnimations(stencil, prefix),
    svg: stencil.svgText ? injectIds(stencil.svgText, prefix) : null,
  }
}
