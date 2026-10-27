# TabSis Local (Windows, Linux, macOS)

App de computador do TabSis. Faz duas coisas:

1. **Baixa do DATASUS para uma pasta sua.** Escolha sistema, tipo, anos, UF e
   meses e clique em "Procurar e baixar". Os arquivos vêm do FTP oficial
   (`ftp.datasus.gov.br`), que continua no ar quando o portal cai. Cada
   combinação é conferida na listagem da pasta do FTP antes de baixar, e o app
   avisa o que não foi publicado.
2. **Liga-se ao TabSis (tabweb.me).** Com o app aberto e o site conectado
   (botão "Abrir o TabSis conectado", ou colando o token em "TabSis Local no
   computador"):
   - todo arquivo que o site baixar ganha uma cópia na pasta, e o site diz onde
     ela ficou;
   - "Enviar para o computador" copia o que estava guardado no navegador;
   - "No computador" lista o que já está na pasta e abre no site sem baixar de
     novo. Também dá para marcar vários e abrir juntos.

A pasta padrão é `Downloads/TabSis`, trocável na janela. Qualquer outro
programa (TabWin, R, Python, Excel) abre os arquivos por ela. O que vem do
navegador fica em `Downloads/TabSis/Guardados do navegador`.

## Instalar

Baixe o executável do seu sistema em
[Releases](https://github.com/redkk123/tabsis/releases/latest). Não precisa
instalar Python.

- **Windows:** `TabSis-Local-windows.exe`. O SmartScreen pode avisar de
  "editor desconhecido": clique em "Mais informações → Executar assim mesmo".
- **Linux:** `TabSis-Local-linux`; rode `chmod +x` e abra.
- **macOS:** `TabSis-Local-macos.zip`. Na primeira vez, abra com o botão
  direito → Abrir, porque o app não é assinado pela Apple.

Ou rode o código direto, com Python 3.10+ e Tkinter:

```bash
python3 apps/desktop/tabsis_local.py
```

Opções: `--pasta <pasta>`, `--porta 8787` e `--sem-janela` (só o servidor,
com o token e o link de conexão no terminal).

## Segurança

O app escuta só em `127.0.0.1`. Ele aceita apenas o site do TabSis (CORS sem
`*`) e um token que muda a cada vez que abre (comparação em tempo constante).
Ele só baixa o FTP público e os pacotes preparados do DATASUS.

A página nunca escolhe onde gravar: o nome do arquivo é higienizado e tudo fica
dentro da pasta do app. Arquivos são gravados em `.part` e só ganham o nome
final quando estão inteiros; um download interrompido continua de onde parou.

O site só lê da pasta arquivos de dados (`.dbc`, `.dbf`, `.parquet`, `.csv`,
`.def`, `.cnv`, `.map`, `.zip`).

Ele fala o mesmo protocolo do downloader local antigo (`apps/tabwin-bridge`,
"tabwin-bridge" versão 1), então o site o reconhece no mesmo lugar.

## Testes

```bash
cd apps/desktop && python3 -m unittest test_tabsis_local -v
```

Os testes não dependem da rede: o HTTPS do DATASUS é simulado. O e2e
`TabSis Local: …` em `e2e/app.spec.ts` sobe o app de verdade e confere a
ligação com o site.

## Versões

Cada tag `v*` gera os executáveis no GitHub Actions
(`.github/workflows/release.yml`) e os publica no release, junto com o APK
Android. A versão do app está em `VERSAO`, no topo de `tabsis_local.py`.
