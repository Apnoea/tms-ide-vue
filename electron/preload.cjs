// Единственный мост между рендерером и main-процессом. Sandbox'нутый preload
// обязан быть CommonJS — ESM в нём не грузится.
//
// Наличие `window.tmsDesktop` = признак десктопа: по нему рендерер понимает, что
// подтверждение закрытия окна берёт на себя оболочка.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('tmsDesktop', {
  version: process.env.TMS_APP_VERSION || '',
  platform: process.platform,
  /** Есть ли правки, не попавшие в выгруженный .zip — main спрашивает перед закрытием. */
  setUnexported: (value) => ipcRenderer.send('tms:unexported', !!value),
})
