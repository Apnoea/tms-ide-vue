import { ref, onBeforeUnmount } from 'vue'
import { useNotify, TOAST_LIFE } from './useNotify'
import {
  ANIMATION_CLASS_OPTIONS,
  CLASS_OFF,
  CLASS_HIDDEN,
  STATE_COLOR_PREFIX,
  buildVoltageCssRules,
  buildStateColorCssRules,
  stateColorClass,
} from '../constants/animation'
import { innerKey, resolveSlotTemplate } from '../constants/ids'
import { normalizeSwitchSources } from '../utils/switchSources'
import { getStencilById, getAllStencils } from '../stencils/registry'
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
  // Счётчик тиков — циклическая смена value-состояний (states[simTick % N]).
  // Персистентен между тиками (в отличие от per-tag rolling, что случаен каждый тик).
  let simTick = 0
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
    // Пересобираем на каждый старт (remove + add): цвета состояний (stateColors)
    // автор мог изменить и пересохранить — кэш дал бы старый цвет. Заодно это
    // снимает дубль <style> после HMR/re-mount (id тот же, старый удаляется).
    document.getElementById(SIM_CSS_ID)?.remove()
    const style = document.createElement('style')
    style.id = SIM_CSS_ID
    // Те же voltage/off-правила, что эмитит exporter, но scope'нуты под
    // .tms-simulating и с доп. исключениями для живого DOM редактора:
    // [joint-selector="wrapper"] — широкий невидимый hit-path standard.Link
    // (без exclusion с !important красится и толстеет); .tms-hit-area — наш
    // прозрачный rect-хитбокс ячейки (иначе зелёная «рамка» у стенсилов без
    // своей rect-обёртки). animation-hidden гасим отдельно (в экспорте — без !important).
    const strokeExtra = ':not([joint-selector="wrapper"]):not(.tms-hit-area)'
    const voltageOffCss = buildVoltageCssRules({ scope: '.tms-simulating ', strokeExtra }).join(
      '\n'
    )
    // State-color: те же правила, что в exporter, но scope'нуты под .tms-simulating.
    const stateColorCss = buildStateColorCssRules(getAllStencils(), {
      scope: '.tms-simulating ',
      strokeExtra,
    }).join('\n')
    style.textContent = `.tms-simulating .${CLASS_HIDDEN} { display: none !important; }\n${voltageOffCss}\n${stateColorCss}`
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
      // Цвет состояния (animation-color-<ключ>) — ключи динамические, чистим по префиксу.
      for (const cls of [...view.el.classList]) {
        if (cls.startsWith(STATE_COLOR_PREFIX)) view.el.classList.remove(cls)
      }
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
    // теге (например .true у cell_qw или .true + .false у
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
    // State-color БУЛЕВ: класс перекраса по активной bool-фазе (согласовано с
    // видимостью выше). Value-стенсилы обрабатываются циклом ниже.
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

    // Value-состояния: ЦИКЛИЧЕСКАЯ смена (видимость групп + цвет). Активное =
    // states[simTick % N] — автор видит каждое состояние по кругу; ячейки одного
    // стенсила синхронны (общий tick). Прячем не-активные группы (animation-hidden),
    // на outer вешаем цвет активного. Гейт по привязанному тегу слота value: без
    // тега рантайм значения не имеет и показал бы все группы — эмулируем так же.
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

    simTick++ // следующий тик — следующее value-состояние по кругу
  }

  function startSimulation() {
    if (simulating.value || !canvas.paperRef.value) return
    injectSimulationCss()
    // Класс tms-simulating вешает Vue через :class binding на paperContainer
    // — реактивно на simulating ref. Manual classList.add тут не нужен.
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

  // Cleanup на unmount компонента — освобождаем таймер и снимаем sim-классы
  // с view'ев (иначе классы зависают на cell'ах после HMR / re-mount'а).
  onBeforeUnmount(() => {
    clearInterval(simIntervalId)
    simIntervalId = null
    if (simulating.value) clearSimClasses()
  })

  return { simulating, toggleSimulation, stopSimulation }
}
