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
//    cell_value, у которого outer="animation-cell-{valueTag}" — рантайм
//    адресует его text-карточку по id, равному тегу).
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

/**
 * tms-поля ЯЧЕЙКИ для round-trip через `data-tms-meta` — ЕДИНЫЙ список для записи
 * (exporter) и чтения (projectLoader): забыть одну сторону при добавлении поля =
 * тихая потеря значения на round-trip'е.
 *
 *  • keep(v)   — писать ли поле в meta (exporter); отсекает дефолты (json чище).
 *  • flag      — писать как `true`, а не значение (булевы флаги locked/flipH/flipV).
 *  • clone     — при чтении копировать объект `{ ...v }` (slots не шарить с meta).
 *
 * `angle` НЕ здесь: пишется в meta, но читается в `cellJson.angle` (JointJS-поле),
 * а не в tms — обрабатывается отдельно.
 */
export const CELL_META_FIELDS = [
  { key: 'slots', keep: Boolean, clone: true },
  { key: 'text', keep: (v) => v !== undefined },
  { key: 'fontSize', keep: (v) => v !== undefined },
  { key: 'bold', keep: (v) => v !== undefined },
  { key: 'color', keep: (v) => v !== undefined },
  // 'left' — дефолт (отсутствие = left), в meta не пишем.
  { key: 'align', keep: (v) => v !== undefined && v !== 'left' },
  { key: 'valueTag', keep: (v) => v !== undefined },
  { key: 'locked', keep: Boolean, flag: true },
  { key: 'flipH', keep: Boolean, flag: true },
  { key: 'flipV', keep: Boolean, flag: true },
  { key: 'groupId', keep: Boolean },
  { key: 'voltageSource', keep: Boolean },
  { key: 'switchSources', keep: Boolean },
  { key: 'navigation', keep: Boolean },
]

/**
 * tms-поля ПРОВОДА для round-trip — тот же принцип, что CELL_META_FIELDS (единый
 * список для exporter и projectLoader). Дефолты стиля (толщина 2 / цвет #000) в
 * meta не пишем: `keep` их отсекает, при чтении отсутствие = дефолт из LINK_DEFAULTS.
 *
 *  • attr — имя JointJS-attr в `attrs.line` (стиль применяется к отрисовке, а не
 *    только хранится в tms). Поля без attr — только данные (voltage/switch).
 *
 * `vertices` НЕ здесь: это поле верхнего уровня линка (не tms), пишется/читается
 * отдельно — как `angle`/`z` у ячейки.
 */
export const LINK_META_FIELDS = [
  { key: 'voltageSource', keep: Boolean },
  { key: 'switchSources', keep: Boolean },
  { key: 'strokeWidth', keep: Boolean, attr: 'strokeWidth' },
  { key: 'strokeColor', keep: Boolean, attr: 'stroke' },
]

// ─── ID-генераторы ──────────────────────────────────────────────────────────

/** Outer-key карточки ячейки. cell_value — конвенция `animation-cell-{tag}`. */
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
