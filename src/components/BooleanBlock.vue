<script setup>
import Button from 'primevue/button'
import TagField from './TagField.vue'

/**
 * Блок «Булево значение». Два независимых источника:
 *  • `slotInfo` — булев слот стенсила (cell_qw slot.onoff): свой тег элемента,
 *    рендерится первой строкой без ×.
 *  • Зависимости-теги ГРУППАМИ (`groups`: массив групп, каждая — массив тегов):
 *    внутри группы теги через И, группы между собой через ИЛИ. Активен, если
 *    выполнена ЛЮБАЯ группа целиком; иначе элемент тускнеет (animation-off).
 *    Нейтрально к домену (сеть/жидкости/…): группа = произвольное И-условие.
 *
 * Эмиты (gi — индекс группы, ti — индекс тега в группе):
 *   open-slot-picker     — клик по slot-row (свой тег стенсила)
 *   add-group            — «+ группа» (открывает picker, группа рождается с тегом)
 *   add-tag(gi)          — «+ тег» внутри группы
 *   edit-tag(gi, ti)     — замена тега по индексу
 *   remove-tag(gi, ti)   — × на строке тега
 *   remove-group(gi)     — × в шапке группы
 *   remove               — × в шапке блока: очистить все группы
 *   highlight-tag(t)     — подсветить тег на холсте
 */
defineProps({
  slotInfo: { type: Object, default: null }, // { value } — свой тег элемента
  groups: { type: Array, default: () => [] }, // Array<Array<string>>
  removable: { type: Boolean, default: false },
  tagsLoaded: { type: Boolean, default: false },
  title: { type: String, default: 'Булево значение' },
  // copyable — есть что копировать (свой тег или группы-зависимости); pasteable —
  // в буфере анимаций лежит булев блок, «вставить» показываем на любом выделении.
  copyable: { type: Boolean, default: false },
  pasteable: { type: Boolean, default: false },
})

defineEmits([
  'open-slot-picker',
  'add-group',
  'add-tag',
  'edit-tag',
  'remove-tag',
  'remove-group',
  'remove',
  'highlight-tag',
  'copy',
  'paste',
])
</script>

<template>
  <div class="border border-surface-200 rounded p-3 bg-surface-0">
    <div class="flex items-center gap-2 mb-2 min-h-6">
      <i class="pi pi-power-off text-cyan-500" />
      <div class="text-xs font-medium text-surface-700">
        {{ title }}
      </div>
      <div class="ml-auto flex items-center">
        <Button
          v-if="pasteable"
          v-tooltip.bottom="'Вставить свойства'"
          icon="pi pi-clipboard"
          severity="secondary"
          text
          size="small"
          class="!p-1 !w-6 !h-6"
          @click="$emit('paste')"
        />
        <Button
          v-if="copyable"
          v-tooltip.bottom="'Копировать свойства'"
          icon="pi pi-copy"
          severity="secondary"
          text
          size="small"
          class="!p-1 !w-6 !h-6"
          @click="$emit('copy')"
        />
        <Button
          v-if="removable"
          v-tooltip.bottom="'Удалить все зависимости'"
          icon="pi pi-times"
          severity="secondary"
          text
          size="small"
          class="!p-1 !w-6 !h-6"
          @click="$emit('remove')"
        />
      </div>
    </div>

    <!-- Прямая привязка: свой тег элемента (intrinsic), без × -->
    <div v-if="slotInfo" class="mb-1">
      <div class="text-[11px] text-surface-500 mb-1">
        Тег
        <span class="text-surface-400">для анимации элемента</span>
      </div>
      <TagField
        :value="slotInfo.value || ''"
        :can-pick="tagsLoaded"
        highlightable
        @pick="$emit('open-slot-picker')"
        @highlight="$emit('highlight-tag', slotInfo.value)"
      />
    </div>

    <!-- Зависимости от ДРУГИХ тегов, группами. Внутри группы И, между группами ИЛИ. -->
    <div :class="slotInfo ? 'mt-2 border-t border-surface-200 pt-2' : ''">
      <div class="text-[11px] font-medium text-surface-600 mb-1">
        Зависимость от других элементов
      </div>
      <p class="text-[11px] text-surface-500 mb-2 leading-snug">
        Активен, если выполнена любая группа условий. Иначе — тускнеет.
      </p>

      <template v-for="(group, gi) in groups" :key="gi">
        <div v-if="gi > 0" class="text-[10px] text-surface-400 text-center my-1">ИЛИ</div>
        <div class="rounded border border-surface-200 bg-surface-50 p-2">
          <div class="flex items-center gap-1.5 mb-1.5">
            <span class="text-[11px] font-medium text-surface-600">Группа {{ gi + 1 }}</span>
            <span class="text-surface-400 text-[10px]">(все теги — И)</span>
            <Button
              v-tooltip.bottom="'Удалить группу'"
              icon="pi pi-times"
              severity="secondary"
              text
              size="small"
              class="!p-1 !w-5 !h-5 ml-auto"
              @click="$emit('remove-group', gi)"
            />
          </div>
          <div class="space-y-1.5">
            <TagField
              v-for="(t, ti) in group"
              :key="ti"
              :value="t || ''"
              :can-pick="tagsLoaded"
              pick-label="Заменить тег"
              highlightable
              removable
              @pick="$emit('edit-tag', gi, ti)"
              @highlight="$emit('highlight-tag', t)"
              @remove="$emit('remove-tag', gi, ti)"
            />
            <button
              type="button"
              class="flex w-full items-center gap-1.5 px-2 py-1 rounded border border-dashed border-surface-300 text-xs text-surface-500 transition-colors hover:border-primary-400 hover:text-surface-700"
              :class="tagsLoaded ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'"
              v-tooltip.bottom="tagsLoaded ? 'Добавить тег (И)' : 'Загрузи tag-list'"
              @click="tagsLoaded && $emit('add-tag', gi)"
            >
              <i class="pi pi-plus !text-[10px]" />
              тег (И)
            </button>
          </div>
        </div>
      </template>

      <div v-if="groups.length" class="text-[10px] text-surface-400 text-center my-1">ИЛИ</div>
      <!-- «+ группа» открывает picker — группа рождается с первым тегом (пустых нет). -->
      <button
        type="button"
        class="flex w-full items-center justify-center gap-1.5 px-2 py-1 rounded border border-dashed border-surface-300 text-xs text-surface-500 transition-colors hover:border-primary-400 hover:text-surface-700"
        :class="tagsLoaded ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'"
        v-tooltip.bottom="tagsLoaded ? 'Новая группа условий (ИЛИ)' : 'Загрузи tag-list'"
        @click="tagsLoaded && $emit('add-group')"
      >
        <i class="pi pi-plus !text-[10px]" />
        группа (ИЛИ)
      </button>
    </div>

    <p v-if="!tagsLoaded" class="text-[11px] text-surface-400 leading-snug mt-1">
      Загрузи tag-list, чтобы выбрать тег.
    </p>
  </div>
</template>
