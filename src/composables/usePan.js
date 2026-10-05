import { useEventListener } from '@vueuse/core'
import { useCanvas } from './useCanvas'
import { isFocusInInput } from '../utils/viewKeys'

/**
 * Pan холста: средняя кнопка или Space+ЛКМ двигают paper (translate), обычный ЛКМ по
 * пустому — лассо. Space-pan работает только с курсором над холстом: иначе пробел
 * перехватывался бы в остальном UI. Move/up слушаются на document — drag может уйти за
 * пределы холста; всё снимается само (useEventListener).
 *
 * Курсор холста — grab при зажатом Space, grabbing во время pan'а — ставится здесь же,
 * инлайн-стилем контейнера: у него один владелец. Флаги не reactive — их читают
 * raw-хендлеры.
 *
 * @param {import('vue').Ref<HTMLElement|null>} container — контейнер paper'а
 */
export function usePan(container) {
  const canvas = useCanvas()
  let panning = false
  let panStart = null
  let spaceHeld = false
  let overCanvas = false

  function setCursor(value) {
    if (container.value) container.value.style.cursor = value
  }

  // Capture-фаза: перехват ДО JointJS, чтобы средняя кнопка и Space+ЛКМ не начали drag
  // элемента и не всплыли в blank:pointerdown как лассо. preventDefault на средней
  // кнопке гасит autoscroll-кружок Windows.
  function onMouseDown(event) {
    const paper = canvas.paperRef.value
    if (!paper || !(event.button === 1 || (event.button === 0 && spaceHeld))) return
    event.preventDefault()
    event.stopPropagation()
    panning = true
    const { tx, ty } = paper.translate()
    panStart = { clientX: event.clientX, clientY: event.clientY, tx, ty }
    setCursor('grabbing')
  }

  function onMouseMove(event) {
    const paper = canvas.paperRef.value
    if (!panning || !paper) return
    paper.translate(
      panStart.tx + event.clientX - panStart.clientX,
      panStart.ty + event.clientY - panStart.clientY
    )
    canvas.bumpPaperView()
  }

  // После любого mouseup курсор возвращается в покой: grab, если Space ещё зажат над
  // холстом, иначе обычный.
  function onMouseUp() {
    panning = false
    panStart = null
    setCursor(spaceHeld ? 'grab' : '')
  }

  function onSpaceDown(event) {
    if (event.code !== 'Space' || spaceHeld || !overCanvas || isFocusInInput(event.target)) return
    spaceHeld = true
    event.preventDefault() // пробел не должен скроллить страницу / жать фокус-кнопку
    setCursor('grab')
  }

  function onSpaceUp(event) {
    if (event.code !== 'Space') return
    spaceHeld = false
    if (!panning) setCursor('')
  }

  useEventListener(container, 'mousedown', onMouseDown, true)
  useEventListener(container, 'mouseenter', () => (overCanvas = true))
  useEventListener(container, 'mouseleave', () => (overCanvas = false))
  useEventListener(document, 'mousemove', onMouseMove)
  useEventListener(document, 'mouseup', onMouseUp)
  useEventListener(window, 'keydown', onSpaceDown)
  useEventListener(window, 'keyup', onSpaceUp)
}
