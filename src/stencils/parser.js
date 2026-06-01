/**
 * Stencil parser & generator
 * ──────────────────────────
 *
 * Принимает определение стенсила (JSON) + контекст ячейки (cellId + slots) и
 * производит:
 *   • объект карточек для animations.json
 *   • SVG-разметку с проставленными финальными id
 *
 * Подстановка переменных в bindings:
 *   `{slot.KEY}` — заменяется на значение пользовательского тега из ячейки
 *   (tms.slots[KEY]). Если слот не выбран — биндинг пропускается (см. ниже).
 *
 * Формат стенсила (упрощённо):
 *
 *   {
 *     "id":          "cell_vk",                // уникальный в реестре
 *     "label":       "Выключатель",            // для палитры
 *     "category":    "Коммутация",
 *
 *     // slots — пользовательски-биндимые теги
 *     "slots": [
 *       {
 *         "key":      "onoff",
 *         "label":    "Состояние ВКЛ/ВЫКЛ",
 *         "type":     "Boolean",       // фильтр в tag-picker'е (опционально)
 *         "required": true              // подсветить как обязательный
 *       }
 *     ],
 *
 *     // shapeFile + размеры + порты — для SVG-редактора
 *     "shapeFile":   "shape.svg",
 *     "width":       20,
 *     "height":      20,
 *     "ports":       [{ "name": "top", "x": 10, "y": 0, "type": "io" }, ...],
 *
 *     // animationTemplate — список карточек с подстановкой через {slot.KEY}
 *     "animationTemplate": [
 *       {
 *         "idSuffix":   ".VK",                // финальный id = "animation-{cellId}{idSuffix}"
 *         "type":       "shape",
 *         "bindings":   [{ "tag": "{slot.onoff}", ... }]
 *       }
 *     ]
 *   }
 *
 * SVG-разметка (shape.svg) — обычный SVG, в котором элементы для анимации
 * помечены атрибутом data-anim-suffix:
 *
 *   <g data-anim-suffix="">              ← корень = idSuffix ""
 *     <text data-anim-suffix=".IA">--</text>  ← попадёт в id="animation-{cellId}.IA"
 *     ...
 *   </g>
 */

/**
 * Подставляет {slot.KEY}-переменные в строку. Если ключ отсутствует в slots —
 * возвращает null, чтобы caller мог отбросить такой биндинг.
 *
 *   interpolate('{slot.onoff}', {onoff: 'PS031.ONOFF'})  → 'PS031.ONOFF'
 *   interpolate('{slot.foo}', {})                        → null
 *   interpolate('static-id', {})                         → 'static-id'
 */
function interpolate(str, slots) {
  let resolved = true
  const result = str.replace(/\{slot\.(\w+)\}/g, (_, key) => {
    const v = slots?.[key]
    if (v === undefined || v === null || v === '') {
      resolved = false
      return ''
    }
    return String(v)
  })
  return resolved ? result : null
}

/**
 * Рекурсивная интерполяция всех строковых значений. Если в какой-то строке
 * есть {slot.X} без значения — возвращает null В ЭТОЙ СТРОКЕ, родитель решает
 * что с этим делать (см. generateAnimations — отбрасывает binding целиком).
 */
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

/**
 * Проверка: есть ли в дереве `node` хотя бы одна неразрешённая ссылка
 * (т.е. null после interpolateDeep'а). Если есть — биндинг нельзя оставить
 * в animations.json (рантайм поймает «обращение к пустому тегу»).
 */
function hasUnresolved(node) {
  if (node === null) return true
  if (Array.isArray(node)) return node.some(hasUnresolved)
  if (node && typeof node === 'object') {
    return Object.values(node).some(hasUnresolved)
  }
  return false
}

/**
 * Из шаблона стенсила и слотов ячейки строит карточки animations.json.
 * Карточки/биндинги с неразрешёнными {slot.X} (юзер не выбрал тег) — отбрасываются.
 *
 * @param {object} stencil — определение стенсила (из stencil.json)
 * @param {string} cellId  — id ячейки на холсте, основа SVG-id ('animation-{cellId}.X')
 * @param {object} slots   — карта slot.key → выбранный тег (из tms.slots)
 * @returns {Object<string, object>} карточки в формате { 'animation-CELLID[.suffix]': cardConfig }
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
    // Если все биндинги отвалились по неразрешённым слотам — карточку
    // тоже не эмитим: пустой bindings[] в рантайме бессмыслен.
    if (bindings.length === 0) continue

    const finalId = `animation-${cellId}${tpl.idSuffix || ''}`
    const card = { animation: tpl.type, bindings }
    if (tpl.detailTags) {
      const dt = interpolateDeep(tpl.detailTags, slots)
      if (!hasUnresolved(dt)) card.detailTags = dt
    }
    if (tpl.navigation) {
      const nav = interpolate(tpl.navigation, slots)
      if (nav !== null) card.navigation = nav
    }
    result[finalId] = card
  }
  return result
}

/**
 * Заменяет data-anim-suffix="..." на id="animation-{cellId}{suffix}" в SVG.
 * Атрибут data-anim-suffix удаляется — итоговый SVG чист и готов к использованию
 * в WebScada-рантайме / Inkscape.
 *
 * @param {string} svgText — содержимое shape.svg
 * @param {string} cellId  — id ячейки, основа для финальных SVG-id'шников
 * @returns {string} новая SVG-разметка
 */
function injectIds(svgText, cellId) {
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
    el.setAttribute('id', `animation-${cellId}${suffix}`)
    el.removeAttribute('data-anim-suffix')
  }

  return new XMLSerializer().serializeToString(root)
}

/**
 * Полная инстанциация стенсила. Вернёт и карточки для animations.json, и
 * финальный SVG с проставленными id'шниками.
 *
 * @param {object} stencil — определение стенсила из реестра
 * @param {string} cellId  — id ячейки на холсте (основа для animation-id'ов)
 * @param {object} [slots] — карта slot.key → tag из tms.slots (по умолчанию {})
 */
export function instantiate(stencil, cellId, slots = {}) {
  return {
    animations: generateAnimations(stencil, cellId, slots),
    svg: stencil.svgText ? injectIds(stencil.svgText, cellId) : null,
  }
}
