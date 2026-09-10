<script setup>
/**
 * Вид тела шины и точки соединения: цвет и толщина. Цвет БАЗОВЫЙ — привязанные
 * диапазоны и обесточивание заливают его поверх, поэтому в рантайме свой цвет виден,
 * пока ни один animation-класс не активен. Толщина у шины — высота ячейки, у точки —
 * диаметр; минимум задаёт вызывающий (тоньше тело сливается с проводами, точка — с
 * пересечением линий).
 */
import { computed } from 'vue'
import InputNumber from 'primevue/inputnumber'
import ColorField from './ColorField.vue'

const props = defineProps({
  color: { type: String, required: true },
  /** Цвет по умолчанию: в `tms` он не пишется, и крестик сброса ведёт к нему. */
  colorDefault: { type: String, required: true },
  thickness: { type: Number, required: true },
  thicknessMin: { type: Number, required: true },
  thicknessMax: { type: Number, required: true },
  /** Толщина по умолчанию: в `tms` она не пишется, и крестик сброса ведёт к ней. */
  thicknessDefault: { type: Number, required: true },
})

const emit = defineEmits(['update-color', 'update-thickness'])

/** Цвет свой, а не дефолтный — только тогда показываем сброс, как у провода. */
const isCustomColor = computed(
  () => props.color?.toLowerCase() !== props.colorDefault.toLowerCase()
)

const isCustomThickness = computed(() => props.thickness !== props.thicknessDefault)
</script>

<template>
  <div class="space-y-2.5">
    <div class="flex items-center gap-3">
      <span class="text-[11px] uppercase tracking-wider text-surface-500 shrink-0">Цвет</span>
      <ColorField
        :model-value="color"
        class="ml-auto"
        @update:model-value="emit('update-color', $event)"
      >
        <!-- Крестик поверх свотча — сброс к дефолту, как у цвета провода: виден только
             когда цвет свой, иначе висел бы пустым обещанием. -->
        <template #badge>
          <button
            v-if="isCustomColor"
            v-tooltip.bottom="'Вернуть цвет по умолчанию'"
            type="button"
            class="absolute -right-0.5 -top-0.5 z-10 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-surface-300 bg-surface-0 text-surface-500 shadow-sm hover:text-surface-800"
            @click.stop="emit('update-color', colorDefault)"
          >
            <i class="pi pi-times text-[7px]!" />
          </button>
        </template>
      </ColorField>
    </div>

    <div class="flex items-center gap-3">
      <span class="text-[11px] uppercase tracking-wider text-surface-500 shrink-0">
        Толщина, px
      </span>
      <!-- Крестик поверх поля — сброс к дефолту, как у толщины провода. -->
      <span class="relative ml-auto inline-flex">
        <InputNumber
          :model-value="thickness"
          :min="thicknessMin"
          :max="thicknessMax"
          :step="1"
          show-buttons
          button-layout="horizontal"
          size="small"
          input-class="w-12! text-center"
          @update:model-value="(v) => emit('update-thickness', v)"
        />
        <button
          v-if="isCustomThickness"
          v-tooltip.bottom="'Вернуть толщину по умолчанию'"
          type="button"
          class="absolute -right-0.5 -top-0.5 z-10 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-surface-300 bg-surface-0 text-surface-500 shadow-sm hover:text-surface-800"
          @click.stop="emit('update-thickness', thicknessDefault)"
        >
          <i class="pi pi-times text-[7px]!" />
        </button>
      </span>
    </div>
  </div>
</template>
