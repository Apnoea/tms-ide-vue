<script setup>
/**
 * Свойства стенсила — контент правой панели в режиме редактора. Метаданные
 * (id / label / категория / размер) редактируются здесь, а не в тулбаре холста;
 * стейт — синглтон useStencilEditor (тот же инстанс, что рисуется в центре).
 * Анимации приедут сюда же в v2.
 */
import { computed, watch } from 'vue'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Select from 'primevue/select'
import Checkbox from 'primevue/checkbox'
import { getCategories, registryVersion } from '../stencils/registry'
import { snapToGrid } from '../utils/grid'
import { useStencilEditor } from '../composables/useStencilEditor'

const { meta, editingId } = useStencilEditor()

// Категории для комбо (существующие + можно вписать новую). registryVersion —
// чтобы список пересобрался, если реестр поменяется.
const categories = computed(() => {
  void registryVersion.value
  return getCategories()
})

// Размер стенсила кратен 10 (порты и сам стенсил садятся на сетку схемы).
watch(
  () => [meta.width, meta.height],
  () => {
    meta.width = Math.max(10, snapToGrid(meta.width, 10))
    meta.height = Math.max(10, snapToGrid(meta.height, 10))
  }
)

// id = имя папки definitions/<id>/ → маска [a-z0-9_]. Фильтруем прямо в DOM
// (watch/computed не годятся: значение уходит в кириллицу и обратно за тик,
// Vue не перезатирает введённый символ). В правке id заблокирован.
function onIdInput(e) {
  const clean = (e.target.value || '').toLowerCase().replace(/[^a-z0-9_]/g, '')
  if (e.target.value !== clean) e.target.value = clean
  meta.id = clean
}
</script>

<template>
  <aside class="h-full flex flex-col bg-surface-50">
    <div class="min-h-14 px-4 border-b border-surface-200 bg-surface-0 flex items-center">
      <h2 class="text-sm font-semibold text-surface-900 uppercase tracking-wide">Стенсил</h2>
    </div>

    <div class="flex-1 min-h-0 p-4 overflow-y-auto text-sm space-y-4">
      <label class="block">
        <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-1">Категория</div>
        <Select
          v-model="meta.category"
          :options="categories"
          editable
          placeholder="Выберите или впишите"
          size="small"
          class="w-full"
        />
      </label>

      <label class="block">
        <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-1">Название</div>
        <InputText v-model="meta.label" size="small" class="w-full" placeholder="Задвижка" />
      </label>

      <label class="block">
        <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-1">id</div>
        <!-- Нативный <input> (не PrimeVue): @input гарантированно нативный, onIdInput
             правит e.target.value напрямую (обходя Vue-диффинг). -->
        <input
          :value="meta.id"
          :disabled="!!editingId"
          placeholder="cell_valve"
          class="p-inputtext p-component p-inputtext-sm w-full font-mono"
          @input="onIdInput"
        />
      </label>

      <div>
        <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-1">Размер</div>
        <div class="flex items-center gap-3">
          <label class="flex items-center gap-1.5 text-xs text-surface-500">
            Ш
            <InputNumber
              v-model="meta.width"
              :min="10"
              :step="10"
              :use-grouping="false"
              size="small"
              input-class="!w-16 text-center"
            />
          </label>
          <label class="flex items-center gap-1.5 text-xs text-surface-500">
            В
            <InputNumber
              v-model="meta.height"
              :min="10"
              :step="10"
              :use-grouping="false"
              size="small"
              input-class="!w-16 text-center"
            />
          </label>
        </div>
      </div>

      <div>
        <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-1">Поведение</div>
        <label class="flex items-center gap-2 mb-1.5 cursor-pointer">
          <Checkbox v-model="meta.noRotate" binary input-id="se-norotate" />
          <span class="text-surface-700">Запретить поворот</span>
        </label>
        <label class="flex items-center gap-2 mb-1.5 cursor-pointer">
          <Checkbox v-model="meta.layoutOnly" binary input-id="se-layoutonly" />
          <span class="text-surface-700">Только разметка (без анимаций)</span>
        </label>
        <label class="flex items-center gap-2 cursor-pointer">
          <Checkbox v-model="meta.quality" binary input-id="se-quality" />
          <span class="text-surface-700">Анимация качества сигнала (Quality)</span>
        </label>
      </div>
    </div>
  </aside>
</template>
