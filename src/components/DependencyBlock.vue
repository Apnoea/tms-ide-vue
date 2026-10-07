<script setup>
/**
 * Блок «Зависимость от тегов»: `tms.boolSource` группами — внутри группы
 * теги через И, группы между собой через ИЛИ. Не выполнена ни одна группа — элемент
 * тускнеет (`animation-off`).
 *
 * Отдельный блок, а не часть блока состояния: гашение не привязано к слоту символа и
 * применимо к любому элементу, включая провод и шину, у которых слотов нет вовсе.
 *
 * Все действия — эмиты наверх; gi/ti в них это индексы группы и тега в ней.
 */
import Button from 'primevue/button'
import TagField from './TagField.vue'
import AnimationCard from './AnimationCard.vue'

defineProps({
  groups: { type: Array, default: () => [] }, // Array<Array<string>>
  removable: { type: Boolean, default: false },
  tagsLoaded: { type: Boolean, default: false },
  // copyable — есть что копировать (заданы группы); pasteable — в буфере анимаций лежат
  // зависимости, «вставить» показываем на любом выделении.
  copyable: { type: Boolean, default: false },
  pasteable: { type: Boolean, default: false },
})

defineEmits([
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
  <AnimationCard
    icon="pi pi-sitemap text-purple-500"
    title="Зависимость"
    hint="от тегов"
    :paste-tip="pasteable && 'Вставить зависимости'"
    :copy-tip="copyable && 'Копировать зависимости'"
    :clear-tip="removable && 'Удалить все зависимости'"
    @paste="$emit('paste')"
    @copy="$emit('copy')"
    @clear="$emit('remove')"
  >
    <!-- Правило показываем, только когда группы есть: пустому блоку хватает кнопки, а
         абзац делал бы самым заметным то, что нужно реже всего. -->
    <p v-if="groups.length" class="tms-hint mb-2">
      Активен, если выполнена любая группа условий. Иначе — тускнеет.
    </p>

    <template v-for="(group, gi) in groups" :key="gi">
      <div v-if="gi > 0" class="tms-hint text-center my-1">ИЛИ</div>
      <div class="rounded border border-surface-200 bg-surface-50 p-2">
        <div class="flex items-center gap-1.5 mb-1.5">
          <span class="text-[11px] font-medium text-surface-600">Группа {{ gi + 1 }}</span>
          <span class="tms-hint">(все теги — И)</span>
          <Button
            v-tooltip.bottom="'Удалить группу'"
            icon="pi pi-times"
            severity="secondary"
            text
            size="small"
            class="tms-row-btn ml-auto"
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
            class="tms-add-row w-full"
            :disabled="!tagsLoaded"
            v-tooltip.bottom="'Добавить тег (И)'"
            @click="$emit('add-tag', gi)"
          >
            <i class="pi pi-plus text-[10px]!" />
            тег (И)
          </button>
        </div>
      </div>
    </template>

    <div v-if="groups.length" class="tms-hint text-center my-1">ИЛИ</div>
    <!-- «+ группа» открывает picker — группа рождается с первым тегом (пустых нет).
         Пунктирные «добавить» — общий `tms-add-row`, как у диапазонов и состояний; без
         tag-list неактивны (`disabled`): о причине говорит предупреждение над
         «Анимациями». -->
    <button
      type="button"
      class="tms-add-row w-full"
      :disabled="!tagsLoaded"
      v-tooltip.bottom="'Новая группа условий (ИЛИ)'"
      @click="$emit('add-group')"
    >
      <i class="pi pi-plus text-[10px]!" />
      группа (ИЛИ)
    </button>
  </AnimationCard>
</template>
