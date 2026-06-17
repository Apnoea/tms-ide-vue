import { ref, onBeforeUnmount } from 'vue'
import { useNotify, TOAST_LIFE } from './useNotify'
import {
  ANIMATION_CLASS_COLORS,
  ANIMATION_CLASS_OPTIONS,
  ANIMATION_OFF_COLOR,
  CLASS_OFF,
  CLASS_HIDDEN,
} from '../constants/animation'
import { innerKey, resolveSlotTemplate } from '../constants/ids'
import { normalizeSwitchSources } from '../utils/switchSources'
import { getStencilById } from '../stencils/registry'
import { useCanvas } from './useCanvas'

const SIM_CYCLE_MS = 1500

/**
 * Симуляция: визуальный preview animation-классов через JS-таймер.
 *
 * Группировка по тегу — на каждом тике один rolling state per-tag (lazy,
 * через voltageFor / boolFalseFor), и все ячейки/линки привязанные к одному
 * тегу рисуются согласованно. Тег voltage → low/mid/high/none; тег bool →
 * true/false. Это даёт реалистичную картину распространения — одна шина
 * одного цвета, выключатель и его зависимости в согласованной фазе.
 *
 * CSS под `.tms-simulating` инжектится один раз в `<head>` (не протекает в
 * обычный режим); класс на paperContainer вешает Vue через :class binding
 * (реактивно на `simulating` ref).
 *
 * Возвращает:
 *  • `simulating` — Ref<boolean> для template (`:class`/`:icon`)
 *  • `toggleSimulation`
 */
export function useSimulation() {
  const canvas = useCanvas()
  const notify = useNotify()
  const simulating = ref(false)
  let simIntervalId = null
  const SIM_CSS_ID = 'tms-sim-css'

  function pickRandomVoltageClass() {
    // null = пропустить (тег «нейтральный»). Доля null = 1/(N+1).
    const idx = Math.floor(Math.random() * (ANIMATION_CLASS_OPTIONS.length + 1))
    return ANIMATION_CLASS_OPTIONS[idx] || null
  }

  /** Резолвит `{slot.X}` → актуальный тег из tms.slots[X]. Общий шаблонный
   * резолвер из constants/ids — поведение синхронно с parser-экспортом. */
  function resolveBindingTag(rawTag, tms) {
    if (!rawTag) return null
    const { value, hadUnresolved } = resolveSlotTemplate(rawTag, tms.slots || {})
    return hadUnresolved ? null : value
  }

  function injectSimulationCss() {
    // Проверяем по id, а не флагу — флаг локален к instance композабла,
    // а после HMR/re-mount instance новый, но <style> в DOM уже есть.
    if (document.getElementById(SIM_CSS_ID)) return
    const style = document.createElement('style')
    style.id = SIM_CSS_ID
    // Исключения для voltage-stroke селектора:
    // [joint-selector="wrapper"] — у standard.Link широкий невидимый path для
    // хитбокса; без exclusion с !important становится окрашен и толст.
    // .tms-hit-area — наш прозрачный rect-хитбокс у каждой ячейки; без
    // exclusion рисует зелёную «рамку» у стенсилов без своей rect-обёртки.
    const voltageRules = Object.entries(ANIMATION_CLASS_COLORS)
      .map(
        ([cls, hex]) => `
.tms-simulating .${cls},
.tms-simulating .${cls} *:not(text):not([joint-selector="wrapper"]):not(.tms-hit-area) { stroke: ${hex} !important; }
.tms-simulating .${cls} .tms-voltage-fill,
.tms-simulating .${cls}.tms-voltage-fill { fill: ${hex} !important; }`
      )
      .join('\n')
    // Boolean false-classes — те же что навешивает WebScada-рантайм при value=false.
    // animation-off перебивает voltage-классы серым stroke'ом (descendant-схема
    // с теми же исключениями для wrapper/hit-area, что и у voltage). В отличие
    // от opacity 0.4 эффект чистый — voltage-цвет не «просвечивает» под dim'ом.
    const boolRules = `
.tms-simulating .animation-hidden { display: none !important; }
.tms-simulating .animation-off,
.tms-simulating .animation-off *:not(text):not([joint-selector="wrapper"]):not(.tms-hit-area) { stroke: ${ANIMATION_OFF_COLOR} !important; }
.tms-simulating .animation-off .tms-voltage-fill,
.tms-simulating .animation-off.tms-voltage-fill { fill: ${ANIMATION_OFF_COLOR} !important; }`
    style.textContent = voltageRules + '\n' + boolRules
    document.head.appendChild(style)
  }

  /** Снимает все sim-классы — voltage с outer-g, animation-hidden/off с descendants. */
  function clearSimClasses() {
    const graph = canvas.graphRef.value
    const paper = canvas.paperRef.value
    if (!graph || !paper) return
    for (const cell of graph.getCells()) {
      const view = paper.findViewByModel(cell)
      if (!view?.el) continue
      for (const cls of ANIMATION_CLASS_OPTIONS) view.el.classList.remove(cls)
      // animation-off от switchSource висит на outer-g (затемнение всей ячейки),
      // от стенсильного template — на внутренних элементах. Чистим оба места.
      view.el.classList.remove(CLASS_OFF)
      for (const el of view.el.querySelectorAll(`.${CLASS_HIDDEN}, .${CLASS_OFF}`)) {
        el.classList.remove(CLASS_HIDDEN)
        el.classList.remove(CLASS_OFF)
      }
    }
  }

  /** Один rolling state per-tag за тик: ячейки/линки с одним тегом — согласованно. */
  function applySimClass() {
    const graph = canvas.graphRef.value
    const paper = canvas.paperRef.value
    if (!graph || !paper) return
    clearSimClasses()

    // Per-tag stateful pickers. Lazy: rolling state кэшируется при первом
    // обращении, последующие cell'ы с тем же тегом получают то же значение.
    const voltageByTag = new Map() // tag → class | null
    const boolByTag = new Map() // tag → boolean (true = on, false = off-фаза)
    const voltageFor = (tag) => {
      if (!voltageByTag.has(tag)) voltageByTag.set(tag, pickRandomVoltageClass())
      return voltageByTag.get(tag)
    }
    const boolFalseFor = (tag) => {
      if (!boolByTag.has(tag)) boolByTag.set(tag, Math.random() < 0.5)
      return boolByTag.get(tag)
    }

    // Voltage: класс по тегу. Все ячейки/линки с PS031.UA в одном цвете.
    for (const cell of graph.getCells()) {
      const tag = cell.get('tms')?.voltageSource?.tag
      if (!tag) continue
      const cls = voltageFor(tag)
      if (!cls) continue
      paper.findViewByModel(cell)?.el?.classList.add(cls)
    }
    // cell_node наследует voltage от соединённого провода — берём тег первого
    // подходящего линка и используем его state (тот же что у провода).
    for (const cell of graph.getElements()) {
      const tms = cell.get('tms') || {}
      if (tms.stencilId !== 'cell_node' || tms.voltageSource?.tag) continue
      const link = graph.getConnectedLinks(cell).find((l) => l.get('tms')?.voltageSource?.tag)
      if (!link) continue
      const cls = voltageFor(link.get('tms').voltageSource.tag)
      if (!cls) continue
      paper.findViewByModel(cell)?.el?.classList.add(cls)
    }

    // Bool-биндинги стенсильного template: для КАЖДОГО binding'а резолвим тег
    // ({slot.X} → tms.slots[X]), смотрим rolling state и применяем класс
    // соответствующего case'а (true или false). Несколько биндингов на одном
    // теге (например .QW + .QW-cross у cell_qw или .closed + .open у
    // cell_qr/cell_qk/cell_qf) переключаются согласованно.
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
    // switchSources: каждый тег делит состояние со всеми использованиями
    // (ОБЩИЙ.ONOFF=false гасит все зависящие ячейки). Активен =
    // (любой «Параллельно» = true) ИЛИ (все «Последовательно» = true).
    for (const cell of graph.getCells()) {
      const { or, and } = normalizeSwitchSources(cell.get('tms')?.switchSources)
      if (!or.length && !and.length) continue
      const orLive = or.some((t) => !boolFalseFor(t))
      const andLive = and.length > 0 && and.every((t) => !boolFalseFor(t))
      if (orLive || andLive) continue
      paper.findViewByModel(cell)?.el?.classList.add(CLASS_OFF)
    }
  }

  function startSimulation() {
    if (simulating.value || !canvas.paperRef.value) return
    injectSimulationCss()
    // Класс tms-simulating вешает Vue через :class binding на paperContainer
    // — реактивно на simulating ref. Manual classList.add тут не нужен.
    simulating.value = true
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

  // Cleanup на unmount компонента — освобождаем таймер и снимаем sim-классы
  // с view'ев (иначе классы зависают на cell'ах после HMR / re-mount'а).
  onBeforeUnmount(() => {
    clearInterval(simIntervalId)
    simIntervalId = null
    if (simulating.value) clearSimClasses()
  })

  return { simulating, toggleSimulation }
}
