<script setup>
/**
 * Редактор стенсилов (v1 — статика, без слоёв анимации). Оверлей поверх холста:
 * рисование примитивов (rect/line/circle/polyline) + расстановка портов, всё со
 * снапом к сетке (вершины фигур → шаг 5, порты/размер → шаг 10). Модель, операции
 * и undo/redo — в useStencilEditor; здесь DOM: SVG-холст, рисование жестами и
 * привязка перемещения/ресайза через interact.js (колбэки обновляют модель, Vue
 * перерисовывает — interact не мутирует DOM в обход Vue). Открывается на создание
 * (пустой черновик) либо правку существующего userCreated-стенсила (loadStencil по
 * ui.stencilEditorTargetId). Сохранение валидирует черновик, регистрирует стенсил
 * в реестре и пишет на диск (dev-плагин).
 */
import { computed, ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { useElementSize, useEventListener } from '@vueuse/core'
import interact from 'interactjs'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Select from 'primevue/select'
import { useConfirm } from 'primevue/useconfirm'
import { useUiStore } from '../stores/useUiStore'
import { useNotify } from '../composables/useNotify'
import { useCanvas } from '../composables/useCanvas'
import { snapToGrid } from '../utils/grid'
import { stencilDraftIssues } from '../utils/stencilSvg'
import {
  getAllStencils,
  getStencilById,
  getCategories,
  registerStencil,
} from '../stencils/registry'
import { reinjectAllStencils } from '../stencils/svgInjector'
import { persistStencilsToDisk } from '../services/stencilLibrary'
import { useStencilEditor, SHAPE_GRID } from '../composables/useStencilEditor'

const ui = useUiStore()
const notify = useNotify()
const confirm = useConfirm()
const canvas = useCanvas()
const ed = useStencilEditor()
const {
  meta,
  shapes,
  ports,
  tool,
  selectedId,
  editingId,
  canUndo,
  canRedo,
  snapShapeX,
  snapShapeY,
  setTool,
  loadStencil,
  select,
  addShape,
  updateShape,
  removeShape,
  addPort,
  movePort,
  removePort,
  commit,
  undo,
  redo,
} = ed

// Инструмент выбора отделён от рисующих разделителем (см. шаблон), поэтому
// вынесен отдельно от списка рисующих инструментов.
const SELECT_TOOL = { key: 'select', icon: 'pi pi-arrow-up-left', tip: 'Выбор / перемещение' }
const DRAW_TOOLS = [
  { key: 'line', icon: 'pi pi-minus', tip: 'Линия' },
  { key: 'rect', icon: 'pi pi-stop', tip: 'Прямоугольник' },
  { key: 'circle', icon: 'pi pi-circle', tip: 'Окружность' },
  { key: 'polyline', icon: 'pi pi-chart-line', tip: 'Ломаная (двойной клик — завершить)' },
  { key: 'port', icon: 'pi pi-map-marker', tip: 'Порт (клик по порту — удалить)' },
]

const categories = computed(() => getCategories())

// Режим определяется таргетом из store: задан id → правка (грузим стенсил в
// модель, id блокируется), иначе создание нового (префилл `cell_` в поле id).
// Правим только userCreated — их SVG в нашем формате, парсится обратно однозначно.
const editTarget = ui.stencilEditorTargetId ? getStencilById(ui.stencilEditorTargetId) : null
if (editTarget) loadStencil(editTarget)
else if (!meta.id) meta.id = 'cell_'

// Есть ли что терять при закрытии (нарисованные фигуры/порты). Метаданные без
// фигур за «работу» не считаем — закрытие пустого редактора не переспрашиваем.
const isDirty = computed(() => shapes.value.length > 0 || ports.value.length > 0)

// Закрытие с подтверждением, если черновик непустой. Попап якорим на кнопку
// «Закрыть» (для Esc, где нет DOM-таргета события, — через closeBtn-реф).
const closeBtn = ref(null)
function requestClose(event) {
  if (!isDirty.value) {
    ui.closeStencilEditor()
    return
  }
  confirm.require({
    target: event?.currentTarget || closeBtn.value?.$el,
    message: 'Закрыть редактор? Несохранённый стенсил будет потерян.',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Закрыть',
    rejectLabel: 'Отмена',
    acceptProps: { severity: 'danger', size: 'small' },
    rejectProps: { severity: 'secondary', text: true, size: 'small' },
    accept: () => ui.closeStencilEditor(),
  })
}

// Сохранение: валидация → регистрация в реестре (появится в палитре) → персист
// на диск (в проде плагина нет → стенсил уедет в library/ проекта). В режиме
// правки id исключаем из проверки уникальности (он и есть редактируемый) и после
// сохранения переинжектим активную форму — расставленные экземпляры подхватят
// новый рисунок; при смене размера/портов предупреждаем (их геометрия не тронута).
async function save() {
  const editing = editingId.value
  const existingIds = getAllStencils()
    .map((s) => s.id)
    .filter((id) => id !== editing)
  const issues = stencilDraftIssues(meta, shapes.value, existingIds)
  if (issues.length) {
    notify.warn('Проверьте стенсил', issues.join('; '))
    return
  }
  const prev = editing ? getStencilById(editing) : null
  const { json, svg } = ed.output()
  registerStencil(json, svg)
  const ok = await persistStencilsToDisk([{ id: json.id, stencilJson: json, shapeSvg: svg }])

  if (editing) {
    reinjectAllStencils(canvas.graphRef.value, canvas.paperRef.value)
    canvas.bumpVersion()
    const geomChanged =
      prev &&
      (prev.width !== json.width ||
        prev.height !== json.height ||
        JSON.stringify(prev.ports || []) !== JSON.stringify(json.ports || []))
    if (geomChanged) {
      notify.warn(
        'Стенсил обновлён',
        'Размер/порты у уже расставленных экземпляров не меняются — переставьте при необходимости'
      )
    } else {
      notify.success('Стенсил обновлён', json.id)
    }
  } else if (ok) {
    notify.success('Стенсил создан', json.id)
  } else {
    notify.warn(
      'Стенсил создан',
      'Запись на диск недоступна — переживёт сессию и уедет в архив проекта'
    )
  }
  ui.closeStencilEditor()
}

// Размер стенсила кратен 10 (порты и сам стенсил садятся на сетку схемы).
watch(
  () => [meta.width, meta.height],
  () => {
    meta.width = Math.max(10, snapToGrid(meta.width, 10))
    meta.height = Math.max(10, snapToGrid(meta.height, 10))
  }
)

// id = имя папки definitions/<id>/ → маска `[a-z0-9_]`. Фильтруем прямо в DOM
// (не через watch/computed: там значение уходит в кириллицу и обратно за один
// тик, Vue не видит изменения modelValue и не перезатирает введённый символ).
function onIdInput(e) {
  const clean = (e.target.value || '').toLowerCase().replace(/[^a-z0-9_]/g, '')
  if (e.target.value !== clean) e.target.value = clean
  meta.id = clean
}

// ─── Масштаб холста ───
// Вписываем bbox стенсила в доступную область с запасом; клампим, чтобы мелкие
// стенсилы не раздувались до пикселизации, а крупные помещались.
const stageEl = ref(null)
const { width: stageW, height: stageH } = useElementSize(stageEl)
const scale = computed(() => {
  const availW = Math.max(1, stageW.value - 48)
  const availH = Math.max(1, stageH.value - 48)
  const fit = Math.min(availW / meta.width, availH / meta.height)
  return Math.max(3, Math.min(24, fit))
})
const pxW = computed(() => meta.width * scale.value)
const pxH = computed(() => meta.height * scale.value)
// Ручки/порты — константного размера на экране (в user-единицах = px/scale).
const hr = computed(() => 4 / scale.value)

// ─── Сетка ───
const range = (max, step) => {
  const out = []
  for (let v = 0; v <= max + 1e-6; v += step) out.push(v)
  return out
}
const gridX = computed(() => range(meta.width, SHAPE_GRID))
const gridY = computed(() => range(meta.height, SHAPE_GRID))
const lineColor = (v) => (v % 10 === 0 ? '#d4d4d8' : '#eef0f2')

// ─── Пиксель события → user-координаты стенсила ───
const svgEl = ref(null)
function unitsFromEvent(e) {
  const r = svgEl.value.getBoundingClientRect()
  return {
    x: ((e.clientX - r.left) / r.width) * meta.width,
    y: ((e.clientY - r.top) / r.height) * meta.height,
  }
}
function snappedShape(e) {
  const u = unitsFromEvent(e)
  return { x: snapShapeX(u.x), y: snapShapeY(u.y) }
}

// ─── Рисование жестами (rect/line/circle — drag; polyline — клики) ───
const drawing = ref(null) // { type, sx, sy, cx, cy } — тянущаяся фигура
const polyPoints = ref([]) // накопленные вершины ломаной
const polyCursor = ref(null) // «резинка» до курсора

function onSurfaceDown(e) {
  if (e.button !== 0) return
  if (tool.value === 'select') {
    if (!e.target.closest('[data-se-move]')) select(null)
    return
  }
  if (tool.value === 'port') {
    if (e.target.closest('[data-se-move="port"]')) return // клик по порту — его хендлер
    const u = unitsFromEvent(e)
    addPort(u.x, u.y)
    return
  }
  if (tool.value === 'polyline') {
    const u = snappedShape(e)
    polyPoints.value = [...polyPoints.value, [u.x, u.y]]
    return
  }
  const u = snappedShape(e)
  drawing.value = { type: tool.value, sx: u.x, sy: u.y, cx: u.x, cy: u.y }
  window.addEventListener('pointermove', onDrawMove)
  window.addEventListener('pointerup', onDrawUp)
}

function onSurfaceMove(e) {
  if (tool.value === 'polyline' && polyPoints.value.length) {
    const u = snappedShape(e)
    polyCursor.value = [u.x, u.y]
  }
}

function onDrawMove(e) {
  if (!drawing.value) return
  const u = snappedShape(e)
  drawing.value = { ...drawing.value, cx: u.x, cy: u.y }
}
function onDrawUp() {
  window.removeEventListener('pointermove', onDrawMove)
  window.removeEventListener('pointerup', onDrawUp)
  commitDrawing()
}
function commitDrawing() {
  const d = drawing.value
  drawing.value = null
  if (!d) return
  if (d.type === 'rect') {
    const w = Math.abs(d.cx - d.sx)
    const h = Math.abs(d.cy - d.sy)
    if (w < SHAPE_GRID || h < SHAPE_GRID) return // клик без протяжки — не фигура
    addShape({ type: 'rect', x: Math.min(d.sx, d.cx), y: Math.min(d.sy, d.cy), w, h })
  } else if (d.type === 'line') {
    if (d.sx === d.cx && d.sy === d.cy) return
    addShape({ type: 'line', x1: d.sx, y1: d.sy, x2: d.cx, y2: d.cy })
  } else if (d.type === 'circle') {
    const r = snapToGrid(Math.hypot(d.cx - d.sx, d.cy - d.sy), SHAPE_GRID)
    if (r < SHAPE_GRID) return
    addShape({ type: 'circle', cx: d.sx, cy: d.sy, r })
  }
}

function finishPolyline() {
  if (tool.value !== 'polyline') return
  // Дедуп подряд идущих совпадающих точек (двойной клик добавляет лишнюю).
  const pts = polyPoints.value.filter(
    (p, i, arr) => i === 0 || p[0] !== arr[i - 1][0] || p[1] !== arr[i - 1][1]
  )
  if (pts.length >= 2) addShape({ type: 'polyline', points: pts })
  polyPoints.value = []
  polyCursor.value = null
}

// Превью тянущейся фигуры (пунктиром) — считаем из drawing.
const draftRect = computed(() => {
  const d = drawing.value
  if (d?.type !== 'rect') return null
  return {
    x: Math.min(d.sx, d.cx),
    y: Math.min(d.sy, d.cy),
    w: Math.abs(d.cx - d.sx),
    h: Math.abs(d.cy - d.sy),
  }
})
const draftCircleR = computed(() => {
  const d = drawing.value
  if (d?.type !== 'circle') return 0
  return Math.hypot(d.cx - d.sx, d.cy - d.sy)
})
const polyPreview = computed(() => {
  if (!polyPoints.value.length) return ''
  const pts = polyCursor.value ? [...polyPoints.value, polyCursor.value] : polyPoints.value
  return pts.map(([x, y]) => `${x},${y}`).join(' ')
})

// ─── Ручки выделенной фигуры ───
const selectedShape = computed(() => shapes.value.find((s) => s.id === selectedId.value) || null)
const handles = computed(() => {
  const s = selectedShape.value
  if (!s) return []
  if (s.type === 'rect') {
    return [
      { h: 'nw', x: s.x, y: s.y },
      { h: 'ne', x: s.x + s.w, y: s.y },
      { h: 'sw', x: s.x, y: s.y + s.h },
      { h: 'se', x: s.x + s.w, y: s.y + s.h },
    ]
  }
  if (s.type === 'circle') return [{ h: 'r', x: s.cx + s.r, y: s.cy }]
  if (s.type === 'line') {
    return [
      { h: 'v0', x: s.x1, y: s.y1 },
      { h: 'v1', x: s.x2, y: s.y2 },
    ]
  }
  if (s.type === 'polyline') return s.points.map(([x, y], i) => ({ h: `v${i}`, x, y }))
  return []
})

// ─── interact.js: перемещение фигур/портов и ресайз ручками ───
// Селектор [data-se-move] существует только внутри редактора. Колбэки берут
// абсолютную позицию курсора → user-координаты → снап → пишут в модель.
let dragCtx = null
const clone = (v) => JSON.parse(JSON.stringify(v))

function anchorOf(s) {
  if (s.type === 'rect') return { x: s.x, y: s.y }
  if (s.type === 'circle') return { x: s.cx, y: s.cy }
  if (s.type === 'line') return { x: s.x1, y: s.y1 }
  return { x: s.points[0][0], y: s.points[0][1] }
}
function translated(s, dx, dy) {
  if (s.type === 'rect') return { x: s.x + dx, y: s.y + dy }
  if (s.type === 'circle') return { cx: s.cx + dx, cy: s.cy + dy }
  if (s.type === 'line') return { x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy }
  return { points: s.points.map(([x, y]) => [x + dx, y + dy]) }
}

function reshape(snap, hKey, cur) {
  const p = { x: snapShapeX(cur.x), y: snapShapeY(cur.y) }
  if (snap.type === 'rect') {
    const fixed = {
      nw: { x: snap.x + snap.w, y: snap.y + snap.h },
      ne: { x: snap.x, y: snap.y + snap.h },
      sw: { x: snap.x + snap.w, y: snap.y },
      se: { x: snap.x, y: snap.y },
    }[hKey]
    updateShape(snap.id, {
      x: Math.min(p.x, fixed.x),
      y: Math.min(p.y, fixed.y),
      w: Math.max(SHAPE_GRID, Math.abs(fixed.x - p.x)),
      h: Math.max(SHAPE_GRID, Math.abs(fixed.y - p.y)),
    })
  } else if (snap.type === 'circle') {
    const r = Math.max(SHAPE_GRID, snapToGrid(Math.hypot(p.x - snap.cx, p.y - snap.cy), SHAPE_GRID))
    updateShape(snap.id, { r })
  } else if (snap.type === 'line') {
    updateShape(snap.id, hKey === 'v0' ? { x1: p.x, y1: p.y } : { x2: p.x, y2: p.y })
  } else if (snap.type === 'polyline') {
    const i = Number(hKey.slice(1))
    updateShape(snap.id, { points: snap.points.map((pt, idx) => (idx === i ? [p.x, p.y] : pt)) })
  }
}

function setupInteract() {
  interact('[data-se-move]').draggable({
    listeners: {
      start(e) {
        // Перетаскивание существующих объектов — только в режиме выбора; при
        // активном инструменте рисования клик по фигуре должен рисовать поверх.
        if (tool.value !== 'select') {
          e.interaction.stop()
          return
        }
        const el = e.target
        const role = el.dataset.seMove
        const id = el.dataset.id
        dragCtx = { role, id, hKey: el.dataset.h }
        if (role === 'shape') {
          dragCtx.snapshot = clone(shapes.value.find((s) => s.id === id))
          dragCtx.start = unitsFromEvent(e)
          select(id)
        } else if (role === 'handle') {
          dragCtx.snapshot = clone(shapes.value.find((s) => s.id === id))
        }
      },
      move(e) {
        if (!dragCtx) return
        const cur = unitsFromEvent(e)
        if (dragCtx.role === 'port') {
          movePort(dragCtx.id, cur.x, cur.y)
        } else if (dragCtx.role === 'handle') {
          reshape(dragCtx.snapshot, dragCtx.hKey, cur)
        } else if (dragCtx.role === 'shape') {
          const a = anchorOf(dragCtx.snapshot)
          const dx = snapShapeX(a.x + (cur.x - dragCtx.start.x)) - a.x
          const dy = snapShapeY(a.y + (cur.y - dragCtx.start.y)) - a.y
          updateShape(dragCtx.id, translated(dragCtx.snapshot, dx, dy))
        }
      },
      end() {
        // Один снимок истории на весь жест (move'ы шли без коммита); commit
        // сам дедупит, если фигуру/порт по факту не сдвинули.
        if (dragCtx) commit()
        dragCtx = null
      },
    },
  })
}

// Порт: в режиме порта клик удаляет его (add идёт по фону, см. onSurfaceDown).
function onPortDown(e, id) {
  if (tool.value === 'port') {
    e.stopPropagation()
    removePort(id)
  }
}

// Клавиши редактора: Del — удалить выделенную фигуру, Esc — отменить рисование
// или закрыть редактор (не трогаем при фокусе в полях размера).
function isInInput(t) {
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
}
useEventListener(window, 'keydown', (e) => {
  if (!ui.stencilEditorOpen) return
  // Undo/redo — по физической клавише (event.code): на русской раскладке
  // e.key для Z/Y возвращает «Я»/«Н», литеральное сравнение сломалось бы.
  // В полях ввода (id/название/размер) не перехватываем — там нативный undo.
  if ((e.ctrlKey || e.metaKey) && !isInInput(e.target)) {
    if (e.code === 'KeyZ') {
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
      return
    }
    if (e.code === 'KeyY') {
      e.preventDefault()
      redo()
      return
    }
  }
  if (e.key === 'Escape') {
    if (drawing.value || polyPoints.value.length) {
      drawing.value = null
      polyPoints.value = []
      polyCursor.value = null
    } else {
      requestClose()
    }
    return
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && !isInInput(e.target) && selectedId.value) {
    e.preventDefault()
    removeShape(selectedId.value)
  }
})

onMounted(setupInteract)
onBeforeUnmount(() => {
  interact('[data-se-move]').unset()
  window.removeEventListener('pointermove', onDrawMove)
  window.removeEventListener('pointerup', onDrawUp)
})
</script>

<template>
  <div class="flex flex-col bg-surface-0">
    <!-- Тулбар -->
    <div class="flex min-h-14 items-center gap-2 border-b border-surface-200 px-3">
      <h2 class="mr-2 text-sm font-semibold uppercase tracking-wide text-surface-900">
        {{ editingId ? 'Правка стенсила' : 'Новый стенсил' }}
      </h2>
      <div class="flex items-center gap-1">
        <Button
          v-tooltip.bottom="SELECT_TOOL.tip"
          :icon="SELECT_TOOL.icon"
          :severity="tool === SELECT_TOOL.key ? 'primary' : 'secondary'"
          :text="tool !== SELECT_TOOL.key"
          size="small"
          class="tms-icon-btn"
          @click="setTool(SELECT_TOOL.key)"
        />
        <div class="mx-1 h-5 w-px bg-surface-200" aria-hidden="true"></div>
        <Button
          v-for="t in DRAW_TOOLS"
          :key="t.key"
          v-tooltip.bottom="t.tip"
          :icon="t.icon"
          :severity="tool === t.key ? 'primary' : 'secondary'"
          :text="tool !== t.key"
          size="small"
          class="tms-icon-btn"
          @click="setTool(t.key)"
        />
      </div>

      <div class="mx-1 h-5 w-px bg-surface-200" aria-hidden="true"></div>

      <Button
        v-tooltip.bottom="'Отменить (Ctrl+Z)'"
        icon="pi pi-undo"
        severity="secondary"
        text
        size="small"
        class="tms-icon-btn"
        :disabled="!canUndo"
        @click="undo"
      />
      <Button
        v-tooltip.bottom="'Вернуть (Ctrl+Shift+Z)'"
        icon="pi pi-refresh"
        severity="secondary"
        text
        size="small"
        class="tms-icon-btn"
        :disabled="!canRedo"
        @click="redo"
      />

      <div class="mx-1 h-5 w-px bg-surface-200" aria-hidden="true"></div>

      <Button
        v-tooltip.bottom="'Удалить выделенное'"
        icon="pi pi-trash"
        severity="secondary"
        text
        size="small"
        class="tms-icon-btn"
        :disabled="!selectedId"
        @click="selectedId && removeShape(selectedId)"
      />

      <div class="mx-1 h-5 w-px bg-surface-200" aria-hidden="true"></div>

      <label class="flex items-center gap-1 text-xs text-surface-500">
        Ш
        <InputNumber
          v-model="meta.width"
          :min="10"
          :step="10"
          :use-grouping="false"
          size="small"
          input-class="!w-14 !py-1 text-center"
        />
      </label>
      <label class="flex items-center gap-1 text-xs text-surface-500">
        В
        <InputNumber
          v-model="meta.height"
          :min="10"
          :step="10"
          :use-grouping="false"
          size="small"
          input-class="!w-14 !py-1 text-center"
        />
      </label>

      <div class="flex-1"></div>

      <Button label="Сохранить" icon="pi pi-check" size="small" @click="save" />
      <Button
        ref="closeBtn"
        label="Закрыть"
        severity="secondary"
        text
        size="small"
        @click="requestClose"
      />
    </div>

    <!-- Метаданные: id (маска [a-z0-9_], уникален), название, категория (комбо
         из существующих + можно вписать новую). Валидируются при сохранении. -->
    <div class="flex items-center gap-3 border-b border-surface-200 bg-surface-0 px-3 py-2">
      <label class="flex items-center gap-1.5 text-xs text-surface-500">
        Название
        <InputText v-model="meta.label" size="small" class="!h-8 !w-44 !text-xs" />
      </label>
      <label class="flex items-center gap-1.5 text-xs text-surface-500">
        id
        <!-- id = имя папки definitions/<id>/; в режиме правки заблокирован.
             :model-value (не v-model) + @input: фильтрацию делает onIdInput,
             лишний update:modelValue не слушаем — иначе гонка с DOM-правкой. -->
        <InputText
          :model-value="meta.id"
          :disabled="!!editingId"
          size="small"
          class="!h-8 !w-40 font-mono !text-xs"
          @input="onIdInput"
        />
      </label>
      <label class="flex items-center gap-1.5 text-xs text-surface-500">
        Категория
        <Select
          v-model="meta.category"
          :options="categories"
          editable
          placeholder="Выберите или впишите"
          size="small"
          class="!h-8 !w-52 items-center"
        />
      </label>
    </div>

    <!-- Холст -->
    <div ref="stageEl" class="flex flex-1 items-center justify-center overflow-auto bg-surface-100">
      <svg
        ref="svgEl"
        :width="pxW"
        :height="pxH"
        :viewBox="`0 0 ${meta.width} ${meta.height}`"
        class="bg-white shadow-sm"
        :class="tool === 'select' ? 'cursor-default' : 'cursor-crosshair'"
        @pointerdown="onSurfaceDown"
        @pointermove="onSurfaceMove"
        @dblclick="finishPolyline"
      >
        <!-- Сетка -->
        <g>
          <line
            v-for="x in gridX"
            :key="`vx${x}`"
            :x1="x"
            :y1="0"
            :x2="x"
            :y2="meta.height"
            :stroke="lineColor(x)"
            stroke-width="1"
            vector-effect="non-scaling-stroke"
          />
          <line
            v-for="y in gridY"
            :key="`hy${y}`"
            :x1="0"
            :y1="y"
            :x2="meta.width"
            :y2="y"
            :stroke="lineColor(y)"
            stroke-width="1"
            vector-effect="non-scaling-stroke"
          />
        </g>

        <!-- Фигуры -->
        <template v-for="s in shapes" :key="s.id">
          <rect
            v-if="s.type === 'rect'"
            data-se-move="shape"
            :data-id="s.id"
            :x="s.x"
            :y="s.y"
            :width="s.w"
            :height="s.h"
            :fill="s.fill"
            :stroke="s.stroke"
            :stroke-width="s.strokeWidth"
            @pointerdown="tool === 'select' && select(s.id)"
          />
          <line
            v-else-if="s.type === 'line'"
            data-se-move="shape"
            :data-id="s.id"
            :x1="s.x1"
            :y1="s.y1"
            :x2="s.x2"
            :y2="s.y2"
            :stroke="s.stroke"
            :stroke-width="s.strokeWidth"
            @pointerdown="tool === 'select' && select(s.id)"
          />
          <circle
            v-else-if="s.type === 'circle'"
            data-se-move="shape"
            :data-id="s.id"
            :cx="s.cx"
            :cy="s.cy"
            :r="s.r"
            :fill="s.fill"
            :stroke="s.stroke"
            :stroke-width="s.strokeWidth"
            @pointerdown="tool === 'select' && select(s.id)"
          />
          <polyline
            v-else-if="s.type === 'polyline'"
            data-se-move="shape"
            :data-id="s.id"
            :points="s.points.map((p) => p.join(',')).join(' ')"
            :fill="s.fill"
            :stroke="s.stroke"
            :stroke-width="s.strokeWidth"
            @pointerdown="tool === 'select' && select(s.id)"
          />
        </template>

        <!-- Превью тянущейся фигуры -->
        <rect
          v-if="draftRect"
          :x="draftRect.x"
          :y="draftRect.y"
          :width="draftRect.w"
          :height="draftRect.h"
          fill="none"
          stroke="#06b6d4"
          stroke-width="1"
          stroke-dasharray="3 2"
          vector-effect="non-scaling-stroke"
        />
        <line
          v-if="drawing?.type === 'line'"
          :x1="drawing.sx"
          :y1="drawing.sy"
          :x2="drawing.cx"
          :y2="drawing.cy"
          stroke="#06b6d4"
          stroke-width="1"
          stroke-dasharray="3 2"
          vector-effect="non-scaling-stroke"
        />
        <circle
          v-if="drawing?.type === 'circle' && draftCircleR > 0"
          :cx="drawing.sx"
          :cy="drawing.sy"
          :r="draftCircleR"
          fill="none"
          stroke="#06b6d4"
          stroke-width="1"
          stroke-dasharray="3 2"
          vector-effect="non-scaling-stroke"
        />
        <polyline
          v-if="polyPreview"
          :points="polyPreview"
          fill="none"
          stroke="#06b6d4"
          stroke-width="1"
          stroke-dasharray="3 2"
          vector-effect="non-scaling-stroke"
        />

        <!-- Ручки выделенной фигуры -->
        <circle
          v-for="hnd in handles"
          :key="`${selectedId}-${hnd.h}`"
          data-se-move="handle"
          :data-id="selectedId"
          :data-h="hnd.h"
          :cx="hnd.x"
          :cy="hnd.y"
          :r="hr"
          fill="#fff"
          stroke="#06b6d4"
          stroke-width="1.5"
          vector-effect="non-scaling-stroke"
          class="cursor-pointer"
        />

        <!-- Порты -->
        <circle
          v-for="p in ports"
          :key="p.id"
          data-se-move="port"
          :data-id="p.id"
          :cx="p.x"
          :cy="p.y"
          :r="hr * 1.2"
          fill="#f59e0b"
          stroke="#78350f"
          stroke-width="1"
          vector-effect="non-scaling-stroke"
          :class="tool === 'port' ? 'cursor-pointer' : 'cursor-move'"
          @pointerdown="onPortDown($event, p.id)"
        />
      </svg>
    </div>
  </div>
</template>
