import { computed, ref, shallowRef, onBeforeUnmount } from 'vue'
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
import { jointGraphAccess, resolveRangeSource } from '../utils/rangeSource'
import {
  boolOf,
  rangeRowFor,
  stateKeyFor,
  stateGroupsOf,
  formatValueText,
  randomValueForTag,
  slotRole,
} from '../utils/simValues'
import {
  EMPTY_TICKS,
  currentTick,
  pushTick,
  backTick,
  forwardTick,
  truncateAfterCurrent,
  replaceCurrentTick,
} from '../utils/tickHistory'
import { useProjectStore } from '../stores/useProjectStore'
import { getStencilById, getAllStencils, stateSlotOf } from '../stencils/registry'
import { useCanvas } from './useCanvas'

const SIM_CYCLE_MS = 1500
const SIM_CSS_ID = 'tms-sim-css'
/** Глубина шага назад: ~45 секунд прогона — столько, чтобы вернуться к мелькнувшему. */
const TICK_HISTORY_MAX = 30

/**
 * Слот, который драйвит состояние символа, — то же правило, что у инспектора
 * (`stateSlotOf`): ни подпись со значением, ни слот зон драйвером не бывают.
 */
const stateSlotKey = (stencil) => stateSlotOf(stencil?.slots)?.key

// СИНГЛТОН: композабл зовут и CanvasPane (запуск, классы), и SimulationPanel (значения
// тегов), поэтому состояние живёт в модуле — иначе у панели была бы своя симуляция.
const simulating = ref(false)
const paused = ref(false)
/** Значения тегов, заданные вручную: `tag → значение`. Остальные — случайные. */
const simValues = ref(new Map())
/**
 * Прошедшие тики и позиция просмотра (`utils/tickHistory`): шаг назад применяет
 * сохранённый набор, шаг вперёд с конца — генерирует новый. Правка значения обрезает
 * всё после текущей позиции, как новое действие в undo-стеке.
 *
 * `shallowRef`: состояние всегда заменяется целиком, а глубокая реактивность обернула
 * бы прокси каждый Map значений на каждом тике.
 */
const ticks = shallowRef(EMPTY_TICKS)
// Исходный текст подписей со значением: симуляция пишет в них число, остановка
// возвращает то, что нарисовано в символе.
const valueTexts = new Map()
let simIntervalId = null
// Сигнатура набора цветов, под который собран <style>: перекрасив строку во время
// симуляции, автор требует доинжектить правило.
let simCssKey = ''

/**
 * Симуляция: превью animation-классов по JS-таймеру.
 *
 * Источник — ЗНАЧЕНИЯ тегов (`simValues`), поэтому превью считает то же, что рантайм:
 * диапазон выбирается сравнением с границами, состояние «по значению» — по коду.
 * Значение одно на тег, значит все его элементы согласованы; не заданное вручную
 * догенерируется случайным и держится до конца тика.
 *
 * CSS под `.tms-simulating` инжектится в `<head>` и не протекает в обычный режим.
 * `stopSimulation` зовёт useProjectArchive перед экспортом и импортом.
 */
export function useSimulation() {
  const canvas = useCanvas()
  const project = useProjectStore()

  /** Пустое значение = вернуть тегу случайное: пустых записей в наборе не держим. */
  function setTagValue(tag, value) {
    const next = new Map(simValues.value)
    if (value == null) next.delete(tag)
    else next.set(tag, value)
    simValues.value = next
    if (!simulating.value) return
    // Правка обрывает просмотр истории: дальше прогон идёт от неё.
    ticks.value = truncateAfterCurrent(ticks.value)
    // Идущий прогон применит правку следующим тиком, на паузе её иначе не видно.
    if (!paused.value) return
    const patched = new Map(currentTick(ticks.value) || [])
    if (value == null) patched.delete(tag)
    else patched.set(tag, value)
    refreshCurrentTick(patched)
  }

  function clearTagValues() {
    simValues.value = new Map()
    if (!simulating.value) return
    ticks.value = truncateAfterCurrent(ticks.value)
    // Теги отпущены — на паузе показываем это сразу, новыми случайными значениями.
    if (paused.value) refreshCurrentTick(null)
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
    const access = jointGraphAccess(graph)
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
        const role = slotRole(slot, stencil)
        put(tag, role, role === 'state' ? { states: stencil.states } : {})
      }
      const vs = cellRangeSource(cell, access)
      if (vs?.tag) put(vs.tag, 'value', { rangeSource: vs })
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

  /**
   * Действующий источник диапазонов элемента — тем же резолвером, что экспорт: у
   * символа (и шины) зоны определения плюс тег слота `range`, у провода — унаследованный
   * по цепи. `access` — один на проход по графу.
   */
  function cellRangeSource(cell, access) {
    return resolveRangeSource(access.of(cell), access, getStencilById)
  }

  /** Строки источника с заданным цветом — только они дают класс (как в экспорте). */
  function colorRows(vs) {
    return (vs?.ranges || []).filter((r) => rangeRowColor(r))
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

  /** Снимает sim-классы элемента — range-класс с outer-g, animation-hidden/off с descendants. */
  function clearSimClassesOf(root) {
    // Цвет диапазона (animation-c-<цвет>) и цвет состояния (animation-color-<ключ>)
    // генерируются из данных, поэтому чистятся по префиксам, а не по списку.
    for (const cls of [...root.classList]) {
      if (cls.startsWith(STATE_COLOR_PREFIX) || cls.startsWith(RANGE_COLOR_PREFIX)) {
        root.classList.remove(cls)
      }
    }
    // animation-off от boolSource висит на outer-g, от символьного template — на
    // внутренних элементах: чистим оба места.
    root.classList.remove(CLASS_OFF)
    for (const el of root.querySelectorAll(`.${CLASS_HIDDEN}, .${CLASS_OFF}`)) {
      el.classList.remove(CLASS_HIDDEN)
      el.classList.remove(CLASS_OFF)
    }
  }

  function clearSimClasses() {
    const graph = canvas.graphRef.value
    const paper = canvas.paperRef.value
    for (const cell of graph?.getCells() || []) {
      const el = paper?.findViewByModel(cell)?.el
      if (el) clearSimClassesOf(el)
    }
  }

  /**
   * Одно значение per-tag за тик: ячейки/линки с одним тегом — согласованно. Возвращает
   * набор применённых значений (он же уходит в историю шагов).
   *
   * `preset` — набор прошлого тика: значения берутся из него и не генерируются заново,
   * поэтому шаг назад возвращает ровно ту картинку.
   */
  function applySimClass(preset = null) {
    const graph = canvas.graphRef.value
    const paper = canvas.paperRef.value
    if (!graph || !paper) return null

    // Значения тегов на этот тик: заданные вручную приоритетнее, остальные
    // догенерируются один раз и держатся до конца тика — иначе элементы с общим тегом
    // разъехались бы.
    const tickValues = new Map(preset || [])
    const valueOf = (tag) => {
      if (!tickValues.has(tag)) {
        const manual = simValues.value.get(tag)
        tickValues.set(tag, manual ?? randomValueForTag(tagInfo.value.get(tag) || {}))
      }
      return tickValues.get(tag)
    }
    const boolKey = (tag) => (boolOf(valueOf(tag)) ? 'true' : 'false')
    const access = jointGraphAccess(graph)
    // Цвета всех строк всех источников — из них CSS-правила (пересобираются, если цвет
    // поменяли на ходу).
    const colors = []

    for (const cell of graph.getCells()) {
      const view = paper.findViewByModel(cell)
      if (!view?.el) continue
      clearSimClassesOf(view.el)
      const tms = cell.get('tms') || {}

      // Диапазоны: значение общее по тегу, цвет — из НАСТРОЕК этого элемента (у провода —
      // унаследованный, см. cellRangeSource).
      const vs = cellRangeSource(cell, access)
      for (const r of colorRows(vs)) colors.push(rangeRowColor(r))
      const row = vs?.tag ? rangeRowFor(vs, valueOf(vs.tag)) : null
      if (row) view.el.classList.add(rangeColorClass(rangeRowColor(row)))

      // boolSource: группы условий. Элемент активен, если ЛЮБАЯ группа выполнена целиком.
      const { groups } = normalizeBoolSource(tms.boolSource)
      if (groups.length && !groups.some((g) => g.every((t) => boolKey(t) === 'true'))) {
        view.el.classList.add(CLASS_OFF)
      }

      const stencil = cell.isLink() ? null : getStencilById(tms.stencilId)
      if (stencil) applyStencilState(view.el, cell, tms, stencil, valueOf, boolKey)
    }

    if (colors.join('|') !== simCssKey) injectSimulationCss(colors)
    return tickValues
  }

  /** Анимации символа на тик: биндинги шаблона, цвет и группы состояний, подписи. */
  function applyStencilState(root, cell, tms, stencil, valueOf, boolKey) {
    const byId = (suffix) => root.querySelector(`[id="${innerKey(stencil.id, cell.id, suffix)}"]`)
    const states = Array.isArray(stencil.states) && stencil.states.length ? stencil.states : null
    const slotKey = stateSlotKey(stencil)
    const stateTag = slotKey ? tms.slots?.[slotKey] : null

    // Биндинги шаблона: тег резолвится ({slot.X} → tms.slots[X]); у булевых — класс
    // нужного case'а, у подписи со значением — текст, как пишет рантайм (исходный
    // запомнен на старте, restoreValueTexts).
    for (const tpl of stencil.animationTemplate || []) {
      const el = byId(tpl.idSuffix)
      if (!el) continue
      if (tpl.type === 'text') {
        const tag = resolveBindingTag(tpl.bindings?.[0]?.tag, tms)
        if (!tag) continue
        if (!valueTexts.has(el)) valueTexts.set(el, el.textContent)
        el.textContent = formatValueText(valueOf(tag), resolveValueDecimals(tms))
        continue
      }
      for (const binding of tpl.bindings || []) {
        const tag = resolveBindingTag(binding.tag, tms)
        const cases = binding.when?.cases
        if (!tag || !cases || typeof cases !== 'object') continue
        const cls = cases[boolKey(tag)]?.apply?.addClass
        if (cls) el.classList.add(cls)
      }
    }

    // Без тега слота-драйвера состояние не выбрать: рантайм показал бы все группы.
    if (!stateTag) return
    if (!states) {
      // Булев: перекрас по значению тега, согласованно с видимостью выше.
      const key = boolKey(stateTag)
      if (stencil.stateColors?.[key]) root.classList.add(stateColorClass(stencil.id, key))
      return
    }
    // «По значению»: активное выбирает КОД под значение тега (как cases рантайма);
    // совпадения нет — скрыты все группы. Видна группа, в чей набор входит активное
    // состояние (см. stateGroupsOf).
    const activeKey = stateKeyFor(states, valueOf(stateTag))
    for (const { suffix, keys } of stateGroupsOf(stencil)) {
      if (!keys.includes(activeKey)) byId(suffix)?.classList.add(CLASS_HIDDEN)
    }
    if (activeKey && stencil.stateColors?.[activeKey]) {
      root.classList.add(stateColorClass(stencil.id, activeKey))
    }
  }

  /** Новый тик: значения генерируются и запоминаются как последний шаг истории. */
  function runNextTick() {
    const values = applySimClass()
    if (!values) return
    ticks.value = pushTick(ticks.value, values, TICK_HISTORY_MAX)
  }

  /** Перерисовать текущий тик на месте — новым шагом истории правка не становится. */
  function refreshCurrentTick(preset) {
    const applied = applySimClass(preset)
    if (applied) ticks.value = replaceCurrentTick(ticks.value, applied)
  }

  const canStepBack = computed(() => ticks.value.index > 0)

  function pauseSimulation() {
    clearInterval(simIntervalId)
    simIntervalId = null
    paused.value = true
  }

  function resumeSimulation() {
    if (simIntervalId) return
    ticks.value = truncateAfterCurrent(ticks.value)
    paused.value = false
    simIntervalId = setInterval(runNextTick, SIM_CYCLE_MS)
  }

  function togglePause() {
    if (!simulating.value) return
    if (paused.value) resumeSimulation()
    else pauseSimulation()
  }

  /** Шаг назад по сохранённым тикам; как в плеере, сначала ставит прогон на паузу. */
  function stepBack() {
    if (!simulating.value) return
    const back = backTick(ticks.value)
    if (!back) return
    pauseSimulation()
    ticks.value = back
    applySimClass(currentTick(back))
  }

  /** Шаг вперёд: по истории, а с её конца — новый тик. */
  function stepForward() {
    if (!simulating.value) return
    pauseSimulation()
    const { state, needsNew } = forwardTick(ticks.value)
    if (needsNew) {
      runNextTick()
      return
    }
    ticks.value = state
    applySimClass(currentTick(state))
  }

  function startSimulation() {
    if (simulating.value || !canvas.paperRef.value) return
    simCssKey = null // CSS собирается заново на первом тике
    // Класс tms-simulating вешает Vue через :class на paperContainer.
    simulating.value = true
    paused.value = false
    ticks.value = EMPTY_TICKS
    runNextTick()
    simIntervalId = setInterval(runNextTick, SIM_CYCLE_MS)
  }

  function stopSimulation() {
    clearInterval(simIntervalId)
    simIntervalId = null
    simulating.value = false
    paused.value = false
    ticks.value = EMPTY_TICKS
    clearSimClasses()
    restoreValueTexts()
  }

  // Без тоста: режим и так виден — кнопка в тулбаре, зелёная рамка и метка на холсте.
  function toggleSimulation() {
    if (simulating.value) stopSimulation()
    else startSimulation()
  }

  onBeforeUnmount(() => {
    // Состояние живёт в модуле, поэтому размонтирование обязано СНЯТЬ симуляцию, а не
    // только таймер: иначе она осталась бы «включённой» без прогона.
    if (simulating.value) stopSimulation()
    // Свой <style> снимаем сами: он живёт в document.head и пережил бы unmount, а
    // собран по тем stateColors, что были на старте симуляции.
    document.getElementById(SIM_CSS_ID)?.remove()
  })

  // simValues + set/clear + formTags — API панели значений: она задаёт, чем кормить
  // превью, и показывает теги текущей формы; paused + шаги — управление прогоном
  // (кнопки тулбара видны, только пока превью идёт).
  return {
    simulating,
    toggleSimulation,
    stopSimulation,
    paused,
    togglePause,
    stepBack,
    stepForward,
    canStepBack,
    simValues,
    setTagValue,
    clearTagValues,
    formTags,
    selectedTags,
  }
}
