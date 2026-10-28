/**
 * O que cada campo do SIM e do SINASC significa, transcrito dos dicionários
 * oficiais do DATASUS — para o painel explicar "STDONOVA" ou "DIFDATA" a quem
 * nunca viu essas siglas, sem que ninguém precise adivinhar.
 *
 * Fontes (ftp.datasus.gov.br/dissemin/publicos):
 * - SIM: `SIM/CID10/DOCS/Estrutura_do_SIM_2025.pdf` (atualizado em 07/2025);
 * - SINASC: `SINASC/NOV/DOCS/Estrutura_SINASC_para_CD.pdf`.
 *
 * Só entra o que está escrito nesses documentos. Campo que eles não descrevem
 * (no SIM, `NUDIASOBIN`; no SINASC, os campos da DN nova, como `KOTELCHUCK`)
 * fica de fora: o painel mostra então só as categorias da CNV, que é o que se
 * sabe. Como em `datasus-field-labels.ts`, isto é apresentação: nunca muda um
 * número, um filtro ou uma exportação.
 */

import { IT_LAYOUTS, IT_SOURCES } from './datasus-dictionary-it.js';
import { sinanAgravoEntry } from './datasus-dictionary-sinan.js';

export interface DatasusFieldEntry {
  /** Nome curto, para mostrar no lugar da sigla. */
  label: string;
  /** O que o campo é, em uma ou duas frases. */
  description: string;
  /** Valores válidos, como o dicionário lista ("1 – Fetal; 2 – Não fetal"). */
  values?: string;
}

export type DatasusDictionarySystem = 'SIM' | 'SINASC' | 'SINAN';

export const DATASUS_DICTIONARY_SOURCES: Readonly<Record<DatasusDictionarySystem, string>> = Object.freeze({
  SIM: 'Estrutura do SIM, DATASUS, 07/2025',
  SINASC: 'Estrutura do SINASC, DATASUS',
  SINAN: 'Dicionário de dados SINAN NET 5.0, ficha de notificação (NINDIN), DATASUS, rev. 11/2018',
});

const SIM_ANOS_DE_ESTUDO = '1 – Nenhuma; 2 – 1 a 3 anos; 3 – 4 a 7 anos; 4 – 8 a 11 anos; 5 – 12 anos e mais; 9 – Ignorado';
const ESCOLARIDADE_2010 = '0 – Sem escolaridade; 1 – Fundamental I (1ª a 4ª série); 2 – Fundamental II (5ª a 8ª série); 3 – Médio; 4 – Superior incompleto; 5 – Superior completo; 9 – Ignorado';
const ESCOLARIDADE_AGREGADA = '00 – Sem escolaridade; 01 – Fundamental I incompleto; 02 – Fundamental I completo; 03 – Fundamental II incompleto; 04 – Fundamental II completo; 05 – Médio incompleto; 06 – Médio completo; 07 – Superior incompleto; 08 – Superior completo; 09 – Ignorado; 10 a 12 – incompleto ou inespecífico';
const SIM_NAO_IGNORADO = '1 – Sim; 2 – Não; 9 – Ignorado';
const RACA_COR = '1 – Branca; 2 – Preta; 3 – Amarela; 4 – Parda; 5 – Indígena';
const DATA = 'data no formato ddmmaaaa';

const SIM: Readonly<Record<string, DatasusFieldEntry>> = {
  TIPOBITO: { label: 'Tipo do óbito', description: 'Se o óbito é fetal (morte antes da expulsão ou extração completa do corpo da mãe) ou não fetal.', values: '1 – Fetal; 2 – Não fetal' },
  DTOBITO: { label: 'Data do óbito', description: 'Data em que ocorreu o óbito.', values: DATA },
  HORAOBITO: { label: 'Hora do óbito', description: 'Horário do óbito, no padrão de 24 horas.' },
  NATURAL: { label: 'Naturalidade', description: 'Município e UF onde o falecido nasceu; se estrangeiro, o país.' },
  CODMUNNATU: { label: 'Município de naturalidade', description: 'Código do município de naturalidade do falecido.' },
  DTNASC: { label: 'Data de nascimento', description: 'Data de nascimento do falecido. No óbito fetal, igual à data do óbito.', values: DATA },
  IDADE: { label: 'Idade', description: 'Idade do falecido em dois subcampos: o primeiro dígito é a unidade (1 = minutos, 2 = horas, 3 = meses, 4 = anos, 5 = mais de 100 anos) e os dois seguintes, a quantidade.' },
  SEXO: { label: 'Sexo', description: 'Sexo do falecido. "Ignorado" é usado em casos especiais, como cadáver em decomposição ou genitália indefinida.', values: 'M ou 1 – Masculino; F ou 2 – Feminino; I, 0 ou 9 – Ignorado' },
  RACACOR: { label: 'Raça/cor', description: 'Cor informada pelo responsável pelas informações do falecido.', values: RACA_COR },
  ESTCIV: { label: 'Situação conjugal', description: 'Situação conjugal do falecido, informada pelos familiares.', values: '1 – Solteiro; 2 – Casado; 3 – Viúvo; 4 – Separado judicialmente/divorciado; 5 – União estável; 9 – Ignorado' },
  ESC: { label: 'Escolaridade (anos)', description: 'Escolaridade do falecido em anos de estudo (formulário antigo).', values: SIM_ANOS_DE_ESTUDO },
  ESC2010: { label: 'Escolaridade 2010 (nível)', description: 'Nível da última série concluída pelo falecido (formulário a partir de 2010).', values: ESCOLARIDADE_2010 },
  SERIESCFAL: { label: 'Última série concluída', description: 'Última série escolar concluída pelo falecido (1 a 8).' },
  ESCFALAGR1: { label: 'Escolaridade agregada', description: 'Escolaridade do falecido agregada (formulário a partir de 2010).', values: ESCOLARIDADE_AGREGADA },
  OCUP: { label: 'Ocupação (CBO 2002)', description: 'Tipo de trabalho que o falecido desenvolveu na maior parte da vida produtiva, pela Classificação Brasileira de Ocupações.' },
  CODMUNRES: { label: 'Município de residência', description: 'Código do município de residência. No óbito fetal, o município de residência da mãe.' },
  LOCOCOR: { label: 'Local de ocorrência', description: 'Onde o óbito ocorreu.', values: '1 – Hospital; 2 – Outro estabelecimento de saúde; 3 – Domicílio; 4 – Via pública; 5 – Outros; 6 – Aldeia indígena; 9 – Ignorado' },
  CODESTAB: { label: 'Estabelecimento (CNES)', description: 'Código do estabelecimento de saúde no Cadastro Nacional de Estabelecimentos de Saúde.' },
  CODMUNOCOR: { label: 'Município de ocorrência', description: 'Código do município onde ocorreu o óbito.' },
  IDADEMAE: { label: 'Idade da mãe', description: 'Idade da mãe, em anos.' },
  ESCMAE: { label: 'Escolaridade da mãe (anos)', description: 'Escolaridade da mãe em anos de estudo (formulário antigo).', values: SIM_ANOS_DE_ESTUDO },
  ESCMAE2010: { label: 'Escolaridade da mãe 2010 (nível)', description: 'Nível da última série concluída pela mãe (formulário a partir de 2010).', values: ESCOLARIDADE_2010 },
  SERIESCMAE: { label: 'Última série concluída pela mãe', description: 'Última série escolar concluída pela mãe (1 a 8).' },
  ESCMAEAGR1: { label: 'Escolaridade da mãe agregada', description: 'Escolaridade da mãe agregada (formulário a partir de 2010).', values: ESCOLARIDADE_AGREGADA },
  OCUPMAE: { label: 'Ocupação da mãe (CBO 2002)', description: 'Trabalho exercido habitualmente pela mãe, pela Classificação Brasileira de Ocupações.' },
  QTDFILVIVO: { label: 'Filhos nascidos vivos', description: 'Número de filhos vivos da mãe.' },
  QTDFILMORT: { label: 'Perdas fetais/abortos', description: 'Número de filhos mortos, sem contar a criança cujo óbito está sendo notificado.' },
  SEMAGESTAC: { label: 'Semanas de gestação', description: 'Semanas de gestação, com dois algarismos.' },
  GESTACAO: { label: 'Faixa de semanas de gestação', description: 'Semanas de gestação em faixas (formulário antigo).', values: '1 – Menos de 22; 2 – 22 a 27; 3 – 28 a 31; 4 – 32 a 36; 5 – 37 a 41; 6 – 42 e mais semanas' },
  GRAVIDEZ: { label: 'Tipo de gravidez', description: 'Se a gravidez foi única ou múltipla.', values: '1 – Única; 2 – Dupla; 3 – Tripla e mais; 9 – Ignorada' },
  PARTO: { label: 'Tipo de parto', description: 'Tipo de parto.', values: '1 – Vaginal; 2 – Cesáreo; 9 – Ignorado' },
  OBITOPARTO: { label: 'Morte em relação ao parto', description: 'Momento do óbito em relação ao parto.', values: '1 – Antes; 2 – Durante; 3 – Depois; 9 – Ignorado' },
  MORTEPARTO: { label: 'Morte em relação ao parto (após investigação)', description: 'Momento do óbito em relação ao parto, depois da investigação.', values: '1 – Antes; 2 – Durante; 3 – Após; 9 – Ignorado' },
  PESO: { label: 'Peso ao nascer', description: 'Peso ao nascer, em gramas.' },
  TPMORTEOCO: { label: 'Quando a morte ocorreu (mulher em idade fértil)', description: 'Situação gestacional ou pós-gestacional em que ocorreu o óbito.', values: '1 – Na gravidez; 2 – No parto; 3 – No abortamento; 4 – Até 42 dias após o parto; 5 – De 43 dias a 1 ano após; 8 – Não ocorreu nesses períodos; 9 – Ignorado' },
  OBITOGRAV: { label: 'Óbito na gravidez', description: 'Se o óbito ocorreu na gravidez.', values: SIM_NAO_IGNORADO },
  OBITOPUERP: { label: 'Óbito no puerpério', description: 'Se o óbito ocorreu no puerpério.', values: '1 – Sim, até 42 dias após o parto; 2 – Sim, de 43 dias a 1 ano; 3 – Não; 9 – Ignorado' },
  TPOBITOCOR: { label: 'Momento do óbito (investigação)', description: 'Momento do óbito apontado pela investigação; em branco, não investigado.', values: '1 – Na gestação; 2 – No abortamento; 3 – Após o abortamento; 4 – No parto ou até 1 hora após; 5 – No puerpério (até 42 dias); 6 – De 43 dias a 1 ano após o parto; 7 – Investigação não identificou; 8 – Mais de um ano após o parto; 9 – Nenhuma dessas' },
  ASSISTMED: { label: 'Recebeu assistência médica', description: 'Se o paciente recebeu atendimento médico continuado durante a doença que causou a morte.', values: SIM_NAO_IGNORADO },
  EXAME: { label: 'Exame', description: 'Se foi realizado exame.', values: SIM_NAO_IGNORADO },
  CIRURGIA: { label: 'Cirurgia', description: 'Se foi realizada cirurgia.', values: SIM_NAO_IGNORADO },
  NECROPSIA: { label: 'Necropsia', description: 'Se foi feita necropsia para confirmar o diagnóstico.', values: SIM_NAO_IGNORADO },
  LINHAA: { label: 'Causa — linha A', description: 'CIDs da linha A da DO: a causa terminal, doença ou estado que causou diretamente a morte.' },
  LINHAB: { label: 'Causa — linha B', description: 'CIDs da linha B da DO: causa antecedente, que produziu a causa da linha A.' },
  LINHAC: { label: 'Causa — linha C', description: 'CIDs da linha C da DO: causa antecedente, que produziu a causa da linha B.' },
  LINHAD: { label: 'Causa — linha D', description: 'CIDs da linha D da DO: causa básica, o estado mórbido que produziu a causa direta da morte registrada na linha A.' },
  LINHAII: { label: 'Causa — parte II', description: 'CIDs informados na parte II da DO.' },
  CAUSABAS: { label: 'Causa básica (CID-10)', description: 'Causa básica do óbito, em CID-10.' },
  CAUSABAS_O: { label: 'Causa básica original', description: 'Causa básica informada antes da resseleção.' },
  CAUSAMAT: { label: 'Causa externa associada à materna', description: 'CID da causa externa associada a uma causa materna.' },
  ATESTANTE: { label: 'Médico atestante', description: 'Condição do médico que atestou o óbito.', values: '1 – Assistente; 2 – Substituto; 3 – IML; 4 – SVO; 5 – Outro' },
  COMUNSVOIM: { label: 'Município do SVO/IML', description: 'Código do município do SVO ou do IML, quando o óbito foi atestado por um deles.' },
  DTATESTADO: { label: 'Data do atestado', description: 'Data em que o atestado foi assinado.', values: DATA },
  CIRCOBITO: { label: 'Tipo de morte violenta', description: 'Circunstância da morte não natural.', values: '1 – Acidente; 2 – Suicídio; 3 – Homicídio; 4 – Outros; 9 – Ignorado' },
  ACIDTRAB: { label: 'Acidente de trabalho', description: 'Se o evento que causou o óbito está relacionado ao trabalho.', values: SIM_NAO_IGNORADO },
  FONTE: { label: 'Fonte da informação', description: 'Fonte usada para preencher o tipo de morte violenta e o acidente de trabalho.', values: '1 – Ocorrência policial; 2 – Hospital; 3 – Família; 4 – Outra; 9 – Ignorado' },
  ORIGEM: { label: 'Origem do registro', description: 'De que banco de dados o registro veio.', values: '1 – Oracle; 2 – Banco estadual via FTP; 3 – Banco SEADE; 9 – Ignorado' },
  NUMEROLOTE: { label: 'Número do lote', description: 'Número do lote de digitação.' },
  DTINVESTIG: { label: 'Data da investigação', description: 'Data da investigação do óbito.', values: DATA },
  DTCADASTRO: { label: 'Data do cadastro', description: 'Data do cadastro do óbito no sistema.', values: DATA },
  DTRECEBIM: { label: 'Data do recebimento', description: 'Data do recebimento da DO.', values: DATA },
  DTRECORIGA: { label: 'Data do recebimento original', description: 'Data do recebimento original, criada no tratamento dos dados.', values: DATA },
  STCODIFICA: { label: 'Instalação codificadora', description: 'Se a instalação é codificadora (S) ou não (N).' },
  CODIFICADO: { label: 'Formulário codificado', description: 'Se o formulário foi codificado (S) ou não (N).' },
  VERSAOSIST: { label: 'Versão do sistema', description: 'Versão do sistema que gerou o registro.' },
  VERSAOSCB: { label: 'Versão do seletor de causa básica', description: 'Versão do programa que seleciona a causa básica.' },
  FONTEINV: { label: 'Fonte da investigação', description: 'Fonte usada na investigação do óbito.', values: '1 – Comitê de morte materna e/ou infantil; 2 – Visita domiciliar/entrevista com a família; 3 – Estabelecimento de saúde/prontuário; 4 – Outros bancos de dados; 5 – SVO; 6 – IML; 7 – Outra; 8 – Múltiplas fontes; 9 – Ignorado' },
  FONTES: { label: 'Fontes da investigação (combinado)', description: 'Combinação das fontes da investigação (entrevista, ambulatório, prontuário, SVO, IML, profissional): S onde a fonte foi usada, X onde não.' },
  ATESTADO: { label: 'CIDs do atestado', description: 'CIDs informados no atestado.' },
  OPOR_DO: { label: 'Oportunidade da DO', description: 'Campo criado no tratamento dos dados para calcular oportunidades.' },
  STDOEPIDEM: { label: 'DO epidemiológica', description: 'Se a declaração de óbito é epidemiológica.', values: '1 – Sim; 0 – Não' },
  STDONOVA: { label: 'DO nova', description: 'Se a declaração de óbito é do modelo novo.', values: '1 – Sim; 0 – Não' },
  DIFDATA: { label: 'Dias até o recebimento', description: 'Diferença, em dias, entre a data do óbito e a data do recebimento original da DO.' },
  NUDIASOBCO: { label: 'Dias até a conclusão da investigação', description: 'Diferença, em dias, entre a data do óbito e a conclusão da investigação.' },
  DTCADINV: { label: 'Data do cadastro da investigação', description: 'Data do cadastro da investigação.', values: DATA },
  DTCONINV: { label: 'Data da conclusão da investigação', description: 'Data da conclusão da investigação.', values: DATA },
  DTCADINF: { label: 'Investigação realizada', description: 'Quando preenchido, indica que a investigação foi realizada.', values: DATA },
  DTCONCASO: { label: 'Data de conclusão do caso', description: 'Data de conclusão do caso.', values: DATA },
  TPRESGINFO: { label: 'Resgate de informação', description: 'Se a investigação trouxe uma causa de óbito não informada ou corrigiu uma informada.', values: '01 – Não acrescentou nem corrigiu; 02 – Sim, resgatou novas informações; 03 – Sim, corrigiu alguma causa informada' },
  TPNIVELINV: { label: 'Nível investigador', description: 'Nível que fez a investigação.', values: 'E – Estadual; R – Regional; M – Municipal' },
  ALTCAUSA: { label: 'Alterou a causa após investigação', description: 'Se a causa do óbito foi corrigida ou alterada depois da investigação.', values: '1 – Sim; 2 – Não' },
  TPPOS: { label: 'Óbito investigado', description: 'Se o óbito foi investigado.', values: '1 – Sim; 2 – Não' },
  TP_ALTERA: { label: 'Motivo de alteração da causa', description: 'Tipo de crítica que levou à alteração da causa básica (em branco, ausência do 4º caractere, causa asterisco, inválida para o sexo, implausível…).' },
  CB_ALT: { label: 'Variável de sistema', description: 'Variável de uso interno do sistema.' },
};

const SINASC: Readonly<Record<string, DatasusFieldEntry>> = {
  NUMERODN: { label: 'Número da DN', description: 'Número da declaração de nascido vivo, sequencial por UF informante e por ano.' },
  LOCNASC: { label: 'Local do nascimento', description: 'Onde o nascimento ocorreu.', values: '1 – Hospital; 2 – Outro estabelecimento de saúde; 3 – Domicílio; 4 – Outros; 9 – Ignorado' },
  CODESTAB: { label: 'Estabelecimento (CNES)', description: 'Código do estabelecimento de saúde.' },
  CODBAINASC: { label: 'Bairro do nascimento', description: 'Código do bairro do nascimento.' },
  CODMUNNASC: { label: 'Município do nascimento', description: 'Código do município de ocorrência do nascimento.' },
  IDADEMAE: { label: 'Idade da mãe', description: 'Idade da mãe, em anos.' },
  ESTCIVMAE: { label: 'Estado civil da mãe', description: 'Estado civil da mãe.', values: '1 – Solteira; 2 – Casada; 3 – Viúva; 4 – Separada judicialmente/divorciada; 9 – Ignorado' },
  ESCMAE: { label: 'Escolaridade da mãe (anos)', description: 'Anos de estudo concluídos pela mãe.', values: '1 – Nenhuma; 2 – 1 a 3 anos; 3 – 4 a 7 anos; 4 – 8 a 11 anos; 5 – 12 e mais; 9 – Ignorado' },
  CODOCUPMAE: { label: 'Ocupação da mãe (CBO 2002)', description: 'Ocupação da mãe, pela Classificação Brasileira de Ocupações.' },
  QTDFILVIVO: { label: 'Filhos vivos', description: 'Número de filhos vivos.' },
  QTDFILMORT: { label: 'Filhos mortos', description: 'Número de filhos mortos.' },
  CODBAIRES: { label: 'Bairro de residência', description: 'Código do bairro de residência.' },
  CODMUNRES: { label: 'Município de residência da mãe', description: 'Código do município de residência da mãe.' },
  GESTACAO: { label: 'Semanas de gestação (faixa)', description: 'Semanas de gestação, em faixas.', values: '1 – Menos de 22; 2 – 22 a 27; 3 – 28 a 31; 4 – 32 a 36; 5 – 37 a 41; 6 – 42 e mais semanas; 9 – Ignorado' },
  GRAVIDEZ: { label: 'Tipo de gravidez', description: 'Se a gravidez foi única ou múltipla.', values: '1 – Única; 2 – Dupla; 3 – Tripla e mais; 9 – Ignorado' },
  PARTO: { label: 'Tipo de parto', description: 'Tipo de parto.', values: '1 – Vaginal; 2 – Cesáreo; 9 – Ignorado' },
  CONSULTAS: { label: 'Consultas de pré-natal', description: 'Número de consultas de pré-natal, em faixas.', values: '1 – Nenhuma; 2 – 1 a 3; 3 – 4 a 6; 4 – 7 e mais; 9 – Ignorado' },
  DTNASC: { label: 'Data do nascimento', description: 'Data do nascimento.', values: DATA },
  HORANASC: { label: 'Hora do nascimento', description: 'Hora do nascimento.' },
  SEXO: { label: 'Sexo', description: 'Sexo do recém-nascido.', values: '0 – Ignorado; 1 – Masculino; 2 – Feminino' },
  APGAR1: { label: 'Apgar no 1º minuto', description: 'Índice de Apgar no primeiro minuto de vida (0 a 10).' },
  APGAR5: { label: 'Apgar no 5º minuto', description: 'Índice de Apgar no quinto minuto de vida (0 a 10).' },
  RACACOR: { label: 'Raça/cor', description: 'Raça/cor do recém-nascido.', values: RACA_COR },
  PESO: { label: 'Peso ao nascer', description: 'Peso ao nascer, em gramas.' },
  IDANOMAL: { label: 'Anomalia congênita', description: 'Se foi detectada anomalia congênita.', values: '1 – Sim; 2 – Não; 9 – Ignorado' },
  CODANOMAL: { label: 'Código da anomalia (CID-10)', description: 'Código da malformação congênita ou anomalia cromossômica, pela CID-10.' },
  DTCADASTRO: { label: 'Data do cadastro', description: 'Data de cadastramento no sistema.', values: DATA },
  DTRECEBIM: { label: 'Data do recebimento', description: 'Data de recebimento no nível central (última atualização do registro).', values: DATA },
  CODINST: { label: 'Instalação', description: 'Código da instalação que gerou o registro.' },
  UFINFORM: { label: 'UF informante', description: 'Código da UF que informou o registro.' },
};

/**
 * SINAN: os campos da ficha de notificação, comuns a todos os agravos
 * (NINDIN_DIC_DADOS.pdf, Dicionário de dados SINAN NET 5.0, revisado em
 * novembro/2018, em Docs_TAB_SINAN.zip). Os campos de cada agravo estão em
 * `datasus-dictionary-sinan.ts` (os mais consultados) ou no PDF do agravo.
 */
const SINAN_DATA_TRANSF = (nivel: string): DatasusFieldEntry => ({
  label: `Data de transferência (${nivel})`,
  description: `Data de transferência do registro ${nivel} para o nível superior do sistema.`,
  values: DATA,
});
const SINAN: Readonly<Record<string, DatasusFieldEntry>> = {
  NU_NOTIFIC: { label: 'Nº da notificação', description: 'Número da notificação. Campo chave para identificação do registro no sistema.' },
  TP_NOT: { label: 'Tipo de notificação', description: 'Identifica o tipo da notificação.', values: '1 – Negativa; 2 – Individual; 3 – Surto; 4 – Agregado' },
  ID_AGRAVO: { label: 'Agravo', description: 'Nome e código do agravo notificado, segundo a CID-10 (ao exportar, é retirado o ponto).' },
  CS_SUSPEIT: { label: 'Suspeita do agravo', description: 'Especifica a suspeição do agravo (sarampo, rubéola, doenças meningocócicas, outras meningites) e identifica se a notificação de AIDS é de adulto ou criança.' },
  DT_NOTIFIC: { label: 'Data da notificação', description: 'Data de preenchimento da ficha de notificação.', values: 'dd/mm/aaaa' },
  SEM_NOT: { label: 'Semana epidemiológica da notificação', description: 'Semana epidemiológica em que o caso foi notificado, preenchida automaticamente a partir da data de notificação (AAAASS).' },
  NU_ANO: { label: 'Ano da notificação', description: 'Ano da notificação, preenchido pelo sistema a partir da data de notificação.' },
  SG_UF_NOT: { label: 'UF de notificação', description: 'UF onde está a unidade de saúde (ou outra fonte notificadora) que fez a notificação.' },
  ID_MUNICIP: { label: 'Município de notificação', description: 'Código do município onde está a unidade de saúde (ou outra fonte notificadora) que fez a notificação.' },
  ID_REGIONA: { label: 'Regional de saúde de notificação', description: 'Regional de saúde onde está o município da unidade notificadora.' },
  ID_UNIDADE: { label: 'Unidade de saúde notificadora', description: 'Código (CNES) da unidade de saúde ou outra fonte notificadora que fez o atendimento e a notificação.' },
  DT_SIN_PRI: { label: 'Data dos primeiros sintomas/diagnóstico', description: 'Data dos primeiros sintomas do caso de agravo agudo; data do diagnóstico do caso de agravo crônico e DRTs; data do acidente nos acidentes da saúde do trabalhador.', values: 'dd/mm/aaaa' },
  SEM_PRI: { label: 'Semana epidemiológica dos primeiros sintomas', description: 'Semana epidemiológica dos primeiros sintomas/diagnóstico, preenchida automaticamente (AAAASS).' },
  NM_PACIENT: { label: 'Nome do paciente', description: 'Nome completo do paciente (sem abreviações).' },
  DT_NASC: { label: 'Data de nascimento', description: 'Data de nascimento do paciente.', values: 'dd/mm/aaaa' },
  NU_IDADE_N: { label: 'Idade', description: 'Idade em quatro dígitos: o primeiro é a unidade (1 = hora, 2 = dia, 3 = mês, 4 = ano) e os três seguintes, a quantidade. Ex.: 3009 = nove meses; 4018 = dezoito anos.' },
  CS_SEXO: { label: 'Sexo', description: 'Sexo do paciente.', values: 'M – Masculino; F – Feminino; I – Ignorado' },
  CS_GESTANT: { label: 'Gestante', description: 'Idade gestacional da paciente.', values: '1 – 1º trimestre; 2 – 2º trimestre; 3 – 3º trimestre; 4 – Idade gestacional ignorada; 5 – Não; 6 – Não se aplica; 9 – Ignorado' },
  CS_RACA: { label: 'Raça/cor', description: 'Cor ou raça declarada pela pessoa.', values: '1 – Branca; 2 – Preta; 3 – Amarela; 4 – Parda; 5 – Indígena; 9 – Ignorado' },
  CS_ESCOL_N: { label: 'Escolaridade', description: 'Série e grau que a pessoa está frequentando ou frequentou, considerando a última série concluída com aprovação.', values: '0 – Analfabeto; 1 – 1ª a 4ª série incompleta do EF; 2 – 4ª série completa do EF; 3 – 5ª à 8ª série incompleta do EF; 4 – Ensino fundamental completo; 5 – Ensino médio incompleto; 6 – Ensino médio completo; 7 – Educação superior incompleta; 8 – Educação superior completa; 9 – Ignorado; 10 – Não se aplica' },
  ID_CNS_SUS: { label: 'Cartão SUS', description: 'Número do Cartão Nacional de Saúde do paciente.' },
  NM_MAE_PAC: { label: 'Nome da mãe', description: 'Nome completo da mãe do paciente (sem abreviações).' },
  SG_UF: { label: 'UF de residência', description: 'UF de residência do paciente por ocasião da notificação.' },
  ID_MN_RESI: { label: 'Município de residência', description: 'Código do município de residência do caso notificado.' },
  ID_RG_RESI: { label: 'Regional de saúde de residência', description: 'Regional de saúde onde está o município de residência do paciente por ocasião da notificação.' },
  ID_DISTRIT: { label: 'Distrito de residência', description: 'Código do distrito de residência do paciente por ocasião da notificação.' },
  ID_BAIRRO: { label: 'Bairro de residência (código)', description: 'Código do bairro de residência do paciente por ocasião da notificação.' },
  NM_BAIRRO: { label: 'Bairro de residência', description: 'Nome do bairro de residência.' },
  ID_LOGRADO: { label: 'Logradouro (código)', description: 'Código do logradouro de residência do paciente.' },
  NM_LOGRADO: { label: 'Logradouro', description: 'Tipo e nome do logradouro de residência do paciente.' },
  NU_NUMERO: { label: 'Número do logradouro', description: 'Número da casa ou do edifício de residência do paciente.' },
  NM_COMPLEM: { label: 'Complemento', description: 'Complemento do logradouro (bloco, apartamento, casa…).' },
  ID_GEO1: { label: 'Geo campo 1', description: 'Campo para georreferenciamento.' },
  ID_GEO2: { label: 'Geo campo 2', description: 'Campo para georreferenciamento.' },
  NM_REFEREN: { label: 'Ponto de referência', description: 'Ponto de referência para facilitar a localização da residência do paciente.' },
  NU_CEP: { label: 'CEP de residência', description: 'CEP de residência do paciente.' },
  NU_DDD_TEL: { label: 'DDD', description: 'Código DDD do telefone de residência do paciente.' },
  NU_TELEFON: { label: 'Telefone', description: 'Telefone de residência do paciente.' },
  CS_ZONA: { label: 'Zona de residência', description: 'Zona de residência do paciente por ocasião da notificação.', values: '1 – Urbana; 2 – Rural; 3 – Periurbana; 9 – Ignorado' },
  ID_PAIS: { label: 'País de residência', description: 'País onde residia o paciente por ocasião da notificação.' },
  NDUPLIC_N: { label: 'Duplicidade', description: 'Identifica duplicidade: marcação feita na rotina de duplicidade para registros que não devem ser listados ou contados.', values: '0 ou branco – Não identificado; 1 – Não é duplicidade (não listar); 2 – Duplicidade (não contar)' },
  IN_VINCULA: { label: 'Vinculação', description: 'Indica se a notificação foi vinculada (hanseníase ou tuberculose).', values: '0 ou branco – Não vinculado; 1 – Vinculado' },
  DT_INVEST: { label: 'Data da investigação', description: 'Data de início da investigação do caso.', values: 'dd/mm/aaaa' },
  CLASSI_FIN: { label: 'Classificação final', description: 'Classificação final do caso após investigação.' },
  CRITERIO: { label: 'Critério de confirmação/descarte', description: 'Critério utilizado para confirmação ou descarte do caso notificado.' },
  TPAUTOCTO: { label: 'Caso autóctone do município de residência', description: 'Indica se o caso é autóctone do município de residência.', values: '1 – Sim; 2 – Não; 3 – Indeterminado' },
  COUFINF: { label: 'UF provável da infecção', description: 'UF onde o paciente foi provavelmente infectado.' },
  COPAISINF: { label: 'País provável da infecção', description: 'País onde o paciente foi provavelmente infectado.' },
  COMUNINF: { label: 'Município provável da infecção', description: 'Código do município onde o paciente foi provavelmente infectado.' },
  CODISINF: { label: 'Distrito provável da infecção', description: 'Código do distrito provável de infecção do caso.' },
  CO_BAINFC: { label: 'Bairro provável da infecção (código)', description: 'Código do bairro provável de infecção do caso.' },
  NOBAIINF: { label: 'Bairro provável da infecção', description: 'Nome do bairro provável de infecção do caso.' },
  DOENCA_TRA: { label: 'Doença relacionada ao trabalho', description: 'Indica se a doença está ou não relacionada ao trabalho.', values: '1 – Sim; 2 – Não; 9 – Ignorado' },
  EVOLUCAO: { label: 'Evolução do caso', description: 'Evolução do caso.' },
  DT_OBITO: { label: 'Data do óbito', description: 'Data do óbito.', values: 'dd/mm/aaaa' },
  DT_ENCERRA: { label: 'Data do encerramento', description: 'Data do encerramento do caso.', values: 'dd/mm/aaaa' },
  FONETICA_N: { label: 'Chave fonética', description: 'Primeiro e último nomes do paciente concatenados (campo interno).' },
  SOUNDEX: { label: 'Soundex', description: 'Nome do paciente criptografado pelo método Soundex (campo interno).' },
  DT_DIGITA: { label: 'Data de digitação', description: 'Data da primeira inclusão da notificação no sistema.', values: 'dd/mm/aaaa' },
  DT_TRANSUS: SINAN_DATA_TRANSF('da unidade de saúde'),
  DT_TRANSDM: SINAN_DATA_TRANSF('do distrito municipal'),
  DT_TRANSSM: SINAN_DATA_TRANSF('da secretaria municipal de saúde'),
  DT_TRANSRM: SINAN_DATA_TRANSF('da regional municipal'),
  DT_TRANSRS: SINAN_DATA_TRANSF('da regional de saúde'),
  DT_TRANSSE: SINAN_DATA_TRANSF('da secretaria estadual de saúde'),
  NU_LOTE_V: { label: 'Lote vertical', description: 'Identifica o lote da transferência da notificação de um nível do sistema para outro (transferência vertical).' },
  NU_LOTE_H: { label: 'Lote horizontal', description: 'Identifica o lote da transferência de registros dentro de um mesmo nível do sistema (transferência horizontal).' },
  CS_FLXRET: { label: 'Fluxo de retorno', description: 'Identifica se o registro está habilitado ou foi enviado pelo fluxo de retorno para o município de residência.', values: '0 – Não habilitado; 1 – Habilitado para envio; 2 – Enviado' },
  FLXRECEBI: { label: 'Recebida por fluxo de retorno', description: 'Identifica se o registro foi recebido pelo fluxo de retorno (campo interno).' },
  IDENT_MICR: { label: 'Identificação do micro', description: 'Identifica em qual microcomputador o registro foi digitado na primeira vez (campo interno).' },
};

const DICTIONARIES: Readonly<Record<DatasusDictionarySystem, Readonly<Record<string, DatasusFieldEntry>>>> = { SIM, SINASC, SINAN };

/**
 * O que o dicionário oficial diz de um campo. Com o sistema (do nome do
 * arquivo: `DOINF23.dbc` é SIM), usa o dicionário dele — `SEXO` tem códigos
 * diferentes no SIM e no SINASC. Sem o sistema, só responde se os dois
 * dicionários não discordam. No SINAN, o prefixo (HANS, DENG…) escolhe o
 * dicionário do agravo, e a ficha de notificação cobre o resto.
 */
export function datasusFieldEntry(
  fieldName: string,
  system?: string,
  prefix?: string,
): { entry: DatasusFieldEntry; source: string } | undefined {
  const field = fieldName.trim().toUpperCase();
  if (system && IT_LAYOUTS[system]) return entradaDoInforme(field, system, prefix);
  if (system === 'SINAN') {
    // O dicionário do agravo vem antes: a ficha tem campos com o mesmo
    // nome e menos detalhe (CLASSI_FIN, sem os códigos de cada agravo).
    const doAgravo = sinanAgravoEntry(prefix, field);
    if (doAgravo) return doAgravo;
  }
  if (system === 'SIM' || system === 'SINASC' || system === 'SINAN') {
    const entry = DICTIONARIES[system][field];
    return entry ? { entry, source: DATASUS_DICTIONARY_SOURCES[system] } : undefined;
  }
  const sim = SIM[field];
  const sinasc = SINASC[field];
  if (sim && sinasc && (sim.values ?? '') !== (sinasc.values ?? '')) return undefined;
  if (sim) return { entry: sim, source: DATASUS_DICTIONARY_SOURCES.SIM };
  if (sinasc) return { entry: sinasc, source: DATASUS_DICTIONARY_SOURCES.SINASC };
  return undefined;
}

/**
 * SIH, SIA e CNES: o layout do arquivo no Informe Técnico (gerado em
 * `datasus-dictionary-it.ts`). Com o prefixo (RD, PA, ST…), o layout daquele
 * arquivo; sem ele, só responde se todos os layouts do sistema concordam.
 */
function entradaDoInforme(field: string, system: string, prefix?: string): { entry: DatasusFieldEntry; source: string } | undefined {
  const layouts = IT_LAYOUTS[system]!;
  let descricao = prefix ? layouts[prefix.toUpperCase()]?.[field] : undefined;
  if (descricao === undefined && !(prefix && layouts[prefix.toUpperCase()])) {
    const todas = new Set(Object.values(layouts).map((campos) => campos[field]).filter((valor): valor is string => Boolean(valor)));
    if (todas.size === 1) descricao = [...todas][0];
  }
  if (!descricao) return undefined;
  return { entry: entradaDeDescricao(descricao), source: IT_SOURCES[system] ?? system };
}

/** "Órgão expedidor do alvará, onde: 1-SES 2-SMS" → nome curto, descrição e valores. */
function entradaDeDescricao(descricao: string): DatasusFieldEntry {
  // Valores depois de "onde:" ou de dois-pontos seguidos de códigos ("0 = não aprovado; 5 = …").
  const valores = /,?\s*onde:\s*(.+)$/i.exec(descricao)?.[1]
    ?? /:\s*((?:\w{1,3}\s*[-=–]\s*\S.*))$/.exec(descricao)?.[1];
  let label = (valores ? descricao.slice(0, descricao.lastIndexOf(valores)) : descricao)
    .replace(/,?\s*onde:\s*$/i, '').replace(/:\s*$/, '')
    .split(/\.\s/)[0]!.replace(/\.$/, '')
    .replace(/,?\s*no formato\s+\S+$/i, '').trim();
  if (label.length > 70) label = `${label.slice(0, 67).replace(/\s+\S*$/, '')}…`;
  return { label, description: descricao, ...(valores ? { values: valores } : {}) };
}

/** Quantos campos cada dicionário cobre, para a interface dizer o alcance. */
export function datasusDictionaryCount(system: DatasusDictionarySystem): number {
  return Object.keys(DICTIONARIES[system]).length;
}

/**
 * Os valores de um campo como o dicionário lista, código → significado:
 * "1 – Cutânea; 2 – Mucosa" → 1 = Cutânea. Aceita "M ou 1 – Masculino" e
 * "I, 0 ou 9 – Ignorado" (vários códigos, o mesmo significado) e o "=" dos
 * Informes Técnicos. O que não tem código (dd/mm/aaaa, texto livre) fica de fora.
 */
export function valoresDoDicionario(valores: string | undefined): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const parte of (valores ?? '').split(';')) {
    const achado = /^\s*(.+?)\s+[–=-]\s+(.+?)\s*$/.exec(parte);
    if (!achado) continue;
    const codigos = achado[1]!.split(/\s*,\s*|\s+ou\s+/);
    if (!codigos.every((codigo) => /^[0-9A-Za-z]{1,4}$/.test(codigo))) continue;
    for (const codigo of codigos) if (!mapa.has(codigo)) mapa.set(codigo, achado[2]!);
  }
  return mapa;
}
