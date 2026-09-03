import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { subtreeIds } from '../utils/formTreeDnd'
import { cssColor } from '../constants/animation'
import { CANVAS_BG_DEFAULT } from '../stencils/canvasPaper'
import { normalizeWireStyle } from '../stencils/linkDefaults'

/**
 * Проектный слой: формы (схемы) и активная форма. Хранит только ДАННЫЕ —
 * JointJS-граф не трогает (им владеет useCanvas); сериализацию графа ↔ форма
 * делает персист-композабл (useAutosave).
 *
 * graphJson каждой формы — большой блоб (graph.toJSON()), реактивность ему не
 * нужна: держим в обычной (нереактивной) Map. Реактивны `formIds` (плоский
 * источник существования/порядка), `activeFormId` и `formTree` (иерархия для
 * дерева форм слева — приходит из hierarchy.json проекта, синкается на CRUD).
 *
 * `id` формы = имя её папки (оно же цель навигации и подпись в дереве).
 */

// ─── Чистые операции над деревом иерархии (узел = { id, children: [] }) ───

/**
 * Предел вложенности. Всё глубже отбрасывается: форма из отброшенного поддерева не
 * исчезает — FormTree покажет её в «Без иерархии», а рекурсия не уйдёт в стек.
 */
const TREE_DEPTH_MAX = 32

/**
 * Иерархия приходит из `hierarchy.json` чужого архива, то есть это НЕПРОВЕРЕННЫЕ
 * данные: узел может оказаться `null`, `children` — строкой, `id` — числом или
 * пустым. Нормализация тотальна (не бросает): иерархия необязательна, и битый файл не
 * должен мешать импорту — проект откроется плоским списком.
 *
 * Мусорный узел отбрасываем, а его детей ПОДНИМАЕМ на его место: под битым родителем
 * могут лежать настоящие формы. Узлы на НЕСУЩЕСТВУЮЩИЕ формы, наоборот, оставляем —
 * FormTree рисует их битыми, и это полезный сигнал «в иерархии форма есть, а в
 * проекте нет». Дубли режем: одна форма в двух ветках путает и рендер, и drag-n-drop
 * (extractNode берёт первое вхождение).
 */
function normalizeTree(nodes, seen = new Set(), depth = 0) {
  if (!Array.isArray(nodes) || depth > TREE_DEPTH_MAX) return []
  const out = []
  for (const n of nodes) {
    const node = n && typeof n === 'object' ? n : null
    const children = normalizeTree(node?.children, seen, depth + 1)
    const raw = typeof node?.id === 'string' || typeof node?.id === 'number' ? String(node.id) : ''
    const id = raw.trim()
    if (!id || seen.has(id)) {
      out.push(...children)
      continue
    }
    seen.add(id)
    out.push({ id, children })
  }
  return out
}
// Удаляем узел, поднимая его детей на место узла (форма-родитель удалена, но
// дочерние формы существуют — не теряем их из дерева).
function pruneTree(nodes, id) {
  const out = []
  for (const n of nodes) {
    if (n.id === id) out.push(...pruneTree(n.children, id))
    else out.push({ id: n.id, children: pruneTree(n.children, id) })
  }
  return out
}
function renameInTree(nodes, oldId, newId) {
  return nodes.map((n) => ({
    id: n.id === oldId ? newId : n.id,
    children: renameInTree(n.children, oldId, newId),
  }))
}
// Вынимает узел (с поддеревом) из дерева. → [дерево без узла, вынутый узел | null].
function extractNode(nodes, id) {
  let extracted = null
  const walk = (list) => {
    const out = []
    for (const n of list) {
      if (n.id === id) {
        extracted = n
        continue
      }
      out.push({ id: n.id, children: walk(n.children) })
    }
    return out
  }
  return [walk(nodes), extracted]
}
// Вставляет node относительно targetId (zone: before/after/inside). targetId=null →
// в конец корня. Возвращает новое дерево либо null, если target не найден.
function insertNode(nodes, targetId, zone, node) {
  if (targetId == null) return [...nodes, node]
  let done = false
  const out = []
  for (const n of nodes) {
    if (n.id === targetId) {
      done = true
      if (zone === 'inside') out.push({ id: n.id, children: [...n.children, node] })
      else if (zone === 'before') out.push(node, n)
      else out.push(n, node)
    } else {
      const sub = insertNode(n.children, targetId, zone, node)
      if (sub) {
        out.push({ id: n.id, children: sub })
        done = true
      } else out.push(n)
    }
  }
  return done ? out : null
}

/**
 * Место узла в дереве: родитель и предыдущий сосед. Нужно, чтобы возвращённая из
 * корзины форма встала туда, где была, а не в конец корня.
 */
function findAnchor(nodes, id, parentId = null) {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].id === id) return { parentId, prevId: i > 0 ? nodes[i - 1].id : null }
    const deeper = findAnchor(nodes[i].children, id, nodes[i].id)
    if (deeper) return deeper
  }
  return null
}

export const useWorkspaceStore = defineStore('workspace', () => {
  // id → graphJson. Приватная, не возвращаем наружу — не state Pinia.
  const forms = new Map()
  const formIds = ref([]) // плоский порядок/существование форм
  const activeFormId = ref(null)
  const formTree = ref([]) // иерархия форм (дерево слева)
  // Имя проекта (= имя импортированного .zip без расширения; имя файла экспорта).
  // null — проект без имени (свежий bootstrap), UI покажет заглушку.
  const projectName = ref(null)
  // Фон холста ПО ФОРМАМ: { formId: '#rrggbb' }. Свойство формы, а не окружения —
  // уезжает в мету проекта и в архив, поэтому у коллеги схема откроется в тех же
  // цветах. Дефолтный фон не храним: отсутствие ключа и есть он.
  const formBg = ref({})

  const activeFormBg = computed(() => formBg.value[activeFormId.value] ?? null)

  /**
   * Вид НОВОГО провода — «липкие» настройки инструмента: нарисовал один цветным и
   * толстым, следующие такие же. Иначе серию однотипных проводов приходится править
   * по одному после каждого рисования.
   *
   * Живёт в мете проекта (переживает reload), но НЕ уезжает в архив: это настройка
   * рисования, а не свойство схемы — в `view.svg` стиль каждого провода записан у
   * него самого. Пустой объект = дефолты `LINK_DEFAULTS` (чёрный, 2px, без стрелок).
   */
  const wireStyle = ref({})

  /**
   * Патч настроек нового провода; `null`-значение убирает поле (вернуть дефолт).
   * Значения проходят ту же нормализацию, что и чтение меты — иначе в мету попадёт
   * что угодно.
   */
  function setWireStyle(patch) {
    const next = { ...wireStyle.value }
    const clean = normalizeWireStyle(patch)
    for (const key of Object.keys(patch || {})) {
      if (clean[key] === undefined) delete next[key]
      else next[key] = clean[key]
    }
    if (JSON.stringify(next) === JSON.stringify(wireStyle.value)) return false
    wireStyle.value = next
    return true
  }

  /** Загрузка из меты: чужие ключи и значения вне допусков отбрасываем. */
  function loadWireStyle(raw) {
    wireStyle.value = normalizeWireStyle(raw)
  }

  /** Фон формы. `null`/дефолт — снять запись (не копим значения, равные дефолту). */
  function setFormBg(id, color) {
    if (!forms.has(id)) return false
    const next = { ...formBg.value }
    const clean = color ? cssColor(color) : null
    if (clean && clean !== CANVAS_BG_DEFAULT) next[id] = clean
    else delete next[id]
    if (JSON.stringify(next) === JSON.stringify(formBg.value)) return false
    formBg.value = next
    return true
  }

  /** Массовая загрузка (restore из IDB / импорт архива): чужие ключи отбрасываем. */
  function loadFormBg(map) {
    const next = {}
    for (const [id, color] of Object.entries(map || {})) {
      const clean = cssColor(color)
      if (forms.has(id) && clean && clean !== CANVAS_BG_DEFAULT) next[id] = clean
    }
    formBg.value = next
  }

  function setProjectName(name) {
    projectName.value = name && String(name).trim() ? String(name).trim() : null
  }

  function syncList() {
    formIds.value = Array.from(forms.keys())
  }

  /**
   * Иерархия форм. null/пусто → плоский список из formIds (проект без файла
   * иерархии показывает все формы корневым списком). Ссылки на несуществующие
   * формы остаются в дереве (компонент рисует их битыми); формы вне дерева
   * компонент собирает в группу «Без иерархии».
   */
  function setFormTree(tree) {
    // Пусто ПОСЛЕ нормализации (файла нет, либо в нём одни мусорные узлы) → плоский
    // список: проект обязан открыться, иерархия — необязательная надстройка.
    const normalized = normalizeTree(tree)
    formTree.value = normalized.length
      ? normalized
      : formIds.value.map((id) => ({ id, children: [] }))
  }

  /** Массовое заполнение (restore из IndexedDB / импорт проекта). formTree —
   *  отдельным вызовом setFormTree (у caller'а есть hierarchy.json). */
  function loadForms(list, activeId) {
    forms.clear()
    for (const f of list) forms.set(f.id, f.graphJson)
    // activeId должен существовать среди форм (мета могла протухнуть) — иначе первая.
    activeFormId.value = (activeId && forms.has(activeId) ? activeId : list[0]?.id) ?? null
    syncList()
  }

  /** Записать текущий граф в активную форму (перед переключением / на autosave). */
  function updateActiveGraph(graphJson) {
    if (forms.has(activeFormId.value)) forms.set(activeFormId.value, graphJson)
  }

  function getFormGraph(id) {
    return forms.get(id) ?? null
  }

  /** Записать graphJson произвольной формы (для авто-фикса nav-ссылок при rename). */
  function setFormGraph(id, graphJson) {
    if (forms.has(id)) forms.set(id, graphJson)
  }

  /** Сделать форму активной (переключение). Несуществующий id игнорируем. */
  function setActiveFormId(id) {
    if (forms.has(id)) activeFormId.value = id
  }

  /** Обнулить граф активной формы (для «очистить холст» — только активную). */
  function clearActiveForm() {
    if (forms.has(activeFormId.value)) forms.set(activeFormId.value, { cells: [] })
  }

  function hasForm(id) {
    return forms.has(id)
  }

  /** Создать пустую форму. false — id уже занят. Активную не меняет. Новая форма
   *  добавляется последним узлом в корень дерева. */
  function addForm(id, graphJson = { cells: [] }) {
    if (forms.has(id)) return false
    forms.set(id, graphJson)
    formTree.value = [...formTree.value, { id, children: [] }]
    syncList()
    return true
  }

  /** Удалить форму. Если удалили активную — активной станет первая оставшаяся.
   *  Возвращает новый activeFormId (вызывающий грузит его граф в холст). */
  function removeForm(id) {
    if (!forms.has(id)) return activeFormId.value
    forms.delete(id)
    if (formBg.value[id]) {
      const rest = { ...formBg.value }
      delete rest[id]
      formBg.value = rest
    }
    formTree.value = pruneTree(formTree.value, id)
    if (activeFormId.value === id) activeFormId.value = forms.keys().next().value ?? null
    syncList()
    return activeFormId.value
  }

  /** Переименовать форму (id = имя везде). Порядок форм сохраняем. false —
   *  oldId нет / newId занят / совпадают. Граф формы не трогаем — только ключ. */
  function renameForm(oldId, newId) {
    if (!forms.has(oldId) || forms.has(newId) || oldId === newId) return false
    // Пересобираем Map с переименованным ключом, сохраняя исходный порядок.
    const entries = Array.from(forms.entries(), ([k, v]) => [k === oldId ? newId : k, v])
    forms.clear()
    for (const [k, v] of entries) forms.set(k, v)
    formTree.value = renameInTree(formTree.value, oldId, newId)
    // Фон привязан к id формы — переносим вместе с ней, иначе схема «побелеет».
    if (formBg.value[oldId]) {
      const next = { ...formBg.value }
      next[newId] = next[oldId]
      delete next[oldId]
      formBg.value = next
    }
    if (activeFormId.value === oldId) activeFormId.value = newId
    syncList()
    return true
  }

  /** Якорь узла (родитель + предыдущий сосед) — для возврата формы из корзины. */
  function nodeAnchor(id) {
    return findAnchor(formTree.value, id)
  }

  /**
   * Перенос узла дерева (DnD): `dragId` встаёт относительно `targetId` по зоне
   * `before`/`after`/`inside` (targetId=null → в корень). Узел едет вместе с
   * поддеревом. false — no-op: drop на себя, в собственное поддерево (цикл) или
   * target не найден. Орфан (формы нет в дереве) при drop'е добавляется узлом.
   * Только структура дерева — графы форм не трогает.
   */
  function moveNode(dragId, targetId, zone) {
    if (dragId === targetId) return false
    if (targetId != null && subtreeIds(formTree.value, dragId).has(targetId)) return false
    const [without, node] = extractNode(formTree.value, dragId)
    const next = insertNode(without, targetId, zone, node || { id: dragId, children: [] })
    if (!next) return false
    formTree.value = next
    return true
  }

  return {
    formIds,
    activeFormId,
    formTree,
    projectName,
    formBg,
    activeFormBg,
    setFormBg,
    loadFormBg,
    wireStyle,
    setWireStyle,
    loadWireStyle,
    setProjectName,
    setFormTree,
    moveNode,
    nodeAnchor,
    loadForms,
    updateActiveGraph,
    getFormGraph,
    setFormGraph,
    setActiveFormId,
    clearActiveForm,
    hasForm,
    addForm,
    removeForm,
    renameForm,
  }
})
