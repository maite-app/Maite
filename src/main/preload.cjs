const { contextBridge, ipcRenderer } = require('electron');

// renderer に渡すのは「状態を受け取る」ためのこの 1 本だけ。
contextBridge.exposeInMainWorld('aipet', {
  onState(callback) {
    ipcRenderer.on('aipet:state', (_event, state) => callback(state));
  },
  // 名刺（card.html）用。**描き終わったことを撮る側に伝えるだけ**
  onCard(callback) {
    ipcRenderer.on('aipet:card', (_event, view) => callback(view));
  },
  cardReady() {
    ipcRenderer.send('aipet:card-ready');
  },
  // 名刺が保存できたことを、オーバーレイの吹き出しに出すため
  onSaved(callback) {
    ipcRenderer.on('aipet:saved', (_event, file) => callback(file));
  },
});
