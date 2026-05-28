<script setup>
import { computed, ref, watch } from 'vue'
import InputText from 'primevue/inputtext'
import IconField from 'primevue/iconfield'
import InputIcon from 'primevue/inputicon'
import Badge from 'primevue/badge'
import Accordion from 'primevue/accordion'
import AccordionPanel from 'primevue/accordionpanel'
import AccordionHeader from 'primevue/accordionheader'
import AccordionContent from 'primevue/accordioncontent'
import { getAllStencils, getCategories } from '../stencils/registry'
import { useUiStore } from '../stores/useUiStore'

const ui = useUiStore()

const search = ref('')

const allCategories = computed(() => getCategories())

function matchesSearch(stencil) {
  const q = search.value.trim().toLowerCase()
  if (!q) return true
  return (
    stencil.label.toLowerCase().includes(q) ||
    stencil.id.toLowerCase().includes(q)
  )
}

const stencilsByCategory = computed(() => {
  const map = new Map()
  for (const cat of allCategories.value) map.set(cat, [])
  for (const stencil of getAllStencils()) {
    if (!matchesSearch(stencil)) continue
    map.get(stencil.category)?.push(stencil)
  }
  return map
})

// При активном поиске показываем только непустые категории.
const categories = computed(() => {
  if (!search.value.trim()) return allCategories.value
  return allCategories.value.filter(
    (c) => (stencilsByCategory.value.get(c)?.length || 0) > 0
  )
})

const noResults = computed(
  () => !!search.value.trim() && categories.value.length === 0
)

// Активные (раскрытые) категории. По умолчанию — все. Persist в localStorage,
// чтобы UI не сбрасывался после F5.
const OPEN_KEY = 'tms-ide:palette-open:v2'
function loadOpen() {
  try {
    const raw = localStorage.getItem(OPEN_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
const userOpen = ref(loadOpen() ?? allCategories.value)
watch(
  userOpen,
  (val) => {
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(val))
    } catch {
      /* ignore quota */
    }
  },
  { deep: true }
)

// Во время поиска принудительно раскрываем все категории с матчами — иначе
// результат может «спрятаться» в свёрнутой. После сброса поиска возвращаемся
// к сохранённому user-состоянию. Writable computed чтобы Accordion'у было что
// биндить через v-model.
const accordionActive = computed({
  get() {
    return search.value.trim() ? categories.value : userOpen.value
  },
  set(val) {
    if (search.value.trim()) return // во время поиска toggle игнорируем
    userOpen.value = val
  },
})

// Drag из палитры на pointer-events (не нативный HTML5 DnD): pointermove идёт
// на полной частоте, поэтому preview на холсте липнет к курсору без задержки.
// Дальнейший трекинг (move/up/preview/drop) живёт в CanvasPane — он watch'ит
// ui.dragging и вешает свои document-листенеры. Здесь только инициируем drag.
function onStencilPointerDown(event, stencil) {
  if (event.button !== 0) return // только ЛКМ
  event.preventDefault()
  ui.startDragging({
    stencilId: stencil.id,
    width: stencil.width,
    height: stencil.height,
    label: stencil.label,
  })
}
</script>

<template>
  <aside
    class="h-full flex flex-col bg-surface-50 dark:bg-surface-900 border-r border-surface-200 dark:border-surface-700"
  >
    <div class="px-4 py-3 border-b border-surface-200 dark:border-surface-700">
      <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-50 uppercase tracking-wide">
        Палитра
      </h2>
      <p class="text-xs text-surface-500 dark:text-surface-400">
        Стенсилы для размещения на холсте
      </p>
    </div>

    <div class="px-2 pt-2">
      <IconField>
        <InputIcon class="pi pi-search" />
        <InputText
          v-model="search"
          size="small"
          class="w-full"
          placeholder="Поиск по названию или id..."
        />
      </IconField>
    </div>

    <div class="flex-1 p-2 overflow-auto">
      <template v-if="!allCategories.length">
        <div
          class="flex flex-col items-center text-center text-surface-400 dark:text-surface-500 py-10"
        >
          <i class="pi pi-inbox text-3xl mb-3 opacity-60" />
          <div class="text-sm font-medium text-surface-500 dark:text-surface-400">
            Реестр стенсилов пуст
          </div>
          <p class="text-[11px] mt-1 max-w-[180px]">
            Добавь папку в src/stencils/definitions/
          </p>
        </div>
      </template>

      <template v-else-if="noResults">
        <div
          class="flex flex-col items-center text-center text-surface-400 dark:text-surface-500 py-8"
        >
          <i class="pi pi-search text-2xl mb-2 opacity-60" />
          <div class="text-xs">Ничего не нашлось по «{{ search }}»</div>
        </div>
      </template>

      <Accordion
        v-else
        v-model:value="accordionActive"
        multiple
        class="tms-palette-accordion"
      >
        <AccordionPanel
          v-for="cat in categories"
          :key="cat"
          :value="cat"
        >
          <AccordionHeader>
            <span class="flex items-center gap-2 w-full pr-2 text-[11px] uppercase tracking-wider font-semibold">
              <span class="flex-1 text-left">{{ cat }}</span>
              <Badge
                :value="stencilsByCategory.get(cat)?.length || 0"
                severity="secondary"
                size="small"
              />
            </span>
          </AccordionHeader>
          <AccordionContent>
            <div
              v-for="stencil in stencilsByCategory.get(cat)"
              :key="stencil.id"
              class="group flex items-center gap-3 p-2 rounded hover:bg-surface-100 dark:hover:bg-surface-800 cursor-grab active:cursor-grabbing select-none"
              :title="`${stencil.id} · v${stencil.version}`"
              :aria-label="`Перетащить стенсил ${stencil.label} на холст`"
              role="button"
              tabindex="0"
              @pointerdown="onStencilPointerDown($event, stencil)"
            >
              <div
                class="stencil-thumb flex-shrink-0 w-12 h-12 flex items-center justify-center bg-white dark:bg-surface-800 rounded border border-surface-200 dark:border-surface-700 overflow-hidden p-1 transition-transform group-hover:scale-105"
                v-html="stencil.svgText"
              ></div>
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium text-surface-900 dark:text-surface-50 truncate">
                  {{ stencil.label }}
                </div>
                <div class="text-[11px] text-surface-500 dark:text-surface-400 truncate font-mono">
                  {{ stencil.id }}
                </div>
              </div>
            </div>
          </AccordionContent>
        </AccordionPanel>
      </Accordion>
    </div>
  </aside>
</template>

<style>
/* PrimeVue Accordion-дефолты в Aura — слишком жирные border/padding для
   узкой колонки палитры. Сжимаем: тонкая нижняя линия между панелями,
   компактные паддинги, header с прозрачным background чтобы вписаться
   в общий surface-50 фон aside'а. */
.tms-palette-accordion .p-accordionheader {
  padding: 0.5rem 0.5rem;
  background: transparent;
  border: 0;
}
.tms-palette-accordion .p-accordionheader:hover {
  background: var(--p-surface-100);
}
.dark .tms-palette-accordion .p-accordionheader:hover {
  background: var(--p-surface-800);
}
.tms-palette-accordion .p-accordioncontent-content {
  padding: 0.25rem 0;
  background: transparent;
  border: 0;
}
.tms-palette-accordion .p-accordionpanel {
  border: 0;
}
.tms-palette-accordion .p-accordionpanel + .p-accordionpanel {
  border-top: 1px solid var(--p-surface-200);
}
.dark .tms-palette-accordion .p-accordionpanel + .p-accordionpanel {
  border-top-color: var(--p-surface-700);
}
</style>
