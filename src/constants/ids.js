// DOM/JSON-контракт с WebScada-рантаймом и round-trip'ом editor↔export: строки,
// обязанные совпадать байт-в-байт у exporter / parser / svgInjector /
// useSimulation / projectLoader, живут ТОЛЬКО здесь — правка ломает уже
// выпущенные view.svg. Цвета анимаций — в constants/animation.js.
//
//  • ячейка:          animation-<stencilId>-<animId>[<suffix из data-anim-suffix>]
//  • cell_value:      animation-cell-<valueTag> (outer) + animation-<valueTag>
//    (text-узел) — рантайм адресует text-карточку по id, равному тегу
//  • провод:          animation-wire-<shortId>

import { LEGACY_RANGE_KEY, LEGACY_BOOL_KEY } from '../services/legacyFormat'

// Без export: наружу торчат только key-билдеры ниже.
const ANIM_PREFIX = 'animation-'
const WIRE_PREFIX = 'animation-wire-'
const CELL_VALUE_PREFIX = 'animation-cell-'

// ─── Data-атрибуты (round-trip / контракт editor'а) ─────────────────────────

export const ATTR_META = 'data-tms-meta'
export const ATTR_STENCIL = 'data-tms-stencil'
export const ATTR_SUFFIX = 'data-anim-suffix'

/**
 * Допустимый id стенсила. Не косметика: id уезжает в `data-tms-stencil` и в
 * CSS-селектор внутри `<![CDATA[…]]>` экспорта, а стенсилы приходят из чужого
 * .zip — кавычка или `]]>` в id сломала бы стиль или дала инъекцию. Реестр
 * отсекает нарушителей (см. stencils/registry), поэтому дальше по конвейеру id
 * безопасен по инварианту.
 */
export const STENCIL_ID_RE = /^[a-z0-9_]+$/

/**
 * tms-поля ЯЧЕЙКИ для round-trip через `data-tms-meta` — единый список для записи
 * (exporter) и чтения (projectLoader): забыть одну сторону = тихая потеря поля.
 *
 *  • keep(v)   — писать ли в meta (отсекает дефолты)
 *  • flag      — писать `true` вместо значения
 *  • clone     — при чтении копировать объект (не шарить с meta)
 *  • legacyKey — прежнее имя поля в архивах: читаем как fallback, пишем только
 *                новое (см. services/legacyFormat — слой снимается целиком)
 *
 * `angle`/`z` не здесь: это поля верхнего уровня JointJS, а не tms.
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
  // Выбранная пара «подпись + единица» cell_value. Пустые не пишем: отсутствие =
  // «взять пресет стенсила по суффиксу тега» (см. resolveValueDisplay).
  { key: 'valueLabel', keep: Boolean },
  { key: 'valueUnit', keep: Boolean },
  { key: 'locked', keep: Boolean, flag: true },
  { key: 'flipH', keep: Boolean, flag: true },
  { key: 'flipV', keep: Boolean, flag: true },
  { key: 'groupId', keep: Boolean },
  { key: 'rangeSource', keep: Boolean, legacyKey: LEGACY_RANGE_KEY },
  { key: 'boolSource', keep: Boolean, legacyKey: LEGACY_BOOL_KEY },
  { key: 'navigation', keep: Boolean },
]

/**
 * То же для ПРОВОДА. Дефолты стиля (2 / #000) в meta не пишем — отсутствие при
 * чтении = дефолт из LINK_DEFAULTS. `attr` — имя поля в `attrs.line` (стиль надо
 * не только хранить в tms, но и отдать JointJS на отрисовку). `vertices` не здесь
 * — поле верхнего уровня линка.
 */
export const LINK_META_FIELDS = [
  { key: 'rangeSource', keep: Boolean, legacyKey: LEGACY_RANGE_KEY },
  { key: 'boolSource', keep: Boolean, legacyKey: LEGACY_BOOL_KEY },
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
 * Тот же id для UI-превью (инспектор / hover-плашка), но animId без разрешения
 * коллизий (его делает exporter.uniqueShortId). Один источник — превью и экспорт
 * не разъезжаются.
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

// Единая регулярка `{slot.X}` для parser (экспорт) и useSimulation (превью) —
// иначе разошлись бы по поведению. Работает и inline: "PRE{slot.x}POST".
const SLOT_PLACEHOLDER_RE = /\{slot\.(\w+)\}/g

/**
 * Подставляет все `{slot.X}`. Пустой (undefined/null/'') слот → `hadUnresolved`,
 * решение за вызывающим: parser отбрасывает binding, simulation — тег.
 */
export function resolveSlotTemplate(template, slots) {
  let hadUnresolved = false
  // Свежая регулярка на вызов: у глобального literal'а живёт lastIndex.
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
