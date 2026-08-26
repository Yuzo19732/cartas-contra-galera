/*
  ESCOLHE O BARALHO PELO IDIOMA DA SALA.

  en = baralho oficial do Cards Against Humanity (CC BY-NC-SA 2.0)
  pt = baralho original em portugues, escrito pra este projeto
*/

const en = require("./cartas");
const pt = require("./cartas-pt");

const BARALHOS = { en, pt };
const IDIOMAS = Object.keys(BARALHOS);

function baralhoDe(idioma) {
  return BARALHOS[idioma] || BARALHOS.en;
}

module.exports = { baralhoDe, IDIOMAS };
