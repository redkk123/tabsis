import type {
  DefDataSource,
  DefDbfLookupOption,
  DefDefinition,
  DefDirective,
  DefExternalLookupOption,
  DefIncrement,
  DefOption,
  DefRole,
  DefUnknownLine,
} from './def-model.js';

export class DefParseError extends Error {
  constructor(
    message: string,
    readonly line?: number,
  ) {
    super(line ? `DEF line ${line}: ${message}` : message);
    this.name = 'DefParseError';
  }
}

export interface ParseDefOptions {
  /**
   * Strict mode validates documented fields for recognized directives. Unknown
   * directive letters are still retained as comments/unknown lines because the
   * TabWin manual explicitly treats undefined first-position characters as comments.
   */
  strict?: boolean;
}

const OPTION_DIRECTIVES = new Set(['S', 'L', 'C', 'Q', 'D', 'T', 'X']);

function rolesForDirective(directive: DefOption['directive']): DefRole[] {
  switch (directive) {
    case 'S':
      return ['selection'];
    case 'L':
      return ['row'];
    case 'C':
      return ['column'];
    case 'Q':
      return ['quad'];
    case 'D':
      return ['row', 'quad'];
    case 'T':
      return ['row', 'column', 'quad'];
    case 'X':
      // Oracle, 2026-10-13: TabWin 4.15 lists an X option under Linhas,
      // Colunas and Seleções disponíveis at the same time.
      return ['row', 'column', 'selection'];
  }
}

function splitCommaFields(rest: string): string[] {
  // DEF syntax predates CSV quoting and its documented examples use comma as an
  // unconditional separator. Preserve empty fields rather than filtering them.
  return rest.split(',').map((value) => value.trim());
}

function parseDataSource(rest: string, sourceLine: number, strict: boolean): DefDataSource {
  const fields = splitCommaFields(rest);
  const pattern = fields[0] ?? '';
  if (strict && !pattern) throw new DefParseError('A directive has no data-file pattern', sourceLine);
  if (strict && fields.length > 2) {
    throw new DefParseError('A directive has more than the documented pattern + SQL fields', sourceLine);
  }
  const sqlQuery = fields[1];
  return {
    pattern,
    ...(sqlQuery ? { sqlQuery } : {}),
    sourceLine,
  };
}

function parseOption(
  directive: DefOption['directive'],
  rest: string,
  sourceLine: number,
  strict: boolean,
): DefOption {
  const fields = splitCommaFields(rest);
  // Três campos ("L + NOME FANTASIA, TITULO, LINHA_COMENTARIO_…" no
  // Producao_Ambulatorial.DEF oficial do SIA): o TabWin lista a opção e lê o
  // terceiro campo como a tabela de conversão — só reclama se alguém a usar
  // ("Tabela de conversão não encontrada"; RE-003, tela 19). Aqui também: vira
  // uma opção cuja CNV não existe, que o painel mostra em cinza, em vez de
  // recusar o DEF inteiro.
  if (fields.length === 3 && fields[0] && fields[1] && fields[2] && !/^\d+$/.test(fields[2])) {
    return {
      kind: 'conversion',
      directive,
      label: fields[0],
      field: fields[1],
      roles: rolesForDirective(directive),
      startPosition: 1,
      conversionFile: fields[2],
      sourceLine,
      threeFields: true,
    } as DefOption;
  }
  if (strict && fields.length < 4) {
    throw new DefParseError(
      `${directive} directive expects at least 4 comma-separated fields after the directive; got ${fields.length}`,
      sourceLine,
    );
  }

  const [label = '', field = '', third = '', fourth = '', ...trailingFields] = fields;
  const retainedTrailingFields = trailingFields.length ? { trailingFields } : {};
  if (strict && !label) throw new DefParseError(`${directive} directive has no display label`, sourceLine);
  if (strict && !field) throw new DefParseError(`${directive} directive has no DBF field`, sourceLine);
  if (strict && !third) throw new DefParseError(`${directive} directive has an empty third field`, sourceLine);
  if (strict && !fourth) throw new DefParseError(`${directive} directive has no conversion/lookup file`, sourceLine);

  const roles = rolesForDirective(directive);
  if (/^\d+$/.test(third)) {
    const startPosition = Number(third);
    if (!Number.isInteger(startPosition) || startPosition <= 0) {
      throw new DefParseError('CNV start position must be a positive integer', sourceLine);
    }
    return {
      kind: 'conversion',
      directive,
      label,
      field,
      roles,
      startPosition,
      conversionFile: fourth,
      sourceLine,
      ...retainedTrailingFields,
    };
  }

  if (/\.dbf$/i.test(fourth)) {
    const option: DefDbfLookupOption = {
      kind: 'dbf-lookup',
      directive,
      label,
      field,
      roles,
      lookupLabelField: third,
      lookupFile: fourth,
      sourceLine,
      ...retainedTrailingFields,
    };
    return option;
  }

  // Texto no terceiro campo com uma CNV no quarto (DS_TPFIN + TP_FINAN.CNV no
  // RD2008.DEF; NM_AGRAVO + agravsurt.cnv no SINAN). Medido no TabWin 4.15
  // (RE-004, 2026-10-14): a tabela sai idêntica à da mesma linha com "1" no
  // terceiro campo — o texto é ignorado e a CNV é lida da posição 1.
  if (/\.cnv$/i.test(fourth)) {
    return {
      kind: 'conversion',
      directive,
      label,
      field,
      roles,
      startPosition: 1,
      conversionFile: fourth,
      ignoredThirdField: third,
      sourceLine,
      ...retainedTrailingFields,
    };
  }

  // Outro recurso (sem caso real medido): guardado, sem fingir que executa.
  const option: DefExternalLookupOption = {
    kind: 'external-lookup',
    directive,
    label,
    field,
    roles,
    lookupLabelField: third,
    resourceFile: fourth,
    sourceLine,
    ...retainedTrailingFields,
  };
  return option;
}

function parseIncrement(rest: string, sourceLine: number, strict: boolean): DefIncrement {
  const fields = splitCommaFields(rest);
  if (strict && fields.length !== 2) {
    throw new DefParseError(`I directive expects label,field; got ${fields.length} fields`, sourceLine);
  }
  const [label = '', field = ''] = fields;
  if (strict && (!label || !field)) throw new DefParseError('I directive requires label and field', sourceLine);
  return { label, field, sourceLine };
}

export function parseDef(text: string, options: ParseDefOptions = {}): DefDefinition {
  const strict = options.strict ?? true;
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');

  const dataSources: DefDataSource[] = [];
  const defOptions: DefOption[] = [];
  const increments: DefIncrement[] = [];
  const comments: string[] = [];
  const unknownLines: DefUnknownLine[] = [];
  const warnings: string[] = [];
  let description: string | undefined;
  let groupedCountField: string | undefined;
  let reportFile: string | undefined;
  let helpFile: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    const sourceLine = i + 1;
    if (!raw.trim()) continue;

    const first = raw[0] ?? '';
    if (first === ';') {
      const comment = raw.slice(1).trim();
      if (comment) {
        comments.push(comment);
        if (description === undefined) description = comment;
      }
      continue;
    }

    // Historical docs say blank in position 1 means comment. Do not trim first.
    if (/\s/.test(first)) {
      comments.push(raw.trim());
      continue;
    }

    const directive = first.toUpperCase();
    const rest = raw.slice(1).trim();

    if (directive === 'A') {
      dataSources.push(parseDataSource(rest, sourceLine, strict));
      continue;
    }
    if (OPTION_DIRECTIVES.has(directive)) {
      const option = parseOption(directive as DefOption['directive'], rest, sourceLine, strict);
      defOptions.push(option);
      if ('threeFields' in option) {
        delete (option as { threeFields?: boolean }).threeFields;
        warnings.push(`${directive} directive at line ${sourceLine} has 3 fields; like TabWin, the third is read as the conversion table (${(option as { conversionFile: string }).conversionFile})`);
      }
      if (option.trailingFields?.length) {
        warnings.push(
          `${directive} directive at line ${sourceLine} contains ${option.trailingFields.length} retained trailing field(s) with unresolved semantics`,
        );
      }
      continue;
    }
    if (directive === 'I') {
      increments.push(parseIncrement(rest, sourceLine, strict));
      continue;
    }
    if (directive === 'G') {
      if (strict && !rest) throw new DefParseError('G directive has no grouped-frequency field', sourceLine);
      if (groupedCountField !== undefined) {
        warnings.push(
          `multiple G directives found; TabWin documentation says G should occur at most once (line ${sourceLine})`,
        );
      } else {
        groupedCountField = rest;
      }
      continue;
    }
    if (directive === '?') {
      if (rest && helpFile === undefined) helpFile = rest;
      continue;
    }
    if (directive === 'R') {
      if (strict && !rest) throw new DefParseError('R directive has no report file', sourceLine);
      if (reportFile !== undefined) warnings.push(`multiple R directives found; keeping first (${reportFile})`);
      else reportFile = rest;
      continue;
    }

    // The historical manual treats any other first-position character as a
    // comment. Keep the line for audit instead of dropping it silently.
    unknownLines.push({ directive, raw, sourceLine });
  }

  if (dataSources.length === 0) warnings.push('no A data-source directive was found');
  if (defOptions.length === 0) warnings.push('no S/L/C/Q/D/T/X options were found');

  return {
    ...(description !== undefined ? { description } : {}),
    dataSources,
    options: defOptions,
    increments,
    ...(groupedCountField !== undefined ? { groupedCountField } : {}),
    ...(reportFile !== undefined ? { reportFile } : {}),
    ...(helpFile !== undefined ? { helpFile } : {}),
    comments,
    unknownLines,
    warnings,
  };
}

export function optionsForRole(definition: DefDefinition, role: DefRole): DefOption[] {
  return definition.options.filter((option) => option.roles.includes(role));
}
