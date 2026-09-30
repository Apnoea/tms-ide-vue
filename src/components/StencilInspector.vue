<script setup>
/**
 * Свойства символа — правая панель редактора, две плашки: «Символ» (идентификация,
 * флаги поведения, анимации — StencilAnimationFields) и «Фигура» (свойства выделенной —
 * StencilShapePanel). Стейт — синглтон useStencilEditor, тот же, что рисует стол, поэтому
 * части панели берут его сами, без пропсов.
 */
import { computed } from 'vue'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import Checkbox from 'primevue/checkbox'
import Chip from 'primevue/chip'
import StencilAnimationFields from './StencilAnimationFields.vue'
import StencilShapePanel from './StencilShapePanel.vue'
import { getAllStencils, getCategories, registryVersion } from '../stencils/registry'
import { useStencilEditor } from '../composables/useStencilEditor'
import { STENCIL_DOMAINS } from '../constants/domains'
import { stencilDraftProblems } from '../utils/stencilSvg'

const { meta, editingId, presetInfo, shapes, commit } = useStencilEditor()

/**
 * Проблемы черновика ЖИВЬЁМ, по полям: занятый id или пустая категория видны сразу,
 * а не тостом после клика «Сохранить». Те же правила, что проверяет сохранение
 * (`stencilDraftProblems`) — разойтись они не могут.
 *
 * Правится существующий символ — его собственный id из списка занятых исключается.
 * Пустой черновик (редактор только открыли) не краснеет: ошибок там ещё нет, а
 * подсвеченная панель на старте читается как поломка.
 */
const problemByField = computed(() => {
  registryVersion.value // список символов мог измениться, пока редактор открыт
  const existingIds = getAllStencils()
    .map((s) => s.id)
    .filter((id) => id !== editingId.value)
  const map = new Map()
  if (!meta.id && !meta.label && !shapes.value.length) return map
  for (const p of stencilDraftProblems(meta, shapes.value, existingIds)) {
    if (!map.has(p.field)) map.set(p.field, p.message)
  }
  return map
})

const problemOf = (field) => problemByField.value.get(field) || ''

/**
 * Символ поставляемого набора: название, рисунок и вид фигур принадлежат набору.
 * Проект правит анимации, раскладку палитры (категория, области) и галки — всё это
 * ложится патчем поверх набора (utils/presetPatch). Программный символ
 * (`meta.locked`, шина) заперт шире — у него и анимация состояния задана кодом.
 */
const isPresetSymbol = computed(() => !!presetInfo.value)
const identityLocked = computed(() => meta.locked || isPresetSymbol.value)

// Области применения: мета символа входит в undo-снимок, поэтому свой шаг истории.
function toggleDomain(key) {
  const next = new Set(meta.domains)
  if (!next.delete(key)) next.add(key)
  meta.domains = [...next]
  commit()
}

// Категории для комбо (существующие + можно вписать новую). registryVersion —
// чтобы список пересобрался, если реестр поменяется.
const categories = computed(() => {
  void registryVersion.value
  return getCategories()
})

// id = имя папки src/library/<id>/ → маска [a-z0-9_]. Фильтруем прямо в DOM
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
    <!-- Плашка «Символ»: свойства документа (идентификация/поведение/анимация) -->
    <div class="flex-1 min-h-0 flex flex-col">
      <div class="min-h-14 px-4 border-b border-surface-200 bg-surface-0 flex items-center gap-2">
        <h2 class="shrink-0 text-sm font-semibold text-surface-900 uppercase tracking-wide">
          Символ
        </h2>
        <!-- Действия над символом целиком (сохранить/закрыть) — в его же шапке. Разметку
             телепортирует сюда StencilEditor: там живут `save`/`requestClose` и признак
             несохранённого. -->
        <div id="tms-editor-actions" class="ml-auto flex items-center gap-1"></div>
      </div>

      <div class="flex-1 min-h-0 p-4 overflow-y-auto text-sm space-y-4">
        <!-- Свойства показаны как есть, но правке не подлежат: у программного символа
             (шина) их задаёт код, у символа из набора — поставка. -->
        <p v-if="meta.locked" class="tms-hint">
          Программный символ: тело и порты задаёт код, правятся только диапазоны значений.
        </p>
        <p v-else-if="isPresetSymbol" class="tms-hint">
          Символ из набора «{{ presetInfo.name }}» {{ presetInfo.version }}.
        </p>
        <!-- Проблемы черновика подсвечиваются ЖИВЬЁМ (`problemOf`): иначе занятый id
             или пустая категория всплывали только тостом после клика «Сохранить».
             Сообщение — в строке заголовка поля и АБСОЛЮТОМ: в потоке оно сдвигало бы
             остальные поля панели при каждом вводе. -->
        <label class="relative block">
          <div class="tms-field-label mb-1">Название</div>
          <InputText
            v-model="meta.label"
            :disabled="identityLocked"
            :invalid="!!problemOf('label')"
            size="small"
            class="w-full"
            placeholder="Задвижка"
            @change="commit"
          />
          <p
            v-if="problemOf('label')"
            v-tooltip.left="problemOf('label')"
            class="pointer-events-auto absolute right-0 top-0 max-w-[70%] truncate text-[11px] text-red-500"
          >
            {{ problemOf('label') }}
          </p>
        </label>

        <label class="relative block">
          <div class="tms-field-label mb-1">id</div>
          <!-- Нативный <input> (не PrimeVue): @input гарантированно нативный, onIdInput
               правит e.target.value напрямую (обходя Vue-диффинг). -->
          <input
            :value="meta.id"
            :disabled="!!editingId"
            placeholder="cell_valve"
            class="p-inputtext p-component p-inputtext-sm w-full font-mono"
            :class="{ 'p-invalid': !!problemOf('id') }"
            @input="onIdInput"
            @change="commit"
          />
          <p
            v-if="problemOf('id')"
            v-tooltip.left="problemOf('id')"
            class="pointer-events-auto absolute right-0 top-0 max-w-[70%] truncate text-[11px] text-red-500"
          >
            {{ problemOf('id') }}
          </p>
        </label>

        <label class="relative block">
          <div class="tms-field-label mb-1">Категория</div>
          <Select
            v-model="meta.category"
            :options="categories"
            :disabled="meta.locked"
            :invalid="!!problemOf('category')"
            editable
            placeholder="Выбери или впиши"
            size="small"
            class="w-full"
            @change="commit"
          />
          <p
            v-if="problemOf('category')"
            v-tooltip.left="problemOf('category')"
            class="pointer-events-auto absolute right-0 top-0 max-w-[70%] truncate text-[11px] text-red-500"
          >
            {{ problemOf('category') }}
          </p>
        </label>

        <!-- Область применения: фильтр палитры, а не вторая категория — символ может
             годиться сразу нескольким областям. Пусто = виден при любом фильтре. Своей
             строкой во всю ширину: в колонке чипы переносились во второй ряд. -->
        <div>
          <div class="tms-field-label mb-1">Область применения</div>
          <div class="flex flex-wrap gap-1">
            <Chip
              v-for="d in STENCIL_DOMAINS"
              :key="d.key"
              :label="d.label"
              class="tms-domain-chip"
              :class="{
                'tms-domain-chip-on': meta.domains.includes(d.key),
                'pointer-events-none opacity-60': meta.locked,
              }"
              @click="toggleDomain(d.key)"
            />
          </div>
        </div>

        <!-- Поворот и отражение раздельно: карточке значения, например, поворот нужен
             (её ставят вдоль вертикальных участков), а отражение зеркалило бы надпись. -->
        <div class="space-y-2 border-t border-surface-200 pt-4">
          <label class="flex items-center gap-2" :class="meta.locked ? '' : 'cursor-pointer'">
            <Checkbox
              v-model="meta.noRotate"
              :disabled="meta.locked"
              binary
              input-id="se-norotate"
              @update:model-value="commit"
            />
            <span class="text-surface-700">Запретить поворот</span>
          </label>
          <label class="flex items-center gap-2" :class="meta.locked ? '' : 'cursor-pointer'">
            <Checkbox
              v-model="meta.noFlip"
              :disabled="meta.locked"
              binary
              input-id="se-noflip"
              @update:model-value="commit"
            />
            <span class="text-surface-700">Запретить отражение</span>
          </label>
        </div>

        <StencilAnimationFields />
      </div>
    </div>

    <StencilShapePanel />
  </aside>
</template>
