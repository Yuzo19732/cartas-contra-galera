/*
  CLIENTE - roda no navegador de cada jogador (e dentro do app Electron).
  Recebe o "estado" do servidor e redesenha a tela.

  Nao tem Card Czar e nao tem pontuacao: todo mundo joga uma carta,
  as respostas aparecem montadas na frase com o nome de quem jogou,
  e qualquer um pode puxar a proxima rodada.
*/

const $ = (id) => document.getElementById(id);

// Quando roda dentro do app, o preload do Electron deixa isso aqui pronto.
const app = window.appCartas || null;
const ehApp = !!app;

let socket = null;          // so nasce quando a gente sabe em qual servidor conectar
let estado = null;          // ultimo estado recebido do servidor
let selecionadas = [];      // ids das cartas que eu escolhi na mao
let rodadaDaSelecao = -1;   // pra limpar a selecao quando muda a rodada
let enderecoAtual = "";     // "" = o proprio servidor de onde a pagina veio

// A marquinha que aparece no rodape de toda carta impressa.
const MARCA = `<span class="marca-carta"><svg width="9" height="11" viewBox="0 0 9 11" aria-hidden="true">
<path d="M0.9 1.7 5 0.4v8.3L0.9 9.9z" fill="currentColor"/>
<rect x="2.7" y="1.2" width="5.6" height="8.6" rx="1" fill="none" stroke="currentColor" stroke-width="0.9"/>
</svg>Cards Against Humanity</span>`;

if (ehApp) document.body.classList.add("modo-app");

// ---------------------------------------------------------------------------
// Ajudantes
// ---------------------------------------------------------------------------
function escapar(txt) {
  return String(txt).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
  );
}

function aviso(msg) {
  const el = $("aviso");
  el.textContent = msg;
  el.classList.add("aparece");
  clearTimeout(aviso.temp);
  aviso.temp = setTimeout(() => el.classList.remove("aparece"), 2200);
}

function salvarSessao(codigo, token) {
  localStorage.setItem("ccg_sessao", JSON.stringify({ codigo, token, endereco: enderecoAtual }));
}
function lerSessao() {
  try { return JSON.parse(localStorage.getItem("ccg_sessao") || "null"); }
  catch { return null; }
}
function limparSessao() { localStorage.removeItem("ccg_sessao"); }

// Aceita as tres formas que a galera vai digitar:
//   "192.168.0.5"                 -> http://192.168.0.5:3000   (PC na mesma rede)
//   "192.168.0.5:3001"            -> http://192.168.0.5:3001
//   "cartas.onrender.com"         -> https://cartas.onrender.com  (jogo hospedado)
//   "https://algo.loca.lt"        -> https://algo.loca.lt         (tunel)
function normalizarEndereco(texto) {
  let t = String(texto || "").trim().replace(/\/+$/, "");
  if (!t) return "";

  // Se a pessoa colou o endereco completo, respeita o que ela colou
  const comProtocolo = t.match(/^(https?):\/\/(.+)$/i);
  if (comProtocolo) return comProtocolo[1].toLowerCase() + "://" + comProtocolo[2];

  // Sem protocolo: separa a porta, se tiver
  const comPorta = t.match(/^(.+):(\d+)$/);
  const host = comPorta ? comPorta[1] : t;
  const porta = comPorta ? comPorta[2] : null;

  const ehIP = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  const ehLocal = ehIP || host === "localhost";

  // IP ou localhost = alguem hospedando na mao, entao http e porta 3000 por padrao.
  if (ehLocal) return "http://" + host + ":" + (porta || "3000");

  // Qualquer outra coisa e um site hospedado: https, e sem inventar porta.
  return "https://" + host + (porta ? ":" + porta : "");
}

function rodapeCarta(pick) {
  const selo = pick > 1
    ? `<span class="pick">PICK <span class="pick-num"><span>${pick}</span></span></span>`
    : "";
  return `<div class="rodape-carta">${MARCA}${selo}</div>`;
}

// As cartas brancas terminam em ponto ("Meth."). Encaixadas no meio de uma frase
// isso vira "Meth.. is a slippery slope", entao a gente tira o ponto quando ainda
// vem texto depois do espaco em branco. E do mesmo jeito que se le na mesa.
function encaixar(texto, vemMaisCoisaDepois) {
  if (!vemMaisCoisaDepois) return texto;
  return texto.replace(/\.$/, "");
}

// Texto da carta preta, com ou sem as respostas encaixadas nos espacos
function textoDaPreta(preta, respostas) {
  if (!preta) return "";
  const buracos = preta.texto.match(/_{3,}/g);

  if (!respostas) {
    return escapar(preta.texto).replace(/_{3,}/g, '<span class="buraco"></span>');
  }
  if (!buracos) {
    // Carta que e pergunta direta, sem "___": mostra a resposta no fim
    return escapar(preta.texto) +
      ' <span class="preenchido">' + escapar(respostas[0] ? respostas[0].texto : "") + "</span>";
  }

  let i = 0;
  return escapar(preta.texto).replace(/_{3,}/g, (marca, posicao, frase) => {
    const r = respostas[i++];
    // Sobrou alguma coisa na frase depois deste espaco em branco?
    const resto = frase.slice(posicao + marca.length).trim();
    const bruto = r ? encaixar(r.texto, resto.length > 0) : "?";
    return '<span class="preenchido">' + escapar(bruto) + "</span>";
  });
}

// ---------------------------------------------------------------------------
// Conexao
// ---------------------------------------------------------------------------
function conectar(endereco) {
  if (socket) { socket.removeAllListeners(); socket.disconnect(); }
  enderecoAtual = endereco || "";
  socket = enderecoAtual ? io(enderecoAtual, { transports: ["websocket", "polling"] }) : io();

  socket.on("estado", (novo) => {
    estado = novo;
    if (estado.rodada !== rodadaDaSelecao) {
      selecionadas = [];
      rodadaDaSelecao = estado.rodada;
    }
    desenhar();
  });

  socket.on("expulso", () => {
    limparSessao();
    alert("Voce foi removido da sala.");
    location.reload();
  });

  socket.on("connect_error", () => {
    mostrarErroEntrada("Nao consegui falar com esse servidor. Confere o endereco.");
  });

  return socket;
}

// ---------------------------------------------------------------------------
// Tela de entrada
// ---------------------------------------------------------------------------
const nomeSalvo = localStorage.getItem("ccg_nome");
if (nomeSalvo) $("in-nome").value = nomeSalvo;

const codigoDaUrl = new URLSearchParams(location.search).get("sala");
if (codigoDaUrl) $("in-codigo").value = codigoDaUrl.toUpperCase();

function mostrarErroEntrada(msg) { $("erro-entrada").textContent = msg || ""; }

function irParaJogo(codigo, token) {
  salvarSessao(codigo, token);
  localStorage.setItem("ccg_nome", $("in-nome").value.trim());
  $("tela-entrada").classList.remove("ativa");
  $("tela-jogo").classList.add("ativa");
  if (!ehApp) history.replaceState({}, "", `/?sala=${codigo}`);
}

function pegarApelido() {
  const nome = $("in-nome").value.trim();
  if (!nome) { mostrarErroEntrada("Escreve um apelido primeiro."); return null; }
  mostrarErroEntrada("");
  return nome;
}

// --- criar sala: sempre no servidor que ta junto com esta tela -------------
$("btn-criar").onclick = () => {
  const nome = pegarApelido();
  if (!nome) return;
  conectar("");
  socket.emit("criarSala", { nome }, (r) => {
    if (!r.ok) return mostrarErroEntrada(r.erro);
    irParaJogo(r.codigo, r.token);
  });
};

// --- entrar numa sala ------------------------------------------------------
$("btn-entrar").onclick = () => {
  const nome = pegarApelido();
  if (!nome) return;
  const codigo = $("in-codigo").value.trim().toUpperCase();
  if (codigo.length !== 4) return mostrarErroEntrada("O codigo tem 4 caracteres.");

  // No app, o amigo digita o endereco do PC de quem esta hospedando.
  const endereco = ehApp ? normalizarEndereco($("in-endereco").value) : "";
  if (ehApp && !endereco) return mostrarErroEntrada("Escreve o endereco de quem esta hospedando.");

  const sessao = lerSessao();
  const token = sessao && sessao.codigo === codigo && sessao.endereco === endereco
    ? sessao.token : null;

  conectar(endereco);
  socket.emit("entrarSala", { codigo, nome, token }, (r) => {
    if (!r.ok) return mostrarErroEntrada(r.erro);
    irParaJogo(r.codigo, r.token);
  });
};

$("in-codigo").addEventListener("keydown", (e) => { if (e.key === "Enter") $("btn-entrar").click(); });
$("in-nome").addEventListener("keydown", (e) => {
  if (e.key === "Enter") ($("in-codigo").value.length === 4 ? $("btn-entrar") : $("btn-criar")).click();
});

// Reconexao automatica ao abrir (so no navegador, que tem a sala na URL)
if (!ehApp) {
  const sessao = lerSessao();
  if (sessao && (!codigoDaUrl || codigoDaUrl.toUpperCase() === sessao.codigo)) {
    conectar("");
    socket.on("connect", () => {
      socket.emit("entrarSala", { codigo: sessao.codigo, nome: nomeSalvo || "", token: sessao.token }, (r) => {
        if (r.ok) irParaJogo(r.codigo, r.token);
        else limparSessao();
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Botoes do topo
// ---------------------------------------------------------------------------
function textoDoConvite() {
  if (!estado) return "";
  if (!ehApp) return `${location.origin}/?sala=${estado.codigo}`;
  const ip = app.enderecos[0] ? app.enderecos[0].ip : "localhost";
  return `${ip}:${app.porta} / sala ${estado.codigo}`;
}

async function copiar(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    aviso("Copiado");
  } catch {
    prompt("Copie:", texto);
  }
}

$("btn-codigo").onclick = () => copiar(textoDoConvite());
$("btn-convite").onclick = () => copiar(textoDoConvite());
$("btn-painel").onclick = () => $("painel").classList.toggle("escondido");

$("btn-sair").onclick = () => {
  if (!confirm("Sair da sala?")) return;
  if (socket) socket.emit("sair");
  limparSessao();
  location.reload();
};

$("btn-comecar").onclick = () => socket.emit("comecar");
$("btn-reiniciar").onclick = () => socket.emit("reiniciar");

for (const campo of ["in-rodadas", "in-tempo"]) {
  $(campo).addEventListener("change", () => {
    socket.emit("config", {
      totalDeRodadas: Number($("in-rodadas").value),
      segundosParaJogar: Number($("in-tempo").value),
    });
  });
}

// ---------------------------------------------------------------------------
// Desenho da tela
// ---------------------------------------------------------------------------
function desenhar() {
  if (!estado) return;

  $("lbl-codigo").textContent = estado.codigo;
  $("lbl-codigo2").textContent = estado.codigo;

  const limite = estado.config.totalDeRodadas;
  $("lbl-rodada").textContent =
    estado.fase === "lobby" ? "Lobby" :
    estado.fase === "fim" ? "Fim da partida" :
    limite > 0 ? `Rodada ${estado.rodada} de ${limite}` : `Rodada ${estado.rodada}`;

  desenharJogadores();
  desenharFeed();

  $("area-lobby").hidden = estado.fase !== "lobby";
  $("area-jogo").hidden = estado.fase === "lobby" || estado.fase === "fim";
  $("area-fim").hidden = estado.fase !== "fim";

  if (estado.fase === "lobby") desenharLobby();
  else if (estado.fase === "fim") desenharFim();
  else desenharJogo();
}

function desenharJogadores() {
  const ul = $("lista-jogadores");
  ul.innerHTML = "";

  for (const j of estado.jogadores) {
    const li = document.createElement("li");
    if (!j.online) li.classList.add("offline");

    let selos = "";
    if (j.dono) selos += '<span class="selo-mini vazado">HOST</span>';
    if (estado.fase === "escolhendo")
      selos += j.jogou
        ? '<span class="selo-mini">PRONTO</span>'
        : '<span class="selo-mini vazado">...</span>';

    li.innerHTML =
      `<span class="nome">${escapar(j.nome)}${j.id === estado.euId ? " (voce)" : ""}</span>` + selos;

    if (estado.souDono && j.id !== estado.euId) {
      const btn = document.createElement("button");
      btn.className = "btn-expulsar";
      btn.title = "Remover da sala";
      btn.textContent = "×";
      btn.onclick = () => {
        if (confirm(`Remover ${j.nome} da sala?`)) socket.emit("expulsar", { jogadorId: j.id });
      };
      li.appendChild(btn);
    }
    ul.appendChild(li);
  }
}

function desenharFeed() {
  const feed = $("feed");
  const coladoNoFim = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;
  feed.innerHTML = "";
  for (const m of estado.historico) {
    const div = document.createElement("div");
    div.className = "m " + m.tipo;
    div.textContent = m.texto;
    feed.appendChild(div);
  }
  if (coladoNoFim) feed.scrollTop = feed.scrollHeight;
}

// ---------------------------------------------------------------------------
function desenharLobby() {
  $("config-dono").hidden = !estado.souDono;
  $("config-visita").hidden = estado.souDono;

  const limite = estado.config.totalDeRodadas;
  $("lbl-rodadas").textContent = limite > 0 ? limite : "sem fim";
  $("lbl-tempo-cfg").textContent = estado.config.segundosParaJogar
    ? estado.config.segundosParaJogar + "s" : "sem limite";

  if (document.activeElement !== $("in-rodadas")) $("in-rodadas").value = limite;
  if (document.activeElement !== $("in-tempo")) $("in-tempo").value = estado.config.segundosParaJogar;

  // No app, mostra o endereco desta maquina pros amigos digitarem
  const caixa = $("enderecos-host");
  if (ehApp && estado.souDono && app.enderecos.length) {
    caixa.hidden = false;
    caixa.innerHTML = "<h3>Seus amigos digitam isto no app</h3>" +
      app.enderecos.map((e) =>
        `<p class="endereco"><b>${escapar(e.ip)}:${app.porta}</b> <span>${escapar(e.nome)}</span></p>`
      ).join("") +
      `<p class="nota-campo">Junto com o codigo da sala: <b>${escapar(estado.codigo)}</b></p>`;
  } else {
    caixa.hidden = true;
  }

  const online = estado.jogadores.filter((j) => j.online).length;
  const btn = $("btn-comecar");
  btn.hidden = !estado.souDono;
  btn.disabled = online < estado.minJogadores;

  $("aviso-lobby").textContent = estado.souDono
    ? (online < estado.minJogadores
        ? `Faltam ${estado.minJogadores - online} pessoa(s) pra comecar.`
        : `${online} jogadores prontos.`)
    : "Esperando o dono da sala comecar a partida...";
}

// ---------------------------------------------------------------------------
function desenharJogo() {
  const preta = estado.cartaPreta;
  $("carta-preta").innerHTML =
    `<div class="corpo-carta">${textoDaPreta(preta, null)}</div>` +
    rodapeCarta(preta ? preta.pick : 1);

  desenharInstrucao();
  desenharMesa();
  desenharAcoes();
  desenharMao();
  atualizarCronometro();
}

function desenharInstrucao() {
  const el = $("instrucao");

  if (estado.fase === "escolhendo") {
    if (estado.jaJoguei) {
      el.innerHTML = `Carta na mesa. Agora e esperar.<br>` +
        `<span class="esperando">Faltam: ${estado.faltamJogar.map(escapar).join(", ") || "ninguem"}</span>`;
    } else {
      el.innerHTML = `Escolha <b>${estado.cartaPreta.pick}</b> carta(s) da sua mao pra completar a frase.<br>` +
        `<span class="esperando">Faltam: ${estado.faltamJogar.map(escapar).join(", ") || "ninguem"}</span>`;
    }
  } else if (estado.fase === "mostrando") {
    el.innerHTML = `Deu. Leiam tudo em voz alta e decidam entre voces quem foi melhor.<br>` +
      `<span class="esperando">Qualquer um pode puxar a proxima rodada.</span>`;
  }
}

// Na revelacao, cada resposta vira uma carta preta com a frase ja montada
function desenharMesa() {
  const mesa = $("mesa");
  mesa.innerHTML = "";
  if (estado.fase !== "mostrando") return;

  for (const jogada of estado.mesa) {
    if (!jogada.cartas) continue;
    const div = document.createElement("div");
    div.className = "jogada";
    div.innerHTML =
      `<div class="carta preta resposta">` +
        `<div class="corpo-carta">${textoDaPreta(estado.cartaPreta, jogada.cartas)}</div>` +
        rodapeCarta(1) +
      `</div>` +
      `<div class="quem">${escapar(jogada.nome)}</div>`;
    mesa.appendChild(div);
  }
}

function desenharAcoes() {
  const acoes = $("acoes");
  acoes.innerHTML = "";

  if (estado.fase === "escolhendo" && !estado.jaJoguei) {
    const btn = document.createElement("button");
    btn.className = "botao principal";
    const faltam = estado.cartaPreta.pick - selecionadas.length;
    btn.textContent = faltam > 0 ? `Escolha mais ${faltam} carta(s)` : "Jogar carta(s)";
    btn.disabled = faltam !== 0;
    btn.onclick = () => socket.emit("jogarCartas", { cartas: selecionadas });
    acoes.appendChild(btn);
  }

  // Qualquer jogador puxa a proxima rodada: assim nunca trava numa pessoa so
  if (estado.fase === "mostrando") {
    const btn = document.createElement("button");
    btn.className = "botao principal";
    const limite = estado.config.totalDeRodadas;
    btn.textContent = (limite > 0 && estado.rodada >= limite)
      ? "Terminar a partida" : "Proxima rodada";
    btn.onclick = () => socket.emit("proximaRodada");
    acoes.appendChild(btn);
  }
}

function desenharMao() {
  const mao = $("mao");
  const podeEscolher = estado.fase === "escolhendo" && !estado.jaJoguei;

  $("contador-selecao").textContent = podeEscolher
    ? `${selecionadas.length} de ${estado.cartaPreta.pick}`
    : "";

  mao.innerHTML = "";
  for (const carta of estado.minhaMao) {
    const div = document.createElement("div");
    div.className = "carta branca";
    div.innerHTML = `<div class="corpo-carta">${escapar(carta.texto)}</div>` + rodapeCarta(1);

    if (!podeEscolher) {
      div.classList.add("bloqueada");
    } else {
      const pos = selecionadas.indexOf(carta.id);
      if (pos >= 0) {
        div.classList.add("selecionada");
        if (estado.cartaPreta.pick > 1) {
          const badge = document.createElement("span");
          badge.className = "ordem";
          badge.textContent = pos + 1;
          div.appendChild(badge);
        }
      }
      div.onclick = () => alternarCarta(carta.id);
    }
    mao.appendChild(div);
  }
  posicionarMao();
}

// Abre as cartas em leque. A do meio fica reta e as das pontas viram pra fora,
// subindo um pouco, que e o desenho que a mao faz quando segura um baralho.
function posicionarMao() {
  const mao = $("mao");
  const cartas = [...mao.children];
  const total = cartas.length;
  if (!total) return;

  // Largura da carta e eixo do giro vem do CSS, entao o leque se ajusta no celular
  const estilo = getComputedStyle(mao);
  const larguraCarta = parseFloat(estilo.getPropertyValue("--larg")) || 172;
  const pivo = parseFloat(estilo.getPropertyValue("--pivo")) || 1.9;
  const giroMaximo = parseFloat(estilo.getPropertyValue("--giro")) || 26;

  const giroTotal = Math.min(giroMaximo, total * 3.4); // com poucas cartas, abre menos
  const anguloMax = giroTotal / 2;
  const meio = (total - 1) / 2;

  const rad = (anguloMax * Math.PI) / 180;

  // O eixo do giro fica abaixo da carta, entao girar tambem joga a carta pro lado.
  // Sem contar isso, as pontas do leque vazam pra fora da tela.
  const distanciaAoEixo = (pivo - 0.5) * larguraCarta; // cartas sao quadradas
  const empurraoDoGiro = distanciaAoEixo * Math.sin(rad);

  // Carta girada tambem ocupa mais largura que ela mesma (os cantos saem pra fora)
  const larguraGirada = larguraCarta * Math.cos(rad) + larguraCarta * Math.sin(rad);

  const espacoUtil = Math.max(0, mao.clientWidth - larguraGirada - 2 * empurraoDoGiro - 8);
  const passo = total > 1 ? Math.max(14, Math.min(66, espacoUtil / (total - 1))) : 0;

  cartas.forEach((carta, i) => {
    const desvio = i - meio;                       // negativo a esquerda, positivo a direita
    const proporcao = meio === 0 ? 0 : desvio / meio;
    const giro = proporcao * (giroTotal / 2);
    const altura = Math.pow(Math.abs(proporcao), 2) * 26; // pontas descem, meio sobe

    carta.style.setProperty("--x", desvio * passo + "px");
    carta.style.setProperty("--y", altura + "px");
    carta.style.setProperty("--r", giro + "deg");
    carta.style.zIndex = String(i + 1);
  });
}

// Se a janela mudar de tamanho, o leque se refaz
let tempoDoResize = null;
window.addEventListener("resize", () => {
  clearTimeout(tempoDoResize);
  tempoDoResize = setTimeout(posicionarMao, 120);
});

function alternarCarta(id) {
  const pos = selecionadas.indexOf(id);
  if (pos >= 0) {
    selecionadas.splice(pos, 1);
  } else {
    if (selecionadas.length >= estado.cartaPreta.pick) selecionadas.shift();
    selecionadas.push(id);
  }
  desenharMao();
  desenharAcoes();
}

// ---------------------------------------------------------------------------
function desenharFim() {
  $("lbl-fim-rodadas").textContent = estado.rodada;
  $("btn-reiniciar").hidden = !estado.souDono;
}

// ---------------------------------------------------------------------------
// Cronometro
// ---------------------------------------------------------------------------
setInterval(atualizarCronometro, 400);

function atualizarCronometro() {
  const chip = $("lbl-tempo");
  if (!estado || !estado.prazo || estado.fase !== "escolhendo") {
    chip.hidden = true;
    return;
  }
  const restam = Math.max(0, Math.ceil((estado.prazo - Date.now()) / 1000));
  chip.hidden = false;
  chip.querySelector("b").textContent = restam + "s";
  chip.classList.toggle("urgente", restam <= 10);
}
