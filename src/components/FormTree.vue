<script setup>
/**
 * Дерево форм проекта (навигатор, слева над палитрой). Иерархия — из
 * `workspace.formTree` (грузится из hierarchy.json проекта, см. useProject).
 * Клик по узлу — открыть форму, копия — дублировать (копия встаёт сиблингом),
 * карандаш — inline-rename, × — удаление, «+» в шапке — создать (падает последним
 * узлом в корень), drag-and-drop — перестройка (перенос/вложение узлов). Кнопки
 * прижаты к правому краю строки, удаление крайнее: новая кнопка не сдвигает
 * привычные, а деструктивное остаётся дальше всех от имени. Клик по заголовку сворачивает секцию (тело дерева
 * прячется, палитра забирает место; состояние в localStorage). Формы вне дерева →
 * группа «Без иерархии»; узлы на несуществующую форму рисуются битыми (серым).
 */
import { computed, ref, nextTick, onBeforeUnmount } from 'vue'
import { useLocalStorage } from '@vueuse/core'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import { useConfirm } from 'primevue/useconfirm'
import { useCanvas } from '../composables/useCanvas'
import { useWorkspaceStore } from '../stores/useWorkspaceStore'
import { subtreeIds, computeDrop } from '../utils/formTreeDnd'
import { confirmDanger } from '../utils/confirmDanger'

const canvas = useCanvas()
const workspace = useWorkspaceStore()
const confirm = useConfirm()

// Свёрнута ли вся секция «Формы» (тело дерева спрятано, палитра забирает место).
// Отдельно от collapsed-веток; persist в localStorage — как у аккордеона палитры.
const panelCollapsed = useLocalStorage('tms-ide:forms-collapsed:v1', false)

// Свёрнутые ветки (по id). По умолчанию всё раскрыто.
const collapsed = ref(new Set())
function toggle(id) {
  const s = new Set(collapsed.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  collapsed.value = s
}

function collectIds(nodes, set) {
  for (const n of nodes) {
    set.add(n.id)
    collectIds(n.children, set)
  }
}

// Плоский список строк для рендера (DFS с учётом свёрнутости) + группа orphan'ов.
const rows = computed(() => {
  const existing = new Set(workspace.formIds)
  const inTree = new Set()
  const out = []
  const walk = (nodes, depth) => {
    for (const n of nodes) {
      const hasChildren = !!n.children?.length
      if (hasChildren) collectIds(n.children, inTree) // все потомки — «в дереве»
      inTree.add(n.id)
      out.push({ kind: 'form', id: n.id, depth, hasChildren, broken: !existing.has(n.id) })
      if (hasChildren && !collapsed.value.has(n.id)) walk(n.children, depth + 1)
    }
  }
  walk(workspace.formTree, 0)
  const orphans = workspace.formIds.filter((id) => !inTree.has(id))
  if (orphans.length) {
    out.push({ kind: 'group', label: 'Без иерархии' })
    for (const id of orphans)
      out.push({ kind: 'form', id, depth: 0, hasChildren: false, broken: false })
  }
  return out
})

// ─── Inline-переименование ───
const editingId = ref(null)
const editValue = ref('')
let renameInputEl = null
const setRenameInput = (el) => (renameInputEl = el)

async function startRename(id) {
  editingId.value = id
  editValue.value = id
  await nextTick()
  renameInputEl?.$el?.focus()
  renameInputEl?.$el?.select()
}
async function commitRename() {
  const oldId = editingId.value
  if (oldId == null) return
  const next = editValue.value
  editingId.value = null
  if (next.trim() && next.trim() !== oldId) await canvas.renameForm(oldId, next)
}
function cancelRename() {
  editingId.value = null
}

// Клик кнопки × ДОЛЖЕН всплыть до document: ConfirmPopup выравнивается по
// target только в своём document-click listener'е (первичного align в onEnter
// нет) — с @click.stop попап падал в (0,0). Строка без @click, всплытие безопасно.
function confirmDelete(event, id) {
  confirmDanger(confirm, {
    target: event.currentTarget,
    message: `Удалить форму «${id}»?`,
    acceptLabel: 'Удалить',
    accept: () => canvas.deleteForm(id),
  })
}

// ─── Drag-and-drop перестройка дерева ───
// Драг стартует по порогу (не мешает клику-выбору / кнопкам с data-nodrag).
// Зона (before/inside/after) и цель считаются в computeDrop по строке под курсором;
// подсветка/линия — по dropTarget, серым — перетаскиваемое поддерево (invalidIds).
const DRAG_THRESHOLD = 4
const AUTO_EXPAND_MS = 500
const dragId = ref(null) // активный drag (после порога)
const dropTarget = ref(null) // { targetId, zone } | null
const invalidIds = ref(new Set()) // перетаскиваемый узел + его поддерево (нельзя дропать внутрь)
let pointerStart = null // { x, y, id } с pointerdown, до порога
let justDragged = false // подавить click-select сразу после drag
let autoExpandTimer = null
const scrollEl = ref(null) // контейнер-скролл (авто-скролл у краёв при drag)
const dragPos = ref({ x: 0, y: 0 }) // курсор: превью-чип + пересчёт цели при авто-скролле
let autoScrollDir = 0 // -1 вверх / +1 вниз / 0
let scrollRaf = null
const EDGE_ZONE = 24 // px от кромки контейнера, где включается авто-скролл
const SCROLL_STEP = 8 // px за кадр

const isDragged = (row) => dragId.value != null && invalidIds.value.has(row.id)
const dropInside = (row) =>
  dropTarget.value?.zone === 'inside' && dropTarget.value.targetId === row.id
const dropBefore = (row) =>
  dropTarget.value?.zone === 'before' && dropTarget.value.targetId === row.id
const dropAfter = (row) =>
  dropTarget.value?.zone === 'after' && dropTarget.value.targetId === row.id

function onRowPointerDown(event, row) {
  if (event.button !== 0 || editingId.value != null) return
  if (event.target.closest('[data-nodrag]')) return // клик кнопки (шеврон/rename/delete) — не drag
  pointerStart = { x: event.clientX, y: event.clientY, id: row.id }
  document.addEventListener('pointermove', onPointerMove)
  document.addEventListener('pointerup', onPointerUp)
}

function onPointerMove(event) {
  if (!pointerStart) return
  if (dragId.value == null) {
    if (Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) < DRAG_THRESHOLD)
      return
    dragId.value = pointerStart.id
    invalidIds.value = subtreeIds(workspace.formTree, pointerStart.id)
    scrollRaf = requestAnimationFrame(autoScrollLoop) // старт авто-скролла у краёв
  }
  dragPos.value = { x: event.clientX, y: event.clientY }
  updateAutoScroll(event.clientY)
  updateDrop(event.clientX, event.clientY)
}

// Цель/зона drop'а по строке под курсором (общее для pointermove и авто-скролла).
function updateDrop(x, y) {
  const el = document.elementFromPoint(x, y)?.closest('[data-row-idx]')
  if (!el) {
    dropTarget.value = null
    return
  }
  const rect = el.getBoundingClientRect()
  const fraction = (y - rect.top) / rect.height
  dropTarget.value = computeDrop(rows.value, Number(el.dataset.rowIdx), fraction, invalidIds.value)
  scheduleAutoExpand()
}

// Курсор у верх/низ кромки списка → направление авто-скролла (крутит autoScrollLoop).
function updateAutoScroll(y) {
  const box = scrollEl.value?.getBoundingClientRect()
  if (!box) {
    autoScrollDir = 0
    return
  }
  if (y < box.top + EDGE_ZONE) autoScrollDir = -1
  else if (y > box.bottom - EDGE_ZONE) autoScrollDir = 1
  else autoScrollDir = 0
}

function autoScrollLoop() {
  if (dragId.value == null) {
    scrollRaf = null
    return
  }
  const el = scrollEl.value
  if (autoScrollDir !== 0 && el) {
    const before = el.scrollTop
    el.scrollTop += autoScrollDir * SCROLL_STEP
    // Курсор стоит, но под ним уехала другая строка → пересчитываем цель.
    if (el.scrollTop !== before) updateDrop(dragPos.value.x, dragPos.value.y)
  }
  scrollRaf = requestAnimationFrame(autoScrollLoop)
}

// Наведение «внутрь» свёрнутого узла ~0.5с раскрывает его — можно дропнуть глубже.
function scheduleAutoExpand() {
  clearTimeout(autoExpandTimer)
  const t = dropTarget.value
  if (!t || t.zone !== 'inside' || !collapsed.value.has(t.targetId)) return
  autoExpandTimer = setTimeout(() => {
    if (dragId.value != null && dropTarget.value?.targetId === t.targetId) toggle(t.targetId)
  }, AUTO_EXPAND_MS)
}

function onPointerUp() {
  document.removeEventListener('pointermove', onPointerMove)
  document.removeEventListener('pointerup', onPointerUp)
  clearTimeout(autoExpandTimer)
  if (scrollRaf) cancelAnimationFrame(scrollRaf)
  scrollRaf = null
  autoScrollDir = 0
  const drag = dragId.value
  const drop = dropTarget.value
  pointerStart = null
  dragId.value = null
  dropTarget.value = null
  invalidIds.value = new Set()
  if (drag == null) return
  justDragged = true
  setTimeout(() => (justDragged = false), 0) // click после pointerup увидит флаг и не выберет форму
  if (drop) canvas.moveFormNode(drag, drop.targetId, drop.zone)
}

function onNameClick(row) {
  if (justDragged || row.broken) return
  canvas.selectForm(row.id)
}

onBeforeUnmount(() => {
  document.removeEventListener('pointermove', onPointerMove)
  document.removeEventListener('pointerup', onPointerUp)
  clearTimeout(autoExpandTimer)
  if (scrollRaf) cancelAnimationFrame(scrollRaf)
})
</script>

<template>
  <!-- Нижний бордер корня (граница с палитрой) — только в раскрытом виде: в
       свёрнутом он встык с бордером шапки давал бы двойную линию (2px). -->
  <div
    class="flex shrink-0 flex-col bg-surface-50"
    :class="{ 'border-b border-surface-200': !panelCollapsed }"
  >
    <!-- Клик по всей шапке сворачивает/разворачивает секцию (тело дерева); клик
         по кнопке «+» гасится @click.stop, чтобы не тоглить заодно. -->
    <div
      class="min-h-14 px-4 border-b border-surface-200 bg-surface-0 flex cursor-pointer select-none items-center justify-between gap-2"
      @click="panelCollapsed = !panelCollapsed"
    >
      <h2
        class="min-w-0 flex-1 truncate text-sm font-semibold uppercase tracking-wide text-surface-900"
      >
        Формы
      </h2>
      <!-- Кнопка «создать форму» — тот же PrimeVue Button, что в тулбаре холста
           (secondary/text/small): единый размер, hover и поведение. В свёрнутом
           виде прячем: создавать форму в скрытую секцию некуда. -->
      <Button
        v-if="!panelCollapsed"
        v-tooltip.bottom="'Создать форму'"
        icon="pi pi-plus"
        severity="secondary"
        text
        size="small"
        class="tms-icon-btn"
        @click.stop="canvas.createForm()"
      />
    </div>

    <!-- Анимация сворачивания: grid-rows 1fr↔0fr плавно тянет реальную высоту тела;
         внутренний overflow-hidden клипует содержимое во время коллапса. -->
    <div
      class="grid transition-[grid-template-rows] duration-200 ease-out"
      :class="panelCollapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'"
    >
      <div class="overflow-hidden">
        <div
          ref="scrollEl"
          class="flex max-h-[40vh] flex-col gap-0.5 overflow-auto p-1"
          :class="{ 'cursor-grabbing select-none': dragId }"
        >
          <template v-for="(row, i) in rows" :key="row.kind === 'form' ? `f:${row.id}` : `g:${i}`">
            <!-- Заголовок группы «Без иерархии» -->
            <div
              v-if="row.kind === 'group'"
              :data-row-idx="i"
              class="mt-2 px-2 py-1 text-[10px] uppercase tracking-wider text-surface-400"
            >
              {{ row.label }}
            </div>

            <!-- Строка формы -->
            <div
              v-else
              class="group relative flex items-center gap-1 rounded transition-colors"
              :class="[
                row.id === workspace.activeFormId ? 'bg-surface-200/70' : 'hover:bg-surface-100',
                dropInside(row) && 'bg-primary-50 ring-1 ring-inset ring-primary-400',
                isDragged(row) && 'opacity-40',
              ]"
              :style="{ paddingLeft: `${row.depth * 14}px` }"
              :data-row-idx="i"
              @pointerdown="onRowPointerDown($event, row)"
            >
              <!-- Индикатор вставки при drag (before/after) -->
              <div
                v-if="dropBefore(row)"
                class="pointer-events-none absolute inset-x-1 top-0 z-10 h-0.5 rounded bg-primary-500"
              />
              <div
                v-if="dropAfter(row)"
                class="pointer-events-none absolute inset-x-1 bottom-0 z-10 h-0.5 rounded bg-primary-500"
              />
              <!-- Шеврон свёртки / спейсер под выравнивание -->
              <button
                v-if="row.hasChildren"
                type="button"
                data-nodrag
                class="flex h-5 w-5 shrink-0 items-center justify-center text-surface-400 hover:text-surface-700"
                @click="toggle(row.id)"
              >
                <i
                  class="pi text-[10px]!"
                  :class="collapsed.has(row.id) ? 'pi-chevron-right' : 'pi-chevron-down'"
                />
              </button>
              <span v-else class="w-5 shrink-0" aria-hidden="true"></span>

              <InputText
                v-if="editingId === row.id"
                :ref="setRenameInput"
                v-model="editValue"
                size="small"
                class="relative z-10 my-0.5 w-full py-0.5! font-mono text-xs!"
                @keyup.enter="commitRename"
                @keyup.esc="cancelRename"
                @blur="commitRename"
              />
              <template v-else>
                <button
                  type="button"
                  class="flex min-w-0 flex-1 items-center gap-1.5 py-1 pr-1 text-left text-xs font-mono truncate"
                  :class="[
                    row.broken
                      ? 'text-surface-400 line-through cursor-default'
                      : row.id === workspace.activeFormId
                        ? 'text-surface-900 font-medium'
                        : 'text-surface-600',
                  ]"
                  :title="row.broken ? `${row.id} — форма отсутствует` : row.id"
                  @click="onNameClick(row)"
                >
                  <i
                    class="pi pi-file text-[10px]! shrink-0"
                    :class="
                      row.id === workspace.activeFormId ? 'text-primary-500' : 'text-surface-400'
                    "
                  />
                  <span class="truncate">{{ row.id }}</span>
                </button>
                <button
                  v-if="!row.broken"
                  type="button"
                  data-nodrag
                  v-tooltip.bottom="'Дублировать форму'"
                  class="flex h-5 w-5 shrink-0 items-center justify-center rounded text-surface-400 opacity-0 hover:bg-surface-200 hover:text-surface-700 group-hover:opacity-100"
                  @click.stop="canvas.duplicateForm(row.id)"
                >
                  <i class="pi pi-clone text-[10px]!" />
                </button>
                <button
                  v-if="!row.broken"
                  type="button"
                  data-nodrag
                  v-tooltip.bottom="'Переименовать'"
                  class="flex h-5 w-5 shrink-0 items-center justify-center rounded text-surface-400 opacity-0 hover:bg-surface-200 hover:text-surface-700 group-hover:opacity-100"
                  @click.stop="startRename(row.id)"
                >
                  <i class="pi pi-pencil text-[10px]!" />
                </button>
                <button
                  v-if="!row.broken && workspace.formIds.length > 1"
                  type="button"
                  data-nodrag
                  v-tooltip.bottom="'Удалить форму'"
                  class="mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-surface-400 opacity-0 hover:bg-surface-200 hover:text-surface-700 group-hover:opacity-100"
                  @click="confirmDelete($event, row.id)"
                >
                  <i class="pi pi-times text-[10px]!" />
                </button>
              </template>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- Превью-чип за курсором при drag (Teleport в body — не режется overflow панели). -->
    <Teleport to="body">
      <div
        v-if="dragId"
        class="pointer-events-none fixed z-[100] flex items-center gap-1.5 rounded bg-surface-0 px-2 py-1 font-mono text-xs shadow-lg ring-1 ring-surface-300"
        :style="{ left: `${dragPos.x + 12}px`, top: `${dragPos.y + 8}px` }"
      >
        <i class="pi pi-file text-[10px]! text-primary-500" />
        {{ dragId }}
      </div>
    </Teleport>
  </div>
</template>
