// Где символы расставлены: правило общее для удаления одного символа и целого набора,
// поэтому считается в одном месте.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const mockCanvas = vi.hoisted(() => ({ graphRef: { value: null } }))
vi.mock('./useCanvas', () => ({ useCanvas: () => mockCanvas }))

import { useStencilUsage } from './useStencilUsage'
import { useWorkspaceStore } from '../stores/useWorkspaceStore'

const cells = (...ids) => ({ cells: ids.map((id, i) => ({ id: `c${i}`, tms: { stencilId: id } })) })

beforeEach(() => {
  setActivePinia(createPinia())
  mockCanvas.graphRef.value = null
  useWorkspaceStore().loadForms(
    [
      { id: 'main', graphJson: cells('cell_qw', 'demo_qf') },
      { id: 'sub', graphJson: cells('demo_qf', 'demo_qf') },
      { id: 'empty', graphJson: { cells: [] } },
    ],
    'main'
  )
})

describe('stencilUsage', () => {
  it('считает по всем формам и возвращает, в каких именно', () => {
    const { stencilUsage } = useStencilUsage()
    expect(stencilUsage('demo_qf')).toEqual({ count: 3, formIds: ['main', 'sub'] })
    expect(stencilUsage('cell_qw')).toEqual({ count: 1, formIds: ['main'] })
  })

  it('набор id считается разом — удаление набора спрашивает про все его символы', () => {
    const { stencilUsage } = useStencilUsage()
    expect(stencilUsage(['demo_qf', 'cell_qw'])).toEqual({ count: 4, formIds: ['main', 'sub'] })
    expect(stencilUsage(new Set(['demo_qf']))).toEqual({ count: 3, formIds: ['main', 'sub'] })
  })

  it('незнакомый символ нигде не стоит', () => {
    const { stencilUsage } = useStencilUsage()
    expect(stencilUsage('demo_nope')).toEqual({ count: 0, formIds: [] })
  })

  // У активной формы правки могли не уехать в стор, поэтому она читается с холста.
  it('активная форма берётся из живого графа, а не из стора', () => {
    mockCanvas.graphRef.value = { toJSON: () => cells('demo_qf', 'demo_qf', 'demo_qf') }
    const { stencilUsage } = useStencilUsage()
    expect(stencilUsage('demo_qf')).toEqual({ count: 5, formIds: ['main', 'sub'] })
  })
})
