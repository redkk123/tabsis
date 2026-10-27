# Troca de endereço: tabweb.me → tabsis.me

Data: 2026-10-27. Status: preparado; falta registrar o domínio.

Em 2026-10-27, `tabsis.me` não tinha registro (consulta RDAP sem resultado).
Hoje `tabweb.me` está na Namecheap (DNS `registrar-servers.com`) e aponta para
o GitHub Pages.

## Já feito (funciona antes e depois da virada)

O Worker do DATASUS, o TabSis Local e a política do auxiliar aceitam
`tabsis.me` e `www.tabsis.me` junto com os endereços antigos. Liberar a origem
antes não custa nada: ela só vale se o navegador realmente vier dela. Liberar
depois quebraria todo download no instante da virada.

## 1. Registrar (Red)

- O Student Pack da Namecheap dá um `.me` grátis por um ano. Não está claro se
  dá um segundo; tentar pelo link do pack com a mesma conta. Se não der, `.me`
  sai barato no primeiro ano em qualquer registrador.
- Anotar a data de renovação do `tabweb.me`, que também foi do pack: quando
  vencer, o redirecionamento do passo 4 para de funcionar.

## 2. DNS do tabsis.me (Red, no painel do registrador)

| Tipo | Host | Valor |
| --- | --- | --- |
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |
| CNAME | www | redkk123.github.io. |

## 3. Virada no repositório (Claude, num PR)

- `apps/web/public/CNAME` → `tabsis.me`. No GitHub: Settings → Pages → Custom
  domain `tabsis.me`; marcar "Enforce HTTPS" quando o certificado sair.
- Trocar os textos e links (README, baixar.html, release-notes, manual, modelo
  de issue, LEIA-ME do "Rodar no computador"; cerca de 40 ocorrências) e o
  `SITE` do TabSis Local.
- Release nova do TabSis Local (o botão "Abrir o TabSis conectado" abre o
  `SITE`).
- **Não mudar** `app.tabweb.me` no Android: é um endereço interno, que nunca
  sai do aparelho. Trocá-lo apagaria o que o app guardou (downloads recentes,
  análises salvas), porque o armazenamento é por endereço.

## 4. O endereço antigo continua levando ao site (Red)

Na Namecheap, no `tabweb.me`, trocar os registros A por "URL Redirect Record"
(301, permanente) para `https://tabsis.me`. Links já compartilhados continuam
funcionando enquanto o `tabweb.me` estiver pago.

Os dados que cada navegador guardou (downloads, análises) ficam presos ao
endereço antigo: quem usava `tabweb.me` vê o TabSis vazio em `tabsis.me`. O
aviso na página precisa dizer isso, e os arquivos do TabSis Local não são
afetados, porque estão na pasta do computador.
