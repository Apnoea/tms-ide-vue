import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * Проектный слой: формы (схемы) и активная форма. Хранит только ДАННЫЕ —
 * JointJS-граф не трогает (им владеет useCanvas); сериализацию графа ↔ форма
 * делает персист-композабл (useAutosave).
 *
 * graphJson каждой формы — большой блоб (graph.toJSON()), реактивность ему не
 * нужна: держим в обычной (нереактивной) Map. Реактивны только `formList` (для
 * панели форм) и `activeFormId` — по аналогии с graphVersion в useCanvas.
 *
 * `id` формы = имя её папки (оно же цель навигации); `name` пока совпадает с id.
 */
export const useWorkspaceStore = defineStore('workspace', () => {
  // id → { name, graphJson }. Приватная, не возвращаем наружу — не state Pinia.
  const forms = new Map()
  const formList = ref([]) // [{ id, name }] для UI (панель форм — Фаза 2)
  const activeFormId = ref(null)

  function syncList() {
    formList.value = Array.from(forms.entries()).map(([id, f]) => ({ id, name: f.name }))
  }

  /** Массовое заполнение (restore из IndexedDB / импорт проекта). */
  function loadForms(list, activeId) {
    forms.clear()
    for (const f of list) forms.set(f.id, { name: f.name, graphJson: f.graphJson })
    activeFormId.value = activeId ?? list[0]?.id ?? null
    syncList()
  }

  /** Записать текущий граф в активную форму (перед переключением / на autosave). */
  function updateActiveGraph(graphJson) {
    const f = forms.get(activeFormId.value)
    if (f) f.graphJson = graphJson
  }

  function getFormGraph(id) {
    return forms.get(id)?.graphJson ?? null
  }

  /** Сделать форму активной (переключение). Несуществующий id игнорируем. */
  function setActiveFormId(id) {
    if (forms.has(id)) activeFormId.value = id
  }

  /** Обнулить граф активной формы (для «очистить холст» — только активную). */
  function clearActiveForm() {
    const f = forms.get(activeFormId.value)
    if (f) f.graphJson = { cells: [] }
  }

  return {
    formList,
    activeFormId,
    loadForms,
    updateActiveGraph,
    getFormGraph,
    setActiveFormId,
    clearActiveForm,
  }
})
