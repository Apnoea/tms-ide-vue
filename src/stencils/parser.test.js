import { describe, it, expect } from 'vitest'
import { instantiate } from './parser'

// parser.js экспортит только instantiate() — она внутри использует
// interpolate / interpolateDeep / generateAnimations / injectIds, так что
// тесты на instantiate покрывают всю цепочку.

const stencil = {
  id: 'cell_test',
  svgText: `<svg xmlns="http://www.w3.org/2000/svg">
    <g data-anim-suffix=".RZ">
      <line data-anim-suffix=".RZ-closed" x1="0" y1="0" x2="10" y2="10"/>
    </g>
  </svg>`,
  animationTemplate: [
    {
      idSuffix: '.RZ',
      type: 'shape',
      bindings: [
        {
          tag: '{slot.onoff}',
          when: {
            type: 'map',
            cases: { false: { apply: { addClass: 'animation-off' } } },
          },
        },
      ],
      detailTags: [{ tag: '{slot.onoff}' }],
    },
  ],
}

describe('parser.instantiate', () => {
  it('подставляет {slot.X} из slots в bindings', () => {
    const { animations } = instantiate(stencil, 'c1', { onoff: 'PS031VK001.ONOFF' })
    const card = animations['animation-cell_test-c1.RZ']
    expect(card).toBeDefined()
    expect(card.bindings[0].tag).toBe('PS031VK001.ONOFF')
  })

  it('подставляет {slot.X} в detailTags', () => {
    const { animations } = instantiate(stencil, 'c1', { onoff: 'PS031VK001.ONOFF' })
    expect(animations['animation-cell_test-c1.RZ'].detailTags).toEqual([
      { tag: 'PS031VK001.ONOFF' },
    ])
  })

  it('собирает финальный id="animation-{stencilId}-{cellId}{suffix}" в разметке', () => {
    // instantiate отдаёт DOM-клон шаблона (шаблон парсится один раз на определение),
    // поэтому id проверяем по узлам, а не по строке.
    const { root } = instantiate(stencil, 'c1', { onoff: 'X.Y' })
    const ids = [...root.querySelectorAll('[id]')].map((el) => el.getAttribute('id'))
    expect(ids).toContain('animation-cell_test-c1.RZ')
    expect(ids).toContain('animation-cell_test-c1.RZ-closed')
  })

  it('удаляет data-anim-suffix из разметки экземпляра', () => {
    const { root } = instantiate(stencil, 'c1', { onoff: 'X.Y' })
    expect(root.querySelectorAll('[data-anim-suffix]')).toHaveLength(0)
  })

  it('шаблон в кэше не мутируется: второй экземпляр получает свои id', () => {
    // Клонируем шаблон, а не правим его: иначе у второй ячейки суффиксы уже сняты,
    // и её элементы остались бы с id первой.
    instantiate(stencil, 'c1', { onoff: 'X.Y' })
    const { root } = instantiate(stencil, 'c2', { onoff: 'X.Y' })
    const ids = [...root.querySelectorAll('[id]')].map((el) => el.getAttribute('id'))
    expect(ids).toContain('animation-cell_test-c2.RZ')
    expect(ids.some((id) => id.includes('-c1.'))).toBe(false)
  })

  it('пропускает binding если slot не выбран (resolved=null) → карточка без bindings отбрасывается', () => {
    // onoff пустой — единственный binding отвалится, карточка не должна попасть
    // в animations (пустой bindings[] в рантайме бессмыслен).
    const { animations } = instantiate(stencil, 'c1', {})
    expect(animations['animation-cell_test-c1.RZ']).toBeUndefined()
  })

  it('возвращает пустые animations если animationTemplate отсутствует', () => {
    const bare = { ...stencil, animationTemplate: undefined }
    const { animations } = instantiate(bare, 'c1', { onoff: 'X' })
    expect(animations).toEqual({})
  })

  it('возвращает root=null если svgText отсутствует (программный символ)', () => {
    const bare = { ...stencil, svgText: '' }
    const { root } = instantiate(bare, 'c1', { onoff: 'X' })
    expect(root).toBeNull()
  })

  it('подстановка нескольких разных слотов в одной карточке', () => {
    const multi = {
      ...stencil,
      animationTemplate: [
        {
          idSuffix: '.A',
          type: 'text',
          bindings: [
            {
              tag: '{slot.left}',
              output: { text: { from: '{slot.right}' } },
            },
          ],
        },
      ],
    }
    const { animations } = instantiate(multi, 'c1', {
      left: 'OBJ.LEFT',
      right: 'OBJ.RIGHT',
    })
    const card = animations['animation-cell_test-c1.A']
    expect(card.bindings[0].tag).toBe('OBJ.LEFT')
    expect(card.bindings[0].output.text.from).toBe('OBJ.RIGHT')
  })
})

describe('параметры экземпляра', () => {
  const paramStencil = {
    id: 'cell_param',
    svgText: `<svg xmlns="http://www.w3.org/2000/svg">
      <text data-tms-param="p1" x="10" y="15">Ua</text>
      <text data-tms-param="p2" x="90" y="15"><tspan x="90">В</tspan></text>
    </svg>`,
  }

  it('значение подписи подставляется в рисунок, незаданное оставляет образец', () => {
    const { root } = instantiate(paramStencil, 'c1', {}, { p1: 'Ia' })
    const texts = root.querySelectorAll('text')
    expect(texts[0].textContent).toBe('Ia')
    // Пустой параметр = текст из определения: он и есть значение по умолчанию.
    expect(texts[1].textContent).toBe('В')
  })

  it('подстановка идёт по клону — шаблон в кэше остаётся с образцом', () => {
    instantiate(paramStencil, 'c1', {}, { p1: 'Ia' })
    const { root } = instantiate(paramStencil, 'c2', {}, {})
    expect(root.querySelector('text').textContent).toBe('Ua')
  })

  it('многострочный образец заменяется целиком (у параметра одна строка)', () => {
    const { root } = instantiate(paramStencil, 'c1', {}, { p2: 'кА' })
    const second = root.querySelectorAll('text')[1]
    expect(second.textContent).toBe('кА')
    expect(second.querySelector('tspan')).toBeNull()
  })
})
