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
    const card = animations['animation-c1.RZ']
    expect(card).toBeDefined()
    expect(card.bindings[0].tag).toBe('PS031VK001.ONOFF')
  })

  it('подставляет {slot.X} в detailTags', () => {
    const { animations } = instantiate(stencil, 'c1', { onoff: 'PS031VK001.ONOFF' })
    expect(animations['animation-c1.RZ'].detailTags).toEqual([
      { tag: 'PS031VK001.ONOFF' },
    ])
  })

  it('собирает финальный id="animation-{cellId}{suffix}" в SVG', () => {
    const { svg } = instantiate(stencil, 'c1', { onoff: 'X.Y' })
    expect(svg).toContain('id="animation-c1.RZ"')
    expect(svg).toContain('id="animation-c1.RZ-closed"')
  })

  it('удаляет data-anim-suffix из выходного SVG', () => {
    const { svg } = instantiate(stencil, 'c1', { onoff: 'X.Y' })
    expect(svg).not.toContain('data-anim-suffix')
  })

  it('пропускает binding если slot не выбран (resolved=null) → карточка без bindings отбрасывается', () => {
    // onoff пустой — единственный binding отвалится, карточка не должна попасть
    // в animations (пустой bindings[] в рантайме бессмыслен).
    const { animations } = instantiate(stencil, 'c1', {})
    expect(animations['animation-c1.RZ']).toBeUndefined()
  })

  it('возвращает пустые animations если animationTemplate отсутствует', () => {
    const bare = { ...stencil, animationTemplate: undefined }
    const { animations } = instantiate(bare, 'c1', { onoff: 'X' })
    expect(animations).toEqual({})
  })

  it('возвращает svg=null если svgText отсутствует', () => {
    const bare = { ...stencil, svgText: '' }
    const { svg } = instantiate(bare, 'c1', { onoff: 'X' })
    expect(svg).toBeNull()
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
    const card = animations['animation-c1.A']
    expect(card.bindings[0].tag).toBe('OBJ.LEFT')
    expect(card.bindings[0].output.text.from).toBe('OBJ.RIGHT')
  })
})
