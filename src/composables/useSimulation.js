import { ref, onBeforeUnmount } from 'vue'
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
} from '../constants/animation'
import { innerKey, resolveSlotTemplate } from '../constants/ids'
import { normalizeBoolSource } from '../utils/boolSource'
import { getStencilById, getAllStencils } from '../stencils/registry'
import { useCanvas } from './useCanvas'

const SIM_CYCLE_MS = 1500

/**
 * Симуляция: визуальный preview animation-классов через JS-таймер.
 *
 * Группировка по тегу: на каждом тике одна фаза per-tag (lazy, phaseFor /
 * boolFalseFor), поэтому все элементы с этим тегом рисуются согласованно — у значения
 * фаза выбирает строку источника (цвет берётся из настроек элемента), у булева —
 * true/false.
 *
 * CSS под `.tms-simulating` инжектится в `<head>` и не протекает в обычный режим;
 * класс на paperContainer вешает Vue через :class.
 *
 * Возвращает:
 *  • `simulating` — Ref<boolean> для template (`:class`/`:icon`)
 *  • `toggleSimulation`
 *  • `stopSimulation` — принудительная остановка (зовёт useProject перед экспортом/импортом)
 */
export function useSimulation() {
  const canvas = useCanvas()
  const notify = useNotify()
  const simulating = ref(false)
  let simIntervalId = null
  // Счётчик тиков — циклическая смена value-состояний (states[simTick % N]); в отличие
  // от фазы тега он persistent между тиками.
  let simTick = 0
  const SIM_CSS_ID = 'tms-sim-css'

  /**
   * Фаза тега: доля 0..1 либо null («нейтральный» тег, вероятность 1/4). Именно фаза, а
   * не готовый класс: цвета свои у каждого источника, и по одной фазе элементы с общим
   * тегом красятся согласованно, каждый своей строкой.
   */
  function pickRandomPhase() {
    const r = Math.random()
    return r < 0.25 ? null : (r - 0.25) / 0.75
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

  // Сигнатура набора цветов, под который собран <style>: перекрасив строку во время
  // симуляции, автор требует доинжектить правило.
  let simCssKey = ''

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

  /** Одна фаза per-tag за тик: ячейки/линки с одним тегом — согласованно. */
  function applySimClass() {
    const graph = canvas.graphRef.value
    const paper = canvas.paperRef.value
    if (!graph || !paper) return
    clearSimClasses()
    // Цвет строки могли поменять на ходу — правило под него могло не попасть в CSS.
    const colors = collectRangeColors()
    if (colors.join('|') !== simCssKey) injectSimulationCss(colors)

    // Per-tag pickers: фаза кэшируется при первом обращении, остальные элементы с тем
    // же тегом получают её же.
    const phaseByTag = new Map() // tag → доля 0..1 | null
    const boolByTag = new Map() // tag → boolean (true = false-фаза/off, false = on)
    const phaseFor = (tag) => {
      if (!phaseByTag.has(tag)) phaseByTag.set(tag, pickRandomPhase())
      return phaseByTag.get(tag)
    }
    const boolFalseFor = (tag) => {
      if (!boolByTag.has(tag)) boolByTag.set(tag, Math.random() < 0.5)
      return boolByTag.get(tag)
    }
    /** Класс строки источника по фазе тега: цвет берём из НАСТРОЕК этого элемента. */
    const rangeClassFor = (vs) => {
      const phase = phaseFor(vs.tag)
      if (phase === null) return null
      const rows = colorRows(vs)
      if (!rows.length) return null
      const idx = Math.min(rows.length - 1, Math.floor(phase * rows.length))
      return rangeColorClass(rangeRowColor(rows[idx]))
    }

    // Источник значения: фаза общая по тегу, цвет — свой у каждого элемента.
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
    // tms.slots[X]), берётся фаза тега и применяется класс нужного case'а. Несколько
    // биндингов на одном теге переключаются согласованно.
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
    // State-color БУЛЕВ: класс перекраса по активной bool-фазе, согласованно с
    // видимостью выше. Value-символы — цикл ниже.
    for (const cell of graph.getElements()) {
      const tms = cell.get('tms') || {}
      const stencil = getStencilById(tms.stencilId)
      const colors = stencil?.stateColors
      if (!colors || !Object.keys(colors).length) continue
      if (Array.isArray(stencil.states) && stencil.states.length) continue // value — ниже
      const slotKey = stencil.slots?.[0]?.key
      const tag = slotKey ? tms.slots?.[slotKey] : null
      if (!tag) continue
      const key = boolFalseFor(tag) ? 'false' : 'true'
      if (colors[key])
        paper.findViewByModel(cell)?.el?.classList.add(stateColorClass(stencil.id, key))
    }

    // Value-состояния: циклическая смена видимости групп и цвета. Активное =
    // states[simTick % N], ячейки одного символа синхронны (общий tick). Гейт по
    // привязанному тегу слота value: без тега рантайм показал бы все группы.
    for (const cell of graph.getElements()) {
      const tms = cell.get('tms') || {}
      const stencil = getStencilById(tms.stencilId)
      const states = stencil?.states
      if (!Array.isArray(states) || !states.length) continue
      const slotKey = stencil.slots?.[0]?.key
      const tag = slotKey ? tms.slots?.[slotKey] : null
      if (!tag) continue
      const view = paper.findViewByModel(cell)
      if (!view?.el) continue
      const active = states[simTick % states.length]
      for (const st of states) {
        if (st.key === active.key) continue
        const el = view.el.querySelector(`[id="${innerKey(stencil.id, cell.id, '.' + st.key)}"]`)
        if (el) el.classList.add(CLASS_HIDDEN)
      }
      const color = stencil.stateColors?.[active.key]
      if (color) view.el.classList.add(stateColorClass(stencil.id, active.key))
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

    simTick++ // следующий тик — следующее value-состояние по кругу
  }

  function startSimulation() {
    if (simulating.value || !canvas.paperRef.value) return
    injectSimulationCss(collectRangeColors())
    // Класс tms-simulating вешает Vue через :class на paperContainer.
    simulating.value = true
    simTick = 0 // начинаем цикл value-состояний с первого
    applySimClass()
    simIntervalId = setInterval(applySimClass, SIM_CYCLE_MS)
  }

  function stopSimulation() {
    clearInterval(simIntervalId)
    simIntervalId = null
    simulating.value = false
    clearSimClasses()
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

  return { simulating, toggleSimulation, stopSimulation }
}
