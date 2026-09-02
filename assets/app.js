// ----------------------------------------------------------------------
// CONEXÃO COM A API (ajuste a porta/host se rodar o uvicorn diferente)
// ----------------------------------------------------------------------
const API_BASE = 'http://10.33.29.109:5000';

// ----------------------------------------------------------------------
// REGRAS DE NEGÓCIO
// ----------------------------------------------------------------------
// A CATEGORIZAÇÃO POR SETOR agora vem PRONTA da API (campo `setor`, derivado
// da Categoria ITIL do GLPI). O frontend não adivinha mais pelo título.
// Escopo do painel (definido na API): FINANCEIRO + CSC + MANUTENÇÃO.
const REGRAS = {
  status_considerados: [
    'Em atendimento (atribuído)',
    'Em atendimento (planejado)',
    'Pendente',
    'Solucionado',
    'Fechado',
  ],
  ano_considerado: 2026,
};

// Cores por setor (as chaves batem com o campo `setor` vindo da API).
const SETOR_COLOR = {
  'FINANCEIRO': 'var(--frotas)',
  'CSC': 'var(--compras)',
  'MANUTENÇÃO': 'var(--manutencao)',
  'OUTROS': 'var(--amber)',
};
const SETOR_ORDEM = ['CSC', 'FINANCEIRO', 'MANUTENÇÃO', 'OUTROS'];

const STATUS_CLASS = {
  'Novo': 'st-Novo',
  'Em atendimento (atribuído)': 'st-Em-atendimento',
  'Em atendimento (planejado)': 'st-Em-atendimento',
  'Pendente': 'st-Pendente',
  'Solucionado': 'st-Solucionado',
  'Fechado': 'st-Fechado',
};
const STATUS_LABEL = {
  'Novo': 'Novo',
  'Em atendimento (atribuído)': 'Em atendimento',
  'Em atendimento (planejado)': 'Em atend. (plan.)',
  'Pendente': 'Pendente',
  'Solucionado': 'Solucionado',
  'Fechado': 'Fechado',
};
const STATUS_COLOR = {
  'Novo': 'var(--st-novo)',
  'Em atendimento (atribuído)': 'var(--st-atend)',
  'Em atendimento (planejado)': 'var(--st-atend)',
  'Pendente': 'var(--st-pend)',
  'Solucionado': 'var(--st-solved)',
  'Fechado': 'var(--st-novo)',
};
// Status que ainda demandam ação -> podem entrar na fila de "sem técnico".
const STATUS_PRECISA_ATRIBUICAO = [
  'Em atendimento (atribuído)',
  'Em atendimento (planejado)',
  'Pendente',
];

const PRIO_WEIGHT = { Alta: 3, Média: 2, Baixa: 1 };
const PRIO_COLOR = { Alta: 'var(--st-pend)', Média: 'var(--st-atend)', Baixa: 'var(--compras)' };
const SLA_LABEL = { ok: 'No prazo', warn: 'Quase vencendo', crit: 'Vencido', paused: 'Pausado' };

const BRANCH_SUGGESTION = {};

const NOMES_MES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

// ----------------------------------------------------------------------
// ESTADO
// ----------------------------------------------------------------------
let TICKETS_BASE = [];   // já filtrado por REGRAS.status_considerados
let TICKETS = [];        // TICKETS_BASE após filtro de mês
let mesSelecionado = '';
let activeStatus = null;
let activeSetor = null;
let activeSla = null;
let activeAtribuicao = null;
let activeTecnico = null;
let sortField = null;
let sortDir = 1;

// ----------------------------------------------------------------------
// MAPEAMENTO / HELPERS DE DADOS
// ----------------------------------------------------------------------

// GLPI: 1 muito baixa · 2 baixa · 3 média · 4 alta · 5 muito alta · 6 crítica.
// O painel só distingue 3 faixas visuais.
function bucketPrioridade(label) {
  const l = String(label || '').toLowerCase();
  if (l.includes('alta') || l.includes('crít') || l.includes('crit')) return 'Alta';
  if (l.includes('baixa')) return 'Baixa';
  return 'Média';
}

function converterData(dataStr) {
  if (!dataStr) return null;
  const [dataPart, horaPart] = String(dataStr).split(' ');
  if (!dataPart || dataPart.indexOf('-') === -1) return null;
  const [ano, mes, dia] = dataPart.split('-');
  const [h, m] = (horaPart || '00:00').split(':');
  return `${dia}-${mes}-${ano} ${h}:${m}`;
}

function parseDataHora(str) {
  if (!str) return null;
  const [dataPart, horaPart] = str.split(' ');
  const [dia, mes, ano] = dataPart.split('-').map(Number);
  const [h, m] = (horaPart || '0:0').split(':').map(Number);
  const d = new Date(ano, mes - 1, dia, h || 0, m || 0);
  return isNaN(d.getTime()) ? null : d;
}

function mapearChamados(chamadosBrutos) {
  return chamadosBrutos.map(ch => {
    const tecnicos = Array.isArray(ch['tecnicos']) ? ch['tecnicos'] : [];
    const requerentes = Array.isArray(ch['requerente_nomes']) ? ch['requerente_nomes'] : [];
    const assuntoLimpo = ch['titulo_bruto'] ? String(ch['titulo_bruto']).replace(/\t/g, ' ').trim() : 'Sem Assunto';

    return {
      id: String(ch['ID']),
      assunto: assuntoLimpo,
      solicitante: requerentes[0] || 'Sistema',
      entidade: ch['Entidade'] ? String(ch['Entidade']).split('>').pop().trim() : 'LOGOS - MATRIZ',
      setor: ch['setor'] || 'OUTROS',
      categoria: ch['categoria_completename'] || '(sem categoria)',
      categoriaId: ch['categoria_id'] != null ? String(ch['categoria_id']) : (ch['categoria_completename'] || 's/cat'),
      prioridade: bucketPrioridade(ch['prioridade_label']),
      prioridadeLabel: ch['prioridade_label'] || 'Não definida',
      status: ch['status_label'] || 'Desconhecido',
      tecnicos: tecnicos.map(t => t && t.nome ? t.nome : String(t)),
      tecnicosIds: (ch['tecnicos_ids'] || []).map(String),
      prazo: converterData(ch['Tempo para solução + Progresso']),
      fechamento: converterData(ch['Data de fechamento']),
      abertura: converterData(ch['Data de abertura']),
    };
  });
}

function diasAberto(t) {
  const abertura = parseDataHora(t.abertura);
  if (!abertura) return 0;
  const fim = t.fechamento ? parseDataHora(t.fechamento) : new Date();
  if (!fim) return 0;
  return Math.max(0, Math.floor((fim - abertura) / 86400000));
}

function fmtDias(dias) {
  if (dias <= 0) return 'hoje';
  return `${dias} dia${dias === 1 ? '' : 's'}`;
}

function agePillClass(dias) {
  if (dias >= 7) return 'crit';
  if (dias >= 3) return 'warn';
  return '';
}

function slaInfo(t) {
  if (t.status === 'Pendente') return { cls: 'paused', label: SLA_LABEL.paused };
  const prazo = parseDataHora(t.prazo);
  if (!prazo) return { cls: null, label: null };
  const encerrado = t.status === 'Solucionado' || t.status === 'Fechado';
  const referencia = encerrado ? (parseDataHora(t.fechamento) || new Date()) : new Date();
  const diffHoras = (prazo - referencia) / 3600000;
  if (diffHoras < 0) return { cls: 'crit', label: SLA_LABEL.crit };
  if (diffHoras <= 48) return { cls: 'warn', label: SLA_LABEL.warn };
  return { cls: 'ok', label: SLA_LABEL.ok };
}

function slaBadgeHtml(t) {
  const info = slaInfo(t);
  if (!info.cls) return '';
  return `<span class="sla-badge ${info.cls}">${info.label}</span><span class="prazo-date">Prazo: ${t.prazo || '—'}</span>`;
}

function mesDaAbertura(aberturaStr) {
  try { return aberturaStr.trim().split(' ')[0].split('-')[1]; } // 'DD-MM-YYYY' -> 'MM'
  catch (e) { return null; }
}

function contarPor(lista, campoFn) {
  const mapa = {};
  lista.forEach(item => {
    const chave = campoFn(item);
    (mapa[chave] ||= []).push(item);
  });
  return mapa;
}

function setoresPresentes() {
  const presentes = [...new Set(TICKETS.map(t => t.setor))];
  return SETOR_ORDEM.filter(s => presentes.includes(s))
    .concat(presentes.filter(s => !SETOR_ORDEM.includes(s)));
}

function sortTickets(items) {
  const arr = items.slice();
  if (!sortField) {
    arr.sort((a, b) => {
      const wa = PRIO_WEIGHT[a.prioridade] || 0, wb = PRIO_WEIGHT[b.prioridade] || 0;
      if (wb !== wa) return wb - wa;
      return diasAberto(b) - diasAberto(a);
    });
    return arr;
  }
  arr.sort((a, b) => {
    let va, vb;
    switch (sortField) {
      case 'id': va = Number(a.id); vb = Number(b.id); break;
      case 'assunto': va = a.assunto.toLowerCase(); vb = b.assunto.toLowerCase(); break;
      case 'status': va = a.status; vb = b.status; break;
      case 'prioridade': va = PRIO_WEIGHT[a.prioridade] || 0; vb = PRIO_WEIGHT[b.prioridade] || 0; break;
      case 'abertura': va = diasAberto(a); vb = diasAberto(b); break;
      default: va = 0; vb = 0;
    }
    if (va < vb) return -1 * sortDir;
    if (va > vb) return 1 * sortDir;
    return 0;
  });
  return arr;
}

function filteredTickets() {
  return TICKETS.filter(t => {
    if (activeStatus && t.status !== activeStatus) return false;
    if (activeSetor && t.setor !== activeSetor) return false;
    if (activeTecnico) {
      if (activeTecnico === '__sem__') { if (t.tecnicos.length) return false; }
      else if (!t.tecnicos.includes(activeTecnico)) return false;
    }
    if (activeSla) {
      const info = slaInfo(t);
      if (!info.cls || info.cls !== activeSla) return false;
    }
    if (activeAtribuicao === 'sem_tecnico') {
      if (!(STATUS_PRECISA_ATRIBUICAO.includes(t.status) && t.tecnicos.length === 0)) return false;
    }
    return true;
  });
}

// ----------------------------------------------------------------------
// RENDER: KPIs, SLA, setores, tabela principal
// ----------------------------------------------------------------------
function ehEmAtendimento(st) { return st === 'Em atendimento (atribuído)' || st === 'Em atendimento (planejado)'; }

function renderKpiNumbers() {
  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  setText('kpi-total', TICKETS.length);
  setText('kpi-atend', TICKETS.filter(t => ehEmAtendimento(t.status)).length);
  setText('kpi-pend', TICKETS.filter(t => t.status === 'Pendente').length);
  setText('kpi-solved', TICKETS.filter(t => t.status === 'Solucionado').length);
  setText('kpi-closed', TICKETS.filter(t => t.status === 'Fechado').length);
  setText('kpi-sem-tecnico', TICKETS.filter(t => STATUS_PRECISA_ATRIBUICAO.includes(t.status) && t.tecnicos.length === 0).length);

  const slaCount = { ok: 0, warn: 0, crit: 0, paused: 0 };
  TICKETS.forEach(t => { const info = slaInfo(t); if (info.cls) slaCount[info.cls]++; });
  setText('sla-ok', slaCount.ok);
  setText('sla-warn', slaCount.warn);
  setText('sla-crit', slaCount.crit);
  setText('sla-paused', slaCount.paused);

  updateActiveClasses();
}

function renderCategoryCards() {
  const root = document.getElementById('category-grid');
  if (!root) return;
  const statusList = Object.keys(STATUS_COLOR).filter(s => REGRAS.status_considerados.includes(s));

  root.innerHTML = setoresPresentes().map(nome => {
    const items = TICKETS.filter(t => t.setor === nome);
    const cor = SETOR_COLOR[nome] || 'var(--amber)';
    const total = items.length || 1;
    const bars = statusList.map(st => {
      const n = items.filter(t => t.status === st).length;
      if (!n) return '';
      return `<span style="width:${(n / total * 100).toFixed(1)}%; background:${STATUS_COLOR[st]}"></span>`;
    }).join('');
    const legenda = statusList
      .filter(st => items.some(t => t.status === st))
      .map(st => `<span><b>${items.filter(t => t.status === st).length}</b> ${STATUS_LABEL[st]}</span>`)
      .join('');

    return `
      <div class="cat-card" data-setor="${nome}" style="--cat-color:${cor}">
        <div class="cat-name"><span class="dot"></span>${nome}</div>
        <div class="flap">${items.length}</div>
        <div class="mini-bars">${bars}</div>
        <div class="cat-legend">${legenda}</div>
      </div>`;
  }).join('');
}

function renderSetorCards() {
  const root = document.getElementById('unidade-cards');
  if (!root) return;
  const filtrados = filteredTickets();
  const porSetor = contarPor(filtrados, t => t.setor);
  const nomes = Object.keys(porSetor).sort((a, b) => porSetor[b].length - porSetor[a].length);

  root.innerHTML = nomes.map(nome => {
    const items = porSetor[nome];
    const semTecnico = items.filter(t => STATUS_PRECISA_ATRIBUICAO.includes(t.status) && t.tecnicos.length === 0).length;
    const cor = SETOR_COLOR[nome] || 'var(--amber)';
    return `
      <div class="cat-card" style="--cat-color:${cor}">
        <div class="cat-name"><span class="dot"></span>${nome}</div>
        <div class="flap">${items.length}</div>
        <div class="cat-legend"><span><b>${semTecnico}</b> sem técnico</span></div>
      </div>`;
  }).join('') || `<div class="empty-flap"><span class="zero">00</span>Nenhum chamado no período</div>`;
}

function buildTicketsTableHtml(items) {
  const sorted = sortTickets(items);
  const rows = sorted.map(t => {
    const tecNomes = t.tecnicos.length ? t.tecnicos.join(', ') : '—';
    return `
      <tr data-id="${t.id}">
        <td class="id">#${t.id}</td>
        <td class="assunto">${t.assunto}<small>${t.solicitante} · ${t.categoria}</small></td>
        <td><span class="badge ${STATUS_CLASS[t.status] || ''}">${STATUS_LABEL[t.status] || t.status}</span></td>
        <td><span class="prio prio-${t.prioridade}">${t.prioridade}</span></td>
        <td>${tecNomes}</td>
        <td>${fmtDias(diasAberto(t))}</td>
        <td>${slaBadgeHtml(t)}</td>
      </tr>`;
  }).join('');

  return `
    <table>
      <thead><tr>
        <th data-field="id">ID</th>
        <th data-field="assunto">Assunto</th>
        <th data-field="status">Status</th>
        <th data-field="prioridade">Prioridade</th>
        <th>Técnico</th>
        <th data-field="abertura">Aberto há</th>
        <th>SLA</th>
      </tr></thead>
      <tbody>${rows || `<tr><td colspan="7" style="text-align:center;color:var(--text-dim)">Nenhum chamado encontrado</td></tr>`}</tbody>
    </table>`;
}

// Visão principal: agrupada por CATEGORIA (completename da Categoria ITIL).
function render() {
  const root = document.getElementById('sections');
  if (!root) return;
  const filtrados = filteredTickets();

  const porCategoria = contarPor(filtrados, t => t.categoria);
  const nomes = Object.keys(porCategoria).sort((a, b) => porCategoria[b].length - porCategoria[a].length);

  const html = nomes.map(nome => {
    const items = porCategoria[nome];
    const setor = items[0] ? items[0].setor : 'OUTROS';
    const cor = SETOR_COLOR[setor] || 'var(--amber)';
    return `
      <div class="section">
        <div class="section-head">
          <h2 style="color:${cor}"><span class="dot" style="background:${cor}"></span>${nome}</h2>
          <span class="section-count">${setor} · ${items.length} chamado${items.length === 1 ? '' : 's'}</span>
        </div>
        ${buildTicketsTableHtml(items)}
      </div>`;
  }).join('');

  root.innerHTML = html || `<div class="empty-flap"><span class="zero">00</span>Nenhum chamado encontrado com esse filtro</div>`;
}

// Aba "Por setor": agrupada por FINANCEIRO / CSC / MANUTENÇÃO.
function renderSetorSection() {
  const root = document.getElementById('unidade-sections');
  if (!root) return;
  const filtrados = filteredTickets();
  const porSetor = contarPor(filtrados, t => t.setor);
  const nomes = Object.keys(porSetor).sort((a, b) => porSetor[b].length - porSetor[a].length);

  root.innerHTML = nomes.map(nome => {
    const items = porSetor[nome];
    const cor = SETOR_COLOR[nome] || 'var(--amber)';
    return `
      <div class="section">
        <div class="section-head">
          <h2 style="color:${cor}"><span class="dot" style="background:${cor}"></span>${nome}</h2>
          <span class="section-count">${items.length} chamado${items.length === 1 ? '' : 's'}</span>
        </div>
        ${buildTicketsTableHtml(items)}
      </div>`;
  }).join('') || `<div class="empty-flap"><span class="zero">00</span>Nenhum chamado encontrado com esse filtro</div>`;
}

// ----------------------------------------------------------------------
// FILA POR TÉCNICO
// ----------------------------------------------------------------------
function buildQueues() {
  const map = {};
  TICKETS.forEach(t => {
    const people = t.tecnicos.length ? t.tecnicos : (STATUS_PRECISA_ATRIBUICAO.includes(t.status) ? ['Não atribuído'] : []);
    people.forEach(p => {
      if (!map[p]) map[p] = [];
      map[p].push(t);
    });
  });

  Object.keys(map).forEach(p => {
    map[p].sort((a, b) => {
      const wa = PRIO_WEIGHT[a.prioridade] || 0;
      const wb = PRIO_WEIGHT[b.prioridade] || 0;
      if (wb !== wa) return wb - wa;
      return diasAberto(b) - diasAberto(a);
    });
  });
  return map;
}

function renderQueues() {
  const map = buildQueues();
  const root = document.getElementById('queue-grid');
  if (!root) return;
  root.innerHTML = '';

  const naoAtribuido = map['Não atribuído'] || [];
  delete map['Não atribuído'];

  const names = Object.keys(map).sort((a, b) => map[b].length - map[a].length);

  names.forEach(name => {
    const items = map[name];
    const altaCount = items.filter(t => t.prioridade === 'Alta').length;
    const oldestDias = items.length ? Math.max(...items.map(diasAberto)) : 0;

    const col = document.createElement('div');
    col.className = 'person-col';

    const head = document.createElement('div');
    head.className = 'person-head';
    head.innerHTML = `
      <div class="name">${name}</div>
      <div class="meta">
        <span><b>${items.length}</b> na fila</span>
        <span><b>${altaCount}</b> alta prioridade</span>
        <span>mais antigo: <b>${fmtDias(oldestDias)}</b></span>
      </div>
    `;
    col.appendChild(head);

    const list = document.createElement('ul');
    list.className = 'queue-list';
    if (items.length === 0) {
      list.innerHTML = `<div class="queue-empty">Fila vazia</div>`;
    } else {
      items.forEach((t, i) => list.appendChild(buildQueueItem(t, i)));
    }
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
    <div class="row2" style="margin-top:5px;">
      ${slaBadgeHtml(t)}
    </div>
  `;
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

  const byBranch = contarPor(items, t => t.setor);
  Object.values(byBranch).forEach(arr => {
    arr.sort((a, b) => {
      const wa = PRIO_WEIGHT[a.prioridade] || 0;
      const wb = PRIO_WEIGHT[b.prioridade] || 0;
      if (wb !== wa) return wb - wa;
      return diasAberto(b) - diasAberto(a);
    });
  });

  const branches = Object.keys(byBranch).sort((a, b) => byBranch[b].length - byBranch[a].length);

  branches.forEach(branch => {
    const arr = byBranch[branch];
    const sugestao = BRANCH_SUGGESTION[branch];

    const col = document.createElement('div');
    col.className = 'person-col unassigned';

    const head = document.createElement('div');
    head.className = 'branch-group-head';
    head.innerHTML = `
      <span><b>${branch}</b> · ${arr.length} chamado${arr.length === 1 ? '' : 's'}</span>
      <span>${sugestao ? 'quem atende: <span class="sug">' + sugestao + '</span>' : 'setor'}</span>
    `;
    col.appendChild(head);

    const list = document.createElement('ul');
    list.className = 'queue-list';
    arr.forEach((t, i) => list.appendChild(buildQueueItem(t, i)));
    col.appendChild(list);
    root.appendChild(col);
  });
}

// ----------------------------------------------------------------------
// MODAL DE DETALHES
// ----------------------------------------------------------------------
function openModal(t) {
  const body = document.getElementById('modal-body');
  const overlay = document.getElementById('overlay');
  if (!body || !overlay) return;
  const tecNomes = t.tecnicos.length ? t.tecnicos.join(', ') : 'Não atribuído';

  body.innerHTML = `
    <div class="m-id">CHAMADO #${t.id}</div>
    <h3>${t.assunto}</h3>
    <div class="grid">
      <div class="field"><div class="k">Status</div><div class="v"><span class="badge ${STATUS_CLASS[t.status] || ''}">${STATUS_LABEL[t.status] || t.status}</span></div></div>
      <div class="field"><div class="k">Prioridade</div><div class="v"><span class="prio prio-${t.prioridade}">${t.prioridadeLabel}</span></div></div>
      <div class="field"><div class="k">Setor</div><div class="v">${t.setor}</div></div>
      <div class="field"><div class="k">Categoria</div><div class="v">${t.categoria}</div></div>
      <div class="field"><div class="k">Solicitante</div><div class="v">${t.solicitante || '—'}</div></div>
      <div class="field"><div class="k">Técnico</div><div class="v">${tecNomes}</div></div>
      <div class="field"><div class="k">Abertura</div><div class="v">${t.abertura || '—'}</div></div>
      <div class="field"><div class="k">Prazo (SLA)</div><div class="v">${t.prazo || '—'}</div></div>
      <div class="field full"><div class="k">Fechamento</div><div class="v">${t.fechamento || 'Em aberto'}</div></div>
      <div class="field full"><div class="k">SLA</div><div class="v">${slaBadgeHtml(t) || '—'}</div></div>
    </div>
  `;
  overlay.classList.add('show');
}

function closeModal() {
  document.getElementById('overlay')?.classList.remove('show');
}

// ----------------------------------------------------------------------
// FILTRO DE MÊS / TÉCNICO / FILTRO ATIVO (chips)
// ----------------------------------------------------------------------
function popularSeletorMes() {
  const select = document.getElementById('filtro-mes');
  if (!select) return;
  const mesesPresentes = [...new Set(TICKETS_BASE.map(t => mesDaAbertura(t.abertura)))].filter(Boolean).sort();
  const valorAtual = select.value;
  select.innerHTML = `<option value="">Todos os meses de ${REGRAS.ano_considerado}</option>` +
    mesesPresentes.map(m => `<option value="${m}">${NOMES_MES[parseInt(m, 10) - 1]}</option>`).join('');
  select.value = mesesPresentes.includes(valorAtual) ? valorAtual : '';
}

function popularSeletorTecnico() {
  const select = document.getElementById('filtro-tecnico');
  if (!select) return;
  const nomes = [...new Set(TICKETS_BASE.flatMap(t => t.tecnicos))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const valorAtual = select.value;
  select.innerHTML = `<option value="">Todos os técnicos</option>` +
    `<option value="__sem__">— Sem técnico atribuído —</option>` +
    nomes.map(n => `<option value="${n}">${n}</option>`).join('');
  select.value = (valorAtual === '__sem__' || nomes.includes(valorAtual)) ? valorAtual : '';
}

function aplicarFiltroMes() {
  TICKETS = mesSelecionado ? TICKETS_BASE.filter(t => mesDaAbertura(t.abertura) === mesSelecionado) : TICKETS_BASE;
  initAll();

  const subtitulo = document.querySelector('.subtitle');
  if (subtitulo) {
    const rotuloMes = mesSelecionado ? `${NOMES_MES[parseInt(mesSelecionado, 10) - 1]}/${REGRAS.ano_considerado}` : REGRAS.ano_considerado;
    subtitulo.textContent = `Chamados de ${rotuloMes} — setores Financeiro, CSC e Manutenção`;
  }
}

function updateActiveClasses() {
  document.querySelectorAll('.kpi[data-status]').forEach(el => {
    const st = el.dataset.status;
    el.classList.toggle('active', st === '__all__' ? !activeStatus : activeStatus === st);
  });
  document.querySelectorAll('.sla-kpi[data-sla]').forEach(el => {
    el.classList.toggle('active', activeSla === el.dataset.sla);
  });
  document.getElementById('kpi-sem-tecnico-card')?.classList.toggle('active', activeAtribuicao === 'sem_tecnico');
  document.querySelectorAll('.cat-card[data-setor]').forEach(el => {
    el.classList.toggle('active', activeSetor === el.dataset.setor);
  });
}

function updateFilterBar() {
  const bar = document.getElementById('filter-bar');
  const algumFiltro = activeStatus || activeSetor || activeSla || activeAtribuicao || activeTecnico;
  bar?.classList.toggle('show', !!algumFiltro);

  const chipCat = document.getElementById('chip-cat');
  if (chipCat) { chipCat.style.display = activeSetor ? 'inline-block' : 'none'; chipCat.textContent = activeSetor || ''; }

  const chipStatus = document.getElementById('chip-status');
  if (chipStatus) { chipStatus.style.display = activeStatus ? 'inline-block' : 'none'; chipStatus.textContent = activeStatus ? (STATUS_LABEL[activeStatus] || activeStatus) : ''; }

  const chipSla = document.getElementById('chip-sla');
  if (chipSla) { chipSla.style.display = activeSla ? 'inline-block' : 'none'; chipSla.textContent = activeSla ? SLA_LABEL[activeSla] : ''; }

  const chipAtrib = document.getElementById('chip-atrib');
  if (chipAtrib) { chipAtrib.style.display = activeAtribuicao ? 'inline-block' : 'none'; chipAtrib.textContent = activeAtribuicao === 'sem_tecnico' ? 'Sem técnico' : ''; }

  const chipTec = document.getElementById('chip-tec');
  if (chipTec) {
    chipTec.style.display = activeTecnico ? 'inline-block' : 'none';
    chipTec.textContent = activeTecnico === '__sem__' ? 'Sem técnico' : (activeTecnico || '');
  }

  updateActiveClasses();
}

function refreshFilteredViews() {
  render();
  renderSetorCards();
  renderSetorSection();
  updateFilterBar();
}

// ----------------------------------------------------------------------
// INICIALIZAÇÃO GERAL
// ----------------------------------------------------------------------
function initAll() {
  renderKpiNumbers();
  renderCategoryCards();
  renderSetorCards();
  renderSetorSection();
  renderQueues();
  render();
  updateFilterBar();
}

async function carregarDadosDaAPI() {
  const textoEl = document.getElementById('dados-atualizados-texto');
  const syncEl = document.getElementById('dados-sync-texto');
  try {
    if (syncEl) syncEl.textContent = 'Sincronizando...';

    const resposta = await fetch(`${API_BASE}/api/chamados`);
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    const chamados = await resposta.json();

    TICKETS_BASE = mapearChamados(chamados).filter(t => REGRAS.status_considerados.includes(t.status));
    popularSeletorMes();
    popularSeletorTecnico();
    aplicarFiltroMes();

    const agora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (textoEl) textoEl.textContent = `${chamados.length} chamados recebidos da API · ${TICKETS_BASE.length} no painel · atualizado às ${agora}`;
    if (syncEl) syncEl.textContent = 'Conectado à API';
  } catch (erro) {
    console.error('Erro ao carregar dados da API:', erro);
    if (textoEl) textoEl.textContent = 'Falha ao carregar dados da API';
    if (syncEl) syncEl.textContent = `Erro: ${erro.message}`;
  }
}

function tickClock() {
  const now = new Date();
  const clockEl = document.getElementById('clock');
  const dateEl = document.getElementById('dateline');
  if (clockEl) clockEl.textContent = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (dateEl) dateEl.textContent = now.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).toUpperCase();
}

function bindStaticEvents() {
  document.querySelectorAll('.kpi[data-status]').forEach(el => {
    el.addEventListener('click', () => {
      const st = el.dataset.status;
      activeStatus = st === '__all__' ? null : (activeStatus === st ? null : st);
      refreshFilteredViews();
    });
  });

  document.querySelectorAll('.sla-kpi[data-sla]').forEach(el => {
    el.addEventListener('click', () => {
      const s = el.dataset.sla;
      activeSla = activeSla === s ? null : s;
      refreshFilteredViews();
    });
  });

  document.getElementById('kpi-sem-tecnico-card')?.addEventListener('click', () => {
    activeAtribuicao = activeAtribuicao === 'sem_tecnico' ? null : 'sem_tecnico';
    refreshFilteredViews();
    document.getElementById('sections')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  document.getElementById('category-grid')?.addEventListener('click', e => {
    const card = e.target.closest('.cat-card[data-setor]');
    if (!card) return;
    const setor = card.dataset.setor;
    activeSetor = activeSetor === setor ? null : setor;
    refreshFilteredViews();
  });

  document.getElementById('clear-filters')?.addEventListener('click', () => {
    activeStatus = activeSetor = activeSla = activeAtribuicao = activeTecnico = null;
    const selTec = document.getElementById('filtro-tecnico');
    if (selTec) selTec.value = '';
    refreshFilteredViews();
  });

  ['sections', 'unidade-sections'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', e => {
      const th = e.target.closest('th[data-field]');
      if (th) {
        const f = th.dataset.field;
        sortDir = sortField === f ? sortDir * -1 : 1;
        sortField = f;
        render();
        renderSetorSection();
        return;
      }
      const tr = e.target.closest('tbody tr[data-id]');
      if (tr) {
        const t = TICKETS.find(x => x.id === tr.dataset.id);
        if (t) openModal(t);
      }
    });
  });

  document.querySelectorAll('.view-tabs button[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-tabs button').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      document.querySelectorAll('.view').forEach(v => v.classList.remove('on'));
      document.getElementById(`view-${btn.dataset.view}`)?.classList.add('on');
    });
  });

  document.getElementById('modal-close')?.addEventListener('click', closeModal);
  document.getElementById('overlay')?.addEventListener('click', e => {
    if (e.target.id === 'overlay') closeModal();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  document.getElementById('filtro-mes')?.addEventListener('change', e => {
    mesSelecionado = e.target.value;
    aplicarFiltroMes();
  });

  document.getElementById('filtro-tecnico')?.addEventListener('change', e => {
    activeTecnico = e.target.value || null;
    refreshFilteredViews();
  });
}

bindStaticEvents();
tickClock();
setInterval(tickClock, 1000);

carregarDadosDaAPI();
setInterval(carregarDadosDaAPI, 5 * 60 * 1000);
