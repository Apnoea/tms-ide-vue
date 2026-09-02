<script setup>
/**
 * Вид тела шины и точки соединения: цвет и толщина. Цвет БАЗОВЫЙ — привязанные
 * диапазоны и обесточивание заливают его поверх, поэтому в рантайме свой цвет виден,
 * пока ни один animation-класс не активен. Толщина у шины — высота ячейки, у точки —
 * диаметр; минимум задаёт вызывающий (тоньше тело сливается с проводами, точка — с
 * пересечением линий).
 */
import InputNumber from 'primevue/inputnumber'

defineProps({
  color: { type: String, required: true },
  thickness: { type: Number, required: true },
  thicknessMin: { type: Number, required: true },
  thicknessMax: { type: Number, required: true },
})

const emit = defineEmits(['update-color', 'update-thickness'])
</script>

<template>
  <div class="space-y-2.5">
    <div class="flex items-center gap-3">
      <span class="text-[11px] uppercase tracking-wider text-surface-500 shrink-0">Цвет</span>
      <input
        type="color"
        :value="color"
        class="ml-auto h-8 w-10 cursor-pointer rounded border border-surface-300 bg-surface-0 p-0.5"
        @input="emit('update-color', $event.target.value)"
      />
    </div>

    <div class="flex items-center gap-3">
      <span class="text-[11px] uppercase tracking-wider text-surface-500 shrink-0">
        Толщина, px
      </span>
      <InputNumber
        :model-value="thickness"
        :min="thicknessMin"
        :max="thicknessMax"
        :step="1"
        show-buttons
        button-layout="horizontal"
        size="small"
        input-class="w-12! text-center"
        class="ml-auto"
        @update:model-value="(v) => emit('update-thickness', v)"
      />
    </div>
  </div>
</template>
