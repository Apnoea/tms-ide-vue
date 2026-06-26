import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * Проектный слой: формы (схемы) и активная форма. Хранит только ДАННЫЕ —
 * JointJS-граф не трогает (им владеет useCanvas); сериализацию графа ↔ форма
 * делает персист-композабл (useAutosave).
 *
 * graphJson каждой формы — большой блоб (graph.toJSON()), реактивность ему не
 * нужна: держим в обычной (нереактивной) Map. Реактивны только `formIds` (для
 * панели форм) и `activeFormId` — по аналогии с graphVersion в useCanvas.
 *
 * `id` формы = имя её папки (оно же цель навигации и подпись в панели).
 */
export const useWorkspaceStore = defineStore('workspace', () => {
  // id → graphJson. Приватная, не возвращаем наружу — не state Pinia.
  const forms = new Map()
  const formIds = ref([]) // порядок форм для вкладок (FormTabs)
  const activeFormId = ref(null)

  function syncList() {
    formIds.value = Array.from(forms.keys())
  }

  /** Массовое заполнение (restore из IndexedDB / импорт проекта). */
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

  /** Создать пустую форму. false — id уже занят. Активную не меняет. */
  function addForm(id, graphJson = { cells: [] }) {
    if (forms.has(id)) return false
    forms.set(id, graphJson)
    syncList()
    return true
  }

  /** Удалить форму. Если удалили активную — активной станет первая оставшаяся.
   *  Возвращает новый activeFormId (вызывающий грузит его граф в холст). */
  function removeForm(id) {
    if (!forms.has(id)) return activeFormId.value
    forms.delete(id)
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
    if (activeFormId.value === oldId) activeFormId.value = newId
    syncList()
    return true
  }

  return {
    formIds,
    activeFormId,
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
