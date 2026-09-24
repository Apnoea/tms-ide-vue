// Срок жизни тостов по severity: ошибка не скрывается сама (висит до крестика), даже
// если вызов передал свой срок, — остальные уходят по таймеру.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const add = vi.fn()
vi.mock('primevue/usetoast', () => ({ useToast: () => ({ add }) }))

import { useNotify, TOAST_LIFE } from './useNotify'

describe('useNotify', () => {
  beforeEach(() => add.mockClear())

  it('ошибка без срока — PrimeVue не закроет её сам, даже с переданным life', () => {
    const notify = useNotify()
    notify.error('Импорт', 'сломалось')
    notify.error('Импорт', 'сломалось', TOAST_LIFE.SHORT)
    expect(add.mock.calls.map(([m]) => m.life)).toEqual([undefined, undefined])
  })

  it('остальные — по дефолту severity или по переданному сроку', () => {
    const notify = useNotify()
    notify.success('Готово')
    notify.warn('Внимание')
    notify.info('Инфо', '', TOAST_LIFE.LONG)
    expect(add.mock.calls.map(([m]) => m.life)).toEqual([
      TOAST_LIFE.SHORT,
      TOAST_LIFE.NORMAL,
      TOAST_LIFE.LONG,
    ])
  })
})
