import { computed, ref, onBeforeUnmount } from 'vue'
import { useNotify, TOAST_LIFE } from './useNotify'
import {
  CLASS_OFF,
  CLASS_HIDDEN,
  STATE_COLOR_PREFIX,
  RANGE_COLOR_PREFIX,
  rangeColorClass,
  rangeRowColor,
  buildRangeCssRules,
  buildStateColorCssRules,
  stateColorClass,
  resolveValueDecimals,
} from '../constants/animation'
import { innerKey, resolveSlotTemplate } from '../constants/ids'
import { normalizeBoolSource } from '../utils/boolSource'
import { getCellTags } from '../utils/cellSearch'
import {
  boolOf,
  rangeRowFor,
  stateKeyFor,
  formatValueText,
  randomValueForTag,
} from '../utils/simValues'
import { useProjectStore } from '../stores/useProjectStore'
import { getStencilById, getAllStencils } from '../stencils/registry'
import { useCanvas } from './useCanvas'

const SIM_CYCLE_MS = 1500
const SIM_CSS_ID = 'tms-sim-css'

/**
 * Слот, который драйвит состояние символа — любой НЕ `Text`: подпись со значением тега
 * тоже слот, и у символа с ней первый по порядку слот оказался бы подписью.
 */
const stateSlotKey = (stencil) => stencil?.slots?.find((sl) => sl.type !== 'Text')?.key

// СИНГЛТОН: композабл зовут и CanvasPane (запуск, классы), и SimulationPanel (значения
// тегов), поэтому состояние живёт в модуле — иначе у панели была бы своя симуляция.
const simulating = ref(false)
/** Значения тегов, заданные вручную: `tag → значение`. Остальные — случайные. */
const simValues = ref(new Map())
// Исходный текст подписей со значением: симуляция пишет в них число, остановка
// возвращает то, что нарисовано в символе.
const valueTexts = new Map()
let simIntervalId = null
// Сигнатура набора цветов, под который собран <style>: перекрасив строку во время
// симуляции, автор требует доинжектить правило.
let simCssKey = ''

/**
 * Симуляция: визуальный preview animation-классов через JS-таймер.
 *
 * Источник — ЗНАЧЕНИЯ тегов (`simValues`), поэтому превью считает то же, что рантайм:
 * строка диапазона выбирается сравнением с границами, состояние «по значению» — по
 * коду, подпись показывает отформатированное число. Значение одно на тег, значит все
 * его элементы согласованы; незаданное вручную догенерируется случайным (см.
 * utils/simValues.randomValueForTag) и держится до конца тика.
 *
 * CSS под `.tms-simulating` инжектится в `<head>` и не протекает в обычный режим;
 * класс на paperContainer вешает Vue через :class. `stopSimulation` — принудительная
 * остановка, её зовёт useProject перед экспортом и импортом.
 */
export function useSimulation() {
  const canvas = useCanvas()
  const notify = useNotify()
  const project = useProjectStore()

  /** Пустое значение = вернуть тегу случайное: пустых записей в наборе не держим. */
  function setTagValue(tag, value) {
    const next = new Map(simValues.value)
    if (value == null) next.delete(tag)
    else next.set(tag, value)
    simValues.value = next
  }

  function clearTagValues() {
    simValues.value = new Map()
  }

  /**
   * Теги, привязанные в ТЕКУЩЕЙ форме, с ролью — от неё зависит контрол в панели:
   * `state` (список состояний символа), `bool` (тумблер), `value` (число). Роль берётся
   * по месту привязки, а не по типу из tag-list: тип может отсутствовать, а место
   * говорит, чем тег управляет. Приоритет state → bool → value: тег в нескольких
   * ролях показываем более конкретной. Источники (`states`/`rangeSource`) при этом
   * НАКАПЛИВАЮТСЯ со всех мест привязки — по ним подбирается случайное значение.
   */
  const formTags = computed(() => {
    canvas.graphVersion.value // пересобрать после правок схемы
    const graph = canvas.graphRef.value
    const byTag = new Map()
    const RANK = { state: 3, bool: 2, value: 1 }
    const put = (tag, kind, extra = {}) => {
      if (!tag) return
      const prev = byTag.get(tag)
      const strongest = prev && RANK[prev.kind] > RANK[kind] ? prev.kind : kind
      byTag.set(tag, { ...prev, ...extra, tag, kind: strongest })
    }
    for (const cell of graph?.getCells() || []) {
      const tms = cell.get('tms') || {}
      const stencil = getStencilById(tms.stencilId)
      for (const slot of stencil?.slots || []) {
        const tag = tms.slots?.[slot.key]
        if (!tag) continue
        if (slot.type === 'Text') put(tag, 'value')
        else if (stencil.states?.length) put(tag, 'state', { states: stencil.states })
        else put(tag, 'bool')
      }
      if (tms.rangeSource?.tag) put(tms.rangeSource.tag, 'value', { rangeSource: tms.rangeSource })
      for (const group of normalizeBoolSource(tms.boolSource).groups) {
        for (const tag of group) put(tag, 'bool')
      }
    }
    const typeOf = (tag) => project.tags.find((t) => t.name === tag)?.type || ''
    return [...byTag.values()]
      .map((entry) => ({ ...entry, type: typeOf(entry.tag) }))
      .sort((a, b) => a.tag.localeCompare(b.tag, 'ru'))
  })

  /** Те же записи по имени тега: контекст для случайных значений на тике. */
  const tagInfo = computed(() => new Map(formTags.value.map((t) => [t.tag, t])))

  /**
   * Теги выделенных на холсте элементов: панель сужает список до них, чтобы не искать
   * нужный тег среди всех тегов формы.
   */
  const selectedTags = computed(() => {
    canvas.graphVersion.value
    const graph = canvas.graphRef.value
    const out = new Set()
    for (const { id } of canvas.selection.value) {
      const cell = graph?.getCell(id)
      if (cell) for (const tag of getCellTags(cell)) out.add(tag)
    }
    return out
  })

  /** Вернуть подписям текст символа (симуляция писала в них значения). */
  function restoreValueTexts() {
    for (const [el, text] of valueTexts) el.textContent = text
    valueTexts.clear()
  }

  /** Строки источника с заданным цветом — только они дают класс (как в экспорте). */
  function colorRows(vs) {
    return (vs?.ranges || []).filter((r) => rangeRowColor(r))
  }

  /** Цвета всех источников формы — из них собираются CSS-правила симуляции. */
  function collectRangeColors() {
    const graph = canvas.graphRef.value
    const out = []
    for (const cell of graph?.getCells() || []) {
      for (const r of colorRows(cell.get('tms')?.rangeSource)) out.push(rangeRowColor(r))
    }
    return out
  }

  /** `{slot.X}` → тег из tms.slots[X] тем же резолвером, что у экспорта. */
  function resolveBindingTag(rawTag, tms) {
    if (!rawTag) return null
    const { value, hadUnresolved } = resolveSlotTemplate(rawTag, tms.slots || {})
    return hadUnresolved ? null : value
  }

  function injectSimulationCss(colors) {
    // Пересборка на каждый старт (remove + add): цвета состояний автор мог изменить,
    // и кэш дал бы старый. Заодно снимается дубль <style> после HMR.
    document.getElementById(SIM_CSS_ID)?.remove()
    const style = document.createElement('style')
    style.id = SIM_CSS_ID
    // Те же range/off-правила, что эмитит exporter, но под .tms-simulating и с
    // исключениями для живого DOM: [joint-selector="wrapper"] — широкий невидимый
    // hit-path линка (без исключения он красится и толстеет), .tms-hit-area — наш
    // прозрачный хитбокс ячейки. animation-hidden гасится отдельным правилом.
    const strokeExtra = ':not([joint-selector="wrapper"]):not(.tms-hit-area)'
    simCssKey = colors.join('|')
    const rangeOffCss = buildRangeCssRules(colors, {
      scope: '.tms-simulating ',
      strokeExtra,
    }).join('\n')
    // State-color: те же правила, что в exporter, но scope'нуты под .tms-simulating.
    const stateColorCss = buildStateColorCssRules(getAllStencils(), {
      scope: '.tms-simulating ',
      strokeExtra,
    }).join('\n')
    style.textContent = `.tms-simulating .${CLASS_HIDDEN} { display: none !important; }\n${rangeOffCss}\n${stateColorCss}`
    document.head.appendChild(style)
  }

  /** Снимает все sim-классы — range-класс с outer-g, animation-hidden/off с descendants. */
  function clearSimClasses() {
    const graph = canvas.graphRef.value
    const paper = canvas.paperRef.value
    if (!graph || !paper) return
    for (const cell of graph.getCells()) {
      const view = paper.findViewByModel(cell)
      if (!view?.el) continue
      // Цвет диапазона (animation-c-<цвет>) и цвет состояния (animation-color-<ключ>)
      // генерируются из данных, поэтому чистятся по префиксам, а не по списку.
      for (const cls of [...view.el.classList]) {
        if (cls.startsWith(STATE_COLOR_PREFIX) || cls.startsWith(RANGE_COLOR_PREFIX)) {
          view.el.classList.remove(cls)
        }
      }
      // animation-off от boolSource висит на outer-g, от символьного template — на
      // внутренних элементах: чистим оба места.
      view.el.classList.remove(CLASS_OFF)
      for (const el of view.el.querySelectorAll(`.${CLASS_HIDDEN}, .${CLASS_OFF}`)) {
        el.classList.remove(CLASS_HIDDEN)
        el.classList.remove(CLASS_OFF)
      }
    }
  }

  /** Одно значение per-tag за тик: ячейки/линки с одним тегом — согласованно. */
  function applySimClass() {
    const graph = canvas.graphRef.value
    const paper = canvas.paperRef.value
    if (!graph || !paper) return
    clearSimClasses()
    // Цвет строки могли поменять на ходу — правило под него могло не попасть в CSS.
    const colors = collectRangeColors()
    if (colors.join('|') !== simCssKey) injectSimulationCss(colors)

    // Значения тегов на этот тик: заданные вручную приоритетнее, остальные
    // догенерируются один раз и держатся до конца тика — иначе элементы с общим тегом
    // разъехались бы.
    const tickValues = new Map()
    const valueOf = (tag) => {
      if (!tickValues.has(tag)) {
        const manual = simValues.value.get(tag)
        tickValues.set(tag, manual ?? randomValueForTag(tagInfo.value.get(tag) || {}))
      }
      return tickValues.get(tag)
    }
    const boolFalseFor = (tag) => !boolOf(valueOf(tag))
    /** Класс строки источника по значению тега: цвет берём из НАСТРОЕК этого элемента. */
    const rangeClassFor = (vs) => {
      const row = rangeRowFor(vs, valueOf(vs.tag))
      return row ? rangeColorClass(rangeRowColor(row)) : null
    }

    // Источник значения: значение общее по тегу, цвет — свой у каждого элемента.
    for (const cell of graph.getCells()) {
      const vs = cell.get('tms')?.rangeSource
      if (!vs?.tag) continue
      const cls = rangeClassFor(vs)
      if (!cls) continue
      paper.findViewByModel(cell)?.el?.classList.add(cls)
    }
    // cell_node наследует цвет соединённого провода: берём источник первого
    // подходящего линка целиком.
    for (const cell of graph.getElements()) {
      const tms = cell.get('tms') || {}
      if (tms.stencilId !== 'cell_node' || tms.rangeSource?.tag) continue
      const link = graph.getConnectedLinks(cell).find((l) => l.get('tms')?.rangeSource?.tag)
      if (!link) continue
      const cls = rangeClassFor(link.get('tms').rangeSource)
      if (!cls) continue
      paper.findViewByModel(cell)?.el?.classList.add(cls)
    }

    // Bool-биндинги символьного template: у каждого резолвится тег ({slot.X} →
    // tms.slots[X]), значение тега приводится к boolean и применяется класс нужного
    // case'а. Несколько биндингов на одном теге переключаются согласованно.
    for (const cell of graph.getElements()) {
      const tms = cell.get('tms') || {}
      const stencil = getStencilById(tms.stencilId)
      if (!stencil?.animationTemplate?.length) continue
      const view = paper.findViewByModel(cell)
      if (!view?.el) continue
      for (const tpl of stencil.animationTemplate) {
        const targetId = innerKey(stencil.id, cell.id, tpl.idSuffix)
        const el = view.el.querySelector(`[id="${targetId}"]`)
        if (!el) continue
        for (const binding of tpl.bindings || []) {
          const tag = resolveBindingTag(binding.tag, tms)
          if (!tag) continue
          const cases = binding.when?.cases
          if (!cases || typeof cases !== 'object') continue
          const stateKey = boolFalseFor(tag) ? 'false' : 'true'
          const cls = cases[stateKey]?.apply?.addClass
          if (cls) el.classList.add(cls)
        }
      }
    }
    // State-color БУЛЕВ: класс перекраса по значению тега, согласованно с видимостью
    // выше. Value-символы — проход ниже.
    for (const cell of graph.getElements()) {
      const tms = cell.get('tms') || {}
      const stencil = getStencilById(tms.stencilId)
      const colors = stencil?.stateColors
      if (!colors || !Object.keys(colors).length) continue
      if (Array.isArray(stencil.states) && stencil.states.length) continue // value — ниже
      const slotKey = stateSlotKey(stencil)
      const tag = slotKey ? tms.slots?.[slotKey] : null
      if (!tag) continue
      const key = boolFalseFor(tag) ? 'false' : 'true'
      if (colors[key])
        paper.findViewByModel(cell)?.el?.classList.add(stateColorClass(stencil.id, key))
    }

    // Value-состояния: активное выбирает КОД под значение тега (как cases рантайма).
    // Совпадения нет — скрыты все группы. Гейт по привязанному тегу слота value: без
    // тега рантайм показал бы все группы.
    for (const cell of graph.getElements()) {
      const tms = cell.get('tms') || {}
      const stencil = getStencilById(tms.stencilId)
      const states = stencil?.states
      if (!Array.isArray(states) || !states.length) continue
      const slotKey = stateSlotKey(stencil)
      const tag = slotKey ? tms.slots?.[slotKey] : null
      if (!tag) continue
      const view = paper.findViewByModel(cell)
      if (!view?.el) continue
      const activeKey = stateKeyFor(states, valueOf(tag))
      for (const st of states) {
        if (st.key === activeKey) continue
        const el = view.el.querySelector(`[id="${innerKey(stencil.id, cell.id, '.' + st.key)}"]`)
        if (el) el.classList.add(CLASS_HIDDEN)
      }
      if (activeKey && stencil.stateColors?.[activeKey]) {
        view.el.classList.add(stateColorClass(stencil.id, activeKey))
      }
    }

    // boolSource: группы условий. Тег делит состояние со всеми своими
    // использованиями; элемент активен, если ЛЮБАЯ группа выполнена целиком.
    for (const cell of graph.getCells()) {
      const { groups } = normalizeBoolSource(cell.get('tms')?.boolSource)
      if (!groups.length) continue
      const active = groups.some((g) => g.every((t) => !boolFalseFor(t)))
      if (active) continue
      paper.findViewByModel(cell)?.el?.classList.add(CLASS_OFF)
    }

    // Подпись со значением тега: рантайм пишет её textContent, превью — то же, с
    // точностью карточки. Исходный текст запомнен на старте (restoreValueTexts).
    for (const cell of graph.getElements()) {
      const tms = cell.get('tms') || {}
      const stencil = getStencilById(tms.stencilId)
      if (!stencil?.animationTemplate?.length) continue
      const view = paper.findViewByModel(cell)
      if (!view?.el) continue
      for (const tpl of stencil.animationTemplate) {
        if (tpl.type !== 'text') continue
        const tag = resolveBindingTag(tpl.bindings?.[0]?.tag, tms)
        if (!tag) continue
        const el = view.el.querySelector(`[id="${innerKey(stencil.id, cell.id, tpl.idSuffix)}"]`)
        if (!el) continue
        if (!valueTexts.has(el)) valueTexts.set(el, el.textContent)
        el.textContent = formatValueText(valueOf(tag), resolveValueDecimals(tms))
      }
    }
  }

  function startSimulation() {
    if (simulating.value || !canvas.paperRef.value) return
    injectSimulationCss(collectRangeColors())
    // Класс tms-simulating вешает Vue через :class на paperContainer.
    simulating.value = true
    applySimClass()
    simIntervalId = setInterval(applySimClass, SIM_CYCLE_MS)
  }

  function stopSimulation() {
    clearInterval(simIntervalId)
    simIntervalId = null
    simulating.value = false
    clearSimClasses()
    restoreValueTexts()
  }

  function toggleSimulation() {
    if (simulating.value) {
      stopSimulation()
      notify.info('Симуляция остановлена', undefined, TOAST_LIFE.SHORT)
    } else {
      startSimulation()
      notify.info('Симуляция запущена', undefined, TOAST_LIFE.SHORT)
    }
  }

  // Cleanup на unmount: таймер и sim-классы с view'ев (иначе классы зависают на
  // ячейках после HMR).
  onBeforeUnmount(() => {
    clearInterval(simIntervalId)
    simIntervalId = null
    if (simulating.value) clearSimClasses()
    // Свой <style> снимаем сами: он живёт в document.head и пережил бы unmount, а
    // собран по тем stateColors, что были на старте симуляции.
    document.getElementById(SIM_CSS_ID)?.remove()
  })

  // simValues + set/clear + formTags — API панели значений: она задаёт, чем кормить
  // превью, и показывает теги текущей формы.
  return {
    simulating,
    toggleSimulation,
    stopSimulation,
    simValues,
    setTagValue,
    clearTagValues,
    formTags,
    selectedTags,
  }
}
