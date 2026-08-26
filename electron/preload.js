/*
  PRELOAD
  -------
  Ponte segura entre o Electron e a pagina do jogo.
  So passa duas coisas: em que porta o servidor local subiu e quais
  enderecos de rede esta maquina tem (pros amigos digitarem).
*/

const { contextBridge } = require("electron");

function lerDados() {
  const arg = process.argv.find((a) => a.startsWith("--dados-app="));
  if (!arg) return { porta: 3000, enderecos: [] };
  try {
    return JSON.parse(arg.slice("--dados-app=".length));
  } catch {
    return { porta: 3000, enderecos: [] };
  }
}

const dados = lerDados();

contextBridge.exposeInMainWorld("appCartas", {
  ehApp: true,
  porta: dados.porta,
  enderecos: dados.enderecos, // [{ nome, ip }]
});
