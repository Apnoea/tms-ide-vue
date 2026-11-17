// Подсказка замены: сама всплывает, только когда находит большую часть недостающих
// привязок; кнопка подставляет любую найденную пару.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('./useCanvas', () => ({ useCanvas: () => ({ graphRef: ref(null) }) }))

import { useTagRebind } from './useTagRebind'
import { useProjectStore } from '../stores/useProjectStore'
import { useUiStore } from '../stores/useUiStore'
import { useWorkspaceStore } from '../stores/useWorkspaceStore'

function seed(boundTags, names) {
  const cells = boundTags.map((tag, i) => ({ id: `c${i}`, tms: { slots: { onoff: tag } } }))
  useWorkspaceStore().loadForms([{ id: 'a', graphJson: { cells } }], 'a')
  useProjectStore().setTags(names.map((name) => ({ name, type: 'Bool' })))
}

const NAMES = ['P.A.V2', 'P.B.V2', 'P.C.X']
const SUFFIX = { find: '.V4', replace: '.V2', suggested: true }

describe('useTagRebind', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('замена находит большую часть недостающих — диалог открывается сам', () => {
    seed(['P.A.V4', 'P.B.V4', 'Q1'], NAMES)
    expect(useTagRebind().offerRebind()).toMatchObject({ matched: 2, missing: 3 })
    expect(useUiStore().tagRebind).toEqual(SUFFIX)
  })

  it('находит меньшинство — сам не всплывает, кнопка подставляет пару', () => {
    seed(['P.A.V4', 'P.B.V4', 'Q1', 'Q2', 'Q3', 'Q4'], NAMES)
    const { offerRebind, openRebind } = useTagRebind()
    expect(offerRebind()).toBeNull()
    expect(useUiStore().tagRebind).toBeNull()
    openRebind()
    expect(useUiStore().tagRebind).toEqual(SUFFIX)
  })

  it('кнопка без подсказки открывает пустые поля', () => {
    seed(['P.C.X'], NAMES)
    useTagRebind().openRebind()
    expect(useUiStore().tagRebind).toEqual({ find: '', replace: '', suggested: false })
  })
})
