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
          tag: '{prefix}.ONOFF',
          when: {
            type: 'map',
            cases: { false: { apply: { addClass: 'animation-off' } } },
          },
        },
      ],
      detailTags: [{ tag: '{prefix}.ONOFF' }],
    },
  ],
}

describe('parser.instantiate', () => {
  it('подставляет prefix в bindings', () => {
    const { animations } = instantiate(stencil, 'PS031VK001')
    const card = animations['animation-PS031VK001.RZ']
    expect(card).toBeDefined()
    expect(card.bindings[0].tag).toBe('PS031VK001.ONOFF')
  })

  it('подставляет prefix в detailTags', () => {
    const { animations } = instantiate(stencil, 'PS031VK001')
    expect(animations['animation-PS031VK001.RZ'].detailTags).toEqual([
      { tag: 'PS031VK001.ONOFF' },
    ])
  })

  it('собирает финальный id="animation-{prefix}{suffix}" в SVG', () => {
    const { svg } = instantiate(stencil, 'PS031VK001')
    expect(svg).toContain('id="animation-PS031VK001.RZ"')
    expect(svg).toContain('id="animation-PS031VK001.RZ-closed"')
  })

  it('удаляет data-anim-suffix из выходного SVG', () => {
    const { svg } = instantiate(stencil, 'PS031VK001')
    expect(svg).not.toContain('data-anim-suffix')
  })

  it('возвращает пустые animations если animationTemplate отсутствует', () => {
    const bare = { ...stencil, animationTemplate: undefined }
    const { animations } = instantiate(bare, 'X')
    expect(animations).toEqual({})
  })

  it('возвращает svg=null если svgText отсутствует', () => {
    const bare = { ...stencil, svgText: '' }
    const { svg } = instantiate(bare, 'X')
    expect(svg).toBeNull()
  })

  it('не путает prefix-подстановку — несколько вхождений {prefix}', () => {
    const multi = {
      ...stencil,
      animationTemplate: [
        {
          idSuffix: '.A',
          type: 'text',
          bindings: [
            {
              tag: '{prefix}.LEFT',
              output: { text: { from: '{prefix}.RIGHT' } },
            },
          ],
        },
      ],
    }
    const { animations } = instantiate(multi, 'OBJ')
    const card = animations['animation-OBJ.A']
    expect(card.bindings[0].tag).toBe('OBJ.LEFT')
    expect(card.bindings[0].output.text.from).toBe('OBJ.RIGHT')
  })
})
