// ----------------------------------------------------------------------
// CONEXÃO COM A API
// ----------------------------------------------------------------------
const API_BASE = 'http://170.244.117.121:5000';

// Chave da API (header X-API-Key). Deixe '' se a API não exigir.
// Também aceita ?key=... na URL (guarda no navegador — útil p/ TV/telão).
const API_KEY = (() => {
  try {
    const u = new URL(location.href);
    const k = u.searchParams.get('key');
    if (k) { localStorage.setItem('painel360_api_key', k); return k; }
    return localStorage.getItem('painel360_api_key') || '';
  } catch (e) { return ''; }
})();

// ----------------------------------------------------------------------
// REGRAS DE NEGÓCIO (o filtro de escopo/categoria fica na API agora)
// ----------------------------------------------------------------------
const REGRAS = {
  status_considerados: ['Em atendimento (atribuído)', 'Em atendimento (planejado)', 'Pendente', 'Solucionado', 'Fechado'],
  ano_considerado: 2026,
};

// As 5 categorias do painel — as chaves batem com o campo `categoria` da API.
const CATS = [
  { key: 'Compras',              hex: '#4fae7a' },
  { key: 'Manutenção',           hex: '#3fb6c4' },
  { key: 'Viagens Corporativas', hex: '#d98a4a' },
  { key: 'Frotas',               hex: '#4a90d9' },
  { key: 'VExpenses',            hex: '#a879e0' },
];

const STATUS_ORDER = ['Em atendimento (atribuído)', 'Em atendimento (planejado)', 'Pendente', 'Solucionado', 'Fechado'];
const STATUS_LABEL = {
  'Novo': 'Novo',
  'Em atendimento (atribuído)': 'Em atendimento',
  'Em atendimento (planejado)': 'Em atend. (plan.)',
  'Pendente': 'Pendente',
  'Solucionado': 'Solucionado',
  'Fechado': 'Fechado',
};
const STATUS_CLASS = {
  'Novo': 'st-Novo',
  'Em atendimento (atribuído)': 'st-Em-atendimento',
  'Em atendimento (planejado)': 'st-Em-atendimento',
  'Pendente': 'st-Pendente',
  'Solucionado': 'st-Solucionado',
  'Fechado': 'st-Fechado',
};
function statusColor(s) {
  if (s === 'Pendente') return 'var(--st-pend)';
  if (s === 'Solucionado') return 'var(--st-solved)';
  if (s === 'Fechado') return 'var(--st-novo)';
  return 'var(--st-atend)';
}

const SLA_LABEL = { ok: 'No prazo', warn: 'Quase vencendo', crit: 'Vencido', paused: 'Pausado' };
const CORES_SLA = { ok: '#4fae7a', warn: 'var(--st-atend)', crit: 'var(--st-pend)', paused: '#6b7684' };
const STATUS_SLA_RELEVANTES = ['Em atendimento (atribuído)', 'Em atendimento (planejado)', 'Solucionado', 'Fechado'];
const STATUS_PRECISA_ATRIBUICAO = ['Em atendimento (atribuído)', 'Em atendimento (planejado)', 'Novo', 'Pendente'];

const PRIO_WEIGHT = { 'Alta': 3, 'Média': 2, 'Baixa': 1 };
const PRIO_COLOR = { 'Alta': 'var(--st-pend)', 'Média': 'var(--st-atend)', 'Baixa': 'var(--compras)' };

const NOMES_MES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

// ----------------------------------------------------------------------
// ESTADO
// ----------------------------------------------------------------------
let TICKETS = [];
let TICKETS_BASE = [];        // já filtrado por status_considerados
let BRANCH_SUGGESTION = {};
let mesSelecionado = '';
let activeCat = null;
let activeStatus = null;
let activeSla = null;
let activeAtribuicao = null;
let activeTecnico = null;
let sortState = {};
let activeUnidade = null;
let sortStateUnidade = {};

// ----------------------------------------------------------------------
// HELPERS DE DATA
// ----------------------------------------------------------------------
// API manda "YYYY-MM-DD HH:MM:SS"; o painel trabalha com "DD-MM-YYYY HH:MM".
function converterData(dataStr) {
  if (!dataStr) return null;
  const [dataPart, horaPart] = String(dataStr).split(' ');
  if (!dataPart || dataPart.indexOf('-') === -1) return null;
  const [ano, mes, dia] = dataPart.split('-');
  const [h, m] = (horaPart || '00:00').split(':');
  return `${dia}-${mes}-${ano} ${h}:${m}`;
}
function parseDateBR(str) {
  if (!str) return null;
  const [datePart, timePart] = str.trim().split(' ');
  const [dd, mm, yyyy] = datePart.split('-').map(Number);
  let hh = 0, min = 0;
  if (timePart) { [hh, min] = timePart.split(':').map(Number); }
  const d = new Date(yyyy, mm - 1, dd, hh || 0, min || 0);
  return isNaN(d.getTime()) ? null : d;
}
const parseAbertura = parseDateBR;

// ----------------------------------------------------------------------
// MAPEAMENTO DO PAYLOAD DA API -> ticket do painel
// ----------------------------------------------------------------------
function bucketPrioridade(label) {
  const l = String(label || '').toLowerCase();
  if (l.includes('alta') || l.includes('crít') || l.includes('crit')) return 'Alta';
  if (l.includes('baixa')) return 'Baixa';
  return 'Média';
}

function mapearChamados(brutos) {
  return brutos.map(ch => {
    const tecnicos = Array.isArray(ch['tecnicos']) ? ch['tecnicos'].map(t => (t && t.nome) ? t.nome : String(t)) : [];
    return {
      id: String(ch['ID']),
      categoria: ch['categoria'] || 'Compras',
      assunto: ch['titulo_bruto'] ? String(ch['titulo_bruto']).replace(/\t/g, ' ').trim() : 'Sem assunto',
      solicitante: ch['solicitante'] || (Array.isArray(ch['requerente_nomes']) ? ch['requerente_nomes'][0] : '') || '',
      entidade: ch['Entidade'] ? String(ch['Entidade']).split('>').pop().trim() : 'LOGOS - MATRIZ',
      status: ch['status_label'] || 'Desconhecido',
      prioridade: bucketPrioridade(ch['prioridade_label']),
      prioridadeCompleta: ch['prioridade_label'] || 'Média',
      abertura: converterData(ch['Data de abertura']),
      prazo: converterData(ch['Tempo para solução + Progresso']),
      fechamento: converterData(ch['Data de fechamento']),
      tecnicos,
      tecnicosIds: (ch['tecnicos_ids'] || []).map(String),
      categoriaItil: ch['categoria_completename'] || '',
    };
  });
}

// ----------------------------------------------------------------------
// SLA — POLÍTICA (Cotação + Aprovação por prioridade, em dias úteis/horas)
// ----------------------------------------------------------------------
const POLITICA_SLA = {
  'Crítica':     { cotacaoHoras: 12, aprovacaoHoras: 12 },
  'Muito alta':  { cotacaoHoras: 12, aprovacaoHoras: 12 },
  'Alta':        { cotacaoDiasUteis: 1.5, aprovacaoHoras: 12 },
  'Média':       { cotacaoDiasUteis: 2, aprovacaoDiasUteis: 1 },
  'Baixa':       { cotacaoDiasUteis: 4, aprovacaoDiasUteis: 1 },
  'Muito baixa': { cotacaoDiasUteis: 4, aprovacaoDiasUteis: 1 },
};

function adicionarHoras(data, horas) {
  return new Date(data.getTime() + horas * 3600000);
}
function adicionarDiasUteis(data, dias) {
  const diasInteiros = Math.floor(dias);
  const fracao = dias - diasInteiros;
  let resultado = new Date(data);
  let restantes = diasInteiros;
  while (restantes > 0) {
    resultado.setDate(resultado.getDate() + 1);
    const dow = resultado.getDay();
    if (dow !== 0 && dow !== 6) restantes--;
  }
  if (fracao > 0) resultado = adicionarHoras(resultado, fracao * 24);
  return resultado;
}
function calcularPrazoEsperado(abertura, prioridadeCompleta) {
  const pol = POLITICA_SLA[prioridadeCompleta] || POLITICA_SLA['Média'];
  let data = new Date(abertura);
  if (pol.cotacaoDiasUteis) data = adicionarDiasUteis(data, pol.cotacaoDiasUteis);
  if (pol.cotacaoHoras) data = adicionarHoras(data, pol.cotacaoHoras);
  if (pol.aprovacaoDiasUteis) data = adicionarDiasUteis(data, pol.aprovacaoDiasUteis);
  if (pol.aprovacaoHoras) data = adicionarHoras(data, pol.aprovacaoHoras);
  return data;
}
function slaStatusPolitica(t) {
  if (t.status === 'Pendente') return 'paused';
  const abertura = parseDateBR(t.abertura);
  if (!abertura) return 'paused';
  const due = calcularPrazoEsperado(abertura, t.prioridadeCompleta);
  const duracaoTotalHoras = (due.getTime() - abertura.getTime()) / 3600000;
  const encerrado = (t.status === 'Solucionado' || t.status === 'Fechado');
  if (encerrado && t.fechamento) {
    const fechado = parseDateBR(t.fechamento);
    return fechado && fechado.getTime() > due.getTime() ? 'crit' : 'ok';
  }
  const horasRestantes = (due.getTime() - Date.now()) / 3600000;
  if (horasRestantes < 0) return 'crit';
  if (horasRestantes <= duracaoTotalHoras * 0.2) return 'warn';
  return 'ok';
}
// SLA GLPI: usa o prazo que o próprio sistema calcula ("Tempo para solução").
function slaStatusGlpi(t) {
  if (!t.prazo) return 'paused';
  const due = parseDateBR(t.prazo);
  if (!due) return 'paused';
  const encerrado = (t.status === 'Solucionado' || t.status === 'Fechado');
  if (encerrado && t.fechamento) {
    const fechado = parseDateBR(t.fechamento);
    return fechado && fechado.getTime() > due.getTime() ? 'crit' : 'ok';
  }
  const hoursLeft = (due.getTime() - Date.now()) / 3600000;
  if (hoursLeft < 0) return 'crit';
  if (hoursLeft <= 48) return 'warn';
  return 'ok';
}

function slaBadgeHtml(t) {
  const sPol = slaStatusPolitica(t);
  const sGlpi = slaStatusGlpi(t);
  const encerrado = (t.status === 'Solucionado' || t.status === 'Fechado');

  let linhaPolitica;
  if (sPol === 'paused') {
    linhaPolitica = `<span class="sla-badge paused">Política: ${SLA_LABEL[sPol]}</span>`;
  } else {
    const abertura = parseDateBR(t.abertura);
    const due = abertura ? calcularPrazoEsperado(abertura, t.prioridadeCompleta) : null;
    const dueStr = due ? due.toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';
    linhaPolitica = `<span class="sla-badge ${sPol}">Política: ${SLA_LABEL[sPol]}</span><span class="prazo-date">esperado: ${dueStr}</span>`;
  }

  let linhaGlpi;
  if (sGlpi === 'paused') {
    linhaGlpi = `<span class="sla-badge paused">GLPI: ${SLA_LABEL[sGlpi]}</span><span class="prazo-date">sem prazo (aguardando)</span>`;
  } else {
    linhaGlpi = `<span class="sla-badge ${sGlpi}">GLPI: ${SLA_LABEL[sGlpi]}</span><span class="prazo-date">${t.prazo || '—'}${encerrado && t.fechamento ? ' · fechado: ' + t.fechamento : ''}</span>`;
  }
  return `<div class="sla-badge-linha">${linhaPolitica}</div><div class="sla-badge-linha">${linhaGlpi}</div>`;
}

function contagemSla(itens, fnSla) {
  const c = { ok: 0, warn: 0, crit: 0, paused: 0 };
  itens.forEach(t => c[fnSla(t)]++);
  return c;
}
function pontosSla(c) {
  return `
    <span><span class="pt" style="background:${CORES_SLA.ok}"></span>${c.ok}</span>
    <span><span class="pt" style="background:${CORES_SLA.warn}"></span>${c.warn}</span>
    <span><span class="pt" style="background:${CORES_SLA.crit}"></span>${c.crit}</span>
    <span><span class="pt" style="background:${CORES_SLA.paused}"></span>${c.paused}</span>`;
}
function slaBreakdownHtml(items) {
  return STATUS_SLA_RELEVANTES.map(s => {
    const itensStatus = items.filter(t => t.status === s);
    if (itensStatus.length === 0) return '';
    const cPol = contagemSla(itensStatus, slaStatusPolitica);
    const cGlpi = contagemSla(itensStatus, slaStatusGlpi);
    return `
      <div class="cat-sla-row"><span class="rotulo">${STATUS_LABEL[s]}</span><span class="contagens"></span></div>
      <div class="cat-sla-subrow"><span class="rotulo-base">Política</span><span class="contagens">${pontosSla(cPol)}</span></div>
      <div class="cat-sla-subrow"><span class="rotulo-base">GLPI</span><span class="contagens">${pontosSla(cGlpi)}</span></div>`;
  }).join('');
}

// ----------------------------------------------------------------------
// KPIs
// ----------------------------------------------------------------------
function semTecnicoRelevante(t) {
  return t.tecnicos.length === 0 && STATUS_PRECISA_ATRIBUICAO.includes(t.status);
}
function ehEmAtendimento(s) { return s === 'Em atendimento (atribuído)' || s === 'Em atendimento (planejado)'; }

function renderKpiNumbers() {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('kpi-total', TICKETS.length);
  set('kpi-atend', TICKETS.filter(t => ehEmAtendimento(t.status)).length);
  set('kpi-pend', TICKETS.filter(t => t.status === 'Pendente').length);
  set('kpi-solved', TICKETS.filter(t => t.status === 'Solucionado').length);
  set('kpi-closed', TICKETS.filter(t => t.status === 'Fechado').length);

  set('sla-ok', TICKETS.filter(t => slaStatusPolitica(t) === 'ok').length);
  set('sla-warn', TICKETS.filter(t => slaStatusPolitica(t) === 'warn').length);
  set('sla-crit', TICKETS.filter(t => slaStatusPolitica(t) === 'crit').length);
  set('sla-paused', TICKETS.filter(t => slaStatusPolitica(t) === 'paused').length);

  set('sla-ok-glpi', TICKETS.filter(t => slaStatusGlpi(t) === 'ok').length);
  set('sla-warn-glpi', TICKETS.filter(t => slaStatusGlpi(t) === 'warn').length);
  set('sla-crit-glpi', TICKETS.filter(t => slaStatusGlpi(t) === 'crit').length);
  set('sla-paused-glpi', TICKETS.filter(t => slaStatusGlpi(t) === 'paused').length);

  set('kpi-sem-tecnico', TICKETS.filter(semTecnicoRelevante).length);
  updateActiveClasses();
}

// ----------------------------------------------------------------------
// CLOCK
// ----------------------------------------------------------------------
function updateClock() {
  const now = new Date();
  const c = document.getElementById('clock');
  const d = document.getElementById('dateline');
  if (c) c.textContent = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (d) d.textContent = now.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).toUpperCase();
}

// ----------------------------------------------------------------------
// CARDS DE CATEGORIA
// ----------------------------------------------------------------------
function renderCategoryCards() {
  const grid = document.getElementById('category-grid');
  if (!grid) return;
  grid.innerHTML = '';
  CATS.forEach(cat => {
    const items = TICKETS.filter(t => t.categoria === cat.key);
    const counts = {};
    STATUS_ORDER.forEach(s => counts[s] = items.filter(t => t.status === s).length);
    const total = items.length;

    const card = document.createElement('div');
    card.className = 'cat-card';
    card.style.setProperty('--cat-color', cat.hex);
    card.dataset.cat = cat.key;
    card.innerHTML = `
      <div><span class="dot"></span><span class="cat-name">${cat.key}</span></div>
      <div class="flap">${String(total).padStart(2, '0')}</div>
      <div class="mini-bars">
        ${STATUS_ORDER.map(s => {
          const pct = total ? (counts[s] / total * 100) : 0;
          return pct ? `<span style="width:${pct}%;background:${statusColor(s)}"></span>` : '';
        }).join('')}
      </div>
      <div class="cat-legend">
        ${STATUS_ORDER.filter(s => counts[s]).map(s => `<span>${STATUS_LABEL[s]} <b>${counts[s]}</b></span>`).join('')}
      </div>
      <div class="cat-sla-breakdown">${slaBreakdownHtml(items)}</div>`;
    card.addEventListener('click', () => {
      activeCat = activeCat === cat.key ? null : cat.key;
      render();
      document.getElementById('sections')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    grid.appendChild(card);
  });
  updateActiveClasses();
}

// ----------------------------------------------------------------------
// TABELA
// ----------------------------------------------------------------------
function tecnicoCell(t) {
  if (t.tecnicos && t.tecnicos.length) return t.tecnicos.join(', ');
  const sug = BRANCH_SUGGESTION[t.entidade];
  return `<span class="unassigned-tag">Sem técnico</span>` +
    (sug ? `<br><small style="color:var(--text-dim)">sugestão: ${sug}</small>` : '');
}

function renderTable(items, sortKey, sortDir) {
  const sorted = [...items];
  if (sortKey) {
    sorted.sort((a, b) => {
      let av, bv;
      if (sortKey === 'abertura' || sortKey === 'prazo') {
        av = parseDateBR(a[sortKey])?.getTime() || 0;
        bv = parseDateBR(b[sortKey])?.getTime() || 0;
      } else if (sortKey === 'prioridade') {
        av = PRIO_WEIGHT[a.prioridade] || 0; bv = PRIO_WEIGHT[b.prioridade] || 0;
      } else if (sortKey === 'id') {
        av = Number(a.id); bv = Number(b.id);
      } else if (sortKey === 'tecnico') {
        av = (a.tecnicos[0] || '~').toLowerCase(); bv = (b.tecnicos[0] || '~').toLowerCase();
      } else {
        av = String(a[sortKey] || '').toLowerCase(); bv = String(b[sortKey] || '').toLowerCase();
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }
  const rows = sorted.map(t => `
    <tr data-id="${t.id}">
      <td class="id">#${t.id}</td>
      <td class="assunto">${t.assunto}<small>${t.solicitante || ''}</small></td>
      <td>${t.entidade}</td>
      <td><span class="prio prio-${t.prioridade}">${t.prioridade}</span></td>
      <td><span class="badge ${STATUS_CLASS[t.status] || ''}">${STATUS_LABEL[t.status] || t.status}</span></td>
      <td>${tecnicoCell(t)}</td>
      <td>${slaBadgeHtml(t)}</td>
      <td style="font-family:var(--mono);white-space:nowrap;color:var(--text-dim);">${t.abertura || '—'}</td>
    </tr>`).join('');

  return `
    <table>
      <thead><tr>
        <th data-key="id">ID</th>
        <th data-key="assunto">Assunto / Solicitante</th>
        <th data-key="entidade">Unidade</th>
        <th data-key="prioridade">Prioridade</th>
        <th data-key="status">Status</th>
        <th data-key="tecnico">Técnico</th>
        <th>Prazo (SLA)</th>
        <th data-key="abertura">Abertura</th>
      </tr></thead>
      <tbody>${rows || `<tr><td colspan="8" style="text-align:center;color:var(--text-dim)">Nenhum chamado</td></tr>`}</tbody>
    </table>`;
}

// ----------------------------------------------------------------------
// VISÃO POR CATEGORIA
// ----------------------------------------------------------------------
function filteredItems(catKey) {
  return TICKETS.filter(t => {
    if (t.categoria !== catKey) return false;
    if (activeStatus && activeStatus !== '__all__' && t.status !== activeStatus) return false;
    if (activeSla && slaStatusPolitica(t) !== activeSla) return false;
    if (activeAtribuicao === 'sem_tecnico' && !semTecnicoRelevante(t)) return false;
    if (activeTecnico) {
      if (activeTecnico === '__sem__') { if (t.tecnicos.length) return false; }
      else if (!t.tecnicos.includes(activeTecnico)) return false;
    }
    return true;
  });
}

function render() {
  updateActiveClasses();
  updateFilterBar();

  const root = document.getElementById('sections');
  if (!root) return;
  const anyFilter = activeCat || (activeStatus && activeStatus !== '__all__') || activeSla || activeAtribuicao || activeTecnico;
  root.innerHTML = '';

  CATS.forEach(cat => {
    if (activeCat && cat.key !== activeCat) return;
    const items = filteredItems(cat.key);
    if (!items.length && !activeCat && !anyFilter) return;

    const section = document.createElement('div');
    section.className = 'section';
    const st = sortState[cat.key] || { key: null, dir: 'asc' };
    section.innerHTML = `
      <div class="section-head">
        <h2 style="color:${cat.hex}"><span class="dot" style="background:${cat.hex}"></span>${cat.key}</h2>
        <span class="section-count">${items.length} chamado${items.length === 1 ? '' : 's'}${anyFilter ? ' com esse filtro' : ' no período'}</span>
      </div>
      ${items.length ? renderTable(items, st.key, st.dir) : `<div class="empty-flap"><span class="zero">00</span>Nenhum chamado ${anyFilter ? 'com esse filtro' : 'nesse período'}</div>`}`;

    section.addEventListener('click', (e) => {
      const th = e.target.closest('th[data-key]');
      if (th) {
        const key = th.dataset.key;
        const cur = sortState[cat.key] || { key: null, dir: 'asc' };
        sortState[cat.key] = { key, dir: (cur.key === key && cur.dir === 'asc') ? 'desc' : 'asc' };
        render();
        return;
      }
      const tr = e.target.closest('tr[data-id]');
      if (tr) {
        const tk = items.find(x => x.id === tr.dataset.id);
        if (tk) openModal(tk);
      }
    });
    root.appendChild(section);
  });

  if (!root.children.length) {
    root.innerHTML = `<div class="empty-flap"><span class="zero">00</span>Nenhum chamado encontrado com esse filtro</div>`;
  }
}

// ----------------------------------------------------------------------
// VISÃO POR UNIDADE
// ----------------------------------------------------------------------
function renderUnidadeCards() {
  const grid = document.getElementById('unidade-cards');
  if (!grid) return;
  grid.innerHTML = '';
  const unidades = Array.from(new Set(TICKETS.map(t => t.entidade)))
    .sort((a, b) => TICKETS.filter(t => t.entidade === b).length - TICKETS.filter(t => t.entidade === a).length);

  unidades.forEach(unidade => {
    const items = TICKETS.filter(t => t.entidade === unidade);
    const total = items.length;
    const countsCat = {};
    CATS.forEach(cat => countsCat[cat.key] = items.filter(t => t.categoria === cat.key).length);

    const card = document.createElement('div');
    card.className = 'cat-card';
    card.style.setProperty('--cat-color', 'var(--amber)');
    card.dataset.unidade = unidade;
    card.innerHTML = `
      <div><span class="dot"></span><span class="cat-name">${unidade}</span></div>
      <div class="flap">${String(total).padStart(2, '0')}</div>
      <div class="mini-bars">
        ${CATS.map(cat => {
          const pct = total ? (countsCat[cat.key] / total * 100) : 0;
          return pct ? `<span style="width:${pct}%;background:${cat.hex}"></span>` : '';
        }).join('')}
      </div>
      <div class="cat-legend">
        ${CATS.filter(cat => countsCat[cat.key] > 0).map(cat => `<span style="color:${cat.hex}">${cat.key} <b>${countsCat[cat.key]}</b></span>`).join('')}
      </div>`;
    card.addEventListener('click', () => {
      activeUnidade = activeUnidade === unidade ? null : unidade;
      document.querySelectorAll('#unidade-cards .cat-card').forEach(c => c.classList.toggle('active', c.dataset.unidade === activeUnidade));
      renderUnidadeSection();
    });
    grid.appendChild(card);
  });
  document.querySelectorAll('#unidade-cards .cat-card').forEach(c => c.classList.toggle('active', c.dataset.unidade === activeUnidade));

  // com uma unidade só, já abre ela
  if (!activeUnidade && unidades.length === 1) activeUnidade = unidades[0];
}

function renderUnidadeSection() {
  const root = document.getElementById('unidade-sections');
  if (!root) return;
  if (!activeUnidade) {
    root.innerHTML = `<div class="empty-flap"><span class="zero">00</span>Clique numa unidade acima para ver os chamados dela por categoria</div>`;
    return;
  }
  const itemsUnidade = TICKETS.filter(t => t.entidade === activeUnidade);
  root.innerHTML = `
    <div class="section-head">
      <h2 style="color:var(--amber)"><span class="dot" style="background:var(--amber)"></span>${activeUnidade}</h2>
      <span class="section-count">${itemsUnidade.length} chamado${itemsUnidade.length === 1 ? '' : 's'} no período, por categoria</span>
    </div>`;

  CATS.forEach(cat => {
    const items = itemsUnidade.filter(t => t.categoria === cat.key);
    const chave = activeUnidade + '|' + cat.key;
    const st = sortStateUnidade[chave] || { key: null, dir: 'asc' };
    const bloco = document.createElement('div');
    bloco.style.marginTop = '18px';
    bloco.innerHTML = `
      <div class="section-head" style="margin-bottom:8px;">
        <h2 style="font-size:14px; color:${cat.hex}"><span class="dot" style="background:${cat.hex}"></span>${cat.key}</h2>
        <span class="section-count">${items.length} chamado${items.length === 1 ? '' : 's'}</span>
      </div>
      ${items.length ? renderTable(items, st.key, st.dir) : `<div class="empty-flap" style="padding:18px;">Nenhum chamado dessa categoria</div>`}`;
    root.appendChild(bloco);

    if (items.length) {
      bloco.querySelector('table thead').addEventListener('click', (e) => {
        const th = e.target.closest('th[data-key]');
        if (!th) return;
        const cur = sortStateUnidade[chave] || { key: null, dir: 'asc' };
        sortStateUnidade[chave] = { key: th.dataset.key, dir: (cur.key === th.dataset.key && cur.dir === 'asc') ? 'desc' : 'asc' };
        renderUnidadeSection();
      });
      bloco.querySelectorAll('table tbody tr').forEach(tr => {
        tr.addEventListener('click', () => {
          const tk = items.find(x => x.id === tr.dataset.id);
          if (tk) openModal(tk);
        });
      });
    }
  });
}

// ----------------------------------------------------------------------
// FILA POR TÉCNICO
// ----------------------------------------------------------------------
function diasAberto(t) {
  const ab = parseAbertura(t.abertura);
  if (!ab) return 0;
  const fim = t.fechamento ? (parseDateBR(t.fechamento) || new Date()) : new Date();
  return Math.max(0, (fim.getTime() - ab.getTime()) / 86400000);
}
function agePillClass(dias) {
  if (dias >= 10) return 'crit';
  if (dias >= 5) return 'warn';
  return '';
}
function fmtDias(dias) {
  const d = Math.floor(dias);
  if (d < 1) return 'hoje';
  return d + (d === 1 ? ' dia' : ' dias');
}

function buildQueues() {
  const map = {};
  TICKETS.forEach(t => {
    const people = t.tecnicos.length ? t.tecnicos : (STATUS_PRECISA_ATRIBUICAO.includes(t.status) ? ['Não atribuído'] : []);
    people.forEach(p => { (map[p] ||= []).push(t); });
  });
  Object.keys(map).forEach(p => {
    map[p].sort((a, b) => {
      const w = (PRIO_WEIGHT[b.prioridade] || 0) - (PRIO_WEIGHT[a.prioridade] || 0);
      return w !== 0 ? w : diasAberto(b) - diasAberto(a);
    });
  });
  return map;
}

function renderQueues() {
  const root = document.getElementById('queue-grid');
  if (!root) return;
  const map = buildQueues();
  root.innerHTML = '';
  const naoAtribuido = map['Não atribuído'] || [];
  delete map['Não atribuído'];

  Object.keys(map).sort((a, b) => map[b].length - map[a].length).forEach(name => {
    const items = map[name];
    const alta = items.filter(t => t.prioridade === 'Alta').length;
    const oldest = items.length ? Math.max(...items.map(diasAberto)) : 0;
    const col = document.createElement('div');
    col.className = 'person-col';
    const head = document.createElement('div');
    head.className = 'person-head';
    head.innerHTML = `
      <div class="name">${name}</div>
      <div class="meta">
        <span><b>${items.length}</b> na fila</span>
        <span><b>${alta}</b> alta prioridade</span>
        <span>mais antigo: <b>${fmtDias(oldest)}</b></span>
      </div>
      <div class="cat-sla-breakdown">${slaBreakdownHtml(items)}</div>`;
    col.appendChild(head);
    const list = document.createElement('ul');
    list.className = 'queue-list';
    if (!items.length) list.innerHTML = `<div class="queue-empty">Fila vazia</div>`;
    else items.forEach((t, i) => list.appendChild(buildQueueItem(t, i)));
    col.appendChild(list);
    root.appendChild(col);
  });

  renderUnassignedByBranch(naoAtribuido);
}

function buildQueueItem(t, i) {
  const dias = diasAberto(t);
  const li = document.createElement('li');
  li.className = 'queue-item';
  li.style.setProperty('--prio-color', PRIO_COLOR[t.prioridade] || 'var(--line)');
  li.innerHTML = `
    <div class="row1">
      <span class="pos">#${i + 1} NA FILA</span>
      <span class="pos">CHAMADO #${t.id}</span>
    </div>
    <div class="assunto">${t.assunto}<small>${t.solicitante || ''}</small></div>
    <div class="row2">
      <span class="badge ${STATUS_CLASS[t.status] || ''}">${STATUS_LABEL[t.status] || t.status}</span>
      <span class="prio prio-${t.prioridade}">${t.prioridade}</span>
      <span class="age-pill ${agePillClass(dias)}">aberto há ${fmtDias(dias)}</span>
      <span class="cat-tag">${t.categoria}</span>
    </div>
    <div class="row2" style="margin-top:5px;">${slaBadgeHtml(t)}</div>`;
  li.addEventListener('click', () => openModal(t));
  return li;
}

function renderUnassignedByBranch(items) {
  const root = document.getElementById('unassigned-grid');
  if (!root) return;
  root.innerHTML = '';
  if (!items.length) {
    root.innerHTML = `<div class="empty-flap"><span class="zero">00</span>Nenhum chamado sem técnico no momento</div>`;
    return;
  }
  const byBranch = {};
  items.forEach(t => { (byBranch[t.entidade] ||= []).push(t); });
  Object.values(byBranch).forEach(arr => arr.sort((a, b) => {
    const w = (PRIO_WEIGHT[b.prioridade] || 0) - (PRIO_WEIGHT[a.prioridade] || 0);
    return w !== 0 ? w : diasAberto(b) - diasAberto(a);
  }));
  Object.keys(byBranch).sort((a, b) => byBranch[b].length - byBranch[a].length).forEach(branch => {
    const arr = byBranch[branch];
    const sug = BRANCH_SUGGESTION[branch];
    const col = document.createElement('div');
    col.className = 'person-col unassigned';
    const head = document.createElement('div');
    head.className = 'branch-group-head';
    head.innerHTML = `
      <span><b>${branch}</b> · ${arr.length} chamado${arr.length === 1 ? '' : 's'}</span>
      <span>${sug ? 'quem costuma atender: <span class="sug">' + sug + '</span>' : 'sem histórico de técnico'}</span>`;
    col.appendChild(head);
    const list = document.createElement('ul');
    list.className = 'queue-list';
    arr.forEach((t, i) => list.appendChild(buildQueueItem(t, i)));
    col.appendChild(list);
    root.appendChild(col);
  });
}

// ----------------------------------------------------------------------
// MODAL
// ----------------------------------------------------------------------
function openModal(t) {
  const body = document.getElementById('modal-body');
  const overlay = document.getElementById('overlay');
  if (!body || !overlay) return;
  const temTec = t.tecnicos && t.tecnicos.length;
  const sug = BRANCH_SUGGESTION[t.entidade];
  body.innerHTML = `
    <div class="m-id">CHAMADO #${t.id} · ${t.categoria}</div>
    <h3>${t.assunto}</h3>
    <div class="grid">
      <div class="field"><div class="k">Status</div><div class="v"><span class="badge ${STATUS_CLASS[t.status] || ''}">${STATUS_LABEL[t.status] || t.status}</span></div></div>
      <div class="field"><div class="k">Prioridade</div><div class="v prio prio-${t.prioridade}">${t.prioridadeCompleta}</div></div>
      <div class="field"><div class="k">Solicitante</div><div class="v">${t.solicitante || '—'}</div></div>
      <div class="field"><div class="k">Técnico responsável</div><div class="v">${temTec ? t.tecnicos.join(', ') : ('não atribuído' + (sug ? ' · sugestão: ' + sug : ''))}</div></div>
      <div class="field"><div class="k">Unidade / Entidade</div><div class="v">${t.entidade}</div></div>
      <div class="field"><div class="k">Categoria ITIL</div><div class="v">${t.categoriaItil || '—'}</div></div>
      <div class="field"><div class="k">Data de abertura</div><div class="v">${t.abertura || '—'}</div></div>
      <div class="field"><div class="k">Fechamento</div><div class="v">${t.fechamento || 'Em aberto'}</div></div>
      <div class="field full"><div class="k">Prazo de solução (SLA)</div><div class="v">${slaBadgeHtml(t)}</div></div>
    </div>`;
  overlay.classList.add('show');
}
function closeModal() { document.getElementById('overlay')?.classList.remove('show'); }

// ----------------------------------------------------------------------
// FILTRO DE MÊS  (ativo no mês) + FILTRO DE TÉCNICO + barra de chips
// ----------------------------------------------------------------------
function mesDaAbertura(s) {
  try { return s.trim().split(' ')[0].split('-')[1]; } catch (e) { return null; }
}
function popularSeletorMes() {
  const select = document.getElementById('filtro-mes');
  if (!select) return;
  const meses = Array.from(new Set(TICKETS_BASE.map(t => mesDaAbertura(t.abertura)))).filter(Boolean).sort();
  const atual = select.value;
  select.innerHTML = `<option value="">Todos os meses de ${REGRAS.ano_considerado}</option>` +
    meses.map(m => `<option value="${m}">${NOMES_MES[parseInt(m, 10) - 1]}</option>`).join('');
  select.value = meses.includes(atual) ? atual : '';
}
function popularSeletorTecnico() {
  const select = document.getElementById('filtro-tecnico');
  if (!select) return;
  const nomes = Array.from(new Set(TICKETS_BASE.flatMap(t => t.tecnicos))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const atual = select.value;
  select.innerHTML = `<option value="">Todos os técnicos</option><option value="__sem__">— Sem técnico atribuído —</option>` +
    nomes.map(n => `<option value="${n}">${n}</option>`).join('');
  select.value = (atual === '__sem__' || nomes.includes(atual)) ? atual : '';
}

function ticketAtivoNoMes(t, ano, mesNum) {
  const inicioMes = new Date(ano, mesNum - 1, 1, 0, 0, 0);
  const fimMes = new Date(ano, mesNum, 0, 23, 59, 59);
  const abertura = parseDateBR(t.abertura);
  if (!abertura || abertura > fimMes) return false;
  const emAndamento = ehEmAtendimento(t.status) || t.status === 'Pendente' || t.status === 'Novo';
  if (emAndamento) return true;
  if (t.fechamento) {
    const f = parseDateBR(t.fechamento);
    if (f) return f >= inicioMes;
  }
  return mesDaAbertura(t.abertura) === String(mesNum).padStart(2, '0');
}

function aplicarFiltroMes() {
  if (!mesSelecionado) {
    TICKETS = TICKETS_BASE;
  } else {
    const m = parseInt(mesSelecionado, 10);
    TICKETS = TICKETS_BASE.filter(t => ticketAtivoNoMes(t, REGRAS.ano_considerado, m));
  }
  initAll();

  const sub = document.querySelector('.subtitle');
  if (sub) {
    const rot = mesSelecionado ? NOMES_MES[parseInt(mesSelecionado, 10) - 1] + '/' + REGRAS.ano_considerado : REGRAS.ano_considerado;
    sub.textContent = `Chamados ativos em ${rot} — Compras, Frotas, Viagens, VExpenses e Manutenção`;
  }
  const span = document.getElementById('abertos-no-mes');
  if (span) {
    if (mesSelecionado) {
      const n = TICKETS_BASE.filter(t => mesDaAbertura(t.abertura) === mesSelecionado).length;
      span.textContent = `· ${n} aberto${n === 1 ? '' : 's'} nesse mês`;
    } else span.textContent = '';
  }
}

function calcularSugestaoFilial(chamados) {
  const cont = {};
  chamados.forEach(t => {
    t.tecnicos.forEach(tec => {
      (cont[t.entidade] ||= {});
      cont[t.entidade][tec] = (cont[t.entidade][tec] || 0) + 1;
    });
  });
  const sug = {};
  Object.keys(cont).forEach(fil => {
    let melhor = null, max = -1;
    Object.entries(cont[fil]).forEach(([tec, n]) => { if (n > max) { max = n; melhor = tec; } });
    if (melhor) sug[fil] = melhor;
  });
  return sug;
}

// ----------------------------------------------------------------------
// BARRA DE FILTRO / ESTADO ATIVO
// ----------------------------------------------------------------------
function updateActiveClasses() {
  document.querySelectorAll('.kpi[data-status]').forEach(el => {
    const st = el.dataset.status;
    el.classList.toggle('active', st === '__all__' ? activeStatus === '__all__' : activeStatus === st);
  });
  document.querySelectorAll('.sla-kpi[data-sla]').forEach(el => el.classList.toggle('active', activeSla === el.dataset.sla));
  document.getElementById('kpi-sem-tecnico-card')?.classList.toggle('active', activeAtribuicao === 'sem_tecnico');
  document.querySelectorAll('.cat-card[data-cat]').forEach(el => el.classList.toggle('active', activeCat === el.dataset.cat));
}

function updateFilterBar() {
  const bar = document.getElementById('filter-bar');
  const any = activeCat || (activeStatus && activeStatus !== '__all__') || activeSla || activeAtribuicao || activeTecnico;
  bar?.classList.toggle('show', !!any || activeStatus === '__all__');

  const chip = (id, show, txt) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = show ? 'inline-block' : 'none';
    el.textContent = show ? txt : '';
  };
  chip('chip-cat', !!activeCat, activeCat || '');
  chip('chip-status', activeStatus && activeStatus !== '__all__', activeStatus ? (STATUS_LABEL[activeStatus] || activeStatus) : '');
  chip('chip-sla', !!activeSla, activeSla ? SLA_LABEL[activeSla] : '');
  chip('chip-atrib', activeAtribuicao === 'sem_tecnico', 'Sem técnico');
  chip('chip-tec', !!activeTecnico, activeTecnico === '__sem__' ? 'Sem técnico' : (activeTecnico || ''));
  updateActiveClasses();
}

// ----------------------------------------------------------------------
// INICIALIZAÇÃO
// ----------------------------------------------------------------------
function initAll() {
  renderKpiNumbers();
  renderCategoryCards();
  renderUnidadeCards();
  renderUnidadeSection();
  renderQueues();
  render();
}

async function carregarDadosDaAPI() {
  const textoEl = document.getElementById('dados-atualizados-texto');
  const syncEl = document.getElementById('dados-sync-texto');
  try {
    if (syncEl) syncEl.textContent = 'Sincronizando...';
    const headers = API_KEY ? { 'X-API-Key': API_KEY } : {};
    const resp = await fetch(`${API_BASE}/api/chamados`, { headers });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const brutos = await resp.json();

    const todos = mapearChamados(brutos);
    TICKETS_BASE = todos.filter(t => REGRAS.status_considerados.includes(t.status));
    BRANCH_SUGGESTION = calcularSugestaoFilial(todos);
    popularSeletorMes();
    popularSeletorTecnico();
    aplicarFiltroMes();

    const agora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (textoEl) textoEl.textContent = `${brutos.length} chamados da API · ${TICKETS_BASE.length} no painel · atualizado às ${agora}`;
    if (syncEl) syncEl.textContent = 'Conectado à API';
  } catch (erro) {
    console.error('Erro ao carregar dados da API:', erro);
    if (textoEl) textoEl.textContent = 'Falha ao carregar dados da API';
    if (syncEl) syncEl.textContent = `Erro: ${erro.message}`;
  }
}

// ----------------------------------------------------------------------
// EVENTOS
// ----------------------------------------------------------------------
function bindStaticEvents() {
  document.querySelectorAll('.kpi[data-status]').forEach(kpi => {
    kpi.addEventListener('click', () => {
      const s = kpi.dataset.status;
      activeStatus = (activeStatus === s) ? null : s;
      render();
      document.getElementById('sections')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
  document.querySelectorAll('.sla-kpi[data-sla]').forEach(kpi => {
    kpi.addEventListener('click', () => {
      const s = kpi.dataset.sla;
      activeSla = (activeSla === s) ? null : s;
      render();
    });
  });
  document.getElementById('kpi-sem-tecnico-card')?.addEventListener('click', () => {
    activeAtribuicao = activeAtribuicao === 'sem_tecnico' ? null : 'sem_tecnico';
    render();
    document.getElementById('sections')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  document.getElementById('clear-filters')?.addEventListener('click', () => {
    activeCat = activeStatus = activeSla = activeAtribuicao = activeTecnico = null;
    const selTec = document.getElementById('filtro-tecnico');
    if (selTec) selTec.value = '';
    render();
  });

  document.querySelectorAll('.view-tabs button[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-tabs button').forEach(b => b.classList.remove('on'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('on'));
      btn.classList.add('on');
      document.getElementById('view-' + btn.dataset.view)?.classList.add('on');
    });
  });

  document.getElementById('modal-close')?.addEventListener('click', closeModal);
  document.getElementById('overlay')?.addEventListener('click', e => { if (e.target.id === 'overlay') closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  document.getElementById('filtro-mes')?.addEventListener('change', e => {
    mesSelecionado = e.target.value;
    aplicarFiltroMes();
  });
  document.getElementById('filtro-tecnico')?.addEventListener('change', e => {
    activeTecnico = e.target.value || null;
    render();
  });
}

bindStaticEvents();
updateClock();
setInterval(updateClock, 30000);
carregarDadosDaAPI();
setInterval(carregarDadosDaAPI, 5 * 60 * 1000);
