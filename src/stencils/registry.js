/**
 * Реестр символов: определения из `definitions/<id>/` (stencil.json + shape.svg)
 * подхватываются Vite-глобом — добавили папку, символ в палитре. Плюс
 * рантайм-регистрация (импорт бандла, редактор) и валидация json.
 */

import { ref } from 'vue'
import { ATTR_SUFFIX, STENCIL_ID_RE } from '../constants/ids'
import { isValidDomain } from '../constants/domains'
import { sanitizeSvgMarkup } from '../utils/sanitizeSvg'

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
    'quality',
    'static',
    'noRotate',
    'noFlip',
    'defaults',
    'locked',
    'domains',
    // Поле прошлых версий (скрытие держит LEGACY_HIDDEN_IDS): в known остаётся,
    // чтобы архивы с ним не сыпали предупреждением на каждом импорте.
    'hidden',
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

    out.set(json.id, {
      ...json,
      svgText: cleanSvg(json.id, svgText).svg,
    })
  }

  return out
})()

/**
 * Символы прошлого формата: реестр их держит, чтобы открывать старые формы, в палитре
 * их нет. Список в КОДЕ, а не полем json: чужой архив приносит своё
 * `library/<id>/stencil.json` и перекрыл бы поле.
 *
 * `cell_text` — подпись стала фигурой-разметкой, `cell_node` — точку рисует свободный
 * конец провода. Ячейки обоих переводит legacyFormat.
 */
const LEGACY_HIDDEN_IDS = new Set(['cell_text', 'cell_node'])

/** Скрыт ли символ из палитры. */
export function isHiddenStencil(stencil) {
  return !!stencil && LEGACY_HIDDEN_IDS.has(stencil.id)
}

export function getAllStencils() {
  return Array.from(registry.values())
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
  registry.set(json.id, { ...json, svgText: cleanSvg(json.id, svgText).svg })
  registryVersion.value++
  return true
}

/** Удаление из рантайм-реестра; файлы definitions/<id>/ сносит dev-плагин. */
export function unregisterStencil(id) {
  if (registry.delete(id)) registryVersion.value++
}

// Закреплена первой независимо от алфавита: каркас схемы (подписи, значения, узлы,
// шины) нужен на любой схеме. Остальные — по алфавиту, ru-локаль.
const PINNED_FIRST_CATEGORIES = ['Разметка и значения']

/**
 * Булев слот-драйвер (`onoff`) — единый ключ всех булевых символов. Инспектор
 * рендерит его первой строкой «Булево значение» и исключает из boolSource.
 */
export function hasBoolSlot(stencil) {
  return !!stencil?.slots?.some((s) => s.key === 'onoff')
}

export function getCategories() {
  const cats = new Set()
  for (const stencil of registry.values()) {
    if (isHiddenStencil(stencil)) continue
    cats.add(stencil.category)
  }
  const pinned = PINNED_FIRST_CATEGORIES.filter((c) => cats.has(c))
  const rest = Array.from(cats)
    .filter((c) => !PINNED_FIRST_CATEGORIES.includes(c))
    .sort((a, b) => a.localeCompare(b, 'ru'))
  return [...pinned, ...rest]
}
