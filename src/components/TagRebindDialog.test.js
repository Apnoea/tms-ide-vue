// @vitest-environment jsdom
// Стык диалога со сторами: превью читает tag-list (`tagNames` — Pinia-getter) и формы,
// применение уходит проектной операцией холста.
import { describe, it, expect, vi } from 'vitest'
import { ref, nextTick } from 'vue'
import { mountWithApp } from '../composables/test-utils'

const mockCanvas = { graphRef: ref(null), rebindTags: vi.fn(async () => ({})) }
vi.mock('../composables/useCanvas', () => ({ useCanvas: () => mockCanvas }))

import TagRebindDialog from './TagRebindDialog.vue'
import { useUiStore } from '../stores/useUiStore'
import { useProjectStore } from '../stores/useProjectStore'
import { useWorkspaceStore } from '../stores/useWorkspaceStore'

const bound = (...tags) => ({
  cells: tags.map((tag, i) => ({ id: `c${i}`, tms: { slots: { onoff: tag } } })),
})

describe('TagRebindDialog', () => {
  it('превью замены и применение через проектную операцию', async () => {
    const wrapper = mountWithApp(TagRebindDialog, { attachTo: document.body })
    useWorkspaceStore().loadForms([{ id: 'a', graphJson: bound('OLD.X', 'OLD.Y') }], 'a')
    useProjectStore().setTags([{ name: 'NEW.X', type: 'Bool' }])
    useUiStore().openTagRebind({ find: 'OLD.', replace: 'NEW.', suggested: true })
    await nextTick()

    const text = document.body.textContent
    expect(text).toContain('Изменится: 2 привязки (2 тега) · форм: 1')
    expect(text).toContain('сейчас 2 → после замены 1')
    expect(text).toContain('NEW.Y')

    const apply = [...document.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Заменить'
    )
    apply.click()
    await nextTick()
    expect(mockCanvas.rebindTags).toHaveBeenCalledWith('OLD.', 'NEW.')
    expect(useUiStore().tagRebind).toBeNull()
    wrapper.unmount()
  })
})
