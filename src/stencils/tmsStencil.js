import { dia, shapes } from '@joint/core'

/**
 * JointJS shape: контейнер-группа `body`, в которую инжектится shape.svg
 * символа (см. svgInjector.injectStencilSvg). Один shape-класс на все
 * символы реестра — разница между cell_bus / cell_qw / cell_alr / ... живёт
 * в `tms.stencilId` и SVG, не в JointJS-define'ах.
 *
 * Селектор 'root' зарезервирован JointJS, поэтому используем 'body'.
 */
export const TMSStencil = dia.Element.define(
  'tms.Stencil',
  {
    size: { width: 120, height: 220 },
    ports: {
      groups: {
        port: {
          position: { name: 'absolute' },
          markup: [{ tagName: 'circle', selector: 'portBody' }],
          attrs: {
            portBody: {
              r: 3,
              fill: '#ffffff',
              // Обводка ЧЁРНАЯ, а не primary: cyan занят ручками ресайза, и порт в
              // тех же цветах читался бы как их продолжение.
              stroke: '#000000',
              strokeWidth: 1,
              magnet: 'active',
              cursor: 'crosshair',
            },
          },
        },
      },
    },
  },
  {
    markup: [{ tagName: 'g', selector: 'body' }],
  }
)

/**
 * Фигура-разметка холста: ни символа, ни портов, ни анимаций — только геометрия в
 * `tms.shape` (редакторский формат) и её отрисовка в ту же body-группу. Рендер и
 * операции — в [shapeElement.js](shapeElement.js), тип объявлен здесь рядом с
 * namespace: без него `fromJSON` не соберёт фигуры при загрузке формы.
 */
export const TMSShape = dia.Element.define(
  'tms.Shape',
  { size: { width: 40, height: 40 } },
  { markup: [{ tagName: 'g', selector: 'body' }] }
)

/** Расширенный shapes-namespace с нашими типами — нужен dia.Graph/Paper. */
export const tmsNamespace = { ...shapes, tms: { Stencil: TMSStencil, Shape: TMSShape } }
