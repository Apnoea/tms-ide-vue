<script setup>
/**
 * Диапазоны: полоска-превью и, когда их правят здесь же, строки «цвет — от — до».
 * ОДИН вид на два места: зоны символа в редакторе и диапазоны провода/шины на холсте —
 * иначе шкала выглядела бы по-разному там, где задаётся, и там, где применяется.
 *
 * `readonly` — только полоска: у символа зоны задаются в редакторе, и на холсте нужен
 * не список чисел, а картина шкалы. Состоянием владеет вызывающий, наружу уходят
 * intent'ы (update/add/remove).
 */
import { computed } from 'vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import ColorField from './ColorField.vue'
import { rangeRowColor, RANGE_COLOR_PRESETS } from '../constants/animation'
import { rangeBarSegments } from '../utils/rangeBar'

const props = defineProps({
  ranges: { type: Array, default: () => [] },
  readonly: { type: Boolean, default: false },
})

defineEmits(['update-range', 'add-range', 'remove-range'])

/** Сегменты полоски-превью; `null` — рисовать нечего (нет годных строк). */
const bar = computed(() => rangeBarSegments(props.ranges))

const rowColor = (r) => rangeRowColor(r) || RANGE_COLOR_PRESETS[0]

/** Пустая ячейка — строка без порога: в экспорт она не попадёт. */
const cellText = (v) => (Number.isFinite(v) ? String(v) : '')
</script>

<template>
  <div>
    <!-- Полоска-превью: в столбике чисел не видно ни порядка, ни пропусков, ни того,
         какая полоса шире. Фон под сегментами остаётся там, где значения цвета не
         получат. Пустую серую полосу и место под подписи держим всегда: иначе блок
         подпрыгивает, как только заполнят первую строку. -->
    <div class="relative mb-1 h-2 w-full overflow-hidden rounded-sm bg-surface-200">
      <span
        v-for="(s, i) in bar?.segments || []"
        :key="i"
        v-tooltip.top="`${s.from} – ${s.to}`"
        class="absolute inset-y-0"
        :style="{ left: `${s.left}%`, width: `${s.width}%`, background: s.color }"
      />
    </div>
    <div class="mb-2 flex h-3 justify-between font-mono text-[10px] leading-3 text-surface-400">
      <span>{{ bar ? bar.from : '' }}</span>
      <span>{{ bar ? bar.to : '' }}</span>
    </div>

    <template v-if="!readonly">
      <div class="space-y-1">
        <div v-for="(r, idx) in ranges" :key="idx" class="flex items-center gap-1.5">
          <!-- Цвет ПЕРВЫМ: он метка строки, а не настройка в конце — глаз связывает его
               с числами. Границы по содержимому (пять знаков), удаление справа. -->
          <ColorField
            :model-value="rowColor(r)"
            class="shrink-0"
            @update:model-value="$emit('update-range', idx, 'color', $event)"
          />
          <!-- Низ ПЕРВОЙ строки не правится и всегда показывает нуль: шкала начинается
               с него (пустое поле читалось бы как «порог не задан»). -->
          <InputText
            :model-value="idx === 0 ? cellText(r.min) || '0' : cellText(r.min)"
            :disabled="idx === 0"
            size="small"
            class="w-14! font-mono text-xs!"
            inputmode="decimal"
            @change="$emit('update-range', idx, 'min', $event.target.value)"
          />
          <span class="text-surface-400 text-xs">–</span>
          <InputText
            :model-value="cellText(r.max)"
            size="small"
            class="w-14! font-mono text-xs!"
            inputmode="decimal"
            @change="$emit('update-range', idx, 'max', $event.target.value)"
          />
          <Button
            v-tooltip.bottom="'Удалить строку'"
            icon="pi pi-times"
            severity="secondary"
            text
            size="small"
            class="ml-auto p-1! w-6! h-6! shrink-0"
            @click="$emit('remove-range', idx)"
          />
        </div>
      </div>

      <Button
        label="Добавить диапазон"
        icon="pi pi-plus"
        severity="secondary"
        text
        size="small"
        class="mt-1 p-1! text-xs!"
        @click="$emit('add-range')"
      />
    </template>
  </div>
</template>
