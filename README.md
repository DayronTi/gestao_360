# Gestão à Vista 360 — Frontend

Painel de chamados do GLPI para o **setor de Compras / Suprimentos** do Grupo Logos
(Compras, Frotas, Viagens Corporativas, VExpenses e Manutenção). Página estática
(HTML + CSS + JS puro), publicada via GitHub Pages.

## Estrutura

```
index.html         # marcação do painel
assets/style.css   # tema (dark)
assets/app.js      # lógica: consumo da API, SLA, filtros, gráficos e tabelas
CNAME              # domínio do GitHub Pages (gestao.csc)
```

## Como funciona

- A cada 5 min o `app.js` chama `GET {API_BASE}/api/chamados` e redesenha o painel.
- **`API_BASE`** fica no topo do `assets/app.js` — aponte para a URL HTTPS da API.
- Aceita `?key=<API_KEY>` na URL (guardada no navegador) e envia como header
  `X-API-Key` — útil para telão/TV quando a API exigir chave.
- **Escopo e categoria vêm prontos da API.** O backend descarta chamados de Ofício e
  de técnicos de fora do setor, e classifica cada chamado em uma das 5 categorias
  (Categoria ITIL como sinal principal + catálogo de palavra-chave como reforço).

### Contrato esperado da API (`/api/chamados` → lista de objetos)

| campo | descrição |
|---|---|
| `categoria` | `Compras` \| `Frotas` \| `Viagens Corporativas` \| `VExpenses` \| `Manutenção` |
| `categoria_completename` | categoria ITIL de origem (exibida no detalhe) |
| `status_label`, `prioridade_label` | rótulos legíveis (mapa único no backend) |
| `tecnicos` | lista `[{id, nome}]` · `tecnicos_ids` / `tecnicos_nomes` achatados |
| `solicitante` | nome do requerente |
| `Data de abertura`, `Data de fechamento`, `Tempo para solução + Progresso` | datas do GLPI |

> Requer a versão correspondente do backend. Um backend que devolva os chamados
> "crus" do GLPI (sem `categoria`/`status_label`/`tecnicos`) não popula o painel.

## SLA — duas leituras lado a lado

- **Política** — Cotação + Aprovação por prioridade (`POLITICA_SLA` no `app.js`), em
  horas corridas ou **dias úteis**. Ajuste a tabela se a política oficial mudar.
- **GLPI** — o campo de prazo que o próprio sistema calcula (`Tempo para solução`).

Chamados encerrados comparam o prazo com a data real de fechamento; os em andamento,
com agora. `Pendente` não entra na conta (aguardando o solicitante).

## Rodar local

```bash
python -m http.server 5500   # abre http://127.0.0.1:5500
```

## Views

- **Por categoria** — as 5 categorias, cada card com quebra de SLA por status
- **Por unidade** — chamados de cada unidade, separados por categoria
- **Fila por técnico** — carga por técnico + fila sem atribuição, agrupada por unidade

Filtros clicáveis e combináveis: mês (ativo no mês), técnico, status, SLA (política),
categoria e "sem técnico".
