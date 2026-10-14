/**
 * Onde está, no FTP do DATASUS, a documentação oficial de cada tipo de
 * arquivo — o dicionário que diz o que cada campo é.
 *
 * O app busca o PDF sob demanda pelo mesmo caminho dos dados (o DATASUS
 * prepara um pacote com ele; testado em 2026-10-14 com o
 * Estrutura_do_SIM_2025.pdf). Nada fica guardado no repositório.
 *
 * O SINAN não publica os dicionários soltos: eles vêm todos no
 * Docs_TAB_SINAN.zip (65 MB), pasta Documentação/AGRAVOS — por isso a
 * entrada traz o tamanho, para a interface avisar antes.
 */

export interface OfficialDocument {
  /** Nome do PDF, como a pessoa vai ver. */
  name: string;
  /** O que é, em português. */
  title: string;
  /** Arquivo no FTP que se pede ao DATASUS (o PDF, ou o pacote que o contém). */
  address: string;
  /** Nome do arquivo no FTP. */
  remoteName: string;
  /** Tamanho aproximado do que se baixa, em bytes, quando é grande. */
  downloadBytes?: number;
}

const FTP = 'ftp://ftp.datasus.gov.br/dissemin/publicos';
const SINAN_DOCS = `${FTP}/SINAN/DOCS/Docs_TAB_SINAN.zip`;

function direto(name: string, title: string, pasta: string): OfficialDocument {
  return { name, title, address: `${FTP}/${pasta}/${name}`, remoteName: name };
}

function sinan(name: string, title: string): OfficialDocument {
  return { name, title, address: SINAN_DOCS, remoteName: 'Docs_TAB_SINAN.zip', downloadBytes: 65_650_628 };
}

const POR_SISTEMA: Readonly<Record<string, OfficialDocument>> = {
  SIM: direto('Estrutura_do_SIM_2025.pdf', 'Estrutura do SIM (dicionário dos campos)', 'SIM/CID10/DOCS'),
  SINASC: direto('Estrutura_SINASC_para_CD.pdf', 'Estrutura do SINASC (dicionário dos campos)', 'SINASC/NOV/DOCS'),
  SIH: direto('IT_SIHSUS_1603.pdf', 'Informe técnico do SIH (layout dos arquivos)', 'SIHSUS/200801_/Doc'),
  SIA: direto('Informe_Tecnico_SIASUS_2019_07.pdf', 'Informe técnico do SIA (layout dos arquivos)', 'SIASUS/200801_/Doc'),
  CNES: direto('IT_CNES_1706.pdf', 'Informe técnico do CNES (layout dos arquivos)', 'CNES/200508_/Doc'),
};

/** Prefixo do arquivo do SINAN (HANS em HANSBR23.dbc) → dicionário do agravo. */
const SINAN_POR_AGRAVO: Readonly<Record<string, string>> = {
  ACBI: 'ACBION_DIC_DADOS.pdf', ACGR: 'ACGRN_DIC_DADOS.pdf', AIDA: 'AIDSAN_DIC_DADOS.pdf',
  AIDC: 'AIDSCN_DIC_DADOS.pdf', ANIM: 'ANIMPN_DIC_DADOS.pdf', BOTU: 'BOTUN_DIC_DADOS.pdf',
  CANC: 'CANCN_DIC_DADOS.pdf', CHAG: 'CHAGAN_DIC_DADOS.pdf', COLE: 'COLEN_DIC_DADOS.pdf',
  COQU: 'COQUEN_DIC_DADOS.pdf', DENG: 'DENGON_DIC_DADOS.pdf', DERM: 'DERMN_DIC_DADOS.pdf',
  DIFT: 'DIFTEN_DIC_DADOS.pdf', ESQU: 'ESQUIN_DIC_DADOS.pdf', EXAN: 'EXANT_DIC_DADOS.pdf',
  FAMA: 'FAMARN_DIC_DADOS.pdf', FMAC: 'FMACUN_DIC_DADOS.pdf', FTIF: 'FTIFON_DIC_DADOS.pdf',
  HANS: 'HANSN_DIC_DADOS.pdf', HANT: 'HANTAN_DIC_DADOS.pdf', HEPA: 'HEPANET_DIC_DADOS.pdf',
  IEXO: 'IEXOGN_DIC_DADOS.pdf', LEIV: 'LEISHN_DIC_DADOS.pdf', LEPT: 'LEPTON_DIC_DADOS.pdf',
  LERD: 'LERDN_DIC_DADOS.pdf', LTAN: 'LTAN_DIC_DADOS.pdf', MALA: 'MALAN_DIC_DADOS.pdf',
  MENI: 'MENIN_DIC_DADOS.pdf', MENT: 'MENTN_DIC_DADOS.pdf', PAIR: 'PAIRN_DIC_DADOS.pdf',
  PEST: 'PESTEN_DIC_DADOS.pdf', PFAN: 'PFAN_DIC_DADOS.pdf', PNEU: 'PNEUN_DIC_DADOS.pdf',
  RAIV: 'RAIVAN_DIC_DADOS.pdf', ROTA: 'DIC_DADOS_ROTA_NET_v5.1.pdf', SDTA: 'SDTA_DIC_DADOS.pdf',
  SIFC: 'SIFICN_DIC_DADOS.pdf', SIFG: 'SIFIGEN_DIC_DADOS.pdf', SRC: 'SRCN_DIC_DADOS.pdf',
  TETA: 'TETACN_DIC_DADOS.pdf', TETN: 'TETANN_DIC_DADOS.pdf', TUBE: 'TUBEN_DIC_DADOS.pdf',
  VIOL: 'VIOLEN_DIC_DADOS.pdf',
};

/**
 * A documentação oficial para um arquivo de dados: sistema e prefixo vêm de
 * `describeDatasusFile`. No SINAN, o dicionário do agravo e o da ficha de
 * notificação (os campos comuns a todos os agravos).
 */
export function officialDocumentsFor(system: string | undefined, prefix: string | undefined): OfficialDocument[] {
  if (!system) return [];
  if (system === 'SINAN') {
    const agravo = prefix ? SINAN_POR_AGRAVO[prefix.toUpperCase()] : undefined;
    return [
      ...(agravo ? [sinan(agravo, 'Dicionário de dados do agravo (SINAN)')] : []),
      sinan('NINDIN_DIC_DADOS.pdf', 'Dicionário da ficha de notificação (SINAN)'),
    ];
  }
  const documento = POR_SISTEMA[system];
  return documento ? [documento] : [];
}
