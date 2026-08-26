# Cartas Contra a Galera

Versao em **aplicativo de PC** de Cards Against Humanity, com o baralho oficial.
Todo mundo instala o mesmo programa: um vira o host e os outros entram no PC dele.

## Como o jogo funciona aqui

Nao tem Card Czar e nao tem pontuacao. Cada rodada e assim:

1. Sai uma carta preta.
2. **Todo mundo** joga uma carta branca (ou duas, ou tres, se a carta pedir).
3. As respostas aparecem **montadas na frase**, com o nome de quem jogou.
4. A galera le, ri e decide na call quem foi melhor.
5. Qualquer um clica em **Proxima rodada** e o jogo segue.

Como qualquer pessoa pode puxar a proxima rodada, o jogo nunca trava esperando
uma pessoa so.

A partida acaba quando terminam as rodadas combinadas no lobby. Configurando
**0 rodadas**, ela nunca acaba.

## Rodando pra desenvolver

```bash
npm install
npm run app
```

Isso abre o app. Pra abrir so o servidor e testar pelo navegador:

```bash
npm start
```

## Gerando o instalador pros amigos

```bash
npm run build
```

O instalador sai na pasta `instalador/`. E esse arquivo que voce manda pra galera.
Cada pessoa instala uma vez; pra atualizar depois, manda o instalador novo.

Tem tambem `npm run build:portatil`, que gera um .exe unico que roda sem instalar.

## Jogando

**Quem vai hospedar:**

1. Abre o app e escreve o apelido.
2. Clica em **Criar uma sala nova**.
3. No lobby aparece o endereco da maquina (tipo `192.168.15.174:3000`) e o codigo
   da sala. Manda os dois pros amigos.
4. Escolhe quantas rodadas e o tempo por rodada, e clica em **Comecar a partida**.

**Os amigos:**

1. Abrem o app e escrevem o apelido.
2. Escrevem o **endereco do host** e o **codigo da sala**.
3. Clicam em **Entrar**.

Precisa de 2 pessoas ou mais.

## Jogando com gente de outra cidade

O endereco `192.168.x.x` so funciona pra quem esta no mesmo Wi-Fi. Pra valer na
internet tem dois caminhos.

### Caminho 1: hospedar o jogo (recomendado)

O jogo fica no ar 24 horas num link fixo, sem depender do seu PC ligado. E os
amigos podem entrar pelo **navegador do celular** tambem, sem instalar nada.

O projeto ja vem com o `render.yaml` pronto, entao o [Render](https://render.com)
preenche tudo sozinho:

1. Cria um repositorio no GitHub e sobe este projeto:
   ```bash
   git remote add origin https://github.com/SEU-USUARIO/cartas-contra-galera.git
   git push -u origin master
   ```
2. Entra no Render, **New > Blueprint**, e aponta pro repositorio.
3. Ele le o `render.yaml`, cria o servico e te da um endereco tipo
   `https://cartas-contra-galera.onrender.com`.

Pronto: esse link e o jogo. Quem tem o app tambem pode entrar nele — e so colar o
endereco no campo "Endereco de quem esta hospedando".

Duas coisas do plano gratuito que valem saber:

- Se ninguem usar por 15 minutos, ele **hiberna**. A primeira pessoa a abrir espera
  uns 50 segundos ele acordar. Depois disso fica normal.
- As salas ficam **na memoria**. Se o servico hibernar ou reiniciar, as salas abertas
  somem. Durante a partida ele nao hiberna, entao na pratica so atrapalha se voces
  pararem no meio e voltarem muito tempo depois.

### Caminho 2: tunel (na hora, sem cadastro)

Abre um endereco publico apontando pro servidor que ja esta rodando no seu PC.
Bom pra jogar agora, hoje. Em dois terminais:

```bash
npm start
```

```bash
npm run tunel
```

O segundo comando cospe um endereco tipo `https://algo-aleatorio.trycloudflare.com`.
Os amigos colam ele no campo de endereco do app (ou abrem direto no navegador).

O endereco muda toda vez que voce liga, e so funciona enquanto seu PC estiver com o
jogo aberto.

## O baralho

O `cartas.js` tem o baralho oficial completo, transcrito do PDF de impressao caseira
da propria Cards Against Humanity (versao 2.4):

- **100 cartas pretas** (11 sao PICK 2 e 1 e PICK 3)
- **500 cartas brancas**

As cartas estao em ingles, como no original.

### Adicionar suas proprias cartas

Abre `cartas.js` e escreve mais linhas nas listas `PRETAS` e `BRANCAS`.
Nas pretas, use `___` pro espaco em branco (pode usar dois ou tres na mesma frase —
o jogo conta sozinho e vira PICK 2 / PICK 3).

```js
"Meu maior medo e ___.",
```

Depois **gere o instalador de novo** e manda pra galera, senao so voce vai ter as
cartas novas.

## Estrutura

```
cartas-contra-galera/
  electron/
    main.js        abre a janela e sobe o servidor do jogo junto
    preload.js     conta pra tela em que porta o servidor subiu
  server.js        toda a logica do jogo (salas, rodadas, cartas)
  cartas.js        o baralho oficial
  public/
    index.html     as telas
    style.css      o visual
    client.js      o que roda dentro da janela
    fontes/        Neue Helvetica 75 Bold
  instalador/      sai daqui o instalador depois do build
```

## Detalhes que valem saber

- O app sempre sobe um servidor local, mesmo pra quem so vai entrar numa partida.
  Isso e de proposito: assim qualquer pessoa pode hospedar a qualquer momento,
  sem precisar de uma versao diferente do programa.
- Se a porta 3000 estiver ocupada, ele tenta 3001, 3002... e o numero que aparece
  no lobby ja e o certo.
- Se alguem cair, pode voltar com o mesmo codigo e continua na partida.

## Creditos e licenca

As cartas sao de **Cards Against Humanity**, distribuidas sob a licenca
[Creative Commons BY-NC-SA 2.0](https://creativecommons.org/licenses/by-nc-sa/2.0/).

Pode usar e modificar de graca, tem que dar credito, e **nao pode vender**.
Este projeto e sem fins lucrativos.

A fonte Neue Helvetica e comercial (Linotype/Monotype). Ela esta aqui pro uso de
voces; se um dia for distribuir isso publicamente, ou compra a licenca ou tira o
arquivo e deixa cair na Arial (a stack do CSS ja faz isso sozinha).
