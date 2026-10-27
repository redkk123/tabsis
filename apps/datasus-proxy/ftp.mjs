/**
 * FTP oficial do DATASUS (ftp.datasus.gov.br), para quando o portal cai.
 *
 * Existe por um defeito real: em 2026-10-25 o site datasus.saude.gov.br
 * recusava conexões (HTTP 520 na Cloudflare, "connection reset" direto) e toda
 * busca do TabSis falhava — até dengue —, enquanto o FTP, que é onde os
 * arquivos moram de verdade, respondia normalmente. O navegador não fala FTP;
 * o Worker fala, por TCP (`cloudflare:sockets`).
 *
 * Só leitura, só o host oficial, só debaixo de /dissemin/publicos/, e o modo
 * passivo usa sempre o nome do host oficial — nunca o IP que o servidor
 * anuncia —, para a rota não virar um conector TCP para qualquer lugar.
 */

export const FTP_HOST = 'ftp.datasus.gov.br';
const FTP_PATH = /^\/dissemin\/publicos\/(?:[A-Za-z0-9_.\- ]+\/)*[A-Za-z0-9_.\- ]*$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder('latin1');

export class FtpFailure extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'FtpFailure';
    this.status = status;
    this.code = code;
  }
}

/** Caminho aceito: debaixo de /dissemin/publicos/, sem `..`, sem caractere estranho. */
export function validateFtpPath(path) {
  if (typeof path !== 'string' || !FTP_PATH.test(path) || path.split('/').some((parte) => parte === '..' || parte === '.')) {
    throw new FtpFailure(400, 'invalid_ftp_path', 'FTP path must be under /dissemin/publicos/');
  }
  return path;
}

async function connectorFrom(environment) {
  if (typeof environment?.FTP_CONNECT === 'function') return environment.FTP_CONNECT;
  // Import dinâmico: o teste em Node carrega este arquivo sem o módulo da Cloudflare.
  const { connect } = await import('cloudflare:sockets');
  return connect;
}

function comPrazo(promessa, ms, mensagem) {
  let relogio;
  const prazo = new Promise((_, rejeitar) => {
    relogio = setTimeout(() => rejeitar(new FtpFailure(504, 'ftp_timeout', mensagem)), ms);
  });
  return Promise.race([promessa, prazo]).finally(() => clearTimeout(relogio));
}

class FtpControl {
  constructor(socket, timeoutMs) {
    this.socket = socket;
    this.reader = socket.readable.getReader();
    this.writer = socket.writable.getWriter();
    this.pendente = '';
    this.timeoutMs = timeoutMs;
  }

  async linha() {
    for (;;) {
      const fim = this.pendente.indexOf('\n');
      if (fim >= 0) {
        const linha = this.pendente.slice(0, fim).replace(/\r$/, '');
        this.pendente = this.pendente.slice(fim + 1);
        return linha;
      }
      const { value, done } = await this.reader.read();
      if (done) throw new FtpFailure(502, 'ftp_closed', 'FTP server closed the control connection');
      this.pendente += decoder.decode(value, { stream: true });
    }
  }

  /** Uma resposta inteira, inclusive a de várias linhas ("220-…" até "220 …"). */
  reply() {
    return comPrazo((async () => {
      const primeira = await this.linha();
      const codigo = /^(\d{3})([ -])/.exec(primeira);
      if (!codigo) throw new FtpFailure(502, 'ftp_protocol', `Unexpected FTP reply: ${primeira.slice(0, 80)}`);
      const linhas = [primeira];
      if (codigo[2] === '-') {
        for (;;) {
          const linha = await this.linha();
          linhas.push(linha);
          if (linha.startsWith(`${codigo[1]} `)) break;
        }
      }
      return { code: Number(codigo[1]), text: linhas.join('\n') };
    })(), this.timeoutMs, 'FTP server did not answer in time');
  }

  async command(texto) {
    await this.writer.write(encoder.encode(`${texto}\r\n`));
    return this.reply();
  }

  close() {
    try { this.writer.write(encoder.encode('QUIT\r\n')).catch(() => {}); } catch { /* já fechado */ }
    try { this.socket.close(); } catch { /* já fechado */ }
  }
}

function esperar(resposta, codigos, etapa) {
  if (!codigos.includes(resposta.code)) {
    const status = resposta.code === 550 ? 404 : 502;
    throw new FtpFailure(status, status === 404 ? 'ftp_not_found' : 'ftp_refused', `${etapa}: ${resposta.text.slice(0, 120)}`);
  }
  return resposta;
}

async function abrirSessao(connect, timeoutMs) {
  const controle = new FtpControl(connect({ hostname: FTP_HOST, port: 21 }), timeoutMs);
  try {
    esperar(await controle.reply(), [220], 'greeting');
    const usuario = esperar(await controle.command('USER anonymous'), [230, 331], 'USER');
    if (usuario.code === 331) esperar(await controle.command('PASS anonymous@'), [230], 'PASS');
    esperar(await controle.command('TYPE I'), [200], 'TYPE');
    return controle;
  } catch (error) {
    controle.close();
    throw error;
  }
}

async function canalDeDados(controle, connect) {
  const resposta = esperar(await controle.command('PASV'), [227], 'PASV');
  const numeros = /(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)/.exec(resposta.text);
  if (!numeros) throw new FtpFailure(502, 'ftp_protocol', 'PASV reply without address');
  const porta = Number(numeros[5]) * 256 + Number(numeros[6]);
  // O IP anunciado é ignorado de propósito (ver o topo do arquivo).
  return connect({ hostname: FTP_HOST, port: porta });
}

async function lerTudo(readable, maximo) {
  const leitor = readable.getReader();
  const partes = [];
  let total = 0;
  for (;;) {
    const { value, done } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximo) {
      leitor.cancel().catch(() => {});
      throw new FtpFailure(502, 'ftp_listing_too_large', 'FTP listing is larger than allowed');
    }
    partes.push(value);
  }
  const bytes = new Uint8Array(total);
  let em = 0;
  for (const parte of partes) { bytes.set(parte, em); em += parte.byteLength; }
  return bytes;
}

const MESES = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/**
 * Lista no formato do IIS ("09-26-23  09:05AM   459467 LEIVBR21.dbc",
 * "<DIR>" para pasta) ou do Unix ("-rw-r--r-- 1 u g 459467 Sep 26 2023 X").
 */
export function parseFtpListing(texto) {
  const itens = [];
  for (const linha of texto.split(/\r?\n/)) {
    const iis = /^(\d{2})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})(AM|PM)\s+(<DIR>|\d+)\s+(.+)$/.exec(linha);
    if (iis) {
      const ano = Number(iis[3]) + (Number(iis[3]) < 70 ? 2000 : 1900);
      itens.push({
        name: iis[8].trim(),
        directory: iis[7] === '<DIR>',
        size: iis[7] === '<DIR>' ? 0 : Number(iis[7]),
        modified: `${ano}-${iis[1]}-${iis[2]}`,
      });
      continue;
    }
    const unix = /^([d-])[rwxs-]{9}\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\w{3})\s+(\d{1,2})\s+(\d{4}|\d{1,2}:\d{2})\s+(.+)$/.exec(linha);
    if (unix) {
      const mes = MESES[unix[3].toLowerCase()];
      const ano = unix[5].includes(':') ? new Date().getUTCFullYear() : Number(unix[5]);
      itens.push({
        name: unix[6].trim(),
        directory: unix[1] === 'd',
        size: Number(unix[2]),
        modified: mes ? `${ano}-${String(mes).padStart(2, '0')}-${unix[4].padStart(2, '0')}` : '',
      });
    }
  }
  return itens;
}

/** Conteúdo de uma pasta do FTP oficial. */
export async function ftpList(path, environment, { timeoutMs, maxBytes }) {
  const connect = await connectorFrom(environment);
  const controle = await abrirSessao(connect, timeoutMs);
  try {
    const dados = await canalDeDados(controle, connect);
    esperar(await controle.command(`LIST ${path}`), [125, 150], 'LIST');
    const bytes = await comPrazo(lerTudo(dados.readable, maxBytes), timeoutMs, 'FTP listing did not finish in time');
    esperar(await controle.reply(), [226, 250], 'LIST end');
    return parseFtpListing(decoder.decode(bytes));
  } finally {
    controle.close();
  }
}

/**
 * Um arquivo do FTP oficial, em fluxo. O tamanho vem do SIZE antes do RETR,
 * para o navegador mostrar o progresso; a conexão de controle fecha quando o
 * último byte passa.
 */
export async function ftpRetrieve(path, environment, { timeoutMs, maxBytes }) {
  const connect = await connectorFrom(environment);
  const controle = await abrirSessao(connect, timeoutMs);
  try {
    const tamanho = esperar(await controle.command(`SIZE ${path}`), [213], 'SIZE');
    const bytes = Number(/^213\s+(\d+)/m.exec(tamanho.text)?.[1]);
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new FtpFailure(502, 'ftp_protocol', 'SIZE reply without a size');
    if (bytes > maxBytes) throw new FtpFailure(413, 'ftp_file_too_large', 'FTP file is larger than allowed');
    const dados = await canalDeDados(controle, connect);
    esperar(await controle.command(`RETR ${path}`), [125, 150], 'RETR');
    // Nada de JavaScript por pedaço: contar bytes num TransformStream estoura
    // o limite de CPU da Cloudflare num arquivo grande e o corpo chega cortado
    // sem erro (o mesmo defeito do Bloco 3.5 do plano, no /archive). Quem
    // confere o tamanho é o FixedLengthStream, nativo, em handleFtp; a conexão
    // de controle fecha quando o fluxo termina.
    return {
      size: bytes,
      stream: dados.readable,
      fechar: () => { controle.reply().catch(() => {}).finally(() => controle.close()); },
    };
  } catch (error) {
    controle.close();
    throw error;
  }
}
