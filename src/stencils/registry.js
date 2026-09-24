/**
 * Реестр символов: определения из `definitions/<id>/` (stencil.json + shape.svg)
 * подхватываются Vite-глобом — добавили папку, символ в палитре. Плюс
 * рантайм-регистрация (импорт бандла, редактор) и валидация json.
 */

import { ref } from 'vue'
import {
  ATTR_SUFFIX,
  BUS_STENCIL_ID,
  PRESET_VERSION_RE,
  RANGE_SLOT,
  STENCIL_ID_RE,
  isValidParamKey,
} from '../constants/ids'
import { isValidDomain } from '../constants/domains'
import { sanitizeSvgMarkup } from '../utils/sanitizeSvg'
import { normalizePresetPatch } from '../utils/presetPatch'

// Сам Map не реактивен, поэтому палитра читает этот счётчик в computed'ах —
// рантайм-регистрация обновляет список без перезагрузки.
export const registryVersion = ref(0)

const jsonModules = import.meta.glob('./definitions/*/stencil.json', {
  eager: true,
  import: 'default',
})

const svgModules = import.meta.glob('./definitions/*/shape.svg', {
  eager: true,
  query: '?raw',
  import: 'default',
})

/**
 * Schema-валидация stencil.json: опечатки в полях, пропуски required, битые слоты
 * и карточки. Загрузку НЕ блокирует — только предупреждения в console.
 *
 * @param {string} path — для префикса сообщений
 * @param {object} json
 * @param {string} [svgText] — для cross-check idSuffix ↔ data-anim-suffix
 * @returns {string[]}
 */
export function validateStencilJson(path, json, svgText) {
  const issues = []

  const required = ['id', 'label', 'category', 'width', 'height', 'shapeFile']
  for (const key of required) {
    if (json[key] === undefined || json[key] === null) {
      issues.push(`[stencils] ${path}: отсутствует поле "${key}"`)
    }
  }

  if (json.id != null && !STENCIL_ID_RE.test(String(json.id))) {
    issues.push(`[stencils] ${path}: id "${json.id}" вне маски [a-z0-9_] — символ не загружен`)
  }

  // Декларативные флаги (quality/static/noRotate) — источник правды о спец-поведении
  // символа: exporter, инспектор и холст читают их из json, Set'ов в коде нет.
  const known = new Set([
    'id',
    'label',
    'category',
    'width',
    'height',
    'minWidth',
    'shapeFile',
    'ports',
    'portSeq',
    'slots',
    'animationTemplate',
    'states',
    'stateColors',
    'ranges',
    'quality',
    'static',
    'noRotate',
    'noFlip',
    'defaults',
    'locked',
    'domains',
    'params',
    'preset',
    'presetPatch',
  ])
  for (const key of Object.keys(json)) {
    if (!known.has(key)) {
      issues.push(`[stencils] ${path}: неизвестное поле "${key}" (опечатка?)`)
    }
  }

  // Области применения — фиксированный список (см. constants/domains): чужой ключ
  // попал бы в фильтр палитры, а убрать его оттуда нечем.
  if (json.domains !== undefined) {
    if (!Array.isArray(json.domains)) {
      issues.push(`[stencils] ${path}: "domains" должен быть массивом`)
    } else {
      for (const key of json.domains) {
        if (!isValidDomain(key)) {
          issues.push(`[stencils] ${path}: неизвестная область применения "${key}" — отброшена`)
        }
      }
    }
  }

  // Метка набора: без неё символ пользовательский, поэтому битую не оставляем молча —
  // иначе поставляемый символ стал бы правимым.
  if (json.preset !== undefined && !normalizePreset(json.preset)) {
    issues.push(`[stencils] ${path}: "preset" без id или версии по маске — метка отброшена`)
  }

  // Параметры — подписи, правимые на холсте: ключ идёт в data-tms-param и в
  // tms.params, поэтому маска та же, что у значений (constants/ids).
  if (json.params !== undefined) {
    if (!Array.isArray(json.params)) {
      issues.push(`[stencils] ${path}: "params" должен быть массивом`)
    } else {
      for (const [i, param] of json.params.entries()) {
        if (!isValidParamKey(param?.key)) {
          issues.push(`[stencils] ${path}: params[${i}] с недопустимым "key"`)
        }
      }
    }
  }

  // key — идентичность слота (идёт в {slot.KEY} и tms.slots); type опционален.
  if (Array.isArray(json.slots)) {
    for (const [i, slot] of json.slots.entries()) {
      if (!slot.key) issues.push(`[stencils] ${path}: slots[${i}] без "key"`)
    }
  }

  // Непустой idSuffix обязан иметь пару в SVG: иначе карточка адресует
  // несуществующий элемент и анимация ничего не делает.
  if (Array.isArray(json.animationTemplate)) {
    for (const [i, tpl] of json.animationTemplate.entries()) {
      if (tpl.idSuffix === undefined) {
        issues.push(`[stencils] ${path}: animationTemplate[${i}] без "idSuffix"`)
      }
      if (!tpl.type) {
        issues.push(`[stencils] ${path}: animationTemplate[${i}] без "type"`)
      }
      if (svgText && tpl.idSuffix) {
        if (!svgText.includes(`${ATTR_SUFFIX}="${tpl.idSuffix}"`)) {
          issues.push(
            `[stencils] ${path}: animationTemplate[${i}].idSuffix "${tpl.idSuffix}" ` +
              `не найден в shape.svg (опечатка? карточка повиснет без DOM-таргета)`
          )
        }
      }
    }
  }

  return issues
}

/**
 * Единственный вход id символа в приложение: дальше он попадает в `data-tms-stencil`,
 * в CSS-классы состояний и в селекторы внутри CDATA экспорта. Отсев здесь позволяет
 * всем писателям SVG-строк считать id безопасным (маска — STENCIL_ID_RE).
 */
function isValidStencilId(id) {
  return typeof id === 'string' && STENCIL_ID_RE.test(id)
}

/**
 * Метка набора (`preset` в stencil.json) — происхождение символа: такой не правится и
 * не удаляется поштучно, только целым набором. Приходит из чужого `.zip`, поэтому
 * чистится здесь: без id или версии по маске метки нет вовсе (символ считается
 * пользовательским), имя — одна строка, пустое имя заменяет id.
 */
function normalizePreset(raw) {
  if (!raw || typeof raw !== 'object') return undefined
  const id = String(raw.id ?? '')
  const version = String(raw.version ?? '')
  if (!STENCIL_ID_RE.test(id) || !PRESET_VERSION_RE.test(version)) return undefined
  const name = String(raw.name ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
  return { id, name: name || id, version }
}

/**
 * Запись реестра: разметка очищена, метка набора нормализована (битая — отброшена).
 * Правки проекта (`presetPatch`) живут только при метке: без набора им не на что ложиться.
 */
function stencilEntry(json, svgText) {
  const { preset, presetPatch, ...rest } = json
  const entry = { ...rest, svgText: cleanSvg(json.id, svgText).svg }
  const mark = normalizePreset(preset)
  if (mark) {
    entry.preset = mark
    const patch = normalizePresetPatch(presetPatch)
    if (patch) entry.presetPatch = patch
  }
  return entry
}

/**
 * Символ из поставляемого набора: правка и удаление поштучно ему недоступны (набор
 * ставится и сносится целиком), дублирование — доступно, копия метку не наследует.
 */
export function isPresetStencil(stencil) {
  return !!stencil?.preset?.id
}

/**
 * То же для РАЗМЕТКИ: `shape.svg` уходит в v-html и appendChild, поэтому чистится на
 * входе в реестр, а рендер-пути дальше не санитайзят. Встроенные символы проходят тот
 * же фильтр — иначе `stencilSignature` сравнивал бы очищенную версию с сырой.
 */
function cleanSvg(id, svgText) {
  const { svg, removed } = sanitizeSvgMarkup(svgText)
  if (removed.length) {
    console.warn(`[stencils] "${id}": из разметки убрано ${removed.join(', ')}`)
  }
  return { svg, removed }
}

/**
 * Собранный реестр: id → объект символа со встроенным svgText.
 */
const registry = (() => {
  const out = new Map()

  for (const [path, json] of Object.entries(jsonModules)) {
    // Путь фильтрует сам glob; маска id проверяется всё равно (isValidStencilId).
    if (!isValidStencilId(json?.id)) {
      console.warn(`[stencils] Пропускаю ${path}: id "${json?.id}" отсутствует или вне маски`)
      continue
    }

    const svgPath = path.replace('/stencil.json', '/shape.svg')
    const svgText = svgModules[svgPath]

    if (!svgText) {
      console.warn(`[stencils] У символа "${json.id}" не найден shape.svg по пути ${svgPath}`)
    }

    // svgText в validate'е — для cross-check idSuffix ↔ data-anim-suffix.
    for (const issue of validateStencilJson(path, json, svgText)) console.warn(issue)

    // Два символа с одинаковым id — второй молча затёр бы первый. Сигналим.
    if (out.has(json.id)) {
      console.warn(`[stencils] Дубль id "${json.id}" (${path}) — предыдущее определение перетёрто`)
    }

    out.set(json.id, stencilEntry(json, svgText))
  }

  return out
})()

/**
 * Слот-драйвер состояния символа: единственный не-`Text` слот (`onoff` у булевых,
 * `value` у «по значению» — режим задаёт редактор символов). Подпись со значением
 * (`Text`) драйвером не считается: у неё нет состояний, она печатает число.
 *
 * Одно правило на всех: инспектор ищет слот в UI-списке, буфер и массовая привязка —
 * в определении символа; разойдись они, тег состояния писался бы не в тот ключ.
 *
 * @param {Array<{key: string, type?: string}>} slots
 */
export function stateSlotOf(slots) {
  return (slots || []).find((s) => s.type !== 'Text' && s.key !== RANGE_SLOT) || null
}

/**
 * Шина — программный символ (`locked`: тело и порты считает код), но зоны диапазонов у
 * неё редактируются, как у любого символа: редактор открывает её в режиме «только
 * диапазоны», а перенос строк с холста в определение её не обходит.
 */
export function isBusStencil(stencil) {
  return stencil?.id === BUS_STENCIL_ID
}

/**
 * Что откроет редактор для символа — подпись карандаша в палитре и пункта меню холста;
 * `null` — не правится (программный символ, чей SVG в формат редактора не разбирается).
 * Режим задаёт сам символ: шина — только диапазоны, символ набора — только анимации.
 */
export function stencilEditLabel(stencil) {
  if (!stencil) return null
  if (stencil.locked) return isBusStencil(stencil) ? 'Диапазоны шины' : null
  return isPresetStencil(stencil) ? 'Анимации символа' : 'Редактировать символ'
}

/** Слот подписи со значением тега (`Text`) — парно к `stateSlotOf`. */
export function textSlotOf(slots) {
  return (slots || []).find((s) => s.type === 'Text') || null
}

export function getAllStencils() {
  return Array.from(registry.values())
}

/**
 * Свободный id для КОПИИ символа: `<base>_copy`, дальше `_copy2`, `_copy3`… Дубль
 * повторного дубля не наращивает суффикс бесконечно (`cell_qw_copy` → `cell_qw_copy2`).
 * Имя предварительное — в редакторе его правят до сохранения.
 */
export function nextStencilId(baseId) {
  const base = String(baseId || 'cell').replace(/_copy\d*$/, '')
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? `${base}_copy` : `${base}_copy${n}`
    if (!registry.has(candidate)) return candidate
  }
}

export function getStencilById(id) {
  return registry.get(id)
}

/**
 * Регистрация в рантайме, минуя glob. Нужна при импорте: символы из library/ обязаны
 * быть в реестре ДО parseSvgProject, иначе их ячейки выкинутся как нераспознанные.
 * Персистентность — за оверрайдами в IDB и файлами в definitions/.
 *
 * `false` — id вне маски, символ НЕ зарегистрирован; вызывающий обязан сообщить об
 * этом пользователю. Разметка не отклоняется, а чистится (cleanSvg).
 */
export function registerStencil(json, svgText) {
  if (!isValidStencilId(json?.id)) {
    if (json?.id) console.warn(`[stencils] id "${json.id}" вне маски — символ отклонён`)
    return false
  }
  registry.set(json.id, stencilEntry(json, svgText))
  registryVersion.value++
  return true
}

/** Удаление из рантайм-реестра; файлы definitions/<id>/ сносит dev-плагин. */
export function unregisterStencil(id) {
  if (registry.delete(id)) registryVersion.value++
}

// Закреплена первой независимо от алфавита: шина — каркас любой схемы, с неё
// начинают. Остальные — по алфавиту, ru-локаль.
const PINNED_FIRST_CATEGORIES = ['Шины']

export function getCategories() {
  const cats = new Set()
  for (const stencil of registry.values()) cats.add(stencil.category)
  const pinned = PINNED_FIRST_CATEGORIES.filter((c) => cats.has(c))
  const rest = Array.from(cats)
    .filter((c) => !PINNED_FIRST_CATEGORIES.includes(c))
    .sort((a, b) => a.localeCompare(b, 'ru'))
  return [...pinned, ...rest]
}
