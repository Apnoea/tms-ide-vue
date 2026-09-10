<script setup>
/**
 * Разделитель между боковой колонкой и холстом: drag меняет ширину колонки, двойной
 * клик возвращает её к дефолту. Кламп — на стороне стора (он же владеет пределами),
 * здесь только жест.
 *
 * Слушатели на `document`, а не на самой ручке: курсор во время drag'а уходит и на
 * холст, и за окно, а полоска шириной 8px теряла бы его на первом же быстром рывке.
 *
 * Пока тянем, гасим выделение текста на body: иначе drag выделяет подписи палитры и
 * инспектора.
 */
import { onBeforeUnmount, ref } from 'vue'
import { useEventListener } from '@vueuse/core'

const props = defineProps({
  /** С какой стороны холста колонка: у правой курсор двигает границу навстречу. */
  side: { type: String, required: true }, // 'left' | 'right'
  width: { type: Number, required: true },
})

const emit = defineEmits(['update', 'reset'])

const dragging = ref(false)
let startX = 0
let startWidth = 0

function onPointerDown(event) {
  // Только основная кнопка: средняя панит холст, правая открывает контекст-меню.
  if (event.button !== 0) return
  event.preventDefault()
  dragging.value = true
  startX = event.clientX
  startWidth = props.width
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'
}

useEventListener(document, 'pointermove', (event) => {
  if (!dragging.value) return
  const delta = event.clientX - startX
  emit('update', startWidth + (props.side === 'left' ? delta : -delta))
})

function stopDrag() {
  if (!dragging.value) return
  dragging.value = false
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
}

useEventListener(document, 'pointerup', stopDrag)
// Уход фокуса из окна во время drag'а (Alt+Tab) pointerup не даёт — жест завис бы.
useEventListener(window, 'blur', stopDrag)
// Колонку могли свернуть кнопкой прямо во время drag'а — ручка уходит вместе с ней, и
// снятые с body стили остались бы на всём приложении (курсор-ресайз, запрет выделения).
onBeforeUnmount(stopDrag)
</script>

<template>
  <div
    class="group relative w-2 shrink-0 cursor-col-resize self-stretch"
    role="separator"
    aria-orientation="vertical"
    :aria-label="side === 'left' ? 'Ширина левой панели' : 'Ширина инспектора'"
    @pointerdown="onPointerDown"
    @dblclick="emit('reset')"
  >
    <!-- Видимая линия узкая, а хватать удобно всей полоской: подсвечиваем на hover и
         на всё время drag'а (курсор в этот момент часто уже вне ручки). -->
    <span
      class="pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 rounded-full transition-colors"
      :class="dragging ? 'bg-primary-400' : 'bg-transparent group-hover:bg-surface-300'"
    />
  </div>
</template>
