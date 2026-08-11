/**
 * Реестр стенсилов: определения из `definitions/<id>/` (stencil.json + shape.svg)
 * подхватываются Vite-глобом — добавили папку, стенсил в палитре. Плюс
 * рантайм-регистрация (импорт бандла, редактор) и валидация json.
 */

import { ref } from 'vue'
import { ATTR_SUFFIX, STENCIL_ID_RE } from '../constants/ids'
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
    issues.push(`[stencils] ${path}: id "${json.id}" вне маски [a-z0-9_] — стенсил не загружен`)
  }

  // Декларативные флаги (quality/static/noRotate) — источник правды о спец-поведении
  // стенсила: exporter/инспектор/холст читают их из json, хардкод-Set'ов в коде нет.
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
    'defaults',
    'locked',
  ])
  for (const key of Object.keys(json)) {
    if (!known.has(key)) {
      issues.push(`[stencils] ${path}: неизвестное поле "${key}" (опечатка?)`)
    }
  }

  // key — идентичность слота (идёт в {slot.KEY} и tms.slots); type опционален.
  if (Array.isArray(json.slots)) {
    for (const [i, slot] of json.slots.entries()) {
      if (!slot.key) issues.push(`[stencils] ${path}: slots[${i}] без "key"`)
    }
  }

  // Непустой idSuffix обязан иметь пару в SVG, иначе карточка эмитится для
  // несуществующего элемента и рантайм молча ничего не анимирует.
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
 * Единственный вход id стенсила в приложение: дальше он попадает в
 * `data-tms-stencil`, в CSS-классы состояний и в селекторы внутри CDATA
 * экспорта, а стенсилы приходят из чужого .zip. Отсекаем здесь — тогда все
 * писатели SVG-строк могут считать id безопасным (см. STENCIL_ID_RE).
 */
function isValidStencilId(id) {
  return typeof id === 'string' && STENCIL_ID_RE.test(id)
}

/**
 * То же для РАЗМЕТКИ: `shape.svg` из чужого архива уходит в v-html и appendChild,
 * поэтому чистим на входе в реестр, а рендер-пути дальше не санитайзят. Встроенные
 * символы гоняем через тот же фильтр: иначе `stencilSignature` сравнивал бы
 * очищенную версию из бандла с сырой из glob'а и считал наш символ «изменённым».
 */
function cleanSvg(id, svgText) {
  const { svg, removed } = sanitizeSvgMarkup(svgText)
  if (removed.length) {
    console.warn(`[stencils] "${id}": из разметки убрано ${removed.join(', ')}`)
  }
  return { svg, removed }
}

/**
 * Собранный реестр: id → объект стенсила со встроенным svgText.
 */
const registry = (() => {
  const out = new Map()

  for (const [path, json] of Object.entries(jsonModules)) {
    // Vite glob уже фильтрует пути по `./definitions/*/stencil.json` —
    // дополнительный regex-guard на ПУТЬ здесь был бы тавтологией; маску id
    // проверяем всё равно (см. isValidStencilId — инвариант держится на реестре).
    if (!isValidStencilId(json?.id)) {
      console.warn(`[stencils] Пропускаю ${path}: id "${json?.id}" отсутствует или вне маски`)
      continue
    }

    const svgPath = path.replace('/stencil.json', '/shape.svg')
    const svgText = svgModules[svgPath]

    if (!svgText) {
      console.warn(`[stencils] У стенсила "${json.id}" не найден shape.svg по пути ${svgPath}`)
    }

    // svgText в validate'е — для cross-check idSuffix ↔ data-anim-suffix.
    for (const issue of validateStencilJson(path, json, svgText)) console.warn(issue)

    // Два стенсила с одинаковым id — второй молча затёр бы первый. Сигналим.
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

export function getAllStencils() {
  return Array.from(registry.values())
}

export function getStencilById(id) {
  return registry.get(id)
}

/**
 * Регистрация в рантайме, минуя glob. Нужна при импорте проекта: стенсилы из
 * library/ должны быть в реестре ДО parseSvgProject, иначе их ячейки выкинутся как
 * нераспознанные. Персистентность — за оверрайдами в IDB / файлами в definitions/.
 *
 * Возвращает успех: `false` — id вне маски, стенсил НЕ зарегистрирован (его
 * ячейки при импорте выкинутся как нераспознанные), вызывающий обязан сказать
 * это вслух. Разметка не отклоняется, а чистится (cleanSvg).
 */
export function registerStencil(json, svgText) {
  if (!isValidStencilId(json?.id)) {
    if (json?.id) console.warn(`[stencils] id "${json.id}" вне маски — стенсил отклонён`)
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
 * Булев слот-драйвер (`onoff`) — единый ключ всех булевых стенсилов. Инспектор
 * рендерит его первой строкой «Булево значение» и исключает из boolSource.
 */
export function hasBoolSlot(stencil) {
  return !!stencil?.slots?.some((s) => s.key === 'onoff')
}

export function getCategories() {
  const cats = new Set()
  for (const stencil of registry.values()) cats.add(stencil.category)
  const pinned = PINNED_FIRST_CATEGORIES.filter((c) => cats.has(c))
  const rest = Array.from(cats)
    .filter((c) => !PINNED_FIRST_CATEGORIES.includes(c))
    .sort((a, b) => a.localeCompare(b, 'ru'))
  return [...pinned, ...rest]
}
