<script setup>
import Button from 'primevue/button'
import Tag from 'primevue/tag'

/**
 * Унифицированный блок анимации выключателя — заменяет SwitchAnimationBlock
 * (интрисик-слот стенсила, например cell_vk) и SwitchSourceBlock (юзер-добавленная
 * propagation-зависимость на ячейке/проводе). Различия закодированы через флаги
 * `required` / `removable`, а не два отдельных компонента.
 *
 * Парент владеет данными (slot vs tms.switchSource), сюда передаёт только
 * `tag`-строку + флаги; реагирует на эмиты в своих терминах:
 *   • intrinsic-mode  (removable=false): только смена тега через picker;
 *                                          явная очистка не нужна — тег нужен
 *                                          для работы стенсила, пустое состояние
 *                                          бессмысленно
 *   • source-mode     (removable=true):  remove    → удаляем tms.switchSource
 *
 * Иконка/цвет/описание одинаковые в обоих режимах — поведение в рантайме
 * идентично (animation-off при false), и юзеру не за чем различать
 * визуально «откуда взялся тег».
 */
defineProps({
  tag: { type: String, default: '' },
  tagSuffix: { type: String, default: null },
  required: { type: Boolean, default: false }, // amber-рамка для пустого required-input'а
  removable: { type: Boolean, default: false }, // показать × в шапке (kill block)
  tagsLoaded: { type: Boolean, default: false },
  title: { type: String, default: 'Выключатель' },
})

defineEmits(['open-tag-picker', 'remove'])
</script>

<template>
  <div
    class="border border-surface-200 dark:border-surface-700 rounded p-3 bg-surface-0 dark:bg-surface-900"
  >
    <div class="flex items-center gap-2 mb-2">
      <i class="pi pi-power-off text-cyan-500" aria-hidden="true" />
      <div class="text-xs font-medium text-surface-700 dark:text-surface-200">
        {{ title }}
      </div>
      <Tag
        v-if="tagSuffix"
        v-tooltip.bottom="`Ожидается тег с суффиксом ${tagSuffix}`"
        :value="tagSuffix"
        severity="secondary"
        rounded
        class="ml-auto !font-mono !text-[10px] !py-0"
      />
      <Button
        v-if="removable"
        icon="pi pi-times"
        severity="secondary"
        text
        size="small"
        title="Удалить"
        :class="['!p-1 !w-6 !h-6', tagSuffix ? '' : 'ml-auto']"
        @click="$emit('remove')"
      />
    </div>

    <p class="text-[11px] text-surface-500 dark:text-surface-400 mb-2 leading-snug">
      Когда значение тега =
      <code class="font-mono">false</code>
      — элемент тускнеет (
      <code class="font-mono">animation-off</code>
      ).
    </p>

    <div>
      <div class="text-[11px] text-surface-500 dark:text-surface-400 mb-1">Тег</div>
      <div class="flex items-center gap-2">
        <code
          class="flex-1 px-2 py-1 bg-surface-100 dark:bg-surface-800 hover:bg-surface-200 dark:hover:bg-surface-700 rounded text-xs font-mono truncate transition-colors"
          :class="[
            tagsLoaded ? 'cursor-pointer' : 'cursor-not-allowed opacity-60',
            required && !tag ? 'border border-amber-500/40' : '',
          ]"
          :title="tagsLoaded ? 'Выбрать тег' : 'Загрузи tag-list, чтобы выбрать тег'"
          @click="tagsLoaded && $emit('open-tag-picker')"
        >
          {{ tag || (tagSuffix ? `— выбрать тег ${tagSuffix} —` : '— не выбран —') }}
        </code>
        <Button
          icon="pi pi-pencil"
          severity="secondary"
          text
          size="small"
          title="Выбрать тег"
          :disabled="!tagsLoaded"
          @click="$emit('open-tag-picker')"
        />
      </div>
    </div>
  </div>
</template>
