/*
  SERVIDOR DO JOGO "CARTAS CONTRA A GALERA"
  -----------------------------------------
  Ele faz tres coisas:
   1. Serve os arquivos da pasta /public (a tela do jogo).
   2. Guarda o estado de cada sala em memoria.
   3. Conversa com os navegadores por WebSocket (socket.io).

  COMO O JOGO FUNCIONA AQUI
  -------------------------
  Nao tem Card Czar e nao tem pontuacao. Cada rodada e assim:
    1. Sai uma carta preta.
    2. TODO MUNDO joga uma carta branca (ou duas, ou tres).
    3. As respostas aparecem montadas na frase, com o nome de quem jogou.
    4. A galera le, ri e decide na call quem foi melhor.
    5. Qualquer um clica em "Proxima rodada" e o jogo segue.

  Rodar solto:  npm start   ->  http://localhost:3000
  Pelo app:     npm run app
*/

const path = require("path");
const http = require("http");
const os = require("os");
const express = require("express");
const { Server } = require("socket.io");
const { baralhoDe, IDIOMAS } = require("./baralhos");

// ---------------------------------------------------------------------------
// Ajustes gerais
// ---------------------------------------------------------------------------
const TAMANHO_DA_MAO = 10; // quantas cartas brancas cada um segura
const MIN_JOGADORES = 2; // sem Card Czar, dois ja da pra jogar
const MAX_JOGADORES = 12;

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
function embaralhar(lista) {
  // Fisher-Yates: embaralha a propria lista
  for (let i = lista.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [lista[i], lista[j]] = [lista[j], lista[i]];
  }
  return lista;
}

function idAleatorio() {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

function codigoDeSala() {
  // Letras que nao se confundem entre si (sem I, O, 0, 1)
  const letras = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let codigo = "";
  for (let i = 0; i < 4; i++) {
    codigo += letras[Math.floor(Math.random() * letras.length)];
  }
  return codigo;
}

function limparNome(nome) {
  return String(nome || "").replace(/\s+/g, " ").trim().slice(0, 16);
}

function quantosEspacos(texto) {
  const achados = texto.match(/_{3,}/g);
  return achados ? achados.length : 1;
}

// Enderecos de rede da maquina, pra mostrar pros amigos entrarem
function enderecosDaRede() {
  const lista = [];
  for (const [nome, enderecos] of Object.entries(os.networkInterfaces())) {
    for (const e of enderecos || []) {
      if (e.family === "IPv4" && !e.internal) lista.push({ nome, ip: e.address });
    }
  }
  return lista;
}

// ---------------------------------------------------------------------------
// Salas
// ---------------------------------------------------------------------------
const salas = new Map(); // codigo -> sala

function novaSala(codigo) {
  return {
    codigo,
    criadaEm: Date.now(),
    donoId: null, // token do jogador que criou a sala
    jogadores: [], // { id, nome, mao[], online, socketId }
    fase: "lobby", // lobby | escolhendo | mostrando | fim
    cartaPreta: null, // { texto, pick }
    rodada: 0,
    jogadas: new Map(), // tokenDoJogador -> [cartas]
    mesa: [], // as respostas reveladas da rodada
    baralhoPretas: [],
    baralhoBrancas: [],
    usadasPretas: [],
    usadasBrancas: [],
    cronometro: null, // setTimeout ativo
    prazo: null, // timestamp de quando o tempo acaba
    config: {
      // Idioma da sala: manda no baralho e nos textos da tela pra todo mundo.
      idioma: "pt",
      // Nao existe vencedor. 0 = partida sem fim.
      totalDeRodadas: 20,
      segundosParaJogar: 90, // 0 = sem tempo
    },
    historico: [], // mensagens do feed
  };
}

function montarBaralhos(sala) {
  const baralho = baralhoDe(sala.config.idioma);
  sala.baralhoPretas = embaralhar(
    baralho.PRETAS.map((texto) => ({ id: idAleatorio(), texto, pick: quantosEspacos(texto) }))
  );
  sala.baralhoBrancas = embaralhar(
    baralho.BRANCAS.map((texto) => ({ id: idAleatorio(), texto }))
  );
  sala.usadasPretas = [];
  sala.usadasBrancas = [];
}

function comprarPreta(sala) {
  if (sala.baralhoPretas.length === 0) {
    sala.baralhoPretas = embaralhar(sala.usadasPretas);
    sala.usadasPretas = [];
  }
  const carta = sala.baralhoPretas.pop();
  if (carta) sala.usadasPretas.push(carta);
  return carta;
}

function comprarBranca(sala) {
  if (sala.baralhoBrancas.length === 0) {
    // Reembaralha o que ja foi jogado, com ids novos pra nao repetir id na mao
    sala.baralhoBrancas = embaralhar(
      sala.usadasBrancas.map((c) => ({ id: idAleatorio(), texto: c.texto }))
    );
    sala.usadasBrancas = [];
  }
  return sala.baralhoBrancas.pop();
}

function completarMao(sala, jogador) {
  while (jogador.mao.length < TAMANHO_DA_MAO) {
    const carta = comprarBranca(sala);
    if (!carta) break;
    jogador.mao.push(carta);
  }
}

function completarMaos(sala) {
  for (const jogador of sala.jogadores) completarMao(sala, jogador);
}

function acharJogador(sala, id) {
  return sala.jogadores.find((j) => j.id === id) || null;
}

function jogadoresAtivos(sala) {
  return sala.jogadores.filter((j) => j.online);
}

// Sem Card Czar: todo mundo que esta online precisa jogar
function quemFaltaJogar(sala) {
  return jogadoresAtivos(sala).filter((j) => !sala.jogadas.has(j.id));
}

// Guarda um codigo, nao a frase pronta: assim cada jogador le o feed
// no idioma da sala, e trocar de idioma reescreve o historico inteiro.
function anunciar(sala, chave, dados = {}, tipo = "info") {
  sala.historico.push({ id: idAleatorio(), chave, dados, tipo, em: Date.now() });
  if (sala.historico.length > 60) sala.historico.shift();
}

// ---------------------------------------------------------------------------
// Cronometro da fase de escolha
// ---------------------------------------------------------------------------
function pararCronometro(sala) {
  if (sala.cronometro) {
    clearTimeout(sala.cronometro);
    sala.cronometro = null;
  }
  sala.prazo = null;
}

function iniciarCronometro(sala) {
  pararCronometro(sala);
  const segundos = sala.config.segundosParaJogar;
  if (!segundos) return;
  sala.prazo = Date.now() + segundos * 1000;
  sala.cronometro = setTimeout(() => {
    if (sala.fase !== "escolhendo") return;
    // Quem nao jogou, joga carta aleatoria da propria mao
    for (const jogador of quemFaltaJogar(sala)) {
      const pick = sala.cartaPreta.pick;
      if (jogador.mao.length < pick) continue;
      const sorteadas = embaralhar([...jogador.mao]).slice(0, pick);
      registrarJogada(sala, jogador, sorteadas.map((c) => c.id));
    }
    anunciar(sala, "tempoEsgotado", {}, "aviso");
    conferirFimDaEscolha(sala);
    enviarEstado(sala);
  }, segundos * 1000);
}

// ---------------------------------------------------------------------------
// Fluxo do jogo
// ---------------------------------------------------------------------------
function comecarPartida(sala) {
  montarBaralhos(sala);
  for (const jogador of sala.jogadores) jogador.mao = [];
  sala.rodada = 0;
  anunciar(sala, "partidaComecou", {}, "sucesso");
  novaRodada(sala);
}

function novaRodada(sala) {
  pararCronometro(sala);
  sala.rodada += 1;
  sala.jogadas = new Map();
  sala.mesa = [];
  sala.cartaPreta = comprarPreta(sala);
  completarMaos(sala);
  sala.fase = "escolhendo";
  anunciar(sala, "rodada", { n: sala.rodada }, "info");
  iniciarCronometro(sala);
}

function registrarJogada(sala, jogador, idsDasCartas) {
  const escolhidas = [];
  for (const id of idsDasCartas) {
    const carta = jogador.mao.find((c) => c.id === id);
    if (carta && !escolhidas.includes(carta)) escolhidas.push(carta);
  }
  if (escolhidas.length !== sala.cartaPreta.pick) return false;

  // tira da mao e guarda a jogada
  jogador.mao = jogador.mao.filter((c) => !escolhidas.includes(c));
  sala.jogadas.set(jogador.id, escolhidas);
  sala.usadasBrancas.push(...escolhidas);
  return true;
}

function conferirFimDaEscolha(sala) {
  if (sala.fase !== "escolhendo") return;
  if (quemFaltaJogar(sala).length > 0) return;
  if (sala.jogadas.size === 0) return; // ninguem jogou, espera

  pararCronometro(sala);
  sala.fase = "mostrando";
  sala.mesa = embaralhar(
    [...sala.jogadas.entries()].map(([jogadorId, cartas]) => {
      const dono = acharJogador(sala, jogadorId);
      return {
        jogadaId: idAleatorio(),
        jogadorId,
        nome: dono ? dono.nome : "Alguem que saiu",
        cartas,
      };
    })
  );
  anunciar(sala, "respostasNaMesa", {}, "sucesso");
}

// Qualquer jogador pode puxar a proxima rodada, pra nunca travar em uma pessoa so
function avancarRodada(sala) {
  if (sala.fase !== "mostrando") return false;

  const limite = sala.config.totalDeRodadas;
  if (limite > 0 && sala.rodada >= limite) {
    pararCronometro(sala);
    sala.fase = "fim";
    anunciar(sala, "fimDasRodadas", { n: limite }, "sucesso");
    return true;
  }

  if (jogadoresAtivos(sala).length < MIN_JOGADORES) {
    pararCronometro(sala);
    sala.fase = "lobby";
    anunciar(sala, "genteDeMenos", {}, "aviso");
    return true;
  }

  novaRodada(sala);
  return true;
}

// ---------------------------------------------------------------------------
// Envio do estado (cada jogador recebe a propria mao, e so a dele)
// ---------------------------------------------------------------------------
function estadoParaJogador(sala, jogador) {
  const revelado = sala.fase === "mostrando" || sala.fase === "fim";

  return {
    codigo: sala.codigo,
    fase: sala.fase,
    rodada: sala.rodada,
    config: sala.config,
    prazo: sala.prazo,
    souDono: jogador.id === sala.donoId,
    euId: jogador.id,
    minhaMao: jogador.mao,
    cartaPreta: sala.cartaPreta,
    jaJoguei: sala.jogadas.has(jogador.id),
    faltamJogar: quemFaltaJogar(sala).map((j) => j.nome),
    jogadores: sala.jogadores.map((j) => ({
      id: j.id,
      nome: j.nome,
      online: j.online,
      dono: j.id === sala.donoId,
      jogou: sala.jogadas.has(j.id),
    })),
    // As respostas so viajam pra tela quando chega a hora de revelar
    mesa: revelado
      ? sala.mesa.map((m) => ({ jogadaId: m.jogadaId, nome: m.nome, cartas: m.cartas }))
      : sala.mesa.map((m) => ({ jogadaId: m.jogadaId, nome: null, cartas: null })),
    historico: sala.historico.slice(-25),
    minJogadores: MIN_JOGADORES,
  };
}

let io = null;

function enviarEstado(sala) {
  if (!io) return;
  for (const jogador of sala.jogadores) {
    if (!jogador.socketId) continue;
    io.to(jogador.socketId).emit("estado", estadoParaJogador(sala, jogador));
  }
}

// ---------------------------------------------------------------------------
// Quando alguem some ou sai, o jogo nao pode travar esperando por essa pessoa
// ---------------------------------------------------------------------------
function resolverAusencia(sala) {
  if (sala.fase === "lobby" || sala.fase === "fim") return;

  if (jogadoresAtivos(sala).length < MIN_JOGADORES) {
    pararCronometro(sala);
    sala.fase = "lobby";
    anunciar(sala, "genteDeMenos", {}, "aviso");
    return;
  }
  // Talvez essa pessoa fosse a ultima que faltava jogar
  conferirFimDaEscolha(sala);
}

function removerJogador(sala, jogadorId, chave) {
  const jogador = acharJogador(sala, jogadorId);
  if (!jogador) return;
  sala.jogadores = sala.jogadores.filter((j) => j.id !== jogadorId);
  sala.jogadas.delete(jogadorId);
  sala.mesa = sala.mesa.filter((m) => m.jogadorId !== jogadorId);
  anunciar(sala, chave, { nome: jogador.nome }, "aviso");

  if (sala.donoId === jogadorId) {
    const proximo = jogadoresAtivos(sala)[0] || sala.jogadores[0];
    sala.donoId = proximo ? proximo.id : null;
    if (proximo) anunciar(sala, "novoDono", { nome: proximo.nome }, "info");
  }
  resolverAusencia(sala);
}

// ---------------------------------------------------------------------------
// Conexoes
// ---------------------------------------------------------------------------
function ligarSockets() {
  io.on("connection", (socket) => {
    socket.data.salaCodigo = null;
    socket.data.jogadorId = null;

    const minhaSala = () => (socket.data.salaCodigo ? salas.get(socket.data.salaCodigo) : null);
    const euMesmo = (sala) => (sala ? acharJogador(sala, socket.data.jogadorId) : null);

    function novoJogador(nome) {
      return {
        id: idAleatorio() + idAleatorio(),
        nome,
        mao: [],
        online: true,
        socketId: socket.id,
      };
    }

    // ---- criar sala -----------------------------------------------------
    socket.on("criarSala", ({ nome, idioma }, resposta) => {
      const apelido = limparNome(nome);
      if (!apelido) return resposta({ ok: false, erro: "apelido" });

      let codigo;
      do { codigo = codigoDeSala(); } while (salas.has(codigo));

      const sala = novaSala(codigo);
      // A sala ja nasce no idioma de quem criou
      if (IDIOMAS.includes(idioma)) sala.config.idioma = idioma;
      salas.set(codigo, sala);

      const jogador = novoJogador(apelido);
      sala.jogadores.push(jogador);
      sala.donoId = jogador.id;

      socket.join(codigo);
      socket.data.salaCodigo = codigo;
      socket.data.jogadorId = jogador.id;

      anunciar(sala, "criouSala", { nome: apelido }, "info");
      resposta({ ok: true, codigo, token: jogador.id });
      enviarEstado(sala);
    });

    // ---- entrar / reconectar --------------------------------------------
    socket.on("entrarSala", ({ codigo, nome, token }, resposta) => {
      const cod = String(codigo || "").toUpperCase().trim();
      const sala = salas.get(cod);
      if (!sala) return resposta({ ok: false, erro: "salaNaoEncontrada" });

      // Reconexao: o navegador guardou o token da sessao anterior
      const antigo = token ? acharJogador(sala, token) : null;
      if (antigo) {
        antigo.online = true;
        antigo.socketId = socket.id;
        if (limparNome(nome)) antigo.nome = limparNome(nome);
        socket.join(cod);
        socket.data.salaCodigo = cod;
        socket.data.jogadorId = antigo.id;
        anunciar(sala, "voltou", { nome: antigo.nome }, "info");
        resposta({ ok: true, codigo: cod, token: antigo.id });
        enviarEstado(sala);
        return;
      }

      const apelido = limparNome(nome);
      if (!apelido) return resposta({ ok: false, erro: "apelido" });
      if (sala.jogadores.length >= MAX_JOGADORES)
        return resposta({ ok: false, erro: "salaCheia" });
      if (sala.jogadores.some((j) => j.nome.toLowerCase() === apelido.toLowerCase()))
        return resposta({ ok: false, erro: "apelidoRepetido" });

      const jogador = novoJogador(apelido);
      // Se a partida ja comecou, entra no meio dela com a mao cheia
      if (sala.fase !== "lobby") completarMao(sala, jogador);
      sala.jogadores.push(jogador);
      if (!sala.donoId) sala.donoId = jogador.id;

      socket.join(cod);
      socket.data.salaCodigo = cod;
      socket.data.jogadorId = jogador.id;

      anunciar(sala, "entrou", { nome: apelido }, "info");
      resposta({ ok: true, codigo: cod, token: jogador.id });
      enviarEstado(sala);
    });

    // ---- configuracoes (so o dono) --------------------------------------
    socket.on("config", (novaConfig) => {
      const sala = minhaSala();
      const eu = euMesmo(sala);
      if (!sala || !eu || eu.id !== sala.donoId) return;
      if (sala.fase !== "lobby") return;

      const rodadas = Number(novaConfig.totalDeRodadas);
      const tempo = Number(novaConfig.segundosParaJogar);
      if (IDIOMAS.includes(novaConfig.idioma)) sala.config.idioma = novaConfig.idioma;
      if (rodadas >= 0 && rodadas <= 200) sala.config.totalDeRodadas = Math.floor(rodadas);
      if (tempo === 0 || (tempo >= 15 && tempo <= 300))
        sala.config.segundosParaJogar = Math.floor(tempo);
      enviarEstado(sala);
    });

    // ---- comecar ---------------------------------------------------------
    socket.on("comecar", () => {
      const sala = minhaSala();
      const eu = euMesmo(sala);
      if (!sala || !eu || eu.id !== sala.donoId) return;
      if (sala.fase !== "lobby") return;
      if (jogadoresAtivos(sala).length < MIN_JOGADORES) return;
      comecarPartida(sala);
      enviarEstado(sala);
    });

    // ---- jogar cartas ----------------------------------------------------
    socket.on("jogarCartas", ({ cartas }) => {
      const sala = minhaSala();
      const eu = euMesmo(sala);
      if (!sala || !eu) return;
      if (sala.fase !== "escolhendo") return;
      if (sala.jogadas.has(eu.id)) return; // ja jogou

      if (registrarJogada(sala, eu, Array.isArray(cartas) ? cartas : [])) {
        conferirFimDaEscolha(sala);
        enviarEstado(sala);
      }
    });

    // ---- proxima rodada (qualquer jogador) -------------------------------
    socket.on("proximaRodada", () => {
      const sala = minhaSala();
      const eu = euMesmo(sala);
      if (!sala || !eu) return;
      if (avancarRodada(sala)) enviarEstado(sala);
    });

    // ---- voltar pro lobby depois do fim ----------------------------------
    socket.on("reiniciar", () => {
      const sala = minhaSala();
      const eu = euMesmo(sala);
      if (!sala || !eu || eu.id !== sala.donoId) return;
      pararCronometro(sala);
      sala.fase = "lobby";
      sala.cartaPreta = null;
      sala.jogadas = new Map();
      sala.mesa = [];
      sala.rodada = 0;
      for (const j of sala.jogadores) j.mao = [];
      anunciar(sala, "voltamosLobby", {}, "info");
      enviarEstado(sala);
    });

    // ---- expulsar (so o dono) -------------------------------------------
    socket.on("expulsar", ({ jogadorId }) => {
      const sala = minhaSala();
      const eu = euMesmo(sala);
      if (!sala || !eu || eu.id !== sala.donoId) return;
      if (jogadorId === eu.id) return;
      const alvo = acharJogador(sala, jogadorId);
      if (!alvo) return;
      if (alvo.socketId) io.to(alvo.socketId).emit("expulso");
      removerJogador(sala, alvo.id, "removido");
      enviarEstado(sala);
    });

    // ---- sair / cair -----------------------------------------------------
    socket.on("sair", () => {
      const sala = minhaSala();
      const eu = euMesmo(sala);
      if (!sala || !eu) return;
      removerJogador(sala, eu.id, "saiu");
      socket.leave(sala.codigo);
      socket.data.salaCodigo = null;
      socket.data.jogadorId = null;
      enviarEstado(sala);
    });

    socket.on("disconnect", () => {
      const sala = minhaSala();
      const eu = euMesmo(sala);
      if (!sala || !eu) return;

      eu.online = false;
      eu.socketId = null;
      anunciar(sala, "caiu", { nome: eu.nome }, "aviso");
      resolverAusencia(sala);
      enviarEstado(sala);

      // Sala vazia por 10 minutos e apagada
      if (jogadoresAtivos(sala).length === 0) {
        setTimeout(() => {
          const ainda = salas.get(sala.codigo);
          if (ainda && jogadoresAtivos(ainda).length === 0) {
            pararCronometro(ainda);
            salas.delete(ainda.codigo);
          }
        }, 10 * 60 * 1000);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Liga o servidor. Devolve a porta que realmente conseguiu usar.
// O app Electron chama isso; o "npm start" chama la embaixo.
// ---------------------------------------------------------------------------
function iniciarServidor(portaDesejada = Number(process.env.PORT) || 3000) {
  return new Promise((resolve, reject) => {
    const app = express();
    const server = http.createServer(app);

    // cors liberado: o app de um amigo (outro endereco) precisa poder conectar
    io = new Server(server, { cors: { origin: "*" } });

    app.use(express.static(path.join(__dirname, "public")));
    ligarSockets();

    let tentativas = 0;
    function tentar(porta) {
      server.once("error", (err) => {
        // Porta ocupada: tenta a proxima, ate 10 vezes
        if (err.code === "EADDRINUSE" && tentativas < 10) {
          tentativas += 1;
          tentar(porta + 1);
        } else {
          reject(err);
        }
      });
      server.listen(porta, () => {
        resolve({ porta, enderecos: enderecosDaRede() });
      });
    }
    tentar(portaDesejada);
  });
}

module.exports = { iniciarServidor, enderecosDaRede };

// Rodou direto pelo terminal (npm start)? Sobe o servidor e mostra os enderecos.
if (require.main === module) {
  iniciarServidor().then(({ porta, enderecos }) => {
    console.log("");
    console.log("  CARTAS CONTRA A GALERA");
    console.log("  ----------------------");
    console.log(`  No seu PC:      http://localhost:${porta}`);
    for (const e of enderecos) {
      console.log(`  Na sua rede:    http://${e.ip}:${porta}   (${e.nome})`);
    }
    console.log("");
  });
}
