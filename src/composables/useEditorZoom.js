import { computed, nextTick, ref } from 'vue'
import { useElementSize, useEventListener } from '@vueuse/core'
import { ZOOM_STEP } from './useCanvasZoom'

/**
 * Пределы ручного зума — в единицах scale (px на единицу модели), а не в процентах: от
 * размера стола они не зависят.
 */
export const MIN_SCALE = 1
export const MAX_SCALE = 48

/**
 * Опорная точка шкалы: 100% = символ 50×50 во всю область стола. Проценты от
 * натуральной величины (единица модели = пиксель схемы) читались бы как «1200%».
 */
const ZOOM_BASE_SIZE = 50

/**
 * Масштаб стола редактора символов. По умолчанию символ вписан в доступную область с
 * запасом (кламп держит мелкие символы от раздувания до пикселизации, а крупные — в
 * пределах области) и следует за размером символа и окна. Ручной зум — поверх, жесты
 * как на холсте схемы: Ctrl/Cmd+колесо к курсору, ± шагом ZOOM_STEP, «вписать».
 *
 * Голое колесо остаётся нативной прокрутке стола (у него overflow-auto) — как на
 * холсте, где оно панорамирует; зум только с Ctrl/Cmd, он же трекпадный pinch.
 *
 * @param {object} deps
 * @param {import('vue').Ref<HTMLElement|null>} deps.stageEl — прокручиваемая область стола
 * @param {import('vue').Ref<SVGSVGElement|null>} deps.svgEl — SVG символа
 * @param {{ width: number, height: number }} deps.meta — размер символа (reactive)
 */
export function useEditorZoom({ stageEl, svgEl, meta }) {
  const { width: stageW, height: stageH } = useElementSize(stageEl)
  // Доступная под символ область стола (за вычетом полей).
  const stageAvail = computed(() => ({
    w: Math.max(1, stageW.value - 48),
    h: Math.max(1, stageH.value - 48),
  }))
  const fitScale = computed(() => {
    const { w, h } = stageAvail.value
    const fit = Math.min(w / meta.width, h / meta.height)
    return Math.max(3, Math.min(24, fit))
  })
  const baseScale = computed(() => {
    const { w, h } = stageAvail.value
    return Math.min(w, h) / ZOOM_BASE_SIZE
  })
  // `null` — «вписано».
  const manualScale = ref(null)
  const scale = computed(() => manualScale.value ?? fitScale.value)
  const zoomPercent = computed(() => Math.round((scale.value / baseScale.value) * 100))
  const pxW = computed(() => meta.width * scale.value)
  const pxH = computed(() => meta.height * scale.value)

  /**
   * Зум с якорем: точка модели под курсором остаётся под ним. Пересчитываем по bbox
   * SVG уже ПОСЛЕ перерисовки — стол центрирует контент флексом, и предсказать новые
   * поля по scrollLeft/Top нельзя.
   */
  async function zoomAt(clientX, clientY, factor) {
    const stage = stageEl.value
    const svg = svgEl.value
    if (!stage || !svg) return
    const before = scale.value
    const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, before * factor))
    if (next === before) return
    const rect = svg.getBoundingClientRect()
    const ux = (clientX - rect.left) / before
    const uy = (clientY - rect.top) / before
    manualScale.value = next
    await nextTick()
    const after = svg.getBoundingClientRect()
    stage.scrollLeft += after.left + ux * next - clientX
    stage.scrollTop += after.top + uy * next - clientY
  }

  /** Кнопки ± и клавиши: якорь — центр видимой области стола. */
  function zoomByStep(factor) {
    const rect = stageEl.value?.getBoundingClientRect()
    if (!rect) return
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor)
  }

  function fitView() {
    manualScale.value = null
  }

  useEventListener(
    stageEl,
    'wheel',
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      zoomAt(e.clientX, e.clientY, e.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP)
    },
    { passive: false }
  )

  return {
    stageW,
    stageH,
    scale,
    pxW,
    pxH,
    zoomPercent,
    zoomIn: () => zoomByStep(ZOOM_STEP),
    zoomOut: () => zoomByStep(1 / ZOOM_STEP),
    fitView,
  }
}
