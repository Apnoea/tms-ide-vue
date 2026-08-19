// DOM/JSON-контракт с WebScada-рантаймом и round-trip'ом editor↔export: строки,
// обязанные совпадать байт-в-байт у exporter / parser / svgInjector /
// useSimulation / projectLoader, живут ТОЛЬКО здесь — правка ломает уже
// выпущенные view.svg. Цвета анимаций — в constants/animation.js.
//
//  • ячейка:          animation-<stencilId>-<animId>[<suffix из data-anim-suffix>]
//  • cell_value:      animation-cell-<valueTag> (outer) + animation-<valueTag>
//    (text-узел) — рантайм адресует text-карточку по id, равному тегу
//  • провод:          animation-wire-<shortId>

import { SVG_FONT, normalizeFont } from '../utils/textMetrics'
import { cssColor, rangeRowColor } from './animation'

/**
 * Санитайзеры значений meta. `normalize` в дескрипторе применяется на ОБОИХ концах
 * round-trip'а, поэтому мусор из чужого архива не попадает ни в модель, ни в
 * экспорт: `fontSize: "huge"` ломал замер габарита, `decimals: 500` — валил
 * `toFixed` в рантайме (допустимо 0..100), нечисловой порог уезжал в карточку.
 */
const clampNumber = (min, max, fallback) => (v) => {
  const n = typeof v === 'number' ? v : Number.parseFloat(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}
const oneOf = (values, fallback) => (v) => (values.includes(v) ? v : fallback)
/**
 * Границы диапазонов и точные значения приводим к числам; нечисловое = «порога нет»
 * (строка из чужого архива уехала бы в карточку как есть и сломала сравнение).
 */
const normalizeRangeSource = (v) => {
  if (!v || typeof v !== 'object') return v
  if (!Array.isArray(v.ranges)) return v
  const bound = (x) => {
    const n = typeof x === 'number' ? x : Number.parseFloat(x)
    return Number.isFinite(n) ? n : undefined
  }
  return {
    ...v,
    ranges: v.ranges.map((r) => {
      const out = { ...r }
      // Цвет строки: своё значение либо прежний class-имя (архив до пикера цвета) —
      // class после конверсии не держим, чтобы в модели было одно поле.
      const color = rangeRowColor(out)
      delete out.class
      if (color) out.color = color
      else delete out.color
      out.min = bound(out.min)
      out.max = bound(out.max)
      return out
    }),
  }
}

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
 * Тег в роли id: whitespace → `_`. Нужно только cell_value — у него id узла равен
 * тегу (рантайм-конвенция, поиск через `getElementById`), а id по стандарту не
 * может содержать пробелов: с пробелом узел не находится и карточка навсегда с
 * прочерком. Тег внутри `bindings[].tag` остаётся ИСХОДНЫМ — подписка идёт на
 * реальный сигнал, переименовывается только адрес узла в DOM.
 */
export function idSafeTag(tag) {
  return String(tag).replace(/\s+/g, '_')
}

/**
 * tms-поля ЯЧЕЙКИ для round-trip через `data-tms-meta` — единый список для записи
 * (exporter) и чтения (projectLoader): забыть одну сторону = тихая потеря поля.
 *
 *  • keep(v)   — писать ли в meta (отсекает дефолты)
 *  • flag      — писать `true` вместо значения
 *  • clone     — при чтении копировать объект (не шарить с meta)
 *
 * `angle`/`z` не здесь: это поля верхнего уровня JointJS, а не tms.
 */
export const CELL_META_FIELDS = [
  { key: 'slots', keep: Boolean, clone: true },
  { key: 'text', keep: (v) => v !== undefined },
  { key: 'fontSize', keep: (v) => v !== undefined, normalize: clampNumber(1, 400, undefined) },
  { key: 'bold', keep: (v) => v !== undefined },
  // Цвет подписи и тела шины. Уезжает в атрибут `fill` экспортного SVG, а архив
  // чужой — мусор отбрасываем целиком (поля нет = дефолтный цвет).
  { key: 'color', keep: (v) => v !== undefined, normalize: (v) => cssColor(v) || undefined },
  // Диаметр точки соединения. Дефолт не пишем — отсутствие поля и есть он.
  { key: 'dotSize', keep: (v) => v !== undefined, normalize: clampNumber(2, 20, undefined) },
  // Шрифт cell_text. `normalize` гоняет значение через whitelist на обоих концах
  // round-trip'а. Дефолт (SVG_FONT) не пишем — отсутствие = он же.
  { key: 'fontFamily', keep: (v) => v !== undefined && v !== SVG_FONT, normalize: normalizeFont },
  // 'left' — дефолт (отсутствие = left), в meta не пишем.
  {
    key: 'align',
    keep: (v) => v !== undefined && v !== 'left',
    normalize: oneOf(['left', 'center', 'right'], undefined),
  },
  { key: 'valueTag', keep: (v) => v !== undefined },
  // Подпись и единица cell_value — вписывает автор. Пустые не пишем.
  { key: 'valueLabel', keep: Boolean },
  { key: 'valueUnit', keep: Boolean },
  // Знаков после запятой у cell_value. Пустое = дефолт (VALUE_DECIMALS_DEFAULT).
  { key: 'decimals', keep: (v) => Number.isFinite(v), normalize: clampNumber(0, 20, undefined) },
  { key: 'locked', keep: Boolean, flag: true },
  { key: 'flipH', keep: Boolean, flag: true },
  { key: 'flipV', keep: Boolean, flag: true },
  { key: 'groupId', keep: Boolean },
  // Закрепление на шине: символ едет за ней при перемещении. Ссылку на исчезнувшую
  // ячейку загрузчик снимает — иначе символ был бы прикреплён к пустоте.
  { key: 'busId', keep: Boolean },
  { key: 'rangeSource', keep: Boolean, normalize: normalizeRangeSource },
  { key: 'boolSource', keep: Boolean },
  { key: 'navigation', keep: Boolean },
]

/**
 * То же для ПРОВОДА. Дефолты стиля (2 / #000) в meta не пишем — отсутствие при
 * чтении = дефолт из LINK_DEFAULTS. `attr` — имя поля в `attrs.line` (стиль надо
 * не только хранить в tms, но и отдать JointJS на отрисовку). `vertices` не здесь
 * — поле верхнего уровня линка.
 */
export const LINK_META_FIELDS = [
  { key: 'rangeSource', keep: Boolean, normalize: normalizeRangeSource },
  { key: 'boolSource', keep: Boolean },
  {
    key: 'strokeWidth',
    keep: Boolean,
    attr: 'strokeWidth',
    normalize: clampNumber(0.5, 40, undefined),
  },
  { key: 'strokeColor', keep: Boolean, attr: 'stroke' },
  // Наконечники на концах провода: `solid` — треугольник, `open` — две линии под 45°.
  // Смотрят В точку соединения. Без `attr`: маркер — объект, который зависит ещё и от
  // толщины/цвета линии, поэтому его собирает linkStyleAttrs.
  { key: 'arrowStart', keep: Boolean, normalize: oneOf(['solid', 'open'], undefined) },
  { key: 'arrowEnd', keep: Boolean, normalize: oneOf(['solid', 'open'], undefined) },
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
