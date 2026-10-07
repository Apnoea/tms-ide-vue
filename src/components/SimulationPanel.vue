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
import Button from 'primevue/button'
import InputNumber from 'primevue/inputnumber'
import Select from 'primevue/select'
import ToggleSwitch from 'primevue/toggleswitch'
import { rangeRowColor } from '../constants/animation'
import { rangeBound, rangeRowFor, zoneValueFor } from '../utils/simValues'
import { rowMax } from '../utils/rangeRows'
import InspectorHeading from './InspectorHeading.vue'
import SearchField from './SearchField.vue'

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
  /** Что выделено на холсте — лист заголовка «Симуляция › Символ»; null — ничего. */
  selectionLeaf: { type: String, default: null },
})

const emit = defineEmits(['set-tag', 'reset', 'clear-selection'])

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
  if (props.selected.size) return 'У выделенного нет привязанных тегов'
  return 'В этой форме нет привязанных тегов'
})

const valueOf = (tag) => props.values.get(tag) ?? null

/**
 * У булева тега три состояния, а тумблер двухпозиционный, поэтому клик читается ПО
 * ПОЛОВИНЕ дорожки (левая — выкл, правая — вкл): из «не задано» выкл ставится одним
 * кликом, а не через вкл. Клавиатурный Space остаётся переключением.
 */
function setBoolAt(tag, event) {
  const box = event.currentTarget.getBoundingClientRect()
  emit('set-tag', tag, event.clientX - box.left >= box.width / 2)
}

/**
 * Незаданный тумблер подписан «случайно»: иначе он неотличим от зафиксированного «выкл».
 * Подпись, а не бледность — полупрозрачный тумблер читался как выключенный контрол.
 */
const boolHint = (tag) =>
  props.values.has(tag) ? '' : 'Значение случайное: щёлкни нужную половину'

/** Роль тега — запасная подпись, когда типа в tag-list нет. */
const kindLabel = (t) =>
  t.kind === 'state' ? 'состояние' : t.kind === 'bool' ? 'булев' : 'значение'

const stateOptions = (t) =>
  (t.states || [])
    .filter((s) => s.code !== '' && s.code != null)
    .map((s) => ({ label: s.label || s.key, value: s.code }))

/** Подпись зоны по её порогам: пустой порог и верх последней строки — открытая граница. */
function zoneLabel(ranges, row) {
  const lo = rangeBound(row.min)
  const hi = rangeBound(rowMax(ranges, row))
  if (lo !== null && hi !== null) return lo === hi ? `= ${lo}` : `${lo}–${hi}`
  if (lo !== null) return `≥ ${lo}`
  if (hi !== null) return `≤ ${hi}`
  return 'любое'
}

/**
 * Зоны диапазонов аналогового тега — кнопками под строкой: чтобы проверить окраску
 * символа по зоне, не нужно помнить его пороги. Клик ставит значение внутри зоны
 * (`zoneValueFor`); зона, которую целиком перекрывает строка выше, не выбирается —
 * покрасить ею нельзя и в рантайме.
 */
const zonesByTag = computed(() => {
  const out = new Map()
  for (const t of visibleTags.value) {
    if (t.kind !== 'value') continue
    const zones = (t.rangeSource?.ranges || [])
      .filter((row) => rangeRowColor(row))
      .map((row) => ({
        row,
        color: rangeRowColor(row),
        label: zoneLabel(t.rangeSource.ranges, row),
        value: zoneValueFor(t.rangeSource, row),
      }))
    if (zones.length) out.set(t.tag, zones)
  }
  return out
})

/** Зона активна, когда в неё попадает ЗАДАННОЕ значение (случайное панель не знает). */
const zoneActive = (t, zone) =>
  props.values.has(t.tag) && rangeRowFor(t.rangeSource, valueOf(t.tag)) === zone.row

const zoneTip = (zone) =>
  zone.value === null
    ? 'Зону перекрывает строка выше — значение сюда не попадёт'
    : `Значение ${zone.value}`
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- Путь — как у инспектора: при выделении список сужен до его тегов, клик по
         «Симуляция» снимает выделение и возвращает теги всей формы. -->
    <div class="min-h-14 px-4 border-b border-surface-200 bg-surface-0 flex items-center">
      <InspectorHeading
        root="Симуляция"
        :leaf="selectionLeaf"
        back-tip="К тегам всей формы · Esc"
        @back="emit('clear-selection')"
      />
    </div>

    <!-- Поиск закреплён: список тегов формы уезжает под скролл. Пояснений над ним нет —
         незаданное значение подписано «случайно» в самой строке, а сужение до
         выделенного видно по заголовку «Симуляция › …». -->
    <div v-if="tags.length" class="px-4 pt-4 flex items-center gap-1">
      <SearchField
        v-model="query"
        class="min-w-0 flex-1"
        placeholder="Поиск по имени тега…"
        @keyup.esc="query = ''"
      />
      <!-- Сброс ВСЕХ заданных значений: круговая стрелка отличает его от крестика,
           который снимает значение одной строки. Место держим всегда — иначе поле поиска
           меняло бы ширину на первом заданном значении и на сбросе. -->
      <span class="w-8 shrink-0">
        <Button
          v-if="values.size"
          v-tooltip.left="'Вернуть случайные значения всем тегам'"
          icon="pi pi-refresh"
          severity="secondary"
          text
          size="small"
          class="tms-icon-btn"
          @click="emit('reset')"
        />
      </span>
    </div>

    <div class="flex-1 min-h-0 p-4 overflow-y-auto text-sm space-y-3">
      <div v-if="!visibleTags.length" class="tms-empty">
        <i class="pi text-3xl mb-3 opacity-60" :class="query.trim() ? 'pi-search' : 'pi-tags'" />
        <div class="tms-empty-title">{{ emptyText }}</div>
      </div>

      <!-- Строка тега: слева тип и имя, справа значение; у тега с диапазонами под ней
           кнопки зон. -->
      <div v-for="t in visibleTags" :key="t.tag">
        <div class="flex items-center gap-2">
          <div class="min-w-0 flex-1">
            <div class="tms-hint">{{ t.type || kindLabel(t) }}</div>
            <div v-tooltip.top="t.tag" class="truncate font-mono text-[11px] text-surface-800">
              {{ t.tag }}
            </div>
          </div>

          <span class="flex shrink-0 items-center gap-1">
            <template v-if="t.kind === 'bool'">
              <!-- Тот же вид, что у плейсхолдера «случайно» в числовых полях и списках. -->
              <span v-if="!values.has(t.tag)" class="text-xs text-surface-500">случайно</span>
              <span
                v-tooltip.left="boolHint(t.tag)"
                class="inline-flex"
                @click.capture.prevent="(e) => setBoolAt(t.tag, e)"
              >
                <ToggleSwitch
                  :model-value="!!valueOf(t.tag)"
                  @update:model-value="(v) => emit('set-tag', t.tag, v)"
                />
              </span>
            </template>
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
              placeholder="случайно"
              size="small"
              input-class="w-24! text-center"
              @update:model-value="(v) => emit('set-tag', t.tag, v)"
            />
            <!-- Место под кнопку держим всегда: иначе первое заданное значение сдвигало
                 бы контрол влево. -->
            <span class="w-6 shrink-0">
              <Button
                v-if="values.has(t.tag)"
                v-tooltip.left="'Вернуть случайное значение'"
                icon="pi pi-times"
                severity="secondary"
                text
                size="small"
                class="tms-row-btn"
                @click="emit('set-tag', t.tag, null)"
              />
            </span>
          </span>
        </div>

        <div v-if="zonesByTag.get(t.tag)" class="mt-1.5 flex flex-wrap gap-1">
          <!-- Недостижимая зона гасится классом, а не `disabled`: у выключенной кнопки
               тултип не показывается, а объяснить, почему она не нажимается, нужно. -->
          <button
            v-for="(z, i) in zonesByTag.get(t.tag)"
            :key="i"
            v-tooltip.top="zoneTip(z)"
            type="button"
            class="flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors"
            :class="
              z.value === null
                ? 'cursor-not-allowed border-surface-200 text-surface-600 opacity-40'
                : zoneActive(t, z)
                  ? 'border-primary-400 bg-primary-50 text-primary-700'
                  : 'border-surface-200 text-surface-600 hover:border-surface-400'
            "
            @click="z.value !== null && emit('set-tag', t.tag, z.value)"
          >
            <span class="h-2 w-2 shrink-0 rounded-sm" :style="{ background: z.color }" />
            {{ z.label }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
