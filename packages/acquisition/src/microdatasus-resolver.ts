import type { DatasusRemoteFile, DatasusSearchQuery } from './datasus.js';

const FTP_ROOT = 'ftp://ftp.datasus.gov.br/dissemin/publicos';
const STATE = /^[A-Z]{2}$/;
const MONTHLY_SIH = new Set(['RD', 'RJ', 'SP', 'ER']);
const MONTHLY_SIA = new Set(['AB', 'ABO', 'ACF', 'AD', 'AN', 'AM', 'AQ', 'AR', 'ATD', 'PA', 'PS', 'SAD']);
const MONTHLY_CNES = new Set(['LT', 'ST', 'DC', 'EQ', 'SR', 'HB', 'PF', 'EP', 'RC', 'IN', 'EE', 'EF', 'GM']);
const SINAN_PREFIX: Readonly<Record<string, string>> = Object.freeze({
  DENG: 'DENGBR', CHIK: 'CHIKBR', ZIKA: 'ZIKABR', MALA: 'MALABR',
  CHAG: 'CHAGBR', LEIV: 'LEIVBR', LTAN: 'LTANBR', LEPT: 'LEPTBR',
});

function remote(query: DatasusSearchQuery, name: string, directory: string, modality: string): DatasusRemoteFile {
  return {
    source: query.system,
    modality,
    name,
    address: `${directory}${name}`,
    catalogQuery: { ...query },
    resolver: 'microdatasus-compatible',
  };
}

function validYear(value: string): number | null {
  if (!/^\d{4}$/.test(value)) return null;
  const year = Number(value);
  return year >= 1900 && year <= 2100 ? year : null;
}

function validMonth(value: string | undefined): number | null {
  if (!value || !/^\d{2}$/.test(value)) return null;
  const month = Number(value);
  return month >= 1 && month <= 12 ? month : null;
}

function monthlyName(prefix: string, uf: string, year: number, month: number): string {
  return `${prefix}${uf}${String(year).slice(-2)}${String(month).padStart(2, '0')}.DBC`;
}

/**
 * Evidence-bounded fallback derived from microdatasus' published registry.
 * Unsupported tuples return no candidate; this function never guesses paths.
 */
export function resolveMicrodatasusCompatibleCandidates(query: DatasusSearchQuery): DatasusRemoteFile[] {
  const year = validYear(query.year);
  if (year === null) return [];
  const uf = query.uf?.toUpperCase() ?? '';
  const month = validMonth(query.month);

  if (query.system === 'SIHSUS' && MONTHLY_SIH.has(query.fileType) && STATE.test(uf) && uf !== 'BR' && month !== null) {
    const value = year * 100 + month;
    if (value < 199201) return [];
    const directory = value >= 200801
      ? `${FTP_ROOT}/SIHSUS/200801_/Dados/`
      : `${FTP_ROOT}/SIHSUS/199201_200712/Dados/`;
    return [remote(query, monthlyName(query.fileType, uf, year, month), directory, value >= 200801 ? 'current' : 'old')];
  }

  if (query.system === 'SIASUS' && MONTHLY_SIA.has(query.fileType) && STATE.test(uf) && uf !== 'BR' && month !== null) {
    const value = year * 100 + month;
    if (value < 199407) return [];
    const directory = value >= 200801
      ? `${FTP_ROOT}/SIASUS/200801_/Dados/`
      : `${FTP_ROOT}/SIASUS/199407_200712/Dados/`;
    return [remote(query, monthlyName(query.fileType, uf, year, month), directory, value >= 200801 ? 'current' : 'old')];
  }

  if (query.system === 'CNES' && MONTHLY_CNES.has(query.fileType) && STATE.test(uf) && uf !== 'BR' && month !== null) {
    const value = year * 100 + month;
    if (value < 200508) return [];
    return [remote(query, monthlyName(query.fileType, uf, year, month), `${FTP_ROOT}/CNES/200508_/Dados/${query.fileType}/`, 'current')];
  }

  if (query.system === 'SIM' && query.fileType === 'DO' && STATE.test(uf) && uf !== 'BR' && year >= 1996) {
    const name = `DO${uf}${year}.DBC`;
    return [
      remote(query, name, `${FTP_ROOT}/SIM/CID10/DORES/`, 'final'),
      remote(query, name, `${FTP_ROOT}/SIM/PRELIM/DORES/`, 'preliminary'),
    ];
  }

  if (query.system === 'SIM' && ['DOFET', 'DOEXT', 'DOINF', 'DOMAT'].includes(query.fileType)
      && (uf === 'BR' || !uf) && year >= 1996) {
    const name = `${query.fileType}${String(year).slice(-2)}.DBC`;
    return [
      remote(query, name, `${FTP_ROOT}/SIM/CID10/DOFET/`, 'final'),
      remote(query, name, `${FTP_ROOT}/SIM/PRELIM/DOFET/`, 'preliminary'),
    ];
  }

  if (query.system === 'SINASC' && query.fileType === 'DN' && STATE.test(uf) && uf !== 'BR' && year >= 1994) {
    if (year <= 1995) return [remote(query, `DNR${uf}${year}.DBC`, `${FTP_ROOT}/SINASC/1994_1995/Dados/DNRES/`, 'old')];
    const name = `DN${uf}${year}.DBC`;
    return [
      remote(query, name, `${FTP_ROOT}/SINASC/1996_/Dados/DNRES/`, 'current'),
      remote(query, name, `${FTP_ROOT}/SINASC/PRELIM/DNRES/`, 'preliminary'),
    ];
  }

  const sinanPrefix = SINAN_PREFIX[query.fileType];
  if (query.system === 'SINAN' && sinanPrefix && (uf === 'BR' || !uf) && year >= 1996) {
    const name = `${sinanPrefix}${String(year).slice(-2)}.DBC`;
    return [
      remote(query, name, `${FTP_ROOT}/SINAN/DADOS/FINAIS/`, 'final'),
      remote(query, name, `${FTP_ROOT}/SINAN/DADOS/PRELIM/`, 'preliminary'),
    ];
  }

  return [];
}

/**
 * Candidatos para conferir NA LISTAGEM do FTP oficial (nunca para baixar às
 * cegas): os do registro acima e, no SINAN, qualquer agravo pelo mesmo nome
 * (`HANSBR23`, `ACBIBR24`…). Um nome que a pasta não lista não vira arquivo.
 */
export function resolveFtpListingCandidates(query: DatasusSearchQuery): DatasusRemoteFile[] {
  const conhecidos = resolveMicrodatasusCompatibleCandidates(query);
  if (conhecidos.length) return conhecidos;
  const year = validYear(query.year);
  const uf = query.uf?.toUpperCase() ?? '';
  if (query.system !== 'SINAN' || year === null || year < 1996 || !/^[A-Z]{4}$/.test(query.fileType) || (uf && uf !== 'BR')) return [];
  const name = `${query.fileType}BR${String(year).slice(-2)}.DBC`;
  return [
    remote(query, name, `${FTP_ROOT}/SINAN/DADOS/FINAIS/`, 'final'),
    remote(query, name, `${FTP_ROOT}/SINAN/DADOS/PRELIM/`, 'preliminary'),
  ];
}
