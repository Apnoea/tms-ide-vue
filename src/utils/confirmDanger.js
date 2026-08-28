/**
 * ConfirmPopup с проектным оформлением: warning-иконка, кнопка подтверждения
 * severity=danger (или primary для неразрушающих действий) и текстовая «Отмена» —
 * одна точка на все подтверждения проекта.
 *
 * `confirm` — инстанс из `useConfirm()`: сервис доступен только в setup-скоупе
 * компонента, поэтому приходит аргументом.
 *
 * @param {object} confirm — PrimeVue confirm-сервис
 * @param {object} opts — { target, message, acceptLabel, accept, reject?, onHide?, severity? }
 */
export function confirmDanger(confirm, { severity = 'danger', ...opts }) {
  confirm.require({
    icon: 'pi pi-exclamation-triangle',
    rejectLabel: 'Отмена',
    acceptProps: { severity, size: 'small' },
    rejectProps: { severity: 'secondary', text: true, size: 'small' },
    ...opts,
  })
}
