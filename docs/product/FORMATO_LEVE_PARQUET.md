# Formato leve: DBC em Parquet, na Cloudflare e no navegador

Pedido do professor (2026-10-13): converter o DBC para algo mais leve antes de
guardar na Cloudflare, e tomar cuidado com o cache do navegador.

## Por que Parquet

O DBC é um DBF inteiro comprimido de uma vez (PKWARE DCL Implode). Para tabular
um campo é preciso descomprimir **e decodificar** o registro todo: medido no
DNBR2024, decodificar registro é 84–85% do tempo de abrir o arquivo
(`npm run bench:decode-breakdown`).

O Parquet guarda cada coluna num bloco próprio, com dicionário e ZSTD:

| Arquivo | Registros | Campos | DBC | Parquet | Razão | Conversão |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| RDAC2401 | 4.315 | 113 | 306 KB | 175 KB | 57% | 0,9 s |
| DOINF23 | 32.017 | 87 | 3,4 MB | 1,6 MB | 47% | 2,5 s |
| DENGBR25 | 1.643.215 | 121 | 64,7 MB | 31,5 MB | 49% | 120 s |

Metade do download, e a tabulação lê só as colunas que o plano usa.

Formato aberto: o mesmo arquivo abre no R (`arrow`), no Python (`pandas`,
`polars`) e no DuckDB.

## A regra que não muda: os números são os mesmos

O motor de tabulação (o que os goldens provam contra o TabWin 4.15) continua
sendo o único. O Parquet só muda **de onde** os registros vêm, e eles chegam
iguais:

- cada campo vai com o tipo que o leitor de DBF devolve — `C` texto, `N`/`F`
  número, `I` inteiro, `D` data, `L` lógico, vazio como nulo;
- o cabeçalho do DBF (nomes, tipos, tamanhos, decimais) vai nos metadados do
  arquivo (`tabsis.dbf-header`);
- a procedência também: nome original, SHA-256 e tamanho do DBC, registros e
  versão do conversor (`tabsis.fonte`).

`scripts/verify-parquet-parity.mjs` compara registro a registro, valor e tipo.
Resultado: RDAC2401 (4.315 × 113), DOINF23 (32.017 × 87) e DENGBR25
(1.643.215 × 121) idênticos.

## Comandos

```bash
npm run parquet:converter -- caminho/RDAC2401.dbc          # gera RDAC2401.parquet ao lado
npm run verify:parquet -- caminho/RDAC2401.dbc caminho/RDAC2401.parquet
```

O nome-base é sempre o original do DATASUS (`RDAC2401.dbc` → `RDAC2401.parquet`).

## No aplicativo

- **Abrir arquivo** aceita `.parquet`.
- O worker de dados guarda os bytes e decodifica **só as colunas que cada
  pedido usa** (tabular, listar valores, perfil numérico), uma vez cada.
- A tabela, o log, as receitas e a auditoria funcionam igual; "Extrair DBF
  original" não se aplica (o Parquet não carrega os bytes do DBF).

## No espelho (Cloudflare R2)

O manifesto `apps/web/public/mirror.json` — no git, nunca no bucket — passa a
declarar a versão leve de cada arquivo:

```json
{
  "name": "DNBR2024.dbc", "path": "sinasc/DNBR2024.dbc", "sha256": "…", "bytes": 117643243,
  "parquet": { "path": "sinasc/DNBR2024.parquet", "sha256": "…", "bytes": 0, "rows": 0,
               "converter": "tabsis-dbc-para-parquet/1" }
}
```

A cadeia de confiança: o app baixa o Parquet, confere o **SHA-256 do Parquet**
contra o manifesto e confere que o **SHA-256 do DBC** gravado dentro do Parquet
é o mesmo que o manifesto declara para o DBC. Qualquer falha — Parquet ausente,
hash errado, origem trocada — cai no DBC do mesmo espelho, e só depois no
DATASUS.

### Publicar

```bash
npx wrangler login                       # uma vez por máquina (a credencial não vai no git)
npm run mirror:sync -- --bucket tabwin-mirror --base https://pub-41df939070d7465a8513416a16be8f88.r2.dev
```

O script baixa cada arquivo de `docs/product/mirror-files.json` do DATASUS,
converte, **confere a paridade antes de enviar**, envia DBC e Parquet e regrava
o manifesto. `--dry-run --so DOINF23.dbc` faz tudo sem enviar e sem regravar o
manifesto (testado em 2026-10-13: DOINF23 3,4 MB → 1,6 MB, paridade conferida,
SHA-256 do DBC igual ao do manifesto atual).

**Atenção:** o manifesto publicado é de 2026-09-03 e o aplicativo ignora
manifesto com mais de 30 dias (`MIRROR_MAX_AGE_MS`). Hoje o espelho está sendo
ignorado e tudo vem do DATASUS. Rodar o `mirror:sync` resolve as duas coisas.

## Cache do navegador

O que mudou, e por quê:

| Antes | Agora |
| --- | --- |
| Até 6 pacotes, sem olhar tamanho. Seis SINASC nacionais passam de 700 MB; quando a origem estoura a cota, o navegador apaga **o site inteiro**. | Teto em **bytes**: o menor entre 1,5 GB e metade do espaço que o navegador diz ter livre para o site (`navigator.storage.estimate()`). Sem estimativa (modo privado), 512 MB. Também no máximo 12 pacotes. |
| Listar o cache trazia os pacotes para a memória (o maior deles de cada vez). | Índice só de metadados (banco v2, migração automática de quem já tinha pacotes): listar e decidir o que apagar não toca nos bytes. |
| Download do espelho não ficava guardado. | Fica, com as mesmas regras. |
| — | A tela de downloads recentes diz quanto está usado e o teto ("312 MB de 1,5 GB"). |

O que **não** fazemos de propósito:

- **Service worker.** É a armadilha clássica de aplicativo velho servido para
  sempre. A versão nova chega porque o GitHub Pages deixa o HTML no cache por
  no máximo 10 minutos (`max-age=600`) e os scripts têm hash no nome (Vite); uma
  aba aberta antes de uma publicação mostra o botão "Atualizar" (`version.json`
  lido com `cache: 'no-store'`).
- **Confiar em cache por nome.** Dado do DATASUS guardado vale 24 h (auxiliares,
  7 dias); o espelho é verificado por hash a cada download; partes retomáveis
  são indexadas pelo hash esperado.
