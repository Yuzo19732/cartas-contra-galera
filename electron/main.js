/*
  APP DESKTOP (Electron)
  ----------------------
  Todo mundo instala o mesmo programa. Ele ja traz o jogo inteiro dentro:

    - Sobe o servidor do jogo na propria maquina, numa porta livre.
    - Abre a janela mostrando a tela do jogo.

  Quem clica em "Criar uma sala nova" vira o host: a partida roda no PC dessa
  pessoa. Os outros clicam em "Entrar" e digitam o endereco do host + o codigo.
*/

const { app, BrowserWindow, shell } = require("electron");
const path = require("path");
const { iniciarServidor } = require("../server");

let janela = null;
let dadosDoApp = { porta: 3000, enderecos: [] };

function criarJanela() {
  janela = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: "#000000",
    title: "Cartas Contra a Galera",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // O preload le isso pra saber em que porta o servidor subiu
      additionalArguments: ["--dados-app=" + JSON.stringify(dadosDoApp)],
    },
  });

  janela.once("ready-to-show", () => janela.show());
  janela.loadURL(`http://localhost:${dadosDoApp.porta}`);

  // Link externo (a licenca Creative Commons) abre no navegador de verdade
  janela.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(async () => {
  try {
    const { porta, enderecos } = await iniciarServidor(3000);
    dadosDoApp = { porta, enderecos };
  } catch (erro) {
    console.error("Nao consegui subir o servidor do jogo:", erro);
  }
  criarJanela();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) criarJanela();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
