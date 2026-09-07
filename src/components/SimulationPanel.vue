<script setup>
/**
 * Панель симуляции — контент правой панели, пока превью запущено. Показывает теги,
 * привязанные в текущей форме, и задаёт им значения: превью считает по ним то же, что
 * рантайм считает по данным с объекта (пороги диапазонов, коды состояний, текст
 * подписи). Незаданный тег получает случайное значение на каждом тике.
 *
 * Контрол по РОЛИ тега (`kind` из `useSimulation.formTags`), а не по типу из tag-list:
 * состояние выбирается из списка символа, булев — тумблером, аналоговый — числом.
 */
import { computed, ref } from 'vue'
import InputNumber from 'primevue/inputnumber'
import InputText from 'primevue/inputtext'
import IconField from 'primevue/iconfield'
import InputIcon from 'primevue/inputicon'
import Select from 'primevue/select'
import ToggleSwitch from 'primevue/toggleswitch'

const props = defineProps({
  /** `[{ tag, kind: 'state'|'bool'|'value', states?, rangeSource?, type }]`. */
  tags: { type: Array, required: true },
  /** Заданные вручную значения: `Map<tag, значение>`; остальные теги случайные. */
  values: { type: Object, required: true },
  /**
   * Теги выделенных на холсте элементов: пока выделение есть, список сужается до них —
   * настраивают тот символ, на который смотрят.
   */
  selected: { type: Object, default: () => new Set() },
})

const emit = defineEmits(['set-tag', 'reset'])

const query = ref('')

/**
 * Выделение на холсте сужает список до своих тегов (без выделения — вся форма), поиск
 * сужает дальше: подстрока по имени, регистр не важен — как в поиске по схеме.
 */
const visibleTags = computed(() => {
  const base = props.selected.size
    ? props.tags.filter((t) => props.selected.has(t.tag))
    : props.tags
  const q = query.value.trim().toLowerCase()
  return q ? base.filter((t) => t.tag.toLowerCase().includes(q)) : base
})

/** Пустой список: причина у него разная, и подсказка обязана называть именно её. */
const emptyText = computed(() => {
  const q = query.value.trim()
  if (q) return `Ничего не нашлось по «${q}»`
  if (props.selected.size) return 'У выделенного нет привязанных тегов.'
  return 'В этой форме нет привязанных тегов.'
})

const valueOf = (tag) => props.values.get(tag) ?? null

/**
 * Тумблер двухпозиционный, а состояний у булева тега три, поэтому клик читаем ПО
 * ПОЛОВИНЕ дорожки (левая — выкл, правая — вкл), а не как переключение: пока значение
 * не задано, тумблер стоит в «выкл», и фиксация «выкл» иначе требовала бы двух кликов,
 * через «вкл». Клавиатурный Space остаётся переключением.
 */
function setBoolAt(tag, event) {
  const box = event.currentTarget.getBoundingClientRect()
  emit('set-tag', tag, event.clientX - box.left >= box.width / 2)
}

/** Незаданный тумблер бледный: «случайно» и зафиксированный «выкл» иначе неразличимы. */
const boolHint = (tag) =>
  props.values.has(tag) ? '' : 'Значение случайное: щёлкните нужную половину'

/** Роль тега — запасная подпись, когда типа в tag-list нет. */
const kindLabel = (t) =>
  t.kind === 'state' ? 'состояние' : t.kind === 'bool' ? 'булев' : 'значение'

const stateOptions = (t) =>
  (t.states || [])
    .filter((s) => s.code !== '' && s.code != null)
    .map((s) => ({ label: s.label || s.key, value: s.code }))
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="min-h-14 px-4 border-b border-surface-200 bg-surface-0 flex items-center">
      <h2 class="text-sm font-semibold uppercase tracking-wide text-surface-900">Симуляция</h2>
    </div>

    <!-- Описание и поиск закреплены: список тегов формы уезжает под скролл. -->
    <div class="px-4 pt-4 space-y-2">
      <div class="flex items-start gap-2">
        <p class="flex-1 text-[11px] text-surface-500">Пустое поле - тег меняется случайно.</p>
        <!-- Сброс ВСЕХ заданных значений: круговая стрелка отличает его от крестика,
             который снимает значение одной строки. -->
        <button
          v-if="values.size"
          v-tooltip.left="'Вернуть случайные значения всем тегам'"
          type="button"
          class="flex h-5 w-5 shrink-0 items-center justify-center rounded text-surface-400 hover:text-surface-800"
          @click="emit('reset')"
        >
          <i class="pi pi-refresh text-[10px]!" />
        </button>
      </div>

      <p v-if="selected.size" class="text-[11px] text-surface-500">
        Показаны теги выделенного на холсте.
      </p>

      <IconField v-if="tags.length" class="w-full">
        <InputText
          v-model="query"
          size="small"
          class="w-full h-8!"
          placeholder="Поиск по имени тега..."
          @keyup.esc="query = ''"
        />
        <InputIcon
          v-if="query"
          class="pi pi-times cursor-pointer hover:text-surface-700"
          @click="query = ''"
        />
      </IconField>
    </div>

    <div class="flex-1 min-h-0 p-4 overflow-y-auto text-sm space-y-3">
      <div v-if="!visibleTags.length" class="text-xs text-surface-500">{{ emptyText }}</div>

      <!-- Строка тега: слева тип и имя, справа значение. -->
      <div v-for="t in visibleTags" :key="t.tag" class="flex items-center gap-2">
        <div class="min-w-0 flex-1">
          <div class="text-[11px] text-surface-400">{{ t.type || kindLabel(t) }}</div>
          <div v-tooltip.top="t.tag" class="truncate font-mono text-[11px] text-surface-800">
            {{ t.tag }}
          </div>
        </div>

        <span class="flex shrink-0 items-center gap-1">
          <span
            v-if="t.kind === 'bool'"
            v-tooltip.left="boolHint(t.tag)"
            class="inline-flex"
            :class="values.has(t.tag) ? '' : 'opacity-40'"
            @click.capture.prevent="(e) => setBoolAt(t.tag, e)"
          >
            <ToggleSwitch
              :model-value="!!valueOf(t.tag)"
              @update:model-value="(v) => emit('set-tag', t.tag, v)"
            />
          </span>
          <Select
            v-else-if="t.kind === 'state'"
            :model-value="valueOf(t.tag)"
            :options="stateOptions(t)"
            option-label="label"
            option-value="value"
            placeholder="случайно"
            size="small"
            class="w-32"
            @update:model-value="(v) => emit('set-tag', t.tag, v)"
          />
          <InputNumber
            v-else
            :model-value="valueOf(t.tag)"
            :max-fraction-digits="3"
            size="small"
            input-class="w-16! text-center"
            @update:model-value="(v) => emit('set-tag', t.tag, v)"
          />
          <!-- Место под кнопку держим всегда: иначе первое заданное значение сдвигало
               бы контрол влево. -->
          <span class="w-5 shrink-0">
            <button
              v-if="values.has(t.tag)"
              v-tooltip.left="'Вернуть случайное значение'"
              type="button"
              class="flex h-5 w-5 items-center justify-center rounded text-surface-400 hover:text-surface-800"
              @click="emit('set-tag', t.tag, null)"
            >
              <i class="pi pi-times text-[10px]!" />
            </button>
          </span>
        </span>
      </div>
    </div>
  </div>
</template>
