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
  const formIds = ref([]) // порядок форм для панели (FormsPanel)
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

  /** Сделать форму активной (переключение). Несуществующий id игнорируем. */
  function setActiveFormId(id) {
    if (forms.has(id)) activeFormId.value = id
  }

  /** Обнулить граф активной формы (для «очистить холст» — только активную). */
  function clearActiveForm() {
    if (forms.has(activeFormId.value)) forms.set(activeFormId.value, { cells: [] })
  }

  return {
    formIds,
    activeFormId,
    loadForms,
    updateActiveGraph,
    getFormGraph,
    setActiveFormId,
    clearActiveForm,
  }
})
