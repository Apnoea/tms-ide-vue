import { useConfirm } from 'primevue/useconfirm'

/**
 * ConfirmPopup с проектным оформлением: warning-иконка, кнопка подтверждения
 * severity=danger (или primary для неразрушающих действий) и текстовая «Отмена» —
 * одна точка на все подтверждения проекта. Зовётся в setup: confirm-сервис PrimeVue
 * доступен только там.
 *
 *   const confirmDanger = useConfirmDanger()
 *   confirmDanger({ target, message, acceptLabel, accept, reject?, onHide?, severity? })
 */
export function useConfirmDanger() {
  const confirm = useConfirm()
  return ({ severity = 'danger', ...opts }) =>
    confirm.require({
      icon: 'pi pi-exclamation-triangle',
      rejectLabel: 'Отмена',
      acceptProps: { severity, size: 'small' },
      rejectProps: { severity: 'secondary', text: true, size: 'small' },
      ...opts,
    })
}
