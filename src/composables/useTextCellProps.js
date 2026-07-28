import { TEXT_FONT_SIZE, textCellHeight, textCellWidth, resizeTextCell } from '../stencils/textCell'

// Выравнивание = якорь блока при росте (см. resizeTextCell), не раскладка строки.
export const ALIGN_OPTIONS = [
  { value: 'left', icon: 'pi pi-align-left', tip: 'Растёт вправо (левый край на месте)' },
  { value: 'center', icon: 'pi pi-align-center', tip: 'Растёт симметрично (центр на месте)' },
  { value: 'right', icon: 'pi pi-align-right', tip: 'Растёт влево (правый край на месте)' },
]

// Жирность — одиночный toggle-сегмент SelectButton (повторный клик снимает).
export const BOLD_OPTIONS = [{ value: 'bold' }]

/**
 * Свойства текстового символа в инспекторе. Каждая правка пересчитывает размер
 * ячейки под фактический текст — иначе hit-area и inline-× разъезжаются с рисунком.
 *
 * @param {object} deps
 * @param {(fn: Function, opts?: object) => void} deps.withSelectedCell — каркас
 *        правки выделенной ячейки (резолв cell/stencil + reinject + snapshot)
 */
export function useTextCellProps({ withSelectedCell }) {
  /** Правка tms + ресайз ячейки под текст/шрифт/жирность. */
  function patchTextCell(patch) {
    withSelectedCell(
      ({ cell, tms, d }) => {
        if (!d.isText) return false
        // Если ничего реально не меняется — выходим, чтобы не плодить snapshot'ы.
        const next = { ...tms, ...patch }
        const same =
          next.text === tms.text &&
          next.fontSize === tms.fontSize &&
          next.bold === tms.bold &&
          next.color === tms.color &&
          (next.align || 'left') === (tms.align || 'left')
        if (same) return false
        cell.set('tms', next)
        // Подгоняем и ширину, и высоту: hit-area совпадает с отображаемым текстом,
        // inline-× прижимается к нему. Якорь держит resizeTextCell; смена одного align
        // ширину не меняет — он сработает при следующем росте текста.
        const fontSize = next.fontSize ?? TEXT_FONT_SIZE
        const bold = !!next.bold
        resizeTextCell(
          cell,
          textCellWidth(next.text ?? '', fontSize, bold),
          textCellHeight(fontSize),
          next.align || 'left'
        )
      },
      { reinject: true }
    )
  }

  return {
    applyText: (text) => patchTextCell({ text }),
    applyFontSize: (fontSize) => patchTextCell({ fontSize }),
    applyBold: (bold) => patchTextCell({ bold }),
    applyColor: (color) => patchTextCell({ color }),
    applyAlign: (align) => patchTextCell({ align }),
  }
}
