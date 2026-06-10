/**
 * Stencil registry
 * ────────────────
 *
 * Собирает все определения стенсилов из src/stencils/definitions/<id>/ через
 * Vite glob imports (eager). Каждый стенсил состоит из двух файлов:
 *   • stencil.json   — метаданные + animationTemplate
 *   • shape.svg      — SVG-разметка с data-anim-suffix-атрибутами
 *
 * Регистрация автоматическая — добавили папку, файл подхватился.
 *
 * Публичное API:
 *   getAllStencils()         — массив всех стенсилов
 *   getStencilById(id)       — один стенсил по id или undefined
 *   getCategories()          — список уникальных категорий
 */

import { ATTR_SUFFIX } from '../constants/ids'

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
 * Минимальная schema-валидация stencil.json. Возвращает массив проблем
 * (строки) — pure-функция, без side-effect'ов. Caller сам решает что делать
 * (логировать в console, бросать ошибку и т.п.). Защищает от опечаток
 * (`slts` вместо `slots`), пропусков required-полей и неправильных структур.
 *
 * Не блокирует загрузку — реестр всё равно подхватит стенсил, но юзер увидит
 * предупреждения в console (см. init code ниже).
 *
 * @param {string} path  Путь к stencil.json (для prefix'а сообщений)
 * @param {object} json  Содержимое stencil.json
 * @param {string} [svgText]  Содержимое shape.svg для cross-check idSuffix ↔
 *                            data-anim-suffix. Без него этот шаг пропускается.
 * @returns {string[]}   Массив строк-предупреждений, пустой если всё ок
 */
export function validateStencilJson(path, json, svgText) {
  const issues = []

  const required = ['id', 'label', 'category', 'width', 'height', 'shapeFile']
  for (const key of required) {
    if (json[key] === undefined || json[key] === null) {
      issues.push(`[stencils] ${path}: отсутствует поле "${key}"`)
    }
  }

  // Известные поля верхнего уровня. Опечатки типа `slts` / `slosts` вылавливаем.
  // Декларативные флаги (quality / intrinsicOnoff / layoutOnly / noRotate) —
  // источник правды о специальном поведении стенсила: exporter / Inspector /
  // Canvas читают их через getStencilById, никаких хардкод-Set'ов.
  const known = new Set([
    'id',
    'label',
    'category',
    'width',
    'height',
    'minWidth',
    'shapeFile',
    'ports',
    'slots',
    'animationTemplate',
    'quality',
    'intrinsicOnoff',
    'layoutOnly',
    'noRotate',
    'defaults',
  ])
  for (const key of Object.keys(json)) {
    if (!known.has(key)) {
      issues.push(`[stencils] ${path}: неизвестное поле "${key}" (опечатка?)`)
    }
  }

  // Слоты — все должны иметь key и label
  if (Array.isArray(json.slots)) {
    for (const [i, slot] of json.slots.entries()) {
      if (!slot.key) issues.push(`[stencils] ${path}: slots[${i}] без "key"`)
      if (!slot.label) issues.push(`[stencils] ${path}: slots[${i}] без "label"`)
    }
  }

  // animationTemplate — каждая карточка должна иметь idSuffix и type.
  // Дополнительно (если передан svgText): каждый непустой idSuffix должен
  // быть подкреплён `data-anim-suffix=` в SVG, иначе animation-карточка
  // эмитится для несуществующего элемента — рантайм тихо не находит.
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
 * Собранный реестр: id → объект стенсила со встроенным svgText.
 */
const registry = (() => {
  const out = new Map()

  for (const [path, json] of Object.entries(jsonModules)) {
    // Vite glob уже фильтрует пути по `./definitions/*/stencil.json` —
    // дополнительный regex-guard здесь был бы тавтологией.
    if (!json?.id) {
      console.warn(`[stencils] Пропускаю ${path}: отсутствует поле "id"`)
      continue
    }

    const svgPath = path.replace('/stencil.json', '/shape.svg')
    const svgText = svgModules[svgPath]

    if (!svgText) {
      console.warn(`[stencils] У стенсила "${json.id}" не найден shape.svg по пути ${svgPath}`)
    }

    // svgText в validate'е — для cross-check idSuffix ↔ data-anim-suffix.
    for (const issue of validateStencilJson(path, json, svgText)) console.warn(issue)

    out.set(json.id, {
      ...json,
      svgText: svgText || '',
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

// Категория «Текст и значения» закреплена ПЕРВОЙ независимо от алфавита: это
// utility-стенсилы (подписи + значения тегов) которые юзеру нужны на любой
// схеме и в любом workflow. Остальные категории — по алфавиту (ru-локаль для
// корректной А-Я сортировки). Добавление нового стенсила/категории встаёт в
// логичную позицию автоматически, без правок этого файла.
const PINNED_FIRST_CATEGORIES = ['Текст и значения']

/**
 * Стенсил считается «свитчем» если у него есть слот с key === 'onoff'.
 * Convention в проекте: ключ `onoff` зарезервирован под булево «вкл/выкл»
 * (cell_qw / qr / qk / qf). Используется Inspector'ом для рендера через
 * SwitchBlock + защиты от дублирования self-тега в switchSources.
 */
export function isSwitchStencil(stencil) {
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
