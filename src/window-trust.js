const { pathToFileURL } = require('node:url');

function rendererTrust(rendererPath, getWindow) {
  const rendererUrl = pathToFileURL(rendererPath).href;
  return {
    rendererUrl,
    isTrustedSender: (event) => {
      const window = getWindow();
      const frame = event.senderFrame;
      return Boolean(window && !window.isDestroyed() && event.sender === window.webContents
        && frame && frame === window.webContents.mainFrame && frame.url === rendererUrl);
    },
    restrictNavigation: (webContents) => {
      webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      webContents.on('will-navigate', (event, url) => {
        if (url !== rendererUrl) event.preventDefault();
      });
      webContents.on('will-redirect', (event) => event.preventDefault());
      webContents.on('will-attach-webview', (event) => event.preventDefault());
    },
  };
}

module.exports = { rendererTrust };
