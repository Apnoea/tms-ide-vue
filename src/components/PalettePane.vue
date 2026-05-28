<script setup>
import { computed, ref } from 'vue'
import { getAllStencils, getCategories } from '../stencils/registry'
import { useUiStore } from '../stores/useUiStore'

const ui = useUiStore()

const categories = computed(() => getCategories())
const stencilsByCategory = computed(() => {
  const map = new Map()
  for (const cat of categories.value) map.set(cat, [])
  for (const stencil of getAllStencils()) {
    map.get(stencil.category)?.push(stencil)
  }
  return map
})

// Состояние свёрнутых категорий. Persist в localStorage чтобы UI не сбрасывался
// после F5. Хранится массив имён свёрнутых категорий — при отсутствии в массиве
// категория считается раскрытой по умолчанию.
const COLLAPSED_KEY = 'tms-ide:palette-collapsed:v1'
const collapsedSet = ref(new Set(loadCollapsed()))

function loadCollapsed() {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function persistCollapsed() {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsedSet.value]))
  } catch {
    /* ignore quota */
  }
}

function isCollapsed(cat) {
  return collapsedSet.value.has(cat)
}

function toggleCategory(cat) {
  const next = new Set(collapsedSet.value)
  if (next.has(cat)) next.delete(cat)
  else next.add(cat)
  collapsedSet.value = next
  persistCollapsed()
}

// Drag из палитры на pointer-events (не нативный HTML5 DnD): pointermove идёт
// на полной частоте, поэтому preview на холсте липнет к курсору без задержки.
// Дальнейший трекинг (move/up/preview/drop) живёт в CanvasPane — он watch'ит
// ui.dragging и вешает свои document-листенеры. Здесь только инициируем drag.
function onStencilPointerDown(event, stencil) {
  if (event.button !== 0) return // только ЛКМ
  // preventDefault — чтобы браузер не начал нативный image/text-drag и не выделял текст
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

    <div class="flex-1 p-2 overflow-auto">
      <template v-if="!categories.length">
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

      <div
        v-for="cat in categories"
        :key="cat"
        class="mb-2"
      >
        <button
          type="button"
          class="w-full flex items-center gap-1 px-2 py-1 text-[11px] uppercase tracking-wider hover:text-surface-700 dark:hover:text-surface-200 transition-colors select-none"
          :class="
            isCollapsed(cat)
              ? 'text-surface-400 dark:text-surface-500'
              : 'text-surface-700 dark:text-surface-200 font-semibold'
          "
          @click="toggleCategory(cat)"
        >
          <i
            class="pi text-[9px] transition-transform"
            :class="isCollapsed(cat) ? 'pi-chevron-right' : 'pi-chevron-down'"
          />
          <span class="flex-1 text-left">{{ cat }}</span>
          <span class="text-[10px] text-surface-400 dark:text-surface-500 normal-case tracking-normal font-normal">
            {{ stencilsByCategory.get(cat)?.length || 0 }}
          </span>
        </button>

        <div v-show="!isCollapsed(cat)">
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
        </div>
      </div>
    </div>
  </aside>
</template>
