// Wire-protocol контракт с WebScada-рантаймом и editor↔export round-trip'ом.
// Все строки, которые ОБЯЗАНЫ совпадать байт-в-байт между exporter / parser /
// svgInjector / useSimulation / projectLoader — собираются ТОЛЬКО здесь.
//
// Менять что-либо отсюда = breaking change для всех уже выпущенных view.svg.
// Цвета анимаций живут в `constants/animation.js` (UI ↔ visual contract);
// этот файл — DOM/JSON contract.
//
// Конвенции:
//  • Outer-wrapper ячейки   — id="animation-{stencilId}-{animId}" (кроме
//    cell_value, у которого outer="animation-cell-{valueTag}" — историческая
//    рантайм-конвенция).
//  • Inner анимируемый узел — id="animation-{stencilId}-{animId}{suffix}",
//    где suffix приходит из `data-anim-suffix` в shape.svg.
//  • Провод                  — id="animation-wire-{shortId}".
//  • cell_value text-узел    — id="animation-{valueTag}" (рантайм находит
//    text-карточку по id равному тегу).

// ─── Префиксы ───────────────────────────────────────────────────────────────

// Префиксы — без export: наружу торчат только key-билдеры ниже (outerKey /
// innerPrefix / wireKey / valueTextKey), сами префиксы используются лишь тут.
const ANIM_PREFIX = 'animation-'
const WIRE_PREFIX = 'animation-wire-'
const CELL_VALUE_PREFIX = 'animation-cell-'

// ─── Data-атрибуты (round-trip / контракт editor'а) ─────────────────────────

export const ATTR_META = 'data-tms-meta'
export const ATTR_STENCIL = 'data-tms-stencil'
export const ATTR_SUFFIX = 'data-anim-suffix'

// ─── ID-генераторы ──────────────────────────────────────────────────────────

/** Outer-key карточки ячейки. cell_value — историческая `animation-cell-{tag}`-конвенция. */
export function outerKey(stencilId, animId) {
  if (stencilId === 'cell_value') return `${CELL_VALUE_PREFIX}${animId}`
  return `${ANIM_PREFIX}${stencilId}-${animId}`
}

/**
 * Outer-key для UI-превью (Inspector / hover-tooltip): тот же id, что эмитит
 * exporter, но animId упрощён — первый сегмент UUID без коллизийного расширения
 * (`exporter.uniqueShortId` добавляет его при совпадении префиксов). cell_value
 * использует сам valueTag. Один источник, чтобы превью и экспорт не разъехались.
 */
export function previewOuterKey(stencilId, cellId, valueTag) {
  const animId = stencilId === 'cell_value' && valueTag ? valueTag : String(cellId).split('-')[0]
  return outerKey(stencilId, animId)
}

/** Inner-key стенсильной карточки (outer + suffix из data-anim-suffix). */
export function innerKey(stencilId, animId, suffix) {
  return `${outerKey(stencilId, animId)}${suffix || ''}`
}

/** Префикс для startsWith()-проверок над inner-картами (exporter merge/quality). */
export function innerPrefix(stencilId, animId) {
  if (stencilId === 'cell_value') return `${ANIM_PREFIX}${animId}.`
  return `${ANIM_PREFIX}${stencilId}-${animId}.`
}

/** Wire-card key. */
export function wireKey(shortId) {
  return `${WIRE_PREFIX}${shortId}`
}

/** Key text-узла cell_value (по полному valueTag без укорачивания). */
export function valueTextKey(valueTag) {
  return `${ANIM_PREFIX}${valueTag}`
}

// ─── Slot-template резолвер ─────────────────────────────────────────────────

/**
 * `{slot.X}` в строках binding.tag / detailTags / navigation. Единая регулярка
 * + единая семантика подстановки, чтобы parser (экспорт) и useSimulation
 * (превью) не разошлись по поведению. Поддержана inline-подстановка
 * ("PRE{slot.x}POST"), не только чистый placeholder.
 */
const SLOT_PLACEHOLDER_RE = /\{slot\.(\w+)\}/g

/**
 * Подставляет ВСЕ `{slot.X}` в строке через значения из `slots`. Если хотя бы
 * один X отсутствует (`undefined` / `null` / `''`), `hadUnresolved=true`;
 * caller сам решает что делать (parser отбрасывает binding, simulation тег).
 *
 *   resolveSlotTemplate('{slot.onoff}', { onoff: 'X.Y' })
 *     → { value: 'X.Y',          hadUnresolved: false }
 *   resolveSlotTemplate('PRE{slot.x}POST', { x: 'Y' })
 *     → { value: 'PREYPOST',     hadUnresolved: false }
 *   resolveSlotTemplate('{slot.foo}', {})
 *     → { value: '',             hadUnresolved: true }
 *   resolveSlotTemplate('static.tag', {})
 *     → { value: 'static.tag',   hadUnresolved: false }
 */
export function resolveSlotTemplate(template, slots) {
  let hadUnresolved = false
  // .replace с lastIndex'ом регекспа — поэтому каждый вызов делаем «свежий»
  // через .source/.flags, чтобы не зависеть от состояния глобального literal'а.
  const re = new RegExp(SLOT_PLACEHOLDER_RE.source, SLOT_PLACEHOLDER_RE.flags)
  const value = String(template).replace(re, (_, key) => {
    const v = slots?.[key]
    if (v === undefined || v === null || v === '') {
      hadUnresolved = true
      return ''
    }
    return String(v)
  })
  return { value, hadUnresolved }
}

/**
 * Проверка: содержит ли строка хотя бы один `{slot.X}` placeholder (любой).
 * Для info-tooltip'ов в Inspector — «есть ли в шаблоне ссылка на этот слот».
 */
export function hasSlotPlaceholder(str, slotKey) {
  return typeof str === 'string' && str.includes(`{slot.${slotKey}}`)
}
