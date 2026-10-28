/**
 * Campos próprios de cada agravo do SINAN, transcritos à mão dos dicionários
 * de dados oficiais (Docs_TAB_SINAN.zip, pasta Documentação/AGRAVOS; SINAN NET
 * 5.0). Os campos da ficha de notificação, comuns a todos, estão em
 * `datasus-field-dictionary.ts`.
 *
 * Só os agravos mais consultados, transcritos e revisados um a um: a extração
 * automática dos 50 PDFs não foi confiável (as colunas se alinham de jeitos
 * diferentes). Os outros agravos têm o PDF oficial com um toque no app.
 *
 * Chave: prefixo do arquivo (HANS em HANSBR23.dbc) → nome do campo no DBF.
 */

import type { DatasusFieldEntry } from './datasus-field-dictionary.js';

const SIM_NAO_IGN = '1 – Sim; 2 – Não; 9 – Ignorado';
const DATA = 'dd/mm/aaaa';

/** Campos da tela de acompanhamento, iguais na hanseníase e na tuberculose. */
const ACOMPANHAMENTO: Readonly<Record<string, DatasusFieldEntry>> = {
  UFATUAL: { label: 'UF de atendimento atual', description: 'Sigla da UF onde está a unidade de saúde responsável pelo tratamento atual do paciente.' },
  ID_MUNI_AT: { label: 'Município de atendimento atual', description: 'Código e nome do município onde está a unidade de saúde responsável pelo tratamento atual do paciente.' },
  NU_NOT_AT: { label: 'Número de notificação atual', description: 'Número da ficha de notificação/investigação enviada pela unidade de saúde atualmente responsável pelo paciente.' },
  DT_NOTI_AT: { label: 'Data de notificação atual', description: 'Data de notificação do caso pela unidade de saúde responsável pelo tratamento atual.', values: DATA },
  ID_UNID_AT: { label: 'Unidade de atendimento atual', description: 'Nome e código (CNES) da unidade de saúde responsável pelo tratamento atual do paciente.' },
  UFRESAT: { label: 'UF de residência atual', description: 'Sigla da UF de residência atual do paciente.' },
  MUNIRESAT: { label: 'Município de residência atual', description: 'Código IBGE do município de residência atual do paciente.' },
  DISTRIT_AT: { label: 'Distrito de residência atual', description: 'Código do distrito de residência atual do paciente, segundo o cadastro do Sinan.' },
  BAIRROAT: { label: 'Bairro de residência atual (código)', description: 'Código do bairro de residência atual do paciente, segundo o cadastro do Sinan.' },
  NOBAIRROAT: { label: 'Bairro de residência atual', description: 'Nome do bairro de residência atual do paciente.' },
  DTULTCOMP: { label: 'Data do último comparecimento', description: 'Data do último comparecimento do paciente à unidade de saúde ou atendimento por agente de saúde.', values: DATA },
  NU_LOTE_IA: { label: 'Lote da transferência do acompanhamento', description: 'Identifica o lote da transferência da investigação e do acompanhamento de um nível do sistema para outro (transferência vertical).' },
};

const HANS: Readonly<Record<string, DatasusFieldEntry>> = {
  ...ACOMPANHAMENTO,
  NU_PRONTUA: { label: 'Nº de prontuário', description: 'Identificador do prontuário na unidade de saúde.' },
  ID_OCUPA_N: { label: 'Ocupação', description: 'Atividade exercida pelo paciente (setor formal, informal ou autônomo) ou a última, se desempregado, pela Classificação Brasileira de Ocupações (CBO).' },
  NU_LESOES: { label: 'Nº de lesões cutâneas', description: 'Número de lesões dermatológicas apresentadas pelo paciente por ocasião do diagnóstico.' },
  FORMACLINI: { label: 'Forma clínica', description: 'Forma clínica inicial por ocasião do diagnóstico, segundo a classificação de Madri.', values: '1 – I (Indeterminada); 2 – T (Tuberculóide); 3 – D (Dimorfa); 4 – V (Virchowiana); 5 – Não classificado' },
  CLASSOPERA: { label: 'Classificação operacional', description: 'Classificação operacional por ocasião do diagnóstico, para escolha do esquema terapêutico.', values: '1 – PB (Paucibacilar); 2 – MB (Multibacilar)' },
  NERVOSAFET: { label: 'Nº de nervos afetados', description: 'Número de nervos afetados.' },
  AVALIA_N: { label: 'Grau de incapacidade física no diagnóstico', description: 'Avaliação do grau de incapacidade física por ocasião do diagnóstico.', values: '0 – Grau zero; 1 – Grau I; 2 – Grau II; 3 – Não avaliado' },
  MODOENTR: { label: 'Modo de entrada', description: 'Modo de entrada do paciente no sistema.', values: '1 – Caso novo; 2 – Transferência do mesmo município (outra unidade); 3 – Transferência de outro município (mesma UF); 4 – Transferência de outro estado; 5 – Transferência de outro país; 6 – Recidiva; 7 – Outros reingressos; 9 – Ignorado' },
  MODODETECT: { label: 'Modo de detecção do caso novo', description: 'Modo de detecção do caso novo.', values: '1 – Encaminhamento; 2 – Demanda espontânea; 3 – Exame de coletividade; 4 – Exame de contatos; 5 – Outros modos; 9 – Ignorado' },
  BACILOSCOP: { label: 'Baciloscopia', description: 'Resultado da baciloscopia.', values: '1 – Positiva; 2 – Negativa; 3 – Não realizada; 9 – Ignorado' },
  DTINICTRAT: { label: 'Data do início do tratamento', description: 'Data do início do tratamento.', values: DATA },
  ESQ_INI_N: { label: 'Esquema terapêutico inicial', description: 'Esquema terapêutico instituído por ocasião do diagnóstico.', values: '1 – PQT/PB/6 doses; 2 – PQT/MB/12 doses; 3 – Outros esquemas substitutos' },
  CONTREG: { label: 'Nº de contatos registrados', description: 'Número de pessoas que residem ou residiram com o doente nos últimos 5 anos, a contar da data do diagnóstico.' },
  MIGRADO_W: { label: 'Migrado do Sinan Windows', description: 'Identifica se o registro veio da rotina de migração da base Windows (campo interno).' },
  CLASSATUAL: { label: 'Classificação operacional atual', description: 'Classificação operacional do caso para escolha do esquema terapêutico adequado (acompanhamento).', values: '1 – PB (Paucibacilar); 2 – MB (Multibacilar)' },
  AVAL_ATU_N: { label: 'Incapacidade física na cura', description: 'Avaliação do grau de incapacidade física no momento da cura.', values: '0 – Grau zero; 1 – Grau I; 2 – Grau II; 3 – Não avaliado; 9 – Ignorado' },
  ESQ_ATU_N: { label: 'Esquema terapêutico atual', description: 'Esquema terapêutico em uso.', values: '1 – PQT/PB/6 doses; 2 – PQT/MB/12 doses; 3 – Outros esquemas substitutivos' },
  DOSE_RECEB: { label: 'Nº de doses supervisionadas', description: 'Número de doses recebidas sob supervisão.' },
  EPIS_RACIO: { label: 'Episódio reacional durante o tratamento', description: 'Tipo de reação apresentada pelo paciente durante o tratamento da hanseníase.', values: '1 – Reação tipo 1; 2 – Reação tipo 2; 3 – Reação tipo 1 e 2' },
  DTMUDESQ: { label: 'Data de mudança do esquema', description: 'Data de mudança do esquema terapêutico (se pertinente).', values: DATA },
  CONTEXAM: { label: 'Nº de contatos examinados', description: 'Número de contatos intradomiciliares submetidos a exame dermatoneurológico.' },
  TPALTA_N: { label: 'Tipo de saída', description: 'Tipo de saída (alta) do paciente.', values: '1 – Cura; 2 – Transferência para o mesmo município; 3 – Transferência para outro município; 4 – Transferência para outro estado; 5 – Transferência para outro país; 6 – Óbito; 7 – Abandono; 8 – Erro diagnóstico; 9 – Transferência não especificada (só em casos migrados ou notificados até a versão 1.3)' },
  DTALTA_N: { label: 'Data da alta', description: 'Data da alta.', values: DATA },
  IN_VINCULA: { label: 'Vinculação', description: 'Indica se a notificação foi vinculada (atribuída pelo sistema após vincular notificações de hanseníase ou tuberculose).', values: '0 – Não vinculada; 1 – Vinculada' },
};

const BACILOSCOPIA_MES = (mes: string): DatasusFieldEntry => ({
  label: `Baciloscopia no ${mes}`,
  description: `Resultado da baciloscopia de escarro para BAAR em amostra colhida ${mes === 'após o 6º mês' ? 'após o 6º mês' : `ao final do ${mes}`} de tratamento.`,
  values: '1 – Positiva; 2 – Negativa; 3 – Não realizada; 4 – Não se aplica',
});
const AGRAVO_ASSOCIADO = (qual: string): DatasusFieldEntry => ({
  label: `Agravo associado: ${qual}`,
  description: `Se havia ${qual.toLowerCase()} associado(a) à tuberculose por ocasião da notificação.`,
  values: SIM_NAO_IGN,
});
const POPULACAO = (qual: string, detalhe = ''): DatasusFieldEntry => ({
  label: `População especial: ${qual}`,
  description: `Situação do paciente quanto à condição de vulnerabilidade: ${qual.toLowerCase()}.${detalhe}`,
  values: SIM_NAO_IGN,
});

const TUBE: Readonly<Record<string, DatasusFieldEntry>> = {
  NU_PRONTUA: { label: 'Nº do prontuário', description: 'Número do prontuário do paciente na unidade de saúde.' },
  TRATAMENTO: { label: 'Tipo de entrada', description: 'Tipo de entrada do paciente na unidade de saúde. Caso novo: nunca tratou tuberculose ou tratou por até 30 dias; retratamento por recidiva após cura ou reingresso após abandono (interrupção por mais de 30 dias); pós-óbito: identificado no momento ou após a morte.', values: '1 – Caso novo; 2 – Recidiva; 3 – Reingresso após abandono; 4 – Não sabe; 5 – Transferência; 6 – Pós-óbito' },
  POP_LIBER: POPULACAO('Privada de liberdade', ' Inclui a população prisional e a que cumpre medida socioeducativa de restrição de liberdade.'),
  POP_RUA: POPULACAO('Em situação de rua'),
  POP_SAUDE: POPULACAO('Profissional de saúde'),
  POP_IMIG: POPULACAO('Imigrante', ' Imigrante é o estrangeiro residente no Brasil há menos de 2 anos.'),
  BENEF_GOV: { label: 'Beneficiário de programa de transferência de renda', description: 'Se o paciente é beneficiário de programa de transferência de renda do governo.', values: SIM_NAO_IGN },
  FORMA: { label: 'Forma', description: 'Forma clínica da tuberculose por ocasião da notificação, segundo a localização.', values: '1 – Pulmonar; 2 – Extrapulmonar; 3 – Pulmonar + extrapulmonar' },
  EXTRAPU_N: { label: 'Se extrapulmonar', description: 'Localização extrapulmonar da tuberculose (forma 2 ou 3).', values: '1 – Pleural; 2 – Ganglionar periférica; 3 – Geniturinária; 4 – Óssea; 5 – Ocular; 6 – Miliar; 7 – Meningoencefálica; 8 – Cutânea; 9 – Laríngea; 10 – Outra' },
  EXTRAPUL_O: { label: 'Extrapulmonar: outra (especificar)', description: 'Outra localização extrapulmonar, quando não está entre as listadas.' },
  AGRAVAIDS: AGRAVO_ASSOCIADO('Aids'),
  AGRAVALCOO: AGRAVO_ASSOCIADO('Alcoolismo'),
  AGRAVDIABE: AGRAVO_ASSOCIADO('Diabetes'),
  AGRAVDOENC: AGRAVO_ASSOCIADO('Doença mental'),
  AGRAVDROGA: AGRAVO_ASSOCIADO('Uso de drogas ilícitas'),
  AGRAVTABAC: AGRAVO_ASSOCIADO('Tabagismo'),
  AGRAVOUTRA: AGRAVO_ASSOCIADO('Outra doença'),
  AGRAVOUTDE: { label: 'Agravo associado: outro (especificar)', description: 'Outros agravos associados à tuberculose.' },
  BACILOSC_E: { label: 'Baciloscopia de escarro (diagnóstico)', description: 'Resultado da baciloscopia de escarro para BAAR nas 1ª e 2ª amostras para diagnóstico; resultado positivo em qualquer uma deve ser informado. "Não se aplica" para a forma extrapulmonar.', values: '1 – Positiva; 2 – Negativa; 3 – Não realizada; 4 – Não se aplica' },
  RAIOX_TORA: { label: 'Radiografia do tórax', description: 'Resultado da radiografia do tórax por ocasião da notificação ("outra patologia" são alterações não compatíveis com tuberculose).', values: '1 – Suspeito; 2 – Normal; 3 – Outra patologia; 4 – Não realizado' },
  HIV: { label: 'HIV', description: 'Resultado da sorologia para HIV, feita antes ou depois da notificação da TB. Avalia a coinfecção, não a oferta do teste.', values: '1 – Positivo; 2 – Negativo; 3 – Em andamento; 4 – Não realizado' },
  ANTIRRETRO: { label: 'Terapia antirretroviral durante o tratamento da TB', description: 'Uso de terapia antirretroviral para HIV/aids durante o tratamento da tuberculose.', values: SIM_NAO_IGN },
  HISTOPATOL: { label: 'Histopatologia', description: 'Resultado do exame histopatológico para diagnóstico de TB.', values: '1 – BAAR positivo; 2 – Sugestivo de TB; 3 – Não sugestivo de TB; 4 – Em andamento; 5 – Não realizado' },
  CULTURA_ES: { label: 'Cultura', description: 'Resultado da cultura de escarro ou outro material para tuberculose.', values: '1 – Positiva; 2 – Negativa; 3 – Em andamento; 4 – Não realizada' },
  TESTE_MOLE: { label: 'Teste molecular rápido (TMR-TB)', description: 'Resultado do teste molecular rápido para M. tuberculosis e resistência à rifampicina (amostra para diagnóstico).', values: '1 – Detectável sensível à rifampicina; 2 – Detectável resistente à rifampicina; 3 – Não detectável; 4 – Inconclusivo; 5 – Não realizado' },
  TEST_SENSI: { label: 'Teste de sensibilidade', description: 'Resultado do teste de sensibilidade, para conhecer o padrão de resistência às drogas do esquema básico.', values: '1 – Resistente somente à isoniazida; 2 – Resistente somente à rifampicina; 3 – Resistente à isoniazida e rifampicina; 4 – Resistente a outras drogas de 1ª linha; 5 – Sensível; 6 – Em andamento; 7 – Não realizado' },
  DT_INIC_TR: { label: 'Data de início do tratamento atual', description: 'Data em que o paciente iniciou o tratamento atual (na transferência, a data de início onde foi diagnosticado).', values: DATA },
  NU_COMU_ID: { label: 'Total de contatos identificados', description: 'Total de contatos identificados pelo paciente por ocasião do diagnóstico.' },
  SG_UF_ATUA: { label: 'UF de notificação atual', description: 'UF de notificação atual (muda quando duas notificações são vinculadas por transferência).' },
  ID_MUNIC_A: { label: 'Município de notificação atual', description: 'Município de notificação atual (muda na vinculação por transferência).' },
  NU_NOTI_AT: { label: 'Número da notificação atual', description: 'Número da notificação atual.' },
  DT_NOTI_AT: { label: 'Data da notificação atual', description: 'Data da notificação atual.', values: DATA },
  ID_UNID_AT: { label: 'Unidade de saúde atual', description: 'Código (CNES) da unidade de saúde atual.' },
  SG_UF_2: { label: 'UF de residência atual', description: 'Sigla da UF de residência atual.' },
  ID_MUNIC_2: { label: 'Município de residência atual', description: 'Município de residência atual.' },
  NU_CEP2: { label: 'CEP de residência atual', description: 'CEP de residência atual do paciente.' },
  D_DISTR_2: { label: 'Distrito de residência atual', description: 'Distrito de residência atual, segundo o cadastro do Sinan.' },
  ID_BAIRRO2: { label: 'Bairro de residência atual (código)', description: 'Código do bairro de residência atual, segundo o cadastro do Sinan.' },
  NM_BAIRRO2: { label: 'Bairro de residência atual', description: 'Nome do bairro de residência atual.' },
  BACILOSC_1: BACILOSCOPIA_MES('1º mês'),
  BACILOSC_2: BACILOSCOPIA_MES('2º mês'),
  BACILOSC_3: BACILOSCOPIA_MES('3º mês'),
  BACILOSC_4: BACILOSCOPIA_MES('4º mês'),
  BACILOSC_5: BACILOSCOPIA_MES('5º mês'),
  BACILOSC_6: BACILOSCOPIA_MES('6º mês'),
  BACILOSC_A: BACILOSCOPIA_MES('após o 6º mês'),
  NU_PRONT_A: { label: 'Nº do prontuário atual', description: 'Identificador do prontuário atual na unidade de saúde.' },
  TRATSUP_AT: { label: 'Tratamento diretamente observado (TDO)', description: 'Se o tratamento diretamente observado foi realizado durante todo o tratamento (24 doses observadas na fase intensiva e 48 na de manutenção).', values: SIM_NAO_IGN },
  NU_CONT_EX: { label: 'Total de contatos examinados', description: 'Total de contatos examinados na investigação e acompanhamento do caso.' },
  SITUA_ENCE: { label: 'Situação de encerramento', description: 'Situação de encerramento do caso notificado.', values: '1 – Cura; 2 – Abandono; 3 – Óbito por TB; 4 – Óbito por outras causas; 5 – Transferência; 6 – Mudança de diagnóstico; 7 – TB-DR; 8 – Mudança de esquema; 9 – Falência; 10 – Abandono primário' },
  TRANSF: { label: 'Se transferência', description: 'Destino da transferência, quando a situação de encerramento é transferência.', values: '1 – Mesmo município; 2 – Município diferente (mesma UF); 3 – UF diferente; 4 – País diferente; 9 – Ignorado' },
  SG_UF_TRAN: { label: 'UF de transferência', description: 'UF para onde o paciente foi transferido.' },
  MUN_TRANSF: { label: 'Município de transferência', description: 'Município para onde o paciente foi transferido.' },
  DT_ENCERRA: { label: 'Data de encerramento', description: 'Data de encerramento do caso (igual ou posterior à data de notificação).', values: DATA },
  OPORTU: { label: 'Oportunidade de encerramento', description: 'Calculada a partir do intervalo entre a data de encerramento e a data de notificação, comparado com o prazo de oportunidade.', values: '1 – Oportuno; 2 – Inoportuno' },
  DT_OPORTU: { label: 'Data da oportunidade', description: 'Data preenchida quando a oportunidade é calculada (campo interno).', values: DATA },
};

/**
 * Nomes que o dicionário escreve com mais de 10 letras — impossível num DBF:
 * a chave é o nome cortado em 10, e o nome por extenso fica como apelido.
 * Um apelido que não existe no arquivo não faz nada.
 */
const APELIDOS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  // Nomes quebrados em duas linhas no PDF, com acento ou com mais de 10 letras.
  VIOL: {
    NM_MAE_PA: 'NM_MAE_PAC', ID_DIS_OCOR: 'ID_DIS_OCO', NM_BA_OCO: 'NM_BA_OCOR', DS_COMP_OCOR: 'DS_COMP_OC',
    DS_REF_OCOR: 'DS_REF_OCO', NUM_ENVOL: 'NUM_ENVOLV', CICL_VID_AUTOR: 'CICL_VID_A', ATEND_MUL: 'ATEND_MULH',
    DELEG_IDOSO: 'DELEG_IDOS', DELEG_MUL: 'DELEG_MULH', PROC_VAGINA: 'PROC_VAGIN', 'REL_IRMÃO': 'REL_IRMAO',
  },
  // O dicionário escreve com acento e com 11 letras; no DBF não há nem um nem outro.
  DENG: { 'PETÉQUIA_N': 'PETEQUIA_N', 'ÁCIDO_PEPT': 'ACIDO_PEPT', CLINIC_CHIK: 'CLINIC_CHI' },
  CHIK: { 'PETÉQUIA_N': 'PETEQUIA_N', 'ÁCIDO_PEPT': 'ACIDO_PEPT', CLINIC_CHIK: 'CLINIC_CHI' },
  // O dicionário pede para manter os nomes do Sinan Windows nos sinais e sintomas.
  SIFC: {
    CLI_ICTERI: 'SIN_ICTE_C', CLI_ANEMIA: 'SIN_ANEM_C', CLI_ESPLEN: 'SIN_ESPL_C', CLI_OSTEO: 'SIN_OSTE_C',
    CLI_RINITE: 'SIN_RINI_C', HEPATO: 'SIN_HEPA_C', LESOES: 'SIN_LESA_C', CLI_PSEUDO: 'SIN_PSEU_C',
    CLI_OUTRO: 'SIN_OUTR_C', CLI_ASSINT: 'TRA_DIAG_C',
  },
  TUBE: {
    AGRAVDROGAS: 'AGRAVDROGA', AGRAVTABACO: 'AGRAVTABAC', ANTIRRETROVIRAL: 'ANTIRRETRO',
    TESTE_MOLEC: 'TESTE_MOLE', TEST_SENSIBILID: 'TEST_SENSI', BACILOSC_APOS_6: 'BACILOSC_A',
    NU_PRONT_AT: 'NU_PRONT_A', SG_UF_ATUAL: 'SG_UF_ATUA', ID_MUNIC_AT: 'ID_MUNIC_A', SG_UF_TRANSF: 'SG_UF_TRAN',
    // O dicionário escreve "D_DISTR_2"; mantido como está e também com o I da frente.
    ID_DISTR_2: 'D_DISTR_2',
  },
};

const ESQUEMA_PENICILINA = '1 – Penicilina G benzatina 2.400.000 UI; 2 – Penicilina G benzatina 4.800.000 UI; 3 – Penicilina G benzatina 7.200.000 UI; 4 – Outro esquema; 5 – Não realizado; 9 – Ignorado';
const TESTE_RESULTADO = '1 – Reagente; 2 – Não reagente; 3 – Não realizado; 9 – Ignorado';

const SIFG: Readonly<Record<string, DatasusFieldEntry>> = {
  ID_OCUPA_N: { label: 'Ocupação', description: 'Ocupação da gestante (tabela de ocupação padronizada do Sinan).' },
  PRE_UFREL: { label: 'UF do pré-natal', description: 'UF onde foi feito o pré-natal.' },
  PRE_MUNIRE: { label: 'Município do pré-natal', description: 'Município da unidade de saúde onde foi feito o pré-natal.' },
  PRE_UNIPRE: { label: 'Unidade do pré-natal', description: 'Unidade de saúde (CNES) onde foi feito o pré-natal.' },
  PRE_SISPRE: { label: 'Nº da gestante no SISPRENATAL', description: 'Número que identifica a gestante no cadastro do SISPRENATAL.' },
  TPEVIDENCI: { label: 'Classificação clínica', description: 'Classificação clínica da sífilis na gestação: primária (cancro duro); secundária (lesões cutâneo-mucosas); terciária (gomas, alterações neurológicas, cardiovasculares ou articulares); latente (fase sem sintomas, diagnóstico só por sorologia).', values: '1 – Primária; 2 – Secundária; 3 – Terciária; 4 – Latente; 9 – Ignorado' },
  TPTESTE1: { label: 'Teste não treponêmico no pré-natal', description: 'Resultado do teste não treponêmico (VDRL ou RPR) da primeira consulta de pré-natal.', values: TESTE_RESULTADO },
  DSTITULO1: { label: 'Título (VDRL/RPR)', description: 'Resultado da titulação do teste não treponêmico.' },
  DTTESTE1: { label: 'Data do teste não treponêmico', description: 'Data da realização do teste não treponêmico no pré-natal.', values: DATA },
  TPCONFIRMA: { label: 'Teste treponêmico no pré-natal', description: 'Resultado do teste treponêmico (confirmatório: FTA-Abs, MHA-Tp, TPHA, ELISA) feito no pré-natal.', values: TESTE_RESULTADO },
  TPESQUEMA: { label: 'Esquema de tratamento', description: 'Esquema de tratamento da gestante preconizado pelo Ministério da Saúde.', values: ESQUEMA_PENICILINA },
  TRATPARC: { label: 'Parceiro tratado junto com a gestante', description: 'Se o parceiro foi tratado ao mesmo tempo que a gestante.', values: SIM_NAO_IGN },
  TPESQPAR: { label: 'Esquema prescrito ao parceiro', description: 'Esquema de tratamento prescrito ao parceiro.', values: ESQUEMA_PENICILINA },
  TPMOTPARC: { label: 'Motivo do não tratamento do parceiro', description: 'Motivo pelo qual o parceiro não foi tratado.', values: '1 – Não teve mais contato com a gestante; 2 – Não foi comunicado/convocado à US para tratamento; 3 – Foi comunicado/convocado mas não compareceu; 4 – Foi comunicado/convocado mas recusou o tratamento; 5 – Sorologia não reagente; 6 – Outro motivo' },
  DSMOTIVO: { label: 'Outro motivo', description: 'Outro motivo pelo qual o parceiro não foi tratado.' },
};

const SINAL = (qual: string, detalhe: string): DatasusFieldEntry => ({
  label: `Sinal ou sintoma: ${qual}`,
  description: `${detalhe} "Não se aplica" em caso de aborto ou natimorto.`,
  values: '1 – Sim; 2 – Não; 3 – Não se aplica; 9 – Ignorado',
});
const RESULTADO_TESTE = '1 – Reagente; 2 – Não reagente; 3 – Não realizado; 9 – Ignorado';
const SIM_NAO_NR_IGN = '1 – Sim; 2 – Não; 3 – Não realizado; 9 – Ignorado';

const SIFC: Readonly<Record<string, DatasusFieldEntry>> = {
  ANT_IDADE: { label: 'Idade da mãe', description: 'Idade da mãe por ocasião da notificação do caso.' },
  ANT_RACA: { label: 'Raça/cor da mãe', description: 'Cor ou raça declarada pela mãe.', values: '1 – Branca; 2 – Preta; 3 – Amarela; 4 – Parda; 5 – Indígena; 9 – Ignorado' },
  ID_OCUPA_N: { label: 'Ocupação da mãe', description: 'Ocupação/ramo de atividade econômica da mãe (tabela de ocupação padronizada do Sinan).' },
  ESCOLMAE: { label: 'Escolaridade da mãe', description: 'Escolaridade da mãe no momento da notificação do caso.', values: '0 – Analfabeto; 1 – 1ª a 4ª série incompleta do EF; 2 – Até 4ª série completa do EF; 3 – 5ª a 8ª série incompleta do EF; 4 – Ensino fundamental completo; 5 – Ensino médio incompleto; 6 – Ensino médio completo; 7 – Educação superior incompleta; 8 – Educação superior completa; 9 – Ignorada; 10 – Não se aplica' },
  ANT_PRE_NA: { label: 'Realizou pré-natal', description: 'Se a mãe fez pré-natal durante a gravidez do caso notificado.', values: SIM_NAO_IGN },
  UF_PRE_NAT: { label: 'UF do pré-natal', description: 'UF do local de realização do pré-natal.' },
  MUN_PRE_NA: { label: 'Município do pré-natal', description: 'Município do local de realização do pré-natal.' },
  UNI_PRE_NA: { label: 'Unidade do pré-natal', description: 'Unidade de saúde onde foi feito o pré-natal.' },
  ANTSIFIL_N: { label: 'Diagnóstico de sífilis materna', description: 'Quando a sífilis da mãe foi diagnosticada em laboratório.', values: '1 – Durante o pré-natal; 2 – No momento do parto/curetagem; 3 – Após o parto; 4 – Não realizado; 9 – Ignorado' },
  LAB_PARTO: { label: 'Teste não treponêmico no parto/curetagem', description: 'Resultado qualitativo do VDRL materno, recomendado na admissão de toda gestante para o parto/curetagem.', values: RESULTADO_TESTE },
  LAB_TITU_2: { label: 'Título do teste não treponêmico no parto', description: 'Resultado quantitativo (título) do VDRL materno no parto/curetagem.' },
  LAB_DT3: { label: 'Data da coleta no parto', description: 'Data da coleta do VDRL no momento do parto/curetagem.', values: DATA },
  LAB_CONF: { label: 'Teste treponêmico no parto/curetagem', description: 'Resultado qualitativo do teste treponêmico feito no parto.', values: RESULTADO_TESTE },
  TRA_ESQUEM: { label: 'Esquema de tratamento materno', description: 'Adequado: de acordo com a fase clínica, iniciado mais de 30 dias antes do parto, com títulos em queda ou baixos e parceiro tratado junto com a gestante.', values: '1 – Adequado; 2 – Inadequado; 3 – Não realizado; 9 – Ignorado' },
  TRA_DT: { label: 'Data do início do tratamento da mãe', description: 'Data do início do tratamento para sífilis da mãe.', values: DATA },
  ANT_TRATAD: { label: 'Parceiro tratado junto com a gestante', description: 'Se o(s) parceiro(s) da mãe foi(ram) tratado(s) para sífilis.', values: SIM_NAO_IGN },
  ANT_UF_CRI: { label: 'UF do nascimento', description: 'UF onde ocorreu o nascimento, aborto ou óbito da criança.' },
  ANT_MUNI_C: { label: 'Município do nascimento', description: 'Município onde ocorreu o nascimento, aborto ou óbito da criança.' },
  ANT_LOCAL_: { label: 'Local do nascimento (maternidade/hospital)', description: 'Unidade de saúde onde foi feito o parto, o aborto ou onde ocorreu o óbito da criança.' },
  LABC_SANGU: { label: 'Teste não treponêmico – sangue periférico', description: 'Resultado qualitativo do VDRL ou outro teste não treponêmico em sangue periférico da criança.', values: RESULTADO_TESTE },
  LABC_TIT_1: { label: 'Título – sangue periférico', description: 'Título do teste não treponêmico em sangue periférico da criança.' },
  LABC_DT_1: { label: 'Data do teste – sangue periférico', description: 'Data da coleta do teste não treponêmico em sangue periférico.', values: DATA },
  LABC_IGG: { label: 'Teste treponêmico após 18 meses', description: 'Resultado do teste treponêmico na criança, em sangue periférico.', values: '1 – Reagente; 2 – Não reagente; 3 – Não realizado; 4 – Não se aplica; 9 – Ignorado' },
  LABC_DT: { label: 'Data do teste treponêmico após 18 meses', description: 'Data do teste treponêmico após 18 meses.', values: DATA },
  LABC_LIQUO: { label: 'Teste não treponêmico – líquor', description: 'Resultado qualitativo do teste não treponêmico em líquor.', values: RESULTADO_TESTE },
  LABC_TIT_2: { label: 'Título – líquor', description: 'Título do teste em líquor.' },
  LABC_DT_2: { label: 'Data do teste – líquor', description: 'Data da coleta do teste não treponêmico em líquor.', values: DATA },
  LABC_TITUL: { label: 'Titulação ascendente', description: 'Comparação dos títulos da sorologia não treponêmica da criança durante o seguimento (VDRL com 1, 3, 6, 12 e 18 meses).', values: SIM_NAO_NR_IGN },
  LABC_EVIDE: { label: 'Evidência de T. pallidum', description: 'Evidência de T. pallidum em exame microscópico (placenta, lesões, cordão umbilical ou necropsia), por campo escuro, imunofluorescência ou outro método.', values: SIM_NAO_NR_IGN },
  LABC_LIQ_1: { label: 'Alteração liquórica', description: 'Alterações no líquor do recém-nato: celularidade acima de 10/campo e proteína acima de 100 mg/ml.', values: SIM_NAO_NR_IGN },
  TRA_DIAG_T: { label: 'Alteração no exame dos ossos longos', description: 'Alterações ósseas ao raio-X (osteocondrite, osteoartrite, periostite, rarefação óssea, tíbia em "lâmina de sabre").', values: SIM_NAO_NR_IGN },
  TRA_DIAG_C: { label: 'Diagnóstico clínico da criança', description: 'Se a criança apresenta ao exame físico manifestação sugestiva de sífilis congênita. "Não se aplica" em aborto ou natimorto.', values: '1 – Assintomático; 2 – Sintomático; 3 – Não se aplica; 9 – Ignorado' },
  SIN_ICTE_C: SINAL('icterícia', 'Presença de icterícia ao exame físico da criança.'),
  SIN_ANEM_C: SINAL('anemia', 'Presença de anemia ao exame físico da criança.'),
  SIN_ESPL_C: SINAL('esplenomegalia', 'Baço aumentado ao exame físico da criança.'),
  SIN_OSTE_C: SINAL('osteocondrite', 'Lesões osteoarticulares dolorosas à manipulação da criança.'),
  SIN_RINI_C: SINAL('rinite muco-sanguinolenta', 'Rinite muco-sanguinolenta ao exame físico da criança.'),
  SIN_HEPA_C: SINAL('hepatomegalia', 'Fígado aumentado ao exame físico da criança.'),
  SIN_LESA_C: SINAL('lesões cutâneas', 'Lesões bolhosas ou descamativas, papulares ou manchas generalizadas (inclusive palmas e plantas) e fissuras ao redor dos orifícios.'),
  SIN_PSEU_C: SINAL('pseudoparalisia', '"Paralisia" por dor, notada principalmente ao manipular a criança.'),
  SIN_OUTR_C: SINAL('outro', 'Outros sinais ou sintomas não listados.'),
  SIN_OUTR_E: { label: 'Outro sinal ou sintoma (especificar)', description: 'Qual outro sinal ou sintoma.' },
  TRA_ESQU_1: { label: 'Esquema de tratamento da criança', description: 'Esquema usado no tratamento da sífilis congênita, hospitalar ou ambulatorial.', values: '1 – Penicilina G cristalina 100.000 a 150.000 UI/kg/dia, 10 dias; 2 – Penicilina G procaína 50.000 UI/kg/dia, 10 dias; 3 – Penicilina G benzatina 50.000 UI/kg/dia, dose única; 4 – Outro esquema; 5 – Não realizado; 6 – Não se aplica; 9 – Ignorado' },
  DS_ESQUEMA: { label: 'Outro esquema (especificar)', description: 'Outro esquema de tratamento usado para a criança.' },
  EVOLUCAO: { label: 'Evolução do caso', description: 'Óbito por sífilis congênita: morte do recém-nato nascido vivo, filho de mãe com sífilis não tratada ou tratada inadequadamente. Aborto: perda até 22 semanas ou até 500 g. Natimorto: feto morto após 22 semanas ou acima de 500 g.', values: '1 – Vivo; 2 – Óbito por sífilis congênita; 3 – Óbito por outras causas; 4 – Aborto; 5 – Natimorto; 9 – Ignorado' },
  EVO_DIAG_N: { label: 'Diagnóstico final', description: 'Diagnóstico definitivo, calculado pelo sistema a partir dos critérios de definição de caso: recente (criança com menos de 2 anos), tardia (2 anos ou mais), natimorto, aborto ou descartado.', values: '1 – Sífilis congênita recente; 2 – Sífilis congênita tardia; 3 – Aborto; 4 – Natimorto; 5 – Descartado' },
  DT_OBITO: { label: 'Data do óbito', description: 'Data do óbito da criança.', values: DATA },
};

const SIM_NAO = '1 – Sim; 2 – Não';
const RESULTADO_EXAME = '1 – Reagente/positivo; 2 – Não reagente/negativo; 3 – Inconclusivo; 4 – Não realizado';
const SINAL_DENGUE = (qual: string): DatasusFieldEntry => ({ label: `Sinal clínico: ${qual}`, description: `Presença de ${qual.toLowerCase()} (sinal clínico ou achado laboratorial inespecífico).`, values: SIM_NAO });
const DOENCA_PREVIA = (qual: string): DatasusFieldEntry => ({ label: `Doença pré-existente: ${qual}`, description: `Se o paciente tinha ${qual.toLowerCase()}.`, values: SIM_NAO });
const ALARME = (qual: string): DatasusFieldEntry => ({ label: `Sinal de alarme: ${qual}`, description: `Dengue com sinais de alarme: presença de ${qual.toLowerCase()}.`, values: SIM_NAO });
const GRAVIDADE = (qual: string): DatasusFieldEntry => ({ label: `Dengue grave: ${qual}`, description: `Sinal de gravidade encontrado: ${qual.toLowerCase()}.`, values: SIM_NAO });

/** Dengue e chikungunya usam a mesma ficha (Sinan Online). */
const DENG: Readonly<Record<string, DatasusFieldEntry>> = {
  ID_OCUPA_N: { label: 'Ocupação', description: 'Atividade exercida pelo paciente ou a última, se desempregado (CBO).' },
  FEBRE: SINAL_DENGUE('Febre'), MIALGIA: SINAL_DENGUE('Mialgia'), CEFALEIA: SINAL_DENGUE('Cefaleia'),
  EXANTEMA: SINAL_DENGUE('Exantema'), VOMITO: SINAL_DENGUE('Vômito'), NAUSEA: SINAL_DENGUE('Náusea'),
  DOR_COSTAS: SINAL_DENGUE('Dor nas costas'), CONJUNTVIT: SINAL_DENGUE('Conjuntivite'), ARTRITE: SINAL_DENGUE('Artrite'),
  ARTRALGIA: SINAL_DENGUE('Artralgia intensa'), PETEQUIA_N: SINAL_DENGUE('Petéquias'), LEUCOPENIA: SINAL_DENGUE('Leucopenia'),
  LACO: SINAL_DENGUE('Prova do laço positiva'), DOR_RETRO: SINAL_DENGUE('Dor retroorbital'),
  DIABETES: DOENCA_PREVIA('Diabetes'), HEMATOLOG: DOENCA_PREVIA('Doenças hematológicas'), HEPATOPAT: DOENCA_PREVIA('Hepatopatias'),
  RENAL: DOENCA_PREVIA('Doença renal crônica'), HIPERTENSA: DOENCA_PREVIA('Hipertensão arterial'),
  ACIDO_PEPT: DOENCA_PREVIA('Doença ácido-péptica'), AUTO_IMUNE: DOENCA_PREVIA('Doenças autoimunes'),
  DT_CHIK_S1: { label: 'Data da coleta – sorologia chikungunya (soro 1)', description: 'Data da coleta do exame sorológico (IgM) para chikungunya, soro 1.', values: DATA },
  DT_CHIK_S2: { label: 'Data da coleta – sorologia chikungunya (soro 2)', description: 'Data da coleta do exame sorológico (IgM) para chikungunya, soro 2.', values: DATA },
  DT_PRNT: { label: 'Data da coleta – PRNT', description: 'Data da coleta do exame PRNT (chikungunya).', values: DATA },
  RES_CHIKS1: { label: 'Sorologia chikungunya (soro 1)', description: 'Resultado do exame sorológico (IgM) para chikungunya, soro 1.', values: RESULTADO_EXAME },
  RES_CHIKS2: { label: 'Sorologia chikungunya (soro 2)', description: 'Resultado do exame sorológico (IgM) para chikungunya, soro 2.', values: RESULTADO_EXAME },
  RESUL_PRNT: { label: 'Resultado do PRNT', description: 'Resultado do exame PRNT (chikungunya).', values: RESULTADO_EXAME },
  DT_SORO: { label: 'Data da coleta – sorologia dengue', description: 'Data da coleta do exame sorológico (IgM) para dengue.', values: DATA },
  RESUL_SORO: { label: 'Sorologia dengue (IgM)', description: 'Resultado do exame sorológico (IgM) para dengue.', values: RESULTADO_EXAME },
  DT_NS1: { label: 'Data da coleta – NS1', description: 'Data da coleta do exame NS1.', values: DATA },
  RESUL_NS1: { label: 'Resultado do NS1', description: 'Resultado do exame NS1.', values: RESULTADO_EXAME },
  DT_VIRAL: { label: 'Data da coleta – isolamento viral', description: 'Data da coleta para isolamento viral.', values: DATA },
  RESUL_VI_N: { label: 'Resultado do isolamento viral', description: 'Resultado do exame de isolamento viral.', values: RESULTADO_EXAME },
  DT_PCR: { label: 'Data da coleta – RT-PCR', description: 'Data da coleta do exame de RT-PCR.', values: DATA },
  RESUL_PCR_: { label: 'Resultado do RT-PCR', description: 'Resultado do exame de RT-PCR.', values: RESULTADO_EXAME },
  SOROTIPO: { label: 'Sorotipo', description: 'Sorotipo do vírus da dengue (quando isolamento viral ou RT-PCR positivo).', values: '1 – DEN 1; 2 – DEN 2; 3 – DEN 3; 4 – DEN 4' },
  HISTOPA_N: { label: 'Histopatologia', description: 'Resultado do exame de histopatologia.', values: RESULTADO_EXAME },
  IMUNOH_N: { label: 'Imuno-histoquímica', description: 'Resultado do exame de imuno-histoquímica.', values: RESULTADO_EXAME },
  HOSPITALIZ: { label: 'Ocorreu hospitalização', description: 'Se o paciente foi hospitalizado.', values: SIM_NAO_IGN },
  DT_INTERNA: { label: 'Data da internação', description: 'Data da internação do paciente.', values: DATA },
  UF: { label: 'UF de hospitalização', description: 'UF onde o paciente foi hospitalizado.' },
  MUNICIPIO: { label: 'Município do hospital', description: 'Município onde o paciente foi hospitalizado.' },
  HOSPITAL: { label: 'Hospital', description: 'Unidade de saúde em que o paciente foi hospitalizado.' },
  DDD_HOSP: { label: 'DDD do hospital', description: 'DDD do telefone da unidade onde o paciente foi hospitalizado.' },
  TEL_HOSP: { label: 'Telefone do hospital', description: 'Telefone da unidade onde o paciente foi hospitalizado.' },
  TPAUTOCTO: { label: 'Caso autóctone do município de residência', description: 'Se o caso é autóctone do município de residência.', values: '1 – Sim; 2 – Não; 3 – Indeterminado' },
  COUFINF: { label: 'UF provável da infecção', description: 'UF onde o paciente foi provavelmente infectado.' },
  COPAISINF: { label: 'País provável da infecção', description: 'País onde o paciente foi provavelmente infectado.' },
  COMUNINF: { label: 'Município provável da infecção', description: 'Município onde o paciente foi provavelmente infectado.' },
  CODISINF: { label: 'Distrito provável da infecção', description: 'Distrito provável de infecção do caso.' },
  CO_BAINF: { label: 'Bairro provável da infecção (código)', description: 'Código do bairro provável de infecção do caso.' },
  NOBAIINF: { label: 'Bairro provável da infecção', description: 'Nome do bairro provável de infecção do caso.' },
  CLASSI_FIN: { label: 'Classificação final', description: 'Classificação do caso.', values: '5 – Descartado; 10 – Dengue; 11 – Dengue com sinais de alarme; 12 – Dengue grave; 13 – Chikungunya' },
  CRITERIO: { label: 'Critério de confirmação/descarte', description: 'Critério de confirmação ou descarte do caso.', values: '1 – Laboratório; 2 – Clínico-epidemiológico; 3 – Em investigação' },
  CLINIC_CHI: { label: 'Apresentação clínica (chikungunya)', description: 'Apresentação clínica do caso de chikungunya.', values: '1 – Aguda; 2 – Crônica' },
  EVOLUCAO: { label: 'Evolução do caso', description: 'Evolução do caso.', values: '1 – Cura; 2 – Óbito pelo agravo; 3 – Óbito por outras causas; 4 – Óbito em investigação; 9 – Ignorado' },
  DT_OBITO: { label: 'Data do óbito', description: 'Data do óbito.', values: DATA },
  DT_ENCERRA: { label: 'Data do encerramento', description: 'Data do encerramento do caso.', values: DATA },
  ALRM_HIPOT: ALARME('Hipotensão'), ALRM_PLAQ: ALARME('Queda abrupta de plaquetas'), ALRM_VOM: ALARME('Vômitos persistentes'),
  ALRM_ABDOM: ALARME('Dor abdominal'), ALRM_LETAR: ALARME('Letargia ou irritabilidade'),
  ALRM_SANG: ALARME('Sangramento de mucosa/outras hemorragias'), ALRM_HEMAT: ALARME('Aumento do hematócrito'),
  ALRM_HEPAT: ALARME('Hepatomegalia'), ALRM_LIQ: ALARME('Acúmulo de líquidos'),
  DT_ALRM: { label: 'Data de início dos sinais de alarme', description: 'Data do primeiro sinal de alarme manifestado.', values: DATA },
  GRAV_PULSO: GRAVIDADE('Pulso débil ou indetectável'), GRAV_CONV: GRAVIDADE('PA convergente'),
  GRAV_ENCH: GRAVIDADE('Tempo de enchimento capilar'), GRAV_INSUF: GRAVIDADE('Acúmulo de líquidos com insuficiência respiratória'),
  GRAV_TAQUI: GRAVIDADE('Taquicardia'), GRAV_EXTRE: GRAVIDADE('Extremidades frias'),
  GRAV_HIPOT: GRAVIDADE('Hipotensão arterial em fase tardia'), GRAV_HEMAT: GRAVIDADE('Hematêmese'),
  GRAV_MELEN: GRAVIDADE('Melena'), GRAV_METRO: GRAVIDADE('Metrorragia volumosa'),
  GRAV_SANG: GRAVIDADE('Sangramento do SNC'), GRAV_AST: GRAVIDADE('AST/ALT acima de 1.000'),
  GRAV_MIOC: GRAVIDADE('Miocardite'), GRAV_CONSC: GRAVIDADE('Alteração da consciência'), GRAV_ORGAO: GRAVIDADE('Outros órgãos'),
  DT_GRAV: { label: 'Data de início dos sinais de gravidade', description: 'Data do primeiro sinal de gravidade manifestado.', values: DATA },
  DS_OBS: { label: 'Observações', description: 'Informações complementares e observações adicionais sobre o caso.' },
};

const SIM_NAO_NA_IGN = '1 – Sim; 2 – Não; 8 – Não se aplica; 9 – Ignorado';
const TIPO_VIOL = (qual: string): DatasusFieldEntry => ({ label: `Tipo de violência: ${qual}`, description: `Se ocorreu ${qual.toLowerCase()}.`, values: SIM_NAO_IGN });
const MEIO = (qual: string): DatasusFieldEntry => ({ label: `Meio de agressão: ${qual}`, description: `Se o meio de agressão foi ${qual.toLowerCase()}.`, values: SIM_NAO_IGN });
const SEXUAL = (qual: string): DatasusFieldEntry => ({ label: `Violência sexual: ${qual}`, description: `Se ocorreu ${qual.toLowerCase()} (quando houve violência sexual).`, values: SIM_NAO_NA_IGN });
const PROCEDIMENTO = (qual: string): DatasusFieldEntry => ({ label: `Procedimento: ${qual}`, description: `Se foi feito(a) ${qual.toLowerCase()} (quando houve violência sexual).`, values: SIM_NAO_NA_IGN });
const RELACAO = (qual: string): DatasusFieldEntry => ({ label: `Provável autor: ${qual}`, description: `Se o provável autor da agressão era ${qual.toLowerCase()}.`, values: SIM_NAO_IGN });
const ENCAMINHAMENTO = (para: string): DatasusFieldEntry => ({ label: `Encaminhamento: ${para}`, description: `Se houve encaminhamento para ${para.toLowerCase()}.`, values: SIM_NAO_IGN });
const DEFICIENCIA = (qual: string): DatasusFieldEntry => ({ label: qual, description: `Se o paciente tem ${qual.toLowerCase()}.`, values: SIM_NAO_NA_IGN });

/** Violência interpessoal/autoprovocada: ficha própria, inclusive nos campos de notificação. */
const VIOL: Readonly<Record<string, DatasusFieldEntry>> = {
  TP_UNI_EXT: { label: 'Unidade notificadora', description: 'Setor de atuação da unidade notificadora.', values: '1 – Unidade de saúde; 2 – Unidade de assistência social; 3 – Estabelecimento de ensino; 4 – Conselho tutelar; 5 – Unidade de saúde indígena; 6 – Centro especializado de atendimento à mulher; 7 – Outros' },
  NM_UNI_EXT: { label: 'Nome da unidade notificadora', description: 'Nome da unidade que fez a notificação (cadastros da Saúde, MDS, MEC, SDH, Saúde Indígena e SPM).' },
  CO_UNI_EXT: { label: 'Código da unidade notificadora', description: 'Código da unidade que fez a notificação.' },
  CNES_NOT: { label: 'Unidade de saúde (CNES)', description: 'Código CNES da unidade de saúde da área de abrangência da unidade notificadora.' },
  DT_OCOR: { label: 'Data da ocorrência da violência', description: 'Data em que a violência ocorreu.', values: DATA },
  NM_MAE_PAC: { label: 'Nome da mãe', description: 'Nome completo da mãe do paciente.' },
  DS_COMPL: { label: 'Complemento (residência)', description: 'Complemento do logradouro de residência.' },
  DS_REF_RES: { label: 'Ponto de referência (residência)', description: 'Ponto de referência da residência do paciente.' },
  DDD: { label: 'DDD', description: 'DDD do telefone de residência.' },
  FONE: { label: 'Telefone', description: 'Telefone de residência do paciente.' },
  ZONA: { label: 'Zona de residência', description: 'Zona de residência do paciente por ocasião da notificação.', values: '1 – Urbana; 2 – Rural; 3 – Periurbana; 9 – Ignorado' },
  ID_OCUPA_N: { label: 'Ocupação', description: 'Atividade exercida pelo paciente ou a última, se desempregado.' },
  SIT_CONJUG: { label: 'Situação conjugal', description: 'Situação conjugal do paciente ("não se aplica" até 9 anos).', values: '1 – Solteiro; 2 – Casado/união consensual; 3 – Viúvo; 4 – Separado; 8 – Não se aplica; 9 – Ignorado' },
  ORIENT_SEX: { label: 'Orientação sexual', description: 'Orientação sexual do paciente ("não se aplica" até 9 anos).', values: '1 – Heterossexual; 2 – Homossexual (gay/lésbica); 3 – Bissexual; 8 – Não se aplica; 9 – Ignorado' },
  IDENT_GEN: { label: 'Identidade de gênero', description: 'Identidade de gênero do paciente ("não se aplica" até 9 anos).', values: '1 – Travesti; 2 – Transexual mulher; 3 – Transexual homem; 8 – Não se aplica; 9 – Ignorado' },
  DEF_TRANS: { label: 'Possui deficiência/transtorno', description: 'Se o paciente tem algum tipo de deficiência ou transtorno.', values: SIM_NAO_IGN },
  DEF_FISICA: DEFICIENCIA('Deficiência física'), DEF_MENTAL: DEFICIENCIA('Deficiência intelectual'),
  DEF_VISUAL: DEFICIENCIA('Deficiência visual'), DEF_AUDITI: DEFICIENCIA('Deficiência auditiva'),
  TRAN_MENT: DEFICIENCIA('Transtorno mental'), TRAN_COMP: DEFICIENCIA('Transtorno de comportamento'),
  DEF_OUT: DEFICIENCIA('Outras deficiências/síndromes'),
  DEF_ESPEC: { label: 'Outras deficiências (especificar)', description: 'Qual outra deficiência ou síndrome.' },
  SG_UF_OCOR: { label: 'UF de ocorrência', description: 'UF onde ocorreu o evento.' },
  ID_MN_OCOR: { label: 'Município de ocorrência', description: 'Município onde ocorreu o evento notificado.' },
  ID_DIS_OCO: { label: 'Distrito de ocorrência', description: 'Distrito onde ocorreu o evento.' },
  ID_BA_OCOR: { label: 'Bairro de ocorrência (código)', description: 'Código do bairro onde ocorreu o evento.' },
  NM_BA_OCOR: { label: 'Bairro de ocorrência', description: 'Nome do bairro onde ocorreu o evento.' },
  ID_LOG_OCO: { label: 'Logradouro de ocorrência (código)', description: 'Código do logradouro onde ocorreu o evento.' },
  NO_LOG_OCO: { label: 'Logradouro de ocorrência', description: 'Tipo e nome do logradouro onde ocorreu o evento.' },
  NM_LOG_RES: { label: 'Número do logradouro de ocorrência', description: 'Número da casa ou edifício onde ocorreu o evento.' },
  DS_COMP_OC: { label: 'Complemento (ocorrência)', description: 'Complemento do logradouro de ocorrência.' },
  ID_GEO3: { label: 'Geo campo 3', description: 'Campo para georreferenciamento (ocorrência).' },
  ID_GEO4: { label: 'Geo campo 4', description: 'Campo para georreferenciamento (ocorrência).' },
  DS_REF_OCO: { label: 'Ponto de referência (ocorrência)', description: 'Ponto de referência do local de ocorrência.' },
  ZONA_OCOR: { label: 'Zona de ocorrência', description: 'Zona onde ocorreu o evento.', values: '1 – Urbana; 2 – Rural; 3 – Periurbana; 9 – Ignorado' },
  HORA_OCOR: { label: 'Hora da ocorrência', description: 'Hora em que a violência ocorreu (00:00 a 23:59).' },
  LOCAL_OCOR: { label: 'Local de ocorrência', description: 'Local de ocorrência do evento notificado.', values: '01 – Residência; 02 – Habitação coletiva; 03 – Escola; 04 – Local de prática esportiva; 05 – Bar ou similar; 06 – Via pública; 07 – Comércio/serviços; 08 – Indústrias/construção; 09 – Outro; 99 – Ignorado' },
  LOCAL_ESPE: { label: 'Outro local (especificar)', description: 'Qual outro local de ocorrência.' },
  OUT_VEZES: { label: 'Ocorreu outras vezes', description: 'Se a violência é de repetição.', values: SIM_NAO_IGN },
  LES_AUTOP: { label: 'Lesão autoprovocada', description: 'Se a lesão foi autoprovocada.', values: SIM_NAO_NA_IGN },
  VIOL_MOTIV: { label: 'Violência motivada por', description: 'Se a violência tem relação com características da vítima.', values: '01 – Sexismo; 02 – Homofobia/lesbofobia/bifobia/transfobia; 03 – Racismo; 04 – Intolerância religiosa; 05 – Xenofobia; 06 – Conflito geracional; 07 – Situação de rua; 08 – Deficiência; 09 – Outros; 88 – Não se aplica; 99 – Ignorado' },
  VIOL_FISIC: TIPO_VIOL('Violência física'), VIOL_PSICO: TIPO_VIOL('Violência psicológica/moral'),
  VIOL_TORT: TIPO_VIOL('Tortura'), VIOL_SEXU: TIPO_VIOL('Violência sexual'),
  VIOL_TRAF: TIPO_VIOL('Tráfico de seres humanos'), VIOL_FINAN: TIPO_VIOL('Violência financeira/econômica'),
  VIOL_NEGLI: TIPO_VIOL('Negligência/abandono'), VIOL_INFAN: TIPO_VIOL('Trabalho infantil'),
  VIOL_LEGAL: TIPO_VIOL('Intervenção legal'), VIOL_OUTR: TIPO_VIOL('Outro tipo de violência'),
  VIOL_ESPEC: { label: 'Outro tipo de violência (especificar)', description: 'Qual outro tipo de violência ocorreu.' },
  AG_FORCA: MEIO('Força corporal/espancamento'), AG_ENFOR: MEIO('Enforcamento'), AG_OBJETO: MEIO('Objeto contundente'),
  AG_CORTE: MEIO('Objeto perfurocortante'), AG_QUENTE: MEIO('Substância/objeto quente'), AG_ENVEN: MEIO('Envenenamento/intoxicação'),
  AG_FOGO: MEIO('Arma de fogo'), AG_AMEACA: MEIO('Ameaça'), AG_OUTROS: MEIO('Outro meio'),
  AG_ESPEC: { label: 'Outro meio de agressão (especificar)', description: 'Qual outro meio de agressão.' },
  SEX_ASSEDI: SEXUAL('Assédio sexual'), SEX_ESTUPR: SEXUAL('Estupro'), SEX_PORNO: SEXUAL('Pornografia infantil'),
  SEX_EXPLO: SEXUAL('Exploração sexual'), SEX_OUTRO: SEXUAL('Outro tipo de violência sexual'),
  SEX_ESPEC: { label: 'Outra violência sexual (especificar)', description: 'Qual outro tipo de violência sexual.' },
  PROC_DST: PROCEDIMENTO('Profilaxia de IST'), PROC_HIV: PROCEDIMENTO('Profilaxia de HIV'), PROC_HEPB: PROCEDIMENTO('Profilaxia de hepatite B'),
  PROC_SANG: PROCEDIMENTO('Coleta de sangue'), PROC_SEMEN: PROCEDIMENTO('Coleta de sêmen'), PROC_VAGIN: PROCEDIMENTO('Coleta de secreção vaginal'),
  PROC_CONTR: PROCEDIMENTO('Contracepção de emergência'), PROC_ABORT: PROCEDIMENTO('Aborto previsto em lei'),
  NUM_ENVOLV: { label: 'Número de envolvidos', description: 'Número de envolvidos na violência.', values: '1 – Um; 2 – Dois ou mais; 9 – Ignorado' },
  REL_PAI: RELACAO('Pai'), REL_MAE: RELACAO('Mãe'), REL_PAD: RELACAO('Padrasto'), REL_MAD: RELACAO('Madrasta'),
  REL_CONJ: RELACAO('Cônjuge'), REL_EXCON: RELACAO('Ex-cônjuge'), REL_NAMO: RELACAO('Namorado(a)'), REL_EXNAM: RELACAO('Ex-namorado(a)'),
  REL_FILHO: RELACAO('Filho(a)'), REL_IRMAO: RELACAO('Irmão(ã)'), REL_CONHEC: RELACAO('Amigo(s)/conhecido(s)'),
  REL_DESCO: RELACAO('Desconhecido'), REL_CUIDA: RELACAO('Cuidador'), REL_PATRAO: RELACAO('Patrão/chefe'),
  REL_INST: RELACAO('Pessoa com relação institucional'), REL_POL: RELACAO('Policial/agente da lei'),
  REL_PROPRI: RELACAO('A própria pessoa'), REL_OUTROS: RELACAO('Outra relação'),
  REL_ESPEC: { label: 'Outra relação (especificar)', description: 'Qual outra relação com a pessoa atendida.' },
  AUTOR_SEXO: { label: 'Sexo do provável autor', description: 'Sexo do provável autor da agressão.', values: '1 – Masculino; 2 – Feminino; 3 – Ambos os sexos; 9 – Ignorado' },
  AUTOR_ALCO: { label: 'Suspeita de uso de álcool pelo autor', description: 'Se havia suspeita de uso de álcool pelo provável autor.', values: SIM_NAO_IGN },
  CICL_VID_A: { label: 'Ciclo de vida do provável autor', description: 'Ciclo de vida do principal provável autor da violência.', values: '1 – Criança; 2 – Adolescente; 3 – Jovem; 4 – Pessoa adulta; 5 – Pessoa idosa; 9 – Ignorado' },
  ENC_SAUDE: ENCAMINHAMENTO('Rede da saúde'), ASSIST_SOC: ENCAMINHAMENTO('Rede da assistência social'),
  REDE_EDUCA: ENCAMINHAMENTO('Rede de educação'), ATEND_MULH: ENCAMINHAMENTO('Rede de atendimento à mulher'),
  CONS_TUTEL: ENCAMINHAMENTO('Conselho tutelar'), CONS_IDO: ENCAMINHAMENTO('Conselho do idoso'),
  DELEG_IDOS: ENCAMINHAMENTO('Delegacia de atendimento ao idoso'), DIR_HUMAN: ENCAMINHAMENTO('Centro de referência dos direitos humanos'),
  MPU: ENCAMINHAMENTO('Ministério Público'), DELEG_CRIA: ENCAMINHAMENTO('Delegacia de proteção à criança e ao adolescente'),
  DELEG_MULH: ENCAMINHAMENTO('Delegacia de atendimento à mulher'), DELEG: ENCAMINHAMENTO('Outras delegacias'),
  INFAN_JUV: ENCAMINHAMENTO('Justiça da infância e da juventude'), DEFEN_PUBL: ENCAMINHAMENTO('Defensoria pública'),
  REL_TRAB: { label: 'Violência relacionada ao trabalho', description: 'Se a violência é relacionada ao trabalho.', values: SIM_NAO_IGN },
  REL_CAT: { label: 'CAT emitida', description: 'Se foi emitida a comunicação de acidente de trabalho (CAT), quando a violência é relacionada ao trabalho.', values: SIM_NAO_NA_IGN },
  CIRC_LESAO: { label: 'Circunstância da lesão', description: 'Código da CID-10, capítulo XX (V01 a Y98), da circunstância da lesão.' },
  DT_ENCERRA: { label: 'Data de encerramento', description: 'Data de encerramento do caso.', values: DATA },
  DS_OBS: { label: 'Observações', description: 'Observações adicionais.' },
};

/** Leishmaniose tegumentar americana: cutânea e mucosa vêm na mesma ficha, separadas por CLAS_FORMA. */
const LTAN: Readonly<Record<string, DatasusFieldEntry>> = {
  DT_INVEST: { label: 'Data da investigação', description: 'Data de início da investigação do caso.', values: DATA },
  ID_OCUPA_N: { label: 'Ocupação', description: 'Atividade exercida pelo paciente (setor formal, informal ou autônomo) ou a última, se desempregado (CBO).' },
  CLI_CUTANE: { label: 'Lesão cutânea', description: 'Se o paciente apresenta lesão cutânea. Com lesão cutânea e sem lesão mucosa, a forma clínica é preenchida como cutânea.', values: '1 – Sim; 2 – Não' },
  CLI_MUCOSA: { label: 'Lesão mucosa', description: 'Se o paciente apresenta lesão mucosa. Com lesão mucosa, a forma clínica é preenchida como mucosa, mesmo havendo lesão cutânea.', values: '1 – Sim; 2 – Não' },
  CLI_CICATR: { label: 'Cicatriz cutânea (com lesão mucosa)', description: 'Em caso de lesão mucosa, se há cicatrizes cutâneas.', values: '1 – Sim; 2 – Não' },
  CLI_CO_HIV: { label: 'Coinfecção HIV', description: 'Se o paciente apresenta coinfecção LTA/HIV.', values: SIM_NAO_IGN },
  LAB_PARASI: { label: 'Parasitológico direto', description: 'Resultado do exame parasitológico direto. Positivo leva o critério de confirmação a laboratorial.', values: '1 – Positivo; 2 – Negativo; 3 – Não realizado' },
  LAB_IRM: { label: 'IRM (Montenegro)', description: 'Resultado da intradermorreação de Montenegro. Positivo leva o critério de confirmação a laboratorial.', values: '1 – Positivo; 2 – Negativo; 3 – Não realizado' },
  LAB_HISTOP: { label: 'Histopatologia', description: 'Resultado do exame histopatológico. Encontro do parasita ou compatível levam o critério a laboratorial.', values: '1 – Encontro do parasita; 2 – Compatível; 3 – Não compatível; 4 – Não realizado' },
  CLA_TIPO_N: { label: 'Tipo de entrada', description: 'Tipo de entrada do caso.', values: '1 – Caso novo; 2 – Recidiva; 3 – Transferência; 9 – Ignorado' },
  CLAS_FORMA: { label: 'Forma clínica', description: 'Forma clínica da leishmaniose tegumentar. Ignorada só nos registros vindos da base antiga (DOS).', values: '1 – Cutânea; 2 – Mucosa; 9 – Ignorada' },
  DT_INIC_TR: { label: 'Data do início do tratamento', description: 'Data do início do tratamento.', values: DATA },
  TRA_DROGA_: { label: 'Droga inicial administrada', description: 'Medicamento prescrito para o tratamento inicial.', values: '1 – Antimonial pentavalente; 2 – Anfotericina B; 3 – Pentamidina; 4 – Outras; 5 – Não utilizada' },
  TRA_PESO: { label: 'Peso (kg)', description: 'Peso do paciente em kg, quando a droga inicial é antimonial pentavalente.' },
  TRA_DOSE: { label: 'Dose prescrita (mg/kg/dia Sb+5)', description: 'Dose prescrita de antimonial pentavalente, em mg/kg/dia.', values: '1 – Menor que 10; 2 – Maior ou igual a 10 e menor que 15; 3 – Igual a 15; 4 – Maior ou igual a 15 e menor que 20; 5 – Maior ou igual a 20' },
  TRA_AMPOLA: { label: 'Nº total de ampolas prescritas', description: 'Número total de ampolas prescritas no tratamento inicial com antimonial pentavalente.' },
  TRA_OUTR_N: { label: 'Outra droga na falência do tratamento inicial', description: 'Droga utilizada na falência do tratamento inicial.', values: '1 – Anfotericina B; 2 – Pentamidina; 3 – Outros; 4 – Não se aplica' },
  CRITERIO: { label: 'Critério de confirmação', description: 'Critério de confirmação, preenchido a partir do parasitológico direto, da IRM e da histopatologia.', values: '1 – Laboratorial; 2 – Clínico-epidemiológico' },
  CON_CLASS_: { label: 'Classificação epidemiológica', description: 'Classificação epidemiológica do caso.', values: '1 – Autóctone; 2 – Importado; 3 – Indeterminado' },
  DOENCA_TRA: { label: 'Doença relacionada ao trabalho', description: 'Se a doença está relacionada ao ambiente de trabalho do paciente.', values: SIM_NAO_IGN },
  EVOLUCAO: { label: 'Evolução do caso', description: 'Evolução do caso.', values: '1 – Alta por cura; 2 – Abandono; 3 – Óbito por LTA; 4 – Óbito por outras causas; 5 – Transferência; 6 – Mudança de diagnóstico' },
  DT_OBITO: { label: 'Data do óbito', description: 'Data do óbito.', values: DATA },
  DT_ENCERRA: { label: 'Data de encerramento', description: 'Data de encerramento do caso.', values: DATA },
};

export const SINAN_AGRAVOS: Readonly<Record<string, Readonly<Record<string, DatasusFieldEntry>>>> = {
  LTAN,
  VIOL,
  DENG,
  CHIK: DENG,
  SIFC,
  SIFG,
  HANS,
  TUBE,
};

export const SINAN_AGRAVO_SOURCES: Readonly<Record<string, string>> = {
  LTAN: 'Dicionário de dados SINAN NET 5.0 – Leishmaniose tegumentar americana (LTAN_DIC_DADOS.pdf), DATASUS',
  HANS: 'Dicionário de dados SINAN NET 5.0 – Hanseníase (HANSN_DIC_DADOS.pdf), DATASUS',
  TUBE: 'Dicionário de dados SINAN NET – Tuberculose (TUBEN_DIC_DADOS.pdf), DATASUS',
  SIFG: 'Dicionário de dados SINAN NET – Sífilis em gestante (SIFIGEN_DIC_DADOS.pdf), DATASUS',
  SIFC: 'Dicionário de dados SINAN NET – Sífilis congênita (SIFICN_DIC_DADOS.pdf), DATASUS',
  DENG: 'Dicionário de dados Sinan Online – Dengue e chikungunya (DENGON_DIC_DADOS.pdf), DATASUS',
  VIOL: 'Dicionário de dados SINAN NET – Violência interpessoal/autoprovocada (VIOLEN_DIC_DADOS.pdf), DATASUS',
  CHIK: 'Dicionário de dados Sinan Online – Dengue e chikungunya (DENGON_DIC_DADOS.pdf), DATASUS',
};

/** O que o dicionário do agravo diz de um campo, quando diz. */
export function sinanAgravoEntry(prefix: string | undefined, field: string): { entry: DatasusFieldEntry; source: string } | undefined {
  if (!prefix) return undefined;
  const agravo = prefix.toUpperCase();
  const campos = SINAN_AGRAVOS[agravo];
  if (!campos) return undefined;
  const nome = field.toUpperCase();
  const entry = campos[nome] ?? campos[APELIDOS[agravo]?.[nome] ?? ''];
  return entry ? { entry, source: SINAN_AGRAVO_SOURCES[agravo] ?? 'SINAN' } : undefined;
}
