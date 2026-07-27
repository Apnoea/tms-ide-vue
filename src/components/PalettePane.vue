<script setup>
import { computed, nextTick, ref } from 'vue'
import { useLocalStorage } from '@vueuse/core'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import IconField from 'primevue/iconfield'
import InputIcon from 'primevue/inputicon'
import Badge from 'primevue/badge'
import Accordion from 'primevue/accordion'
import AccordionPanel from 'primevue/accordionpanel'
import AccordionHeader from 'primevue/accordionheader'
import AccordionContent from 'primevue/accordioncontent'
import { useConfirm } from 'primevue/useconfirm'
import {
  getAllStencils,
  getCategories,
  registryVersion,
  unregisterStencil,
} from '../stencils/registry'
import { deleteStencilFromDisk } from '../services/stencilLibrary'
import { removeStencilOverride } from '../services/stencilOverrides'
import { useNotify } from '../composables/useNotify'
import { useCanvas } from '../composables/useCanvas'
import { useUiStore } from '../stores/useUiStore'
import { useWorkspaceStore } from '../stores/useWorkspaceStore'
import { nplural } from '../utils/plural'
import { confirmDanger } from '../utils/confirmDanger'

const ui = useUiStore()
const confirm = useConfirm()
const notify = useNotify()
const canvas = useCanvas()
const workspace = useWorkspaceStore()

const search = ref('')
// Поиск свёрнут в кнопку-лупу; по клику разворачивается в поле ввода (collapsible).
const searchOpen = ref(false)
const searchInput = ref(null)

async function openSearch() {
  searchOpen.value = true
  await nextTick()
  searchInput.value?.$el?.focus()
}
function closeSearch() {
  search.value = ''
  searchOpen.value = false
}
// Крестик в поле: только чистит запрос, поле остаётся открытым и в фокусе.
function clearQuery() {
  search.value = ''
  searchInput.value?.$el?.focus()
}
// Кнопка-лупа тогглит поиск: закрыта → открыть+фокус, открыта → закрыть (фильтр
// снимается). Закрыть поле можно кнопкой-лупой или Esc в самом поле; клик-вне не
// сворачивает (поле выехало отдельной строкой и не мешает работе).
function toggleSearch() {
  if (searchOpen.value) closeSearch()
  else openSearch()
}

// registryVersion читаем во всех computed'ах, зависящих от реестра — чтобы
// список пересобрался сразу после создания/удаления стенсила (без reload).
const allCategories = computed(() => {
  void registryVersion.value
  return getCategories()
})

function matchesSearch(stencil) {
  const q = search.value.trim().toLowerCase()
  if (!q) return true
  return stencil.label.toLowerCase().includes(q) || stencil.id.toLowerCase().includes(q)
}

// Внутри категории сортируем по label (то, что видит юзер в палитре),
// ru-локаль для корректной А-Я сортировки.
const stencilsByCategory = computed(() => {
  void registryVersion.value
  const map = new Map()
  for (const cat of allCategories.value) map.set(cat, [])
  for (const stencil of getAllStencils()) {
    if (!matchesSearch(stencil)) continue
    map.get(stencil.category)?.push(stencil)
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.label.localeCompare(b.label, 'ru'))
  }
  return map
})

// При активном поиске показываем только непустые категории.
const categories = computed(() => {
  if (!search.value.trim()) return allCategories.value
  return allCategories.value.filter((c) => (stencilsByCategory.value.get(c)?.length || 0) > 0)
})

const noResults = computed(() => !!search.value.trim() && categories.value.length === 0)

// Активные (раскрытые) категории — persist в localStorage чтобы UI не
// сбрасывался после F5. Дефолт — все категории раскрыты.
const userOpen = useLocalStorage('tms-ide:palette-open:v2', allCategories.value, {
  deep: true,
})

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
// Дальнейший трекинг (move/up/preview/drop) живёт в CanvasPane — он реактивно
// цепляет document-листенеры по ui.dragging (useEventListener с computed-target).
// Здесь только инициируем drag.
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

/**
 * Tooltip: только увеличенное превью SVG. id юзер видит прямо в строке
 * стенсила (под label), поэтому в tooltip его не дублируем.
 */
function stencilTooltip(stencil) {
  const value = `<div class="tms-stencil-zoom">${stencil.svgText || ''}</div>`
  return { value, escape: false, showDelay: 400 }
}

// Где используется стенсил: живой граф активной формы (правки могли не уехать
// в стор) + сохранённые графы остальных форм. → { count, formIds }.
function stencilUsage(id) {
  const activeId = workspace.activeFormId
  const forms = []
  let count = 0
  const scan = (formId, graph) => {
    const n = (graph?.cells || []).filter((c) => c?.tms?.stencilId === id).length
    if (n) {
      count += n
      forms.push(formId)
    }
  }
  const live = canvas.graphRef?.value
  scan(activeId, live ? live.toJSON() : workspace.getFormGraph(activeId))
  for (const fid of workspace.formIds) {
    if (fid === activeId) continue
    scan(fid, workspace.getFormGraph(fid))
  }
  return { count, formIds: forms }
}

// Удаление стенсила из палитры: если он где-то расставлен — отказываем (иначе
// осиротим ячейки на схемах), сообщаем где. Иначе попап-подтверждение якорится
// на кнопку, снимаем из рантайм-реестра (мгновенно пропадает) и сносим с диска.
function confirmDeleteStencil(event, stencil) {
  const usage = stencilUsage(stencil.id)
  if (usage.count) {
    notify.warn(
      'Символ используется',
      `${nplural(usage.count, 'символ', 'символа', 'символов')} в формах: ` +
        `${usage.formIds.join(', ')}. Сначала удалите их со схем.`
    )
    return
  }
  confirmDanger(confirm, {
    target: event.currentTarget,
    message: `Удалить символ «${stencil.label}»?`,
    acceptLabel: 'Удалить',
    accept: () => removeStencil(stencil.id),
  })
}
async function removeStencil(id) {
  unregisterStencil(id)
  await removeStencilOverride(id) // снять IDB-оверрайд, иначе он вернул бы стенсил на reload
  canvas.markDirty() // состав library/ в .zip изменился → проект разошёлся с экспортом
  const ok = await deleteStencilFromDisk(id)
  if (ok) notify.success('Символ удалён', id)
  else
    notify.warn(
      'Символ удалён',
      'Файл на диске не удалён (dev-плагин недоступен) — после перезагрузки может вернуться'
    )
}
</script>

<template>
  <aside class="flex-1 min-h-0 flex flex-col bg-surface-50">
    <div>
      <div
        class="min-h-14 px-4 border-b border-surface-200 bg-surface-0 flex items-center justify-between gap-3"
      >
        <h2 class="shrink-0 text-sm font-semibold text-surface-900 uppercase tracking-wide">
          Палитра
        </h2>
        <!-- Кнопки-действия. Поиск раскрывается отдельной строкой ниже (не в
             шапке), поэтому кнопки не прячутся и не теснятся при росте их числа. -->
        <div class="flex items-center gap-1">
          <Button
            v-tooltip.bottom="'Поиск символов'"
            icon="pi pi-search"
            :severity="searchOpen ? 'primary' : 'secondary'"
            :text="!searchOpen"
            size="small"
            class="tms-icon-btn shrink-0"
            @click="toggleSearch"
          />
          <Button
            v-tooltip.bottom="'Создать символ'"
            icon="pi pi-plus"
            severity="secondary"
            text
            size="small"
            class="tms-icon-btn shrink-0"
            @click="ui.openStencilEditor()"
          />
        </div>
      </div>

      <!-- Поле поиска «выезжает» между шапкой и списком (grid-rows 0fr↔1fr — тот же
           приём, что сворачивание в дереве форм). Всегда смонтировано (focus по
           openSearch работает); border-b — только раскрытым (в 0-высоте линия
           клипуется, но условие убирает мигание в конце анимации). -->
      <div
        class="grid transition-[grid-template-rows] duration-200 ease-out"
        :class="searchOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'"
      >
        <div class="overflow-hidden">
          <div
            class="px-3 py-2 bg-surface-0"
            :class="{ 'border-b border-surface-200': searchOpen }"
          >
            <IconField class="w-full">
              <InputText
                ref="searchInput"
                v-model="search"
                size="small"
                class="w-full !h-8"
                placeholder="Поиск по названию или id..."
                @keyup.esc="closeSearch"
              />
              <InputIcon
                v-if="search"
                class="pi pi-times cursor-pointer hover:text-surface-700"
                @click="clearQuery"
              />
            </IconField>
          </div>
        </div>
      </div>
    </div>

    <div class="flex-1 p-2 overflow-auto">
      <template v-if="!allCategories.length">
        <div class="flex flex-col items-center text-center text-surface-400 py-10">
          <i class="pi pi-inbox text-3xl mb-3 opacity-60" />
          <div class="text-sm font-medium text-surface-500">Реестр символов пуст</div>
          <p class="text-[11px] mt-1 max-w-[180px]">Добавь папку в src/stencils/definitions/</p>
        </div>
      </template>

      <template v-else-if="noResults">
        <div class="flex flex-col items-center text-center text-surface-400 py-8">
          <i class="pi pi-search text-2xl mb-2 opacity-60" />
          <div class="text-xs">Ничего не нашлось по «{{ search }}»</div>
        </div>
      </template>

      <Accordion v-else v-model:value="accordionActive" multiple class="tms-palette-accordion">
        <AccordionPanel v-for="cat in categories" :key="cat" :value="cat">
          <AccordionHeader>
            <span
              class="flex items-center gap-2 w-full pr-2 text-[11px] uppercase tracking-wider font-semibold"
            >
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
              class="group flex items-center gap-3 p-2 rounded hover:bg-surface-100 cursor-grab active:cursor-grabbing select-none"
              v-tooltip.right="stencilTooltip(stencil)"
              @pointerdown="onStencilPointerDown($event, stencil)"
            >
              <div
                class="stencil-thumb flex-shrink-0 w-9 h-9 flex items-center justify-center bg-white rounded border border-surface-200 overflow-hidden p-1 transition-transform group-hover:scale-105"
                v-html="stencil.svgText"
              ></div>
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium text-surface-900 truncate">
                  {{ stencil.label }}
                </div>
                <div class="text-[10px] font-mono text-surface-500 truncate">
                  {{ stencil.id }}
                </div>
              </div>
              <!-- Правка — у всех, кроме залоченных (`locked`: программные,
                   анимированные, с текстом — их SVG в наш формат не разбирается).
                   Открывает редактор с id. -->
              <button
                v-if="!stencil.locked"
                type="button"
                v-tooltip.bottom="'Редактировать символ'"
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded text-surface-400 opacity-0 hover:bg-surface-200 hover:text-surface-700 group-hover:opacity-100"
                @pointerdown.stop
                @click="ui.openStencilEditor(stencil.id)"
              >
                <i class="pi pi-pencil !text-sm" />
              </button>
              <!-- Удаление — у всех, кроме залоченных (`locked`). Видно по ховеру
                   строки. @pointerdown.stop глушит старт drag'а (строка тащится по
                   pointerdown). Клик БЕЗ .stop: ConfirmPopup выравнивается по target
                   только в своём document-click листенере — с .stop клик не всплыл бы
                   и попап упал бы в (0,0). Drag уже погашен на pointerdown, click безопасен. -->
              <button
                v-if="!stencil.locked"
                type="button"
                v-tooltip.bottom="'Удалить символ'"
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded text-surface-400 opacity-0 hover:bg-surface-200 hover:text-red-600 group-hover:opacity-100"
                @pointerdown.stop
                @click="confirmDeleteStencil($event, stencil)"
              >
                <i class="pi pi-trash !text-sm" />
              </button>
            </div>
          </AccordionContent>
        </AccordionPanel>
      </Accordion>
    </div>
  </aside>
</template>

<style>
/* Увеличенное превью SVG стенсила в hover-tooltip'е (см. stencilTooltip).
 PrimeVue tooltip монтируется в body — стили не должны быть scoped. Белый
 фон чтобы чёрные обводки SVG читались на тёмной плашке tooltip'а. */
.tms-stencil-zoom {
  width: 96px;
  height: 96px;
  background: #fff;
  border-radius: 4px;
  padding: 8px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
}
.tms-stencil-zoom svg {
  width: 100%;
  height: 100%;
  display: block;
}
/* По дефолту .p-tooltip-text имеет асимметричный padding (4/8) — для
 зум-превью переопределяем на равномерный, иначе сверху «съедается». */
.p-tooltip:has(.tms-stencil-zoom) .p-tooltip-text {
  padding: 6px;
}

/* PrimeVue Accordion-дефолты в Aura — слишком жирные border/padding для
 узкой колонки палитры. Сжимаем: тонкая нижняя линия между панелями,
 компактные паддинги, header с прозрачным background чтобы вписаться
 в общий фон aside'а. */
.tms-palette-accordion .p-accordionheader {
  padding: 0.5rem 0.5rem;
  background: transparent;
  border: 0;
}
.tms-palette-accordion .p-accordionheader:hover {
  background: var(--p-surface-100);
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
/* У раскрытой панели разделитель снизу убираем (он же — border-top следующей):
 линия под контентом открытой категории выглядела бы лишним «нижним бордером». */
.tms-palette-accordion .p-accordionpanel:has([aria-expanded='true']) + .p-accordionpanel {
  border-top: 0;
}
</style>
