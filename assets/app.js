let TICKETS = window.TICKETS_DATA || [];

const CATS = [
  { key:'Compras',              hex:'#4fae7a' },
  { key:'Manutenção',           hex:'#3fb6c4' },
  { key:'Viagens Corporativas', hex:'#d98a4a' },
  { key:'Frotas',               hex:'#4a90d9' },
  { key:'VExpenses',            hex:'#a879e0' },
];
const STATUS_ORDER = ['Em atendimento (atribuído)','Pendente','Solucionado','Fechado'];
const STATUS_LABEL = { 'Em atendimento (atribuído)':'Em atendimento', 'Pendente':'Pendente', 'Solucionado':'Solucionado', 'Fechado':'Fechado' };
const STATUS_CLASS = { 'Em atendimento (atribuído)':'st-Em-atendimento', 'Pendente':'st-Pendente', 'Solucionado':'st-Solucionado', 'Fechado':'st-Fechado' };

function statusColor(s){
  if(s==='Pendente') return 'var(--st-pend)';
  if(s==='Solucionado') return 'var(--st-solved)';
  if(s==='Fechado') return 'var(--st-novo)';
  return 'var(--st-atend)';
}

// ---- state ----
let activeCat = null;
let activeStatus = null; // null | '__all__' means "total" clicked (no real filter, just highlight) | specific status
let activeSla = null; // null | 'ok' | 'warn' | 'crit' | 'paused'
let activeAtribuicao = null; // null | 'sem_tecnico'
let sortState = {};

// ---- SLA helpers (baseado em "Tempo para solução") ----
function parseDateBR(str){
  if(!str) return null;
  const [datePart, timePart] = str.trim().split(' ');
  const [dd, mm, yyyy] = datePart.split('-').map(Number);
  let hh = 0, min = 0;
  if(timePart){ [hh, min] = timePart.split(':').map(Number); }
  return new Date(yyyy, mm - 1, dd, hh || 0, min || 0);
}

function slaStatus(t){
  if(!t.prazo) return 'paused'; // sem prazo definido = SLA pausado (ex: aguardando retorno do solicitante)
  const due = parseDateBR(t.prazo);

  const encerrado = (t.status === 'Solucionado' || t.status === 'Fechado');
  if(encerrado && t.fechamento){
    // chamado já encerrado: compara o prazo com a data em que foi REALMENTE resolvido,
    // não com a data de hoje — senão todo chamado antigo aparece como "vencido".
    const fechado = parseDateBR(t.fechamento);
    return fechado.getTime() > due.getTime() ? 'crit' : 'ok';
  }

  // chamado ainda em andamento (ou encerrado sem data de fechamento registrada):
  // compara o prazo com agora, que é a única referência que faz sentido.
  const hoursLeft = (due.getTime() - Date.now()) / 3600000;
  if(hoursLeft < 0) return 'crit';
  if(hoursLeft <= 48) return 'warn';
  return 'ok';
}

const SLA_LABEL = { ok:'No prazo', warn:'Quase vencendo', crit:'Vencido', paused:'Pausado' };

function slaBadgeHtml(t){
  const s = slaStatus(t);
  const encerrado = (t.status === 'Solucionado' || t.status === 'Fechado');
  let extra = '';
  if(encerrado && t.fechamento){
    extra = `<span class="prazo-date">prazo: ${t.prazo || '—'} · fechado: ${t.fechamento}</span>`;
  } else if(t.prazo){
    extra = `<span class="prazo-date">${t.prazo}</span>`;
  } else {
    extra = `<span class="prazo-date">sem prazo (aguardando)</span>`;
  }
  return `<span class="sla-badge ${s}">${SLA_LABEL[s]}</span>${extra}`;
}

// ---- KPIs base numbers (recalculadas a cada carga/atualização de dados) ----
const STATUS_PRECISA_ATRIBUICAO = ['Em atendimento (atribuído)', 'Novo', 'Pendente'];
function semTecnicoRelevante(t){
  return t.tecnicos.length === 0 && STATUS_PRECISA_ATRIBUICAO.includes(t.status);
}

function renderKpiNumbers(){
  document.getElementById('kpi-total').textContent = TICKETS.length;
  document.getElementById('kpi-atend').textContent = TICKETS.filter(t=>t.status==='Em atendimento (atribuído)').length;
  document.getElementById('kpi-pend').textContent = TICKETS.filter(t=>t.status==='Pendente').length;
  document.getElementById('kpi-solved').textContent = TICKETS.filter(t=>t.status==='Solucionado').length;
  document.getElementById('kpi-closed').textContent = TICKETS.filter(t=>t.status==='Fechado').length;

  document.getElementById('sla-ok').textContent = TICKETS.filter(t=>slaStatus(t)==='ok').length;
  document.getElementById('sla-warn').textContent = TICKETS.filter(t=>slaStatus(t)==='warn').length;
  document.getElementById('sla-crit').textContent = TICKETS.filter(t=>slaStatus(t)==='crit').length;
  document.getElementById('sla-paused').textContent = TICKETS.filter(t=>slaStatus(t)==='paused').length;

  document.getElementById('kpi-sem-tecnico').textContent = TICKETS.filter(semTecnicoRelevante).length;
}

// ---- Clock ----
function updateClock(){
  const now = new Date();
  document.getElementById('clock').textContent = now.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  document.getElementById('dateline').textContent = 'Painel atualizado em ' + now.toLocaleDateString('pt-BR');
}
updateClock();
setInterval(updateClock, 30000);

// ---- Category cards (recriados a cada atualização de dados) ----
const grid = document.getElementById('category-grid');
function renderCategoryCards(){
  grid.innerHTML = '';
  CATS.forEach(cat=>{
    const items = TICKETS.filter(t=>t.categoria===cat.key);
    const counts = {};
    STATUS_ORDER.forEach(s=> counts[s] = items.filter(t=>t.status===s).length);
    const total = items.length;

    const card = document.createElement('div');
    card.className = 'cat-card';
    card.style.setProperty('--cat-color', cat.hex);
    card.dataset.cat = cat.key;

    card.innerHTML = `
      <div><span class="dot"></span><span class="cat-name">${cat.key}</span></div>
      <div class="flap">${String(total).padStart(2,'0')}</div>
      <div class="mini-bars">
        ${STATUS_ORDER.map(s=>{
          const pct = total ? (counts[s]/total*100) : 0;
          return `<span style="width:${pct}%;background:${statusColor(s)}"></span>`;
        }).join('')}
      </div>
      <div class="cat-legend">
        ${STATUS_ORDER.map(s => `<span>${STATUS_LABEL[s]} <b>${counts[s]}</b></span>`).join('')}
      </div>
    `;
    card.addEventListener('click', ()=>{
      activeCat = activeCat === cat.key ? null : cat.key;
      render();
      document.getElementById('sections').scrollIntoView({behavior:'smooth', block:'start'});
    });
    grid.appendChild(card);
  });
  document.querySelectorAll('.cat-card').forEach(c=>c.classList.toggle('active', c.dataset.cat===activeCat));
}

// ---- KPI click handlers ----
document.querySelectorAll('.kpi').forEach(kpi=>{
  kpi.addEventListener('click', ()=>{
    const s = kpi.dataset.status;
    activeStatus = (activeStatus === s) ? null : s;
    render();
    document.getElementById('sections').scrollIntoView({behavior:'smooth', block:'start'});
  });
});

// ---- SLA KPI click handlers ----
document.querySelectorAll('.sla-kpi').forEach(kpi=>{
  kpi.addEventListener('click', ()=>{
    const s = kpi.dataset.sla;
    activeSla = (activeSla === s) ? null : s;
    render();
    document.getElementById('sections').scrollIntoView({behavior:'smooth', block:'start'});
  });
});

document.getElementById('clear-filters').addEventListener('click', ()=>{
  activeCat = null; activeStatus = null; activeSla = null; activeAtribuicao = null; render();
});

// ---- Sections ----
const sectionsRoot = document.getElementById('sections');

function filteredItems(catKey){
  return TICKETS.filter(t=>{
    if(t.categoria !== catKey) return false;
    if(activeStatus && activeStatus !== '__all__' && t.status !== activeStatus) return false;
    if(activeSla && slaStatus(t) !== activeSla) return false;
    if(activeAtribuicao === 'sem_tecnico' && !semTecnicoRelevante(t)) return false;
    return true;
  });
}

function renderTable(catKey, items, sortKey, sortDir){
  const sorted = [...items];
  if(sortKey){
    sorted.sort((a,b)=>{
      let av = (a[sortKey]||'').toString();
      let bv = (b[sortKey]||'').toString();
      if(sortKey==='abertura'){
        const norm = s => { const [d,h] = s.split(' '); const [dd,mm,yy] = d.split('-'); return yy+mm+dd+(h||''); };
        av = norm(av); bv = norm(bv);
      }
      return sortDir==='asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }
  const rows = sorted.map((t)=>`
    <tr data-id="${t.id}">
      <td class="id">#${t.id}</td>
      <td class="assunto">${t.assunto}<small>${t.solicitante || ''}</small></td>
      <td>${t.entidade}</td>
      <td><span class="prio prio-${t.prioridade}">${t.prioridade}</span></td>
      <td><span class="badge ${STATUS_CLASS[t.status]}">${STATUS_LABEL[t.status]}</span></td>
      <td>${tecnicoCell(t)}</td>
      <td>${slaBadgeHtml(t)}</td>
      <td style="font-family:var(--mono);white-space:nowrap;color:var(--text-dim);">${t.abertura}</td>
    </tr>
  `).join('');

  return `
    <table>
      <thead>
        <tr>
          <th data-key="id">ID</th>
          <th data-key="assunto">Assunto / Solicitante</th>
          <th data-key="entidade">Unidade</th>
          <th data-key="prioridade">Prioridade</th>
          <th data-key="status">Status</th>
          <th data-key="tecnico">Técnico</th>
          <th data-key="prazo">Prazo (SLA)</th>
          <th data-key="abertura">Abertura</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function tecnicoCell(t){
  if(t.tecnicos && t.tecnicos.length){
    return t.tecnicos.join(', ');
  }
  const sugestao = BRANCH_SUGGESTION[t.entidade];
  return `<span class="unassigned-tag">Sem técnico · ${t.entidade}</span>` +
    (sugestao ? `<br><small style="color:var(--text-dim)">sugestão: ${sugestao}</small>` : '');
}

let activeUnidade = null;
let sortStateUnidade = {};

function renderUnidadeCards(){
  const grid = document.getElementById('unidade-cards');
  grid.innerHTML = '';
  const unidades = Array.from(new Set(TICKETS.map(t=>t.entidade))).sort((a,b)=>{
    return TICKETS.filter(t=>t.entidade===b).length - TICKETS.filter(t=>t.entidade===a).length;
  });
  unidades.forEach(unidade=>{
    const items = TICKETS.filter(t=>t.entidade===unidade);
    const total = items.length;
    const countsCat = {};
    CATS.forEach(cat=> countsCat[cat.key] = items.filter(t=>t.categoria===cat.key).length);

    const card = document.createElement('div');
    card.className = 'cat-card';
    card.style.setProperty('--cat-color', 'var(--amber)');
    card.dataset.unidade = unidade;
    card.innerHTML = `
      <div><span class="dot"></span><span class="cat-name">${unidade}</span></div>
      <div class="flap">${String(total).padStart(2,'0')}</div>
      <div class="mini-bars">
        ${CATS.map(cat=>{
          const pct = total ? (countsCat[cat.key]/total*100) : 0;
          return `<span style="width:${pct}%;background:${cat.hex}"></span>`;
        }).join('')}
      </div>
      <div class="cat-legend">
        ${CATS.filter(cat=>countsCat[cat.key]>0).map(cat => `<span style="color:${cat.hex}">${cat.key} <b>${countsCat[cat.key]}</b></span>`).join('')}
      </div>
    `;
    card.addEventListener('click', ()=>{
      activeUnidade = activeUnidade === unidade ? null : unidade;
      document.querySelectorAll('#unidade-cards .cat-card').forEach(c=>c.classList.toggle('active', c.dataset.unidade===activeUnidade));
      renderUnidadeSection();
    });
    grid.appendChild(card);
  });
  document.querySelectorAll('#unidade-cards .cat-card').forEach(c=>c.classList.toggle('active', c.dataset.unidade===activeUnidade));
}

function renderUnidadeSection(){
  const root = document.getElementById('unidade-sections');
  if(!activeUnidade){
    root.innerHTML = `<div class="empty-flap" style="background:var(--panel); border:1px dashed var(--line); border-radius:8px; padding:36px 20px; text-align:center; color:var(--text-dim); font-family:var(--mono); font-size:12.5px;">Clique numa unidade acima para ver os chamados dela, separados por categoria</div>`;
    return;
  }
  const itemsUnidade = TICKETS.filter(t=>t.entidade===activeUnidade);

  root.innerHTML = `
    <div class="section-head">
      <h2 style="color:var(--amber)"><span class="dot" style="background:var(--amber)"></span>${activeUnidade}</h2>
      <span class="section-count">${itemsUnidade.length} chamado${itemsUnidade.length===1?'':'s'} no período, por categoria</span>
    </div>
  `;

  CATS.forEach(cat=>{
    const items = itemsUnidade.filter(t=>t.categoria===cat.key);
    const chaveSort = activeUnidade + '|' + cat.key;
    const st = sortStateUnidade[chaveSort] || {key:null, dir:'asc'};

    const bloco = document.createElement('div');
    bloco.style.marginTop = '18px';
    bloco.innerHTML = `
      <div class="section-head" style="margin-bottom:8px;">
        <h2 style="font-size:14px; color:${cat.hex}"><span class="dot" style="background:${cat.hex}"></span>${cat.key}</h2>
        <span class="section-count">${items.length} chamado${items.length===1?'':'s'}</span>
      </div>
      ${items.length ? renderTable(chaveSort, items, st.key, st.dir) : `<div class="empty-flap" style="background:var(--panel); border:1px dashed var(--line); border-radius:8px; padding:18px; text-align:center; color:var(--text-dim); font-family:var(--mono); font-size:12px;">Nenhum chamado dessa categoria nessa unidade</div>`}
    `;
    root.appendChild(bloco);

    if(items.length){
      bloco.querySelector('table thead').addEventListener('click', (e)=>{
        const th = e.target.closest('th[data-key]');
        if(!th) return;
        const key = th.dataset.key;
        const stAtual = sortStateUnidade[chaveSort] || {key:null, dir:'asc'};
        const dir = (stAtual.key===key && stAtual.dir==='asc') ? 'desc' : 'asc';
        sortStateUnidade[chaveSort] = {key, dir};
        renderUnidadeSection();
      });
      bloco.querySelectorAll('table tbody tr').forEach(tr=>{
        tr.addEventListener('click', ()=>{
          const ticket = items.find(t=>t.id===tr.dataset.id);
          if(ticket) openModal(ticket);
        });
      });
    }
  });
}

function openModal(ticket){
  const overlay = document.getElementById('overlay');
  const temTecnico = ticket.tecnicos && ticket.tecnicos.length;
  const sugestao = BRANCH_SUGGESTION[ticket.entidade];
  document.getElementById('modal-body').innerHTML = `
    <div class="m-id">CHAMADO #${ticket.id} · ${ticket.categoria}</div>
    <h3>${ticket.assunto}</h3>
    <div class="grid">
      <div class="field"><div class="k">Status</div><div class="v"><span class="badge ${STATUS_CLASS[ticket.status]}">${STATUS_LABEL[ticket.status]}</span></div></div>
      <div class="field"><div class="k">Prioridade</div><div class="v prio prio-${ticket.prioridade}">${ticket.prioridade}</div></div>
      <div class="field"><div class="k">Solicitante</div><div class="v">${ticket.solicitante || '—'}</div></div>
      <div class="field"><div class="k">Técnico responsável</div><div class="v">${temTecnico ? ticket.tecnicos.join(', ') : ('não atribuído' + (sugestao ? ' · sugestão: ' + sugestao : ''))}</div></div>
      <div class="field"><div class="k">Unidade / Entidade</div><div class="v">${ticket.entidade}</div></div>
      <div class="field"><div class="k">Data de abertura</div><div class="v">${ticket.abertura}</div></div>
      <div class="field full"><div class="k">Prazo de solução (SLA)</div><div class="v">${slaBadgeHtml(ticket)}</div></div>
    </div>
  `;
  overlay.classList.add('show');
}
document.getElementById('modal-close').addEventListener('click', ()=> document.getElementById('overlay').classList.remove('show'));
document.getElementById('overlay').addEventListener('click', (e)=>{ if(e.target.id==='overlay') e.currentTarget.classList.remove('show'); });

function render(){
  // category cards active state
  document.querySelectorAll('.cat-card').forEach(c=>c.classList.toggle('active', c.dataset.cat===activeCat));
  // kpi active state
  document.querySelectorAll('.kpi').forEach(k=>k.classList.toggle('active', activeStatus!==null && k.dataset.status===activeStatus));
  // sla kpi active state
  document.querySelectorAll('.sla-kpi').forEach(k=>k.classList.toggle('active', activeSla!==null && k.dataset.sla===activeSla));
  document.getElementById('kpi-sem-tecnico-card').classList.toggle('active', activeAtribuicao==='sem_tecnico');

  // filter bar
  const bar = document.getElementById('filter-bar');
  const chipCat = document.getElementById('chip-cat');
  const chipStatus = document.getElementById('chip-status');
  const chipSla = document.getElementById('chip-sla');
  const anyFilter = activeCat || (activeStatus && activeStatus!=='__all__') || activeSla || activeAtribuicao;
  bar.classList.toggle('show', !!anyFilter || activeStatus==='__all__');
  chipCat.style.display = activeCat ? 'inline-block' : 'none';
  chipCat.textContent = activeCat || '';
  const showStatusChip = activeStatus && activeStatus!=='__all__';
  chipStatus.style.display = showStatusChip ? 'inline-block' : 'none';
  chipStatus.textContent = showStatusChip ? STATUS_LABEL[activeStatus] : '';
  chipSla.style.display = activeSla ? 'inline-block' : 'none';
  chipSla.textContent = activeSla ? SLA_LABEL[activeSla] : '';
  const chipAtrib = document.getElementById('chip-atrib');
  if(chipAtrib){
    chipAtrib.style.display = activeAtribuicao ? 'inline-block' : 'none';
    chipAtrib.textContent = activeAtribuicao === 'sem_tecnico' ? 'Sem técnico' : '';
  }

  sectionsRoot.innerHTML = '';
  CATS.forEach(cat=>{
    if(activeCat && cat.key !== activeCat) return;
    const items = filteredItems(cat.key);

    const section = document.createElement('div');
    section.className = 'section';
    section.dataset.cat = cat.key;

    const head = document.createElement('div');
    head.className = 'section-head';
    head.innerHTML = `
      <h2 style="color:${cat.hex}"><span class="dot" style="background:${cat.hex}"></span>${cat.key}</h2>
      <span class="section-count">${items.length} chamado${items.length===1?'':'s'}${anyFilter ? ' com esse filtro' : ' no período'}</span>
    `;
    section.appendChild(head);

    const body = document.createElement('div');
    if(items.length === 0){
      body.innerHTML = `<div class="empty-flap"><span class="zero">00</span>Nenhum chamado ${anyFilter ? 'com esse filtro' : 'nesse período'} nesta fila no momento</div>`;
    } else {
      const st = sortState[cat.key] || {key:null, dir:'asc'};
      body.innerHTML = renderTable(cat.key, items, st.key, st.dir);
    }
    section.appendChild(body);
    sectionsRoot.appendChild(section);

    section.addEventListener('click', (e)=>{
      const th = e.target.closest('th[data-key]');
      if(th){
        const key = th.dataset.key;
        const st = sortState[cat.key] || {key:null, dir:'asc'};
        const dir = (st.key===key && st.dir==='asc') ? 'desc' : 'asc';
        sortState[cat.key] = {key, dir};
        render();
        return;
      }
      const tr = e.target.closest('tr[data-id]');
      if(tr){
        const ticket = TICKETS.find(t=> t.id === tr.dataset.id && t.categoria === cat.key);
        if(ticket) openModal(ticket);
      }
    });
  });
}

// ---- View tabs ----
document.querySelectorAll('.view-tabs button').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.view-tabs button').forEach(b=>b.classList.remove('on'));
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('on'));
    btn.classList.add('on');
    document.getElementById('view-' + btn.dataset.view).classList.add('on');
  });
});

// ---- Priority weight & aging helpers ----
const PRIO_WEIGHT = { 'Alta': 3, 'Média': 2, 'Baixa': 1 };
let BRANCH_SUGGESTION = window.BRANCH_SUGGESTION_DATA || {};
const PRIO_COLOR = { 'Alta': 'var(--st-pend)', 'Média': 'var(--st-atend)', 'Baixa': 'var(--compras)' };

function parseAbertura(str){
  // formato: "DD-MM-YYYY HH:MM"
  const [datePart, timePart] = str.trim().split(' ');
  const [dd, mm, yyyy] = datePart.split('-').map(Number);
  let hh = 0, min = 0;
  if(timePart){ [hh, min] = timePart.split(':').map(Number); }
  return new Date(yyyy, mm - 1, dd, hh || 0, min || 0);
}

function diasAberto(ticket){
  const abertura = parseAbertura(ticket.abertura);
  const ms = Date.now() - abertura.getTime();
  return Math.max(0, ms / (1000*60*60*24));
}

function agePillClass(dias){
  if(dias >= 10) return 'crit';
  if(dias >= 5) return 'warn';
  return '';
}

function fmtDias(dias){
  const d = Math.floor(dias);
  if(d < 1) return 'hoje';
  return d + (d===1 ? ' dia' : ' dias');
}

// ---- Build per-technician queues ----
function buildQueues(){
  const map = {}; // nome -> array de tickets
  TICKETS.forEach(t=>{
    const people = t.tecnicos.length ? t.tecnicos : (STATUS_PRECISA_ATRIBUICAO.includes(t.status) ? ['Não atribuído'] : []);
    people.forEach(p=>{
      if(!map[p]) map[p] = [];
      map[p].push(t);
    });
  });
  // ordena cada fila: prioridade desc, depois tempo em aberto desc (mais antigo primeiro)
  Object.keys(map).forEach(p=>{
    map[p].sort((a,b)=>{
      const wa = PRIO_WEIGHT[a.prioridade] || 0;
      const wb = PRIO_WEIGHT[b.prioridade] || 0;
      if(wb !== wa) return wb - wa;
      return diasAberto(b) - diasAberto(a);
    });
  });
  return map;
}

function renderQueues(){
  const map = buildQueues();
  const root = document.getElementById('queue-grid');
  root.innerHTML = '';

  const naoAtribuido = map['Não atribuído'] || [];
  delete map['Não atribuído'];

  // ordena colunas por volume decrescente
  const names = Object.keys(map).sort((a,b)=> map[b].length - map[a].length);

  names.forEach(name=>{
    const items = map[name];
    const altaCount = items.filter(t=>t.prioridade==='Alta').length;
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
    if(items.length === 0){
      list.innerHTML = `<div class="queue-empty">Fila vazia</div>`;
    } else {
      items.forEach((t, i)=>{
        list.appendChild(buildQueueItem(t, i));
      });
    }
    col.appendChild(list);
    root.appendChild(col);
  });

  renderUnassignedByBranch(naoAtribuido);
}

function buildQueueItem(t, i){
  const dias = diasAberto(t);
  const li = document.createElement('li');
  li.className = 'queue-item';
  li.style.setProperty('--prio-color', PRIO_COLOR[t.prioridade] || 'var(--line)');
  li.innerHTML = `
    <div class="row1">
      <span class="pos">#${i+1} NA FILA</span>
      <span class="pos">CHAMADO #${t.id}</span>
    </div>
    <div class="assunto">${t.assunto}<small>${t.solicitante || ''}</small></div>
    <div class="row2">
      <span class="badge ${STATUS_CLASS[t.status]}">${STATUS_LABEL[t.status]}</span>
      <span class="prio prio-${t.prioridade}">${t.prioridade}</span>
      <span class="age-pill ${agePillClass(dias)}">aberto há ${fmtDias(dias)}</span>
      <span class="cat-tag">${t.categoria}</span>
    </div>
    <div class="row2" style="margin-top:5px;">
      ${slaBadgeHtml(t)}
    </div>
  `;
  li.addEventListener('click', ()=> openModal(t));
  return li;
}

function renderUnassignedByBranch(items){
  const root = document.getElementById('unassigned-grid');
  root.innerHTML = '';
  if(!items.length){
    root.innerHTML = `<div class="empty-flap"><span class="zero">00</span>Nenhum chamado sem técnico no momento</div>`;
    return;
  }

  // agrupa por filial
  const byBranch = {};
  items.forEach(t=>{
    if(!byBranch[t.entidade]) byBranch[t.entidade] = [];
    byBranch[t.entidade].push(t);
  });
  // ordena cada grupo por prioridade + tempo em aberto
  Object.values(byBranch).forEach(arr=>{
    arr.sort((a,b)=>{
      const wa = PRIO_WEIGHT[a.prioridade] || 0;
      const wb = PRIO_WEIGHT[b.prioridade] || 0;
      if(wb !== wa) return wb - wa;
      return diasAberto(b) - diasAberto(a);
    });
  });

  const branches = Object.keys(byBranch).sort((a,b)=> byBranch[b].length - byBranch[a].length);

  branches.forEach(branch=>{
    const arr = byBranch[branch];
    const sugestao = BRANCH_SUGGESTION[branch];

    const col = document.createElement('div');
    col.className = 'person-col unassigned';

    const head = document.createElement('div');
    head.className = 'branch-group-head';
    head.innerHTML = `
      <span><b>${branch}</b> · ${arr.length} chamado${arr.length===1?'':'s'}</span>
      <span>${sugestao ? 'quem atende essa filial: <span class="sug">' + sugestao + '</span>' : 'sem histórico de técnico'}</span>
    `;
    col.appendChild(head);

    const list = document.createElement('ul');
    list.className = 'queue-list';
    arr.forEach((t, i)=> list.appendChild(buildQueueItem(t, i)));
    col.appendChild(list);
    root.appendChild(col);
  });
}
// ----------------------------------------------------------------------
// CARGA E ATUALIZAÇÃO AUTOMÁTICA DOS DADOS (dados.js gerado pelo robô)
// ----------------------------------------------------------------------
// ----------------------------------------------------------------------
// CARGA DOS DADOS: lê o CSV do GLPI direto no navegador — sem Python, sem robô
// ----------------------------------------------------------------------

const REGRAS = {
  tecnicos_excluidos: ["Kassia Fernanda Ribeiro Leite"],
  status_considerados: ["Em atendimento (atribuído)", "Pendente", "Solucionado", "Fechado"],
  ano_considerado: 2026,
  categorias: [
    { nome: "Viagens Corporativas", palavras_chave: ["PACOTE VIAGEM"] },
    { nome: "VExpenses", palavras_chave: ["VEXPENSES"] },
    { nome: "Frotas", palavras_chave: ["FROTA", "RENOVAÇÃO DE SEGURO"] },
    { nome: "Manutenção", palavras_chave: ["MANUTENÇÃO", "PROBLEMA ELÉTRICO", "PROBLEMA ESTRUTURAL", "PROBLEMA HIDRÁULICO", "EQUIPAMENTOS", "REFORMA", "REVISÃO", "INSTALAÇÃO DE SOFTWARE", "SOFTWARE"] },
  ],
  categoria_padrao: "Compras",
};
// Para mudar uma regra (status considerados, ano, categorias, exclusões),
// edite os valores acima — é o mesmo conteúdo do regras_negocio.json.

function categorizarTitulo(titulo){
  const t = (titulo || '').toUpperCase();
  for(const cat of REGRAS.categorias){
    for(const palavra of cat.palavras_chave){
      if(t.includes(palavra)) return cat.nome;
    }
  }
  return REGRAS.categoria_padrao;
}

function dividirTecnicos(valor){
  if(!valor) return [];
  return String(valor).split(/<br\s*\/?>/i).map(s => s.trim()).filter(Boolean);
}

function extrairAssuntoSolicitante(titulo, requerente){
  const partes = String(titulo || '').split('|');
  const assunto = (partes[0] || '').trim();
  const solicitante = partes.length > 1 ? partes[1].trim() : '';
  return [assunto, solicitante || (requerente || '').trim()];
}

function extrairPrazo(valorBruto){
  if(!valorBruto) return null;
  const primeira = String(valorBruto).split('\n')[0].trim();
  return primeira || null;
}

function extrairEntidadeCurta(entidadeCompleta){
  const partes = String(entidadeCompleta || '').split('>');
  return partes[partes.length - 1].trim();
}

function anoDaAbertura(aberturaStr){
  try{
    const data = aberturaStr.trim().split(' ')[0];
    return parseInt(data.split('-')[2], 10);
  } catch(e){ return null; }
}

// Parser de CSV robusto: separador ";", respeita aspas e campos com quebra de
// linha dentro de aspas (o export do GLPI tem isso na coluna de prazo/SLA).
function parseCSV(texto){
  if(texto.charCodeAt(0) === 0xFEFF) texto = texto.slice(1); // remove BOM (utf-8-sig)
  const linhas = [];
  let linhaAtual = [], campo = '', dentroAspas = false;
  for(let i = 0; i < texto.length; i++){
    const c = texto[i];
    if(dentroAspas){
      if(c === '"'){
        if(texto[i+1] === '"'){ campo += '"'; i++; }
        else { dentroAspas = false; }
      } else {
        campo += c;
      }
    } else {
      if(c === '"'){ dentroAspas = true; }
      else if(c === ';'){ linhaAtual.push(campo); campo = ''; }
      else if(c === '\r'){ /* ignora */ }
      else if(c === '\n'){ linhaAtual.push(campo); linhas.push(linhaAtual); linhaAtual = []; campo = ''; }
      else { campo += c; }
    }
  }
  if(campo.length || linhaAtual.length){ linhaAtual.push(campo); linhas.push(linhaAtual); }

  const header = linhas[0].map(h => h.trim());
  const registros = [];
  for(let i = 1; i < linhas.length; i++){
    if(linhas[i].length === 1 && linhas[i][0] === '') continue;
    const obj = {};
    header.forEach((h, idx) => obj[h] = linhas[i][idx] !== undefined ? linhas[i][idx] : '');
    registros.push(obj);
  }
  return registros;
}

function processarLinhasGlpi(registros){
  const todos = [];
  registros.forEach(r => {
    const tecnicos = dividirTecnicos(r['Atribuído - Técnico']);
    if(tecnicos.some(t => REGRAS.tecnicos_excluidos.includes(t))) return;

    const [assunto, solicitante] = extrairAssuntoSolicitante(r['Título'], r['Requerente - Requerente']);

    todos.push({
      id: String(r['ID'] || '').trim(),
      categoria: categorizarTitulo(r['Título']),
      assunto,
      solicitante,
      entidade: extrairEntidadeCurta(r['Entidade']),
      status: String(r['Status'] || '').trim(),
      prioridade: String(r['Prioridade'] || '').trim(),
      abertura: String(r['Data de abertura'] || '').trim(),
      prazo: extrairPrazo(r['Tempo para solução + Progresso']),
      fechamento: (r['Data de fechamento'] || '').trim() || null,
      tecnicos,
    });
  });

  const anoAlvo = REGRAS.ano_considerado;
  const selecionados = todos.filter(t =>
    REGRAS.status_considerados.includes(t.status) &&
    (anoAlvo === null || anoDaAbertura(t.abertura) === anoAlvo)
  );
  return [selecionados, todos];
}

function calcularSugestaoFilial(todosChamados){
  const contagem = {};
  todosChamados.forEach(t => {
    t.tecnicos.forEach(tec => {
      if(REGRAS.tecnicos_excluidos.includes(tec)) return;
      contagem[t.entidade] = contagem[t.entidade] || {};
      contagem[t.entidade][tec] = (contagem[t.entidade][tec] || 0) + 1;
    });
  });
  const sugestao = {};
  Object.keys(contagem).forEach(filial => {
    let melhor = null, max = -1;
    Object.entries(contagem[filial]).forEach(([tec, n]) => { if(n > max){ max = n; melhor = tec; } });
    if(melhor) sugestao[filial] = melhor;
  });
  return sugestao;
}

function initAll(){
  renderKpiNumbers();
  renderCategoryCards();
  renderUnidadeCards();
  renderUnidadeSection();
  renderQueues();
  render();
}

let TICKETS_BASE = [];
let mesSelecionado = ''; // '' = todos os meses; '01'..'12' = mês específico
const NOMES_MES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

function mesDaAbertura(aberturaStr){
  try{ return aberturaStr.trim().split(' ')[0].split('-')[1]; } // 'DD-MM-YYYY' -> 'MM'
  catch(e){ return null; }
}

function popularSeletorMes(){
  const select = document.getElementById('filtro-mes');
  const mesesPresentes = Array.from(new Set(TICKETS_BASE.map(t => mesDaAbertura(t.abertura)))).filter(Boolean).sort();
  const valorAtual = select.value;
  select.innerHTML = `<option value="">Todos os meses de ${REGRAS.ano_considerado}</option>` +
    mesesPresentes.map(m => `<option value="${m}">${NOMES_MES[parseInt(m,10)-1]}</option>`).join('');
  select.value = mesesPresentes.includes(valorAtual) ? valorAtual : '';
}

function aplicarFiltroMes(){
  TICKETS = mesSelecionado ? TICKETS_BASE.filter(t => mesDaAbertura(t.abertura) === mesSelecionado) : TICKETS_BASE;
  initAll();
  const subtitulo = document.querySelector('.subtitle');
  if(subtitulo){
    const rotuloMes = mesSelecionado ? NOMES_MES[parseInt(mesSelecionado,10)-1] + '/' + REGRAS.ano_considerado : REGRAS.ano_considerado;
    subtitulo.textContent = `Chamados de ${rotuloMes} — status Em atendimento, Pendente, Solucionado e Fechado`;
  }
}

document.getElementById('filtro-mes').addEventListener('change', (e) => {
  mesSelecionado = e.target.value;
  aplicarFiltroMes();
});

document.getElementById('kpi-sem-tecnico-card').addEventListener('click', () => {
  activeAtribuicao = activeAtribuicao === 'sem_tecnico' ? null : 'sem_tecnico';
  render();
  document.getElementById('sections').scrollIntoView({behavior:'smooth', block:'start'});
});

function carregarDeTextoCSV(texto, origem){
  const registros = parseCSV(texto);
  const [selecionados, todos] = processarLinhasGlpi(registros);
  TICKETS_BASE = selecionados;
  BRANCH_SUGGESTION = calcularSugestaoFilial(todos);
  popularSeletorMes();
  mesSelecionado = '';
  aplicarFiltroMes();
  const el = document.getElementById('dados-atualizados-texto');
  if(el) el.textContent = `Carregado de "${origem}" às ` + new Date().toLocaleString('pt-BR') + ` · ${TICKETS_BASE.length} chamados (${REGRAS.ano_considerado})`;
  try{ localStorage.setItem('painel360_csv_cache', texto); localStorage.setItem('painel360_csv_nome', origem); }catch(e){}
}

document.getElementById('btn-escolher-csv').addEventListener('click', () => {
  document.getElementById('input-csv').click();
});
document.getElementById('input-csv').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => carregarDeTextoCSV(ev.target.result, file.name);
  reader.readAsText(file, 'UTF-8');
});

function tentarCarregarAutomatico(){
  fetch('glpi.csv?t=' + Date.now())
    .then(r => { if(!r.ok) throw new Error('sem arquivo glpi.csv na pasta'); return r.text(); })
    .then(texto => carregarDeTextoCSV(texto, 'glpi.csv'))
    .catch(() => {
      let cache = null, nomeCache = null;
      try{ cache = localStorage.getItem('painel360_csv_cache'); nomeCache = localStorage.getItem('painel360_csv_nome'); }catch(e){}
      if(cache){
        carregarDeTextoCSV(cache, (nomeCache || 'planilha') + ' — cache do navegador');
      } else {
        const el = document.getElementById('dados-atualizados-texto');
        if(el) el.textContent = 'Nenhuma planilha carregada ainda. Clique em "Atualizar planilha (CSV)" ao lado e escolha o export do GLPI.';
      }
    });
}

// Se o painel estiver sendo aberto via um servidor local (ex: Live Server do
// VS Code), ele acha o glpi.csv sozinho automaticamente todo dia que você
// substituir o arquivo. Se for aberto com duplo-clique (file://), o navegador
// bloqueia essa leitura automática por segurança — nesse caso, use o botão
// "Atualizar planilha (CSV)" (1 clique) toda vez que tiver um export novo.
tentarCarregarAutomatico();
setInterval(tentarCarregarAutomatico, 5 * 60 * 1000);
