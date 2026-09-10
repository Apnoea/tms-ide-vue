<script setup>
/**
 * Поле цвета: свотч, палитра в поповере, код и недавние цвета.
 *
 * Нативный `<input type="color">` не подходит: его диалог показывает hex только после
 * переключения формата, выбор не запоминается между открытиями, и управлять этим со
 * страницы нельзя. Поэтому пикер свой (PrimeVue `ColorPicker`, формат `hex`), а рядом
 * с ним — поле кода (цвета приходят строкой из фирменной палитры) и недавние цвета
 * (`useRecentColors`, общие на все поля приложения).
 *
 * Палитра правит цвет ЖИВЬЁМ (`update:modelValue` на каждый сдвиг) — результат виден
 * на схеме сразу; код применяется по КОММИТУ (Enter / потеря фокуса), потому что
 * промежуточные `#f`/`#f5` цветом не являются. Невалидный ввод откатывается к текущему
 * значению: пустого цвета у поля нет.
 *
 * `change` — жест закончен (палитра закрыта, код или недавний цвет применён): по нему
 * пишется шаг истории в редакторе символов и запоминается недавний цвет.
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import InputText from 'primevue/inputtext'
import ColorPicker from 'primevue/colorpicker'
import Popover from 'primevue/popover'
import { useRecentColors, RECENT_MAX } from '../composables/useRecentColors'

const props = defineProps({
  /**
   * Цвет в формате `#rrggbb` (короткая запись разворачивается). Пустое значение и
   * `none` дают чёрный: своего «нет цвета» у поля нет — запасной цвет для таких
   * случаев подставляет вызывающий, он знает, чем заменить.
   */
  modelValue: { type: String, default: '' },
  /**
   * Класс свотча: размеры у полей инспектора и у списка состояний разные. По умолчанию
   * квадрат 30×30 — высота как у компактных контролов (`.p-inputtext` в style.css),
   * иначе поле цвета раздвигает строку инспектора.
   */
  swatchClass: { type: String, default: 'h-[30px] w-[30px]' },
})

const emit = defineEmits(['update:modelValue', 'change'])

const { recentColors, pushRecentColor } = useRecentColors()
// Слотов всегда RECENT_MAX: пустые показываем белыми, иначе ряд появлялся бы только
// после первого выбора и поповер «прыгал» бы по высоте.
const recentSlots = computed(() =>
  Array.from({ length: RECENT_MAX }, (_, i) => recentColors.value[i] ?? null)
)

/** Палитра и свотч работают с 6-значным `#rrggbb`: короткую запись разворачиваем. */
function toHex6(value) {
  const v = String(value || '').trim()
  const hash = v.startsWith('#') ? v : `#${v}`
  if (/^#[0-9a-fA-F]{6}$/.test(hash)) return hash.toLowerCase()
  if (/^#[0-9a-fA-F]{3}$/.test(hash)) {
    return ('#' + [...hash.slice(1)].map((c) => c + c).join('')).toLowerCase()
  }
  return null
}

const color = computed(() => toHex6(props.modelValue) || '#000000')

// Черновик кода: пока его набирают, показываем набранное, иначе — значение цвета.
const draft = ref(null)
const hex = computed(() => draft.value ?? color.value)

const popover = ref(null)
// Последний цвет, выбранный палитрой: держим ЕГО, а не `color` (тот считается из
// `modelValue`, а вызывающий может применить правку не сразу или не применить вовсе —
// при «разных» значениях выделения).
let pendingColor = null

const openPopover = (event) => popover.value?.toggle(event)

function apply(value) {
  if (value !== props.modelValue) emit('update:modelValue', value)
}

/** Жест закончен: цвет уходит в недавние, вызывающий пишет шаг истории. */
function finish(value) {
  pendingColor = null
  pushRecentColor(value)
  emit('change')
}

/** ColorPicker отдаёт hex БЕЗ решётки. */
function onPickerInput(value) {
  const next = toHex6(String(value || ''))
  if (!next) return
  pendingColor = next
  apply(next)
}

/** Выбор мышью фиксируется по ЗАКРЫТИЮ палитры — любым способом (клик вне, повторный
 *  клик по свотчу, Esc): промежуточные оттенки в историю не попадают. */
function onPopoverHide() {
  if (pendingColor) finish(pendingColor)
}

// Палитра может уйти вместе с компонентом (перерисовка инспектора со сменой выделения),
// а `hide` эмитится хуком анимации закрытия и тогда не придёт — фиксируем сами.
onBeforeUnmount(() => {
  if (pendingColor) finish(pendingColor)
})

/**
 * Ввод принимаем и без `#`, и в короткой записи — так его копируют из палитр. Esc в
 * поле отменяет НАБРАННОЕ и не всплывает: закрывать палитру им же значило бы терять
 * и то, что уже выбрано мышью.
 */
function commitHex() {
  const typed = draft.value
  draft.value = null
  const next = toHex6(typed)
  if (!next || next === color.value) return
  apply(next)
  finish(next)
}

function applyRecent(value) {
  apply(value)
  finish(value)
}
</script>

<template>
  <span class="inline-flex items-center">
    <!-- Слот `trigger` — своя кнопка вместо свотча (в тулбаре холста это иконка
         палитры), `badge` — крестик сброса на углу открывающего элемента. -->
    <span class="relative inline-flex shrink-0">
      <slot name="trigger" :open="openPopover" :color="color">
        <button
          type="button"
          class="cursor-pointer rounded border border-surface-300 bg-surface-0 p-0.5"
          :class="swatchClass"
          :aria-label="`Цвет ${color}`"
          @click="openPopover($event)"
        >
          <span class="block h-full w-full rounded-sm" :style="{ background: color }" />
        </button>
      </slot>
      <slot name="badge" />
    </span>

    <Popover ref="popover" class="tms-color-popover" @hide="onPopoverHide">
      <div class="flex flex-col items-center">
        <ColorPicker inline format="hex" :model-value="color" @update:model-value="onPickerInput" />
        <!-- Отступ у ряда свой: у поповера паддинга нет, чтобы палитра прилегала к
             краям, а вплотную к ним поле читалось бы как обрезанное. Слева недавние
             цвета (подобрал один раз — ставишь в один клик), справа поле кода. -->
        <div class="flex w-full items-center gap-2 px-2 pb-2">
          <span class="flex items-center gap-1">
            <button
              v-for="(c, i) in recentSlots"
              :key="i"
              v-tooltip.top="c || ''"
              type="button"
              class="h-5 w-5 shrink-0 rounded-sm border border-surface-300 bg-surface-0"
              :class="c ? 'cursor-pointer' : 'cursor-default'"
              :style="c ? { background: c } : null"
              :disabled="!c"
              @click="c && applyRecent(c)"
            />
          </span>
          <InputText
            :model-value="hex"
            size="small"
            class="ml-auto w-[76px]! font-mono text-xs!"
            spellcheck="false"
            @update:model-value="draft = $event"
            @blur="commitHex"
            @keydown.enter.prevent="commitHex"
            @keydown.esc.stop.prevent="draft = null"
          />
        </div>
      </div>
    </Popover>
  </span>
</template>
