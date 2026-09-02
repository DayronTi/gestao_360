# Gestão à Vista 360 — Frontend

Painel de chamados do GLPI para o setor de **CSC / Compras, Financeiro e Manutenção**
do Grupo Logos. Página estática (HTML + CSS + JS puro), publicada via GitHub Pages.

## Estrutura

```
index.html        # marcação do painel
assets/style.css   # tema (dark)
assets/app.js      # lógica: consumo da API, filtros, gráficos e tabelas
CNAME              # domínio do GitHub Pages (gestao.csc)
```

## Como funciona

- A cada 5 min o `app.js` chama `GET {API_BASE}/api/chamados` e redesenha o painel.
- **`API_BASE`** fica no topo do `assets/app.js` — aponte para a URL da API GLPI.
- A **categorização por setor vem pronta da API** (campo `setor`, derivado da Categoria
  ITIL do GLPI). O frontend não adivinha mais pelo título do chamado.

### Contrato esperado da API (`/api/chamados` → lista de objetos)

Cada chamado precisa trazer, além dos campos do GLPI:

| campo | descrição |
|---|---|
| `setor` | `FINANCEIRO` \| `CSC` \| `MANUTENÇÃO` |
| `categoria_id`, `categoria_completename` | categoria ITIL |
| `status_label`, `prioridade_label` | rótulos legíveis (mapa único no backend) |
| `tecnicos` | lista `[{id, nome}]` |
| `tecnicos_ids`, `tecnicos_nomes` | idem, achatados |
| `requerente_nomes` | lista de nomes |

> Requer a versão correspondente do backend. Um backend que devolva os chamados
> "crus" do GLPI (sem `setor`/`status_label`/`tecnicos`) não popula o painel.

## Rodar local

```bash
python -m http.server 5500
# abre http://127.0.0.1:5500
```

## Views

- **Por categoria** — chamados agrupados pela categoria ITIL
- **Por setor** — agrupados por Financeiro / CSC / Manutenção
- **Fila por técnico** — carga de trabalho por técnico + fila sem atribuição

Filtros: mês, técnico, status, SLA, setor e "sem técnico" (clicáveis, combináveis).
