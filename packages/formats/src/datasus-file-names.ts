/**
 * O que um arquivo do DATASUS é, lido do próprio nome — para mostrar ao lado
 * do nome original ("RDAC2401.dbc" → "Internações (AIH reduzida) · SIH ·
 * Acre · janeiro de 2024"). O nome original continua sendo o que aparece
 * primeiro: é por ele que as pessoas se entendem (pedido do professor); a
 * descrição é para quem não decorou as siglas.
 *
 * Só nomes no padrão do FTP do DATASUS; o resto devolve `null`, nunca um
 * palpite.
 */

export interface DatasusFileDescription {
  /** Sigla do sistema: SIH, SIA, CNES, SIM, SINASC, SINAN. */
  system: string;
  /** O que o arquivo traz, em português ("Internações (AIH reduzida)"). */
  kind: string;
  /** Prefixo do tipo de arquivo no FTP (RD, PA, ST, DO…): escolhe o layout no dicionário. */
  prefix?: string;
  /** Estado por extenso, ou "Brasil". */
  place?: string;
  /** Período por extenso ("janeiro de 2024", "2023"). */
  period?: string;
  /** Período curto ("jan/2024", "2023"). */
  periodShort?: string;
  /** Uma linha para mostrar: "Internações (AIH reduzida) · SIH · Acre · jan/2024". */
  summary: string;
}

export const UF_NAMES: Readonly<Record<string, string>> = Object.freeze({
  AC: 'Acre', AL: 'Alagoas', AM: 'Amazonas', AP: 'Amapá', BA: 'Bahia', CE: 'Ceará',
  DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MG: 'Minas Gerais',
  MS: 'Mato Grosso do Sul', MT: 'Mato Grosso', PA: 'Pará', PB: 'Paraíba', PE: 'Pernambuco',
  PI: 'Piauí', PR: 'Paraná', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RO: 'Rondônia',
  RR: 'Roraima', RS: 'Rio Grande do Sul', SC: 'Santa Catarina', SE: 'Sergipe', SP: 'São Paulo',
  TO: 'Tocantins', BR: 'Brasil',
});

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto',
  'setembro', 'outubro', 'novembro', 'dezembro'];

const SIH: Record<string, string> = {
  RD: 'Internações (AIH reduzida)', RJ: 'AIH rejeitadas', SP: 'Serviços profissionais (AIH)', ER: 'AIH rejeitadas com código de erro',
};
const SIA: Record<string, string> = {
  PA: 'Produção ambulatorial', PS: 'Atenção psicossocial (RAAS)', SAD: 'Atenção domiciliar (RAAS)',
  AB: 'APAC de cirurgia bariátrica', ABO: 'APAC de acompanhamento pós-bariátrica', ACF: 'APAC de confecção de fístula',
  AD: 'APAC de laudos diversos', AM: 'APAC de medicamentos', AN: 'APAC de nefrologia', AQ: 'APAC de quimioterapia',
  AR: 'APAC de radioterapia', ATD: 'APAC de tratamento dialítico', BI: 'Boletim de produção ambulatorial individualizado',
};
const CNES: Record<string, string> = {
  ST: 'Estabelecimentos', LT: 'Leitos', PF: 'Profissionais', EQ: 'Equipamentos', SR: 'Serviços especializados',
  HB: 'Habilitações', EP: 'Equipes', DC: 'Dados complementares', RC: 'Regras contratuais', IN: 'Incentivos',
  EE: 'Estabelecimentos de ensino', EF: 'Estabelecimentos filantrópicos', GM: 'Gestão e metas',
};
const SIM_NATIONAL: Record<string, string> = {
  DOINF: 'Óbitos infantis', DOFET: 'Óbitos fetais', DOEXT: 'Óbitos por causas externas', DOMAT: 'Óbitos maternos',
};
const SINAN: Record<string, string> = {
  ACBI: 'Acidente com material biológico', ACGR: 'Acidente de trabalho grave', AIDA: 'Aids em adultos',
  AIDC: 'Aids em crianças', ANIM: 'Acidentes por animais peçonhentos', ANTR: 'Atendimento antirrábico',
  BOTU: 'Botulismo', CANC: 'Câncer relacionado ao trabalho', CHAG: 'Doença de Chagas aguda', CHIK: 'Chikungunya',
  COLE: 'Cólera', COQU: 'Coqueluche', DENG: 'Dengue', DERM: 'Dermatoses ocupacionais', DIFT: 'Difteria',
  ESQU: 'Esquistossomose', EXAN: 'Doenças exantemáticas', FAMA: 'Febre amarela', FMAC: 'Febre maculosa',
  FTIF: 'Febre tifoide', HANS: 'Hanseníase', HANT: 'Hantavirose', HEPA: 'Hepatites virais', IEXO: 'Intoxicação exógena',
  INFL: 'Influenza', LEIV: 'Leishmaniose visceral', LEPT: 'Leptospirose', LERD: 'LER/DORT', LTAN: 'Leishmaniose tegumentar',
  MALA: 'Malária', MENI: 'Meningite', MENT: 'Transtornos mentais relacionados ao trabalho', NTRA: 'Notificação de tracoma',
  PAIR: 'Perda auditiva por ruído', PEST: 'Peste', PFAN: 'Paralisia flácida aguda', PNEU: 'Pneumoconioses',
  RAIV: 'Raiva humana', ROTA: 'Rotavírus', SDTA: 'Surto de doença transmitida por alimentos', SIFA: 'Sífilis adquirida',
  SIFC: 'Sífilis congênita', SIFG: 'Sífilis em gestante', SRC: 'Síndrome da rubéola congênita', TETA: 'Tétano acidental',
  TETN: 'Tétano neonatal', TOXC: 'Toxoplasmose congênita', TOXG: 'Toxoplasmose gestacional', TRAC: 'Tracoma',
  TUBE: 'Tuberculose', VARC: 'Varicela', VIOL: 'Violência interpessoal/autoprovocada', ZIKA: 'Zika',
};

function build(system: string, kind: string, uf: string | undefined, year: number | undefined, month?: number, prefix?: string): DatasusFileDescription {
  const place = uf ? UF_NAMES[uf] : undefined;
  const period = year === undefined ? undefined : month ? `${MONTHS[month - 1]} de ${year}` : String(year);
  const periodShort = year === undefined ? undefined : month ? `${MONTHS[month - 1]!.slice(0, 3)}/${year}` : String(year);
  const summary = [kind, system, place, periodShort].filter(Boolean).join(' · ');
  return {
    system, kind,
    ...(prefix ? { prefix } : {}),
    ...(place ? { place } : {}),
    ...(period ? { period } : {}),
    ...(periodShort ? { periodShort } : {}),
    summary,
  };
}

function fullYear(two: string): number {
  const value = Number(two);
  return value >= 70 ? 1900 + value : 2000 + value;
}

export function describeDatasusFile(fileName: string): DatasusFileDescription | null {
  const base = fileName.trim().split(/[\\/]/).pop() ?? '';
  const match = /^([A-Za-z]+?)(\d+)\.(dbc|dbf|parquet)$/i.exec(base)
    ?? /^([A-Za-z]+)\.(dbc|dbf|parquet)$/i.exec(base);
  if (!match) return null;
  const letters = match[1]!.toUpperCase();
  const digits = /^\d+$/.test(match[2] ?? '') ? match[2]! : '';

  // Mensais por estado: PREFIXO + UF + AA + MM (SIH, SIA, CNES).
  if (digits.length === 4) {
    const prefix = letters.slice(0, -2);
    const uf = letters.slice(-2);
    const month = Number(digits.slice(2));
    if (UF_NAMES[uf] && month >= 1 && month <= 12) {
      const year = fullYear(digits.slice(0, 2));
      if (SIH[prefix]) return build('SIH', SIH[prefix]!, uf, year, month, prefix);
      if (SIA[prefix]) return build('SIA', SIA[prefix]!, uf, year, month, prefix);
      if (CNES[prefix]) return build('CNES', CNES[prefix]!, uf, year, month, prefix);
    }
    // SIM: DO + UF + AAAA? (4 dígitos = ano completo)
  }
  // Anuais por estado: DO/DN + UF + AAAA.
  if (digits.length === 4 && /^(DO|DN)[A-Z]{2}$/.test(letters)) {
    const uf = letters.slice(2);
    if (UF_NAMES[uf]) {
      const year = Number(digits);
      return letters.startsWith('DO')
        ? build('SIM', 'Óbitos (por residência)', uf, year)
        : build('SINASC', 'Nascidos vivos', uf, year);
    }
  }
  // SIM nacionais por tipo: DOINF + AA.
  if (digits.length === 2 && SIM_NATIONAL[letters]) return build('SIM', SIM_NATIONAL[letters]!, 'BR', fullYear(digits));
  // SINAN: AGRAVO + BR + AA (alguns agravos têm 3 letras: SRC).
  if (digits.length === 2 && letters.endsWith('BR') && SINAN[letters.slice(0, -2)]) {
    return build('SINAN', SINAN[letters.slice(0, -2)]!, 'BR', fullYear(digits));
  }
  return null;
}

/** O que é um arquivo auxiliar, pela extensão: para quem não conhece DEF, CNV, DBF. */
export function describeAuxiliaryFile(fileName: string): string | null {
  const extension = fileName.split('.').pop()?.toUpperCase();
  if (extension === 'DEF') return 'definição da tabulação: lista o que pode ir em Linhas, Colunas, Incremento e Seleções';
  if (extension === 'CNV') return 'tabela de conversão: troca o código pelo nome (1 → Masculino)';
  if (extension === 'MAP') return 'mapa do TabWin';
  return null;
}
