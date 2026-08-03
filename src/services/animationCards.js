// Билдеры animation-карточек для animations.json — чистые функции над tms-payload
// (`cellExports`/`linkExports`-элемент), без SVG-сериализации и без графа. Вынесены
// из exporter'а: тот остаётся оркестрацией (обход графа → SVG + сборка карточек), а
// здесь — рантайм-протокол в одном месте и тестируемо по отдельности.
//
// Что эмитим — см. «Раннтайм-протокол» в CLAUDE.md.

import { getStencilById } from '../stencils/registry'
import { CLASS_OFF, stateColorClass } from '../constants/animation'
import { innerPrefix } from '../constants/ids'
import { normalizeBoolSource, boolSourceTags } from '../utils/boolSource'

/**
 * Карточка анимации диапазонов: один range-биндинг, читающий выбранный тег
 * и добавляющий соответствующий класс в зависимости от диапазона значения.
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
          cases: (vs.ranges || []).map((r) => ({
            min: r.min,
            max: r.max,
            apply: { addClass: r.class },
          })),
        },
      },
    ],
  }
}

/**
 * Shape-карточка булева источника: на каждый тег — bool-биндинг (false → animation-off).
 * Union биндингов = AND «любой false → серый». Для не-multi случая (чистая
 * цепочка / одиночный параллельный тег). Принимает плоский список тегов.
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

/** Нужна ли multi-карточка: ≥2 групп boolSource (ИЛИ-агрегация невыразима
 *  union-биндингами shape-карточки). Одна группа (чистое И) / нет групп → дешёвый
 *  shape (buildBoolCard: любой тег группы false → animation-off). */
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
 * тегам (единственный способ выразить ИЛИ-агрегацию групп boolSource, где
 * union-биндинги дают только AND). Несёт ВСЕ outer-эффекты слоями (бинды
 * независимы, ActionApplier складывает классы): цвет по диапазонам, группы
 * boolSource, quality. Кладётся на outer-id; на потомков классы каскадят через
 * CSS, поэтому merge во внутренние shape-карточки не нужен. Генерируется напрямую
 * из tms — только здесь есть семантика «какие теги в какой группе».
 */
export function buildMultiCard(c) {
  const stencil = getStencilById(c.stencilId)
  const bindings = []

  const vs = c.rangeSource
  if (vs?.tag && vs.ranges?.length) {
    for (const r of vs.ranges) {
      bindings.push(
        singleMultiBinding(
          vs.tag,
          'value',
          { type: 'range', cases: [{ min: r.min, max: r.max }] },
          r.class
        )
      )
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
 * Дублирует bindings новой карточки во ВСЕ стенсильные shape-карточки того же
 * animId (`animation-{stencilId}-{animId}.true`, `.false`, …). Так класс
 * ляжет не только на outer-wrapper, но и на внутренние shape-группы стенсила.
 * Text-карточки (вроде cell_value text-update) пропускаем — их раскрашивать
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
