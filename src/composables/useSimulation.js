import { ref, onBeforeUnmount } from 'vue'
import { useToast } from 'primevue/usetoast'
import {
  ANIMATION_CLASS_COLORS,
  ANIMATION_CLASS_OPTIONS,
  ANIMATION_OFF_COLOR,
} from '../constants/animation'
import { TOAST_LIFE } from '../constants/toast'
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
 *  • `toggleSimulation` / `startSimulation` / `stopSimulation`
 */
export function useSimulation() {
  const canvas = useCanvas()
  const toast = useToast()
  const simulating = ref(false)
  let simIntervalId = null
  let simCssInjected = false

  function pickRandomVoltageClass() {
    // null = пропустить (тег «нейтральный»). Доля null = 1/(N+1).
    const idx = Math.floor(Math.random() * (ANIMATION_CLASS_OPTIONS.length + 1))
    return ANIMATION_CLASS_OPTIONS[idx] || null
  }

  /** Резолвит `{slot.X}` → актуальный тег из tms.slots[X], либо raw-tag как есть. */
  function resolveBindingTag(rawTag, tms) {
    const m = /^\{slot\.(.+)\}$/.exec(rawTag || '')
    if (!m) return rawTag || null
    return tms.slots?.[m[1]] || null
  }

  function injectSimulationCss() {
    if (simCssInjected) return
    const style = document.createElement('style')
    style.id = 'tms-sim-css'
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
    simCssInjected = true
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
      view.el.classList.remove('animation-off')
      for (const el of view.el.querySelectorAll('.animation-hidden, .animation-off')) {
        el.classList.remove('animation-hidden')
        el.classList.remove('animation-off')
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
    // ({slot.X} → tms.slots[X]), смотрим rolling state. Если тег в false-фазе —
    // применяем false-классы из биндинга. Несколько биндингов на одном теге
    // (например .QW + .QW-cross у cell_qw) переключаются согласованно.
    for (const cell of graph.getElements()) {
      const tms = cell.get('tms') || {}
      const stencil = getStencilById(tms.stencilId)
      if (!stencil?.animationTemplate?.length) continue
      const view = paper.findViewByModel(cell)
      if (!view?.el) continue
      for (const tpl of stencil.animationTemplate) {
        const targetId = `animation-${cell.id}${tpl.idSuffix || ''}`
        const el = view.el.querySelector(`[id="${targetId}"]`)
        if (!el) continue
        for (const binding of tpl.bindings || []) {
          const tag = resolveBindingTag(binding.tag, tms)
          if (!tag) continue
          if (!boolFalseFor(tag)) continue // true-фаза → пропускаем
          const cls = binding.when?.cases?.false?.apply?.addClass
          if (cls) el.classList.add(cls)
        }
      }
    }
    // switchSources: outer-g становится off если ХОТЯ БЫ ОДИН тег в false-фазе.
    // Каждый тег имеет общее состояние со всеми другими его использованиями
    // (если ОБЩИЙ.ONOFF = off, гасит все ячейки которые от него зависят).
    for (const cell of graph.getCells()) {
      const tags = cell.get('tms')?.switchSources?.tags
      if (!tags?.length) continue
      if (!tags.some((t) => boolFalseFor(t))) continue
      paper.findViewByModel(cell)?.el?.classList.add('animation-off')
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
      toast.add({ severity: 'info', summary: 'Симуляция остановлена', life: TOAST_LIFE.SHORT })
    } else {
      startSimulation()
      toast.add({ severity: 'info', summary: 'Симуляция запущена', life: TOAST_LIFE.SHORT })
    }
  }

  // Cleanup на unmount компонента — освобождаем таймер.
  onBeforeUnmount(() => {
    clearInterval(simIntervalId)
    simIntervalId = null
  })

  return { simulating, startSimulation, stopSimulation, toggleSimulation }
}
