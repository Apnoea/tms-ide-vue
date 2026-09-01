// Билдеры карточек animations.json — чистые функции над tms-payload, без SVG и графа
// (в exporter'е оркестрация, здесь рантайм-протокол). Формат карточек — «Раннтайм-
// протокол» в CLAUDE.md.

import { getStencilById } from '../stencils/registry'
import { CLASS_OFF, rangeColorClass, rangeRowColor, stateColorClass } from '../constants/animation'
import { innerPrefix } from '../constants/ids'
import { normalizeBoolSource, boolSourceTags } from '../utils/boolSource'

/** Строки источника, годные к эмиту: без цвета или без порогов case пустой. */
function usableRows(vs) {
  return (vs.ranges || []).filter(
    (r) => rangeRowColor(r) && (Number.isFinite(r.min) || Number.isFinite(r.max))
  )
}

/** Класс перекраса строки: генерируется из её цвета (см. rangeColorClass). */
function rowClass(row) {
  return rangeColorClass(rangeRowColor(row))
}

/**
 * Карточка анимации диапазонов: один range-биндинг — значение тега → класс цвета той
 * строки, в чей интервал оно попало. Сравнение inclusive по обоим концам, поэтому
 * одинаковые границы (`3 – 3`) задают ТОЧНОЕ значение.
 */
export function buildRangeCard(vs) {
  return {
    animation: 'shape',
    bindings: [
      {
        tag: vs.tag,
        when: {
          source: 'value',
          type: 'range',
          cases: usableRows(vs).map((r) => ({
            min: r.min,
            max: r.max,
            apply: { addClass: rowClass(r) },
          })),
        },
      },
    ],
  }
}

/**
 * Shape-карточка булева источника: на каждый тег — bool-биндинг (false →
 * animation-off), объединение биндингов даёт «любой false → серый». Для не-multi
 * случая; принимает плоский список тегов.
 */
export function buildBoolCard(tags) {
  return {
    animation: 'shape',
    bindings: tags.map((tag) => ({
      tag,
      when: {
        source: 'value',
        type: 'map',
        cases: { false: { apply: { addClass: CLASS_OFF } } },
      },
    })),
  }
}

/** Нужна ли multi-карточка: ≥2 групп boolSource (ИЛИ невыразимо биндингами
 *  shape-карточки). Одна группа или ни одной → дешёвый shape (buildBoolCard). */
export function needsMulti(c) {
  return normalizeBoolSource(c.boolSource).groups.length >= 2
}

/** Условие «выключатель открыт» (value=false). ConditionEvaluator(map) вернёт
 *  cases['false']=true → MultiConditionEvaluator трактует результат как true. */
function openCondition(id, tag) {
  return { id, tag, source: 'value', when: { type: 'map', cases: { false: true } } }
}

/** multi-биндинг с ОДНИМ условием (expression='c'): тег под source/when →
 *  apply addClass. Для слоёв range / onoff / quality в multi-карточке. */
function singleMultiBinding(tag, source, when, addClass) {
  return {
    multiCondition: {
      expression: 'c',
      conditions: [{ id: 'c', tag, source, when }],
      apply: { addClass },
    },
  }
}

/**
 * Outer-карточка типа `multi` — рантайм-тип с булевым `expression` по нескольким
 * тегам: единственный способ выразить ИЛИ-агрегацию групп boolSource. Несёт все
 * outer-эффекты слоями (цвет по диапазонам, группы boolSource, quality) и кладётся на
 * outer-id — на потомков классы каскадят через CSS. Строится напрямую из tms.
 */
export function buildMultiCard(c) {
  const stencil = getStencilById(c.stencilId)
  const bindings = []

  // Источник значения — слой на строку: у multi-биндинга одно `apply`, а классов
  // столько же, сколько строк.
  const vs = c.rangeSource
  if (vs?.tag) {
    for (const r of usableRows(vs)) {
      const when = { type: 'range', cases: [{ min: r.min, max: r.max }] }
      bindings.push(singleMultiBinding(vs.tag, 'value', when, rowClass(r)))
    }
  }

  // boolSource — группы условий: активен, если ЛЮБАЯ группа выполнена целиком
  // (все теги замкнуты). Гасим (animation-off), когда НИ одна не выполнена =
  // в КАЖДОЙ группе хотя бы один тег открыт. Без отрицания (рантайм-expression его
  // не даёт): произведение сумм — И по группам ( ИЛИ «открыт» внутри группы ).
  const { groups } = normalizeBoolSource(c.boolSource)
  const conditions = []
  const factors = []
  groups.forEach((group, gi) => {
    const ids = group.map((tag, ti) => {
      const id = `g${gi}t${ti}`
      conditions.push(openCondition(id, tag))
      return id
    })
    factors.push(`(${ids.join(' || ')})`)
  })
  if (conditions.length) {
    bindings.push({
      multiCondition: {
        expression: factors.join(' && '),
        conditions,
        apply: { addClass: CLASS_OFF },
      },
    })
  }

  if (stencil?.quality) {
    const qTags = [
      ...new Set([vs?.tag, c.slots?.onoff, ...boolSourceTags(c.boolSource)].filter(Boolean)),
    ]
    for (const tag of qTags) {
      bindings.push(
        singleMultiBinding(
          tag,
          'quality',
          { type: 'range', cases: [{ min: 0, max: 191 }] },
          CLASS_OFF
        )
      )
    }
  }

  return { animation: 'multi', bindings }
}

/**
 * Биндинг перекраса всего символа по состоянию (stateColors в stencil.json):
 * значение тега-слота состояния → класс `animation-color-<stencilId>-<ключ>` на outer, цвет
 * каскадит на потомков через CSS (см. inlineStyles). Кладётся слоем на outer
 * (assignOrMerge — уживается с диапазонами/булевым/quality). Коды: режим значения —
 * из states, булев — сами ключи 'true'/'false'. null, если красить нечего или
 * тег слота не привязан. Обесточивание (animation-off) бьёт цвет в CSS.
 */
export function buildStateColorCard(c) {
  const stencil = getStencilById(c.stencilId)
  const colors = stencil?.stateColors
  if (!colors || !Object.keys(colors).length) return null
  const slotKey = stencil.slots?.[0]?.key
  const tag = slotKey ? c.slots?.[slotKey] : null
  if (!tag) return null
  const cases = {}
  if (Array.isArray(stencil.states) && stencil.states.length) {
    for (const st of stencil.states) {
      const color = colors[st.key]
      if (color && st.code !== '' && st.code != null) {
        cases[String(st.code)] = { apply: { addClass: stateColorClass(c.stencilId, st.key) } }
      }
    }
  } else {
    for (const k of ['true', 'false']) {
      if (colors[k]) cases[k] = { apply: { addClass: stateColorClass(c.stencilId, k) } }
    }
  }
  if (!Object.keys(cases).length) return null
  return { animation: 'shape', bindings: [{ tag, when: { source: 'value', type: 'map', cases } }] }
}

/**
 * Карточка под ключ либо создаётся, либо в существующую дописываются
 * bindings. Нужно потому что несколько источников (диапазоны + булево) могут
 * хотеть навесить биндинги на один и тот же outer-wrapper или link-id —
 * порядок добавления не должен затирать предыдущее.
 */
export function assignOrMergeAnimation(animations, key, card) {
  if (animations[key]) {
    animations[key].bindings = [...(animations[key].bindings || []), ...card.bindings]
  } else {
    animations[key] = card
  }
}

/**
 * Дублирует bindings новой карточки во ВСЕ символьные shape-карточки того же
 * animId (`animation-{stencilId}-{animId}.true`, `.false`, …). Так класс
 * ляжет не только на outer-wrapper, но и на внутренние shape-группы символа.
 * Text-карточки (подпись показывает значение тега) пропускаем — их раскрашивать
 * чужими классами не нужно.
 */
export function mergeBindingsIntoStencilCards(animations, stencilId, animId, exceptKey, card) {
  const keyPrefix = innerPrefix(stencilId, animId)
  for (const key of Object.keys(animations)) {
    if (key === exceptKey) continue
    if (animations[key].animation === 'text') continue
    if (!key.startsWith(keyPrefix)) continue
    animations[key].bindings = [...(animations[key].bindings || []), ...card.bindings]
  }
}
