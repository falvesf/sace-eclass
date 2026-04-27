/**
 * SACE - Sistema de Controle e Acompanhamento E-Class
 * Logic: Fabio Alves Feitoza & Antigravity (Gemini/Claude)
 */

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('SACE: Service Worker registrado com sucesso.'))
            .catch(err => console.error('SACE: Erro ao registrar Service Worker:', err));
    });
}

// --- Supabase Configuration ---
const SUPABASE_URL = 'https://qqnckvemoetdbimrofrm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_9Ys3sLag7RRkVjkMBG7uHQ_hq4bNURE';
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// --- State Management ---
let state = {
    user: null,
    teachers: [],
    series: [], 
    segmentos: [],
    tracking: {}, 
    config: {
        cidade_uf: 'Sua Cidade - UF',
        assinatura_url: ''
    },
    currentSection: 'tracking',
    editingTeacherId: null,
    editingSeriesId: null,
    sortConfig: { key: 'nome', direction: 'asc' },
    activeSystem: 'eclass', // 'eclass' | 'seq_didatica'
    selectedRecords: new Set() // Armazena chaves "teacherId_serie"
};

// --- System Routing ---
function getActiveTable() {
    return state.activeSystem === 'eclass' ? 'acompanhamento' : 'acompanhamento_seq_didatica';
}

function getActiveSystemLabel() {
    return state.activeSystem === 'eclass' ? 'E-Class' : 'Sequência Didática';
}

async function switchSystem(system) {
    state.activeSystem = system;
    state.tracking = {}; // Limpa cache ao trocar

    // Atualiza botões do switcher
    document.querySelectorAll('.sys-btn').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById(`btn-sys-${system}`);
    if (btn) btn.classList.add('active');

    // Atualiza subtítulo
    const sub = document.getElementById('tracking-subtitle');
    if (sub) sub.textContent = `Controle de preenchimento do sistema ${getActiveSystemLabel()}`;

    if (state.currentSection === 'tracking') {
        await renderTrackingList(true);
    } else if (state.currentSection === 'reports') {
        const titleEl = document.getElementById('report-section-title');
        if (titleEl) {
            titleEl.textContent = `Relatórios - ${getActiveSystemLabel()}`;
        }
        await renderReports();
    }
}

const periods = {
    DAILY: 'daily',
    WEEKLY: 'weekly',
    FORTNIGHTLY: 'fortnightly',
    MONTHLY: 'monthly'
};

// --- Initialization ---
window.onload = async () => {
    const now = new Date();
    const week = getWeekNumber(now);
    document.getElementById('week-selector').value = `${now.getFullYear()}-W${String(week).padStart(2, '0')}`;
    updatePeriodSelector();

    const savedUser = localStorage.getItem('sace_user');
    if (savedUser) {
        state.user = JSON.parse(savedUser);
        document.getElementById('auth-overlay').style.display = 'none';
        updateUserInfo();
        await loadConfig();
        await initDashboard();
    }
};

function getWeekNumber(d) {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    var weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return weekNo;
}

function getAcademicWeek(isoWeekString) {
    if (!state.config.ano_inicio) return null;
    
    const match = isoWeekString.match(/^(\d{4})-W(\d+)$/);
    if (!match) return null;
    
    const currentYear = parseInt(match[1]);
    const currentIsoWeek = parseInt(match[2]);
    
    const parts = state.config.ano_inicio.split('-');
    if (parts.length !== 3) return null;
    
    const startDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    const startIsoWeek = getWeekNumber(startDate);
    const startYear = startDate.getFullYear();

    if (currentYear === startYear) {
        return currentIsoWeek - startIsoWeek + 1;
    } else if (currentYear > startYear) {
        const dec31 = new Date(startYear, 11, 31);
        let weeksInStartYear = getWeekNumber(dec31);
        if (weeksInStartYear === 1) { 
            weeksInStartYear = getWeekNumber(new Date(startYear, 11, 24));
        }
        return (weeksInStartYear - startIsoWeek + 1) + currentIsoWeek;
    }
    return null;
}

function formatPeriodForDisplay(periodValue) {
    if (!periodValue) return '';
    const weekMatch = periodValue.match(/^(\d{4})-W(\d+)$/);
    if (!weekMatch) return periodValue; // Return as is if not a week format (daily/monthly/etc)

    const ano = parseInt(weekMatch[1]);
    const semana = parseInt(weekMatch[2]);
    
    // Encontrar segunda-feira dessa semana ISO
    const jan4 = new Date(ano, 0, 4);
    const startOfWeek = new Date(jan4);
    startOfWeek.setDate(jan4.getDate() - ((jan4.getDay() || 7) - 1) + (semana - 1) * 7);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 4);
    const opts = { day: '2-digit', month: '2-digit' };
    
    let labelSemana = `Semana ${semana}`;
    const aw = getAcademicWeek(periodValue);
    if (aw !== null && aw > 0) {
        labelSemana = `Semana Letiva ${aw}`;
    }
    
    return `${labelSemana} (${startOfWeek.toLocaleDateString('pt-BR', opts)} a ${endOfWeek.toLocaleDateString('pt-BR', opts)})`;
}

// --- Period Selector Dinâmico ---
function updatePeriodSelector() {
    const type = document.getElementById('period-type').value;
    const selector = document.getElementById('week-selector');
    const title = document.getElementById('tracking-section-title');

    const titleMap = {
        daily: 'Acompanhamento Diário',
        weekly: 'Acompanhamento Semanal',
        fortnightly: 'Acompanhamento Quinzenal',
        monthly: 'Acompanhamento Mensal'
    };
    const inputTypeMap = {
        daily: 'date',
        weekly: 'week',
        fortnightly: 'date',
        monthly: 'month'
    };

    selector.type = inputTypeMap[type] || 'week';
    if (title) title.textContent = titleMap[type] || 'Acompanhamento';

    // Atualiza o valor do seletor para o período atual
    const now = new Date();
    if (type === 'weekly') {
        const week = getWeekNumber(now);
        selector.value = `${now.getFullYear()}-W${String(week).padStart(2, '0')}`;
    } else if (type === 'monthly') {
        selector.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    } else {
        selector.value = now.toISOString().split('T')[0];
    }
}

// --- Authentication ---
function internalLogin() {
    const name = document.getElementById('login-name').value;
    const role = document.getElementById('login-role').value;
    if (name) {
        completeAuth(name, role);
    } else {
        alert('Por favor, digite seu nome.');
    }
}

function handleCredentialResponse(response) {
    const base64Url = response.credential.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));

    const profile = JSON.parse(jsonPayload);
    completeAuth(profile.name, 'Coordenador');
}

function logout() {
    localStorage.removeItem('sace_user');
    state.user = null;
    location.reload(); 
}

async function completeAuth(name, role) {
    state.user = { name, role };
    localStorage.setItem('sace_user', JSON.stringify(state.user));
    document.getElementById('auth-overlay').style.display = 'none';
    updateUserInfo();
    await loadConfig();
    await initDashboard();
}

function updateUserInfo() {
    const nameEl = document.getElementById('user-name');
    const roleEl = document.getElementById('user-role-label');
    if (nameEl) nameEl.textContent = state.user.name;
    if (roleEl) roleEl.textContent = state.user.role;
    // Atualiza também o drawer mobile
    const mName = document.getElementById('mobile-user-name');
    const mRole = document.getElementById('mobile-user-role');
    if (mName) mName.textContent = state.user.name;
    if (mRole) mRole.textContent = state.user.role;
}

// --- Navigation ---
async function showSection(id) {
    document.querySelectorAll('.section').forEach(s => s.style.display = 'none');
    document.getElementById(`section-${id}`).style.display = 'block';
    
    // Atualiza nav desktop
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    const activeLink = Array.from(document.querySelectorAll('.nav-link'))
        .find(l => l.getAttribute('onclick')?.includes(id));
    if (activeLink) activeLink.classList.add('active');

    // Atualiza nav mobile (drawer)
    document.querySelectorAll('.mobile-nav-link').forEach(l => l.classList.remove('active'));
    const mobileLink = document.getElementById(`m-nav-${id}`);
    if (mobileLink) mobileLink.classList.add('active');
    
    state.currentSection = id;
    if (id === 'tracking') await renderTrackingList();
    if (id === 'teachers') await renderTeacherList();
    if (id === 'series') await renderSeriesList();
    if (id === 'reports') {
        const titleEl = document.getElementById('report-section-title');
        if (titleEl) {
            titleEl.textContent = `Relatórios - ${state.activeSystem === 'eclass' ? 'E-Class' : 'Sequência Didática'}`;
        }
        await renderReports();
    }
    if (id === 'config') await loadConfig();
}

// --- Mobile Navigation ---
function toggleMobileMenu() {
    const drawer = document.getElementById('mobile-drawer');
    const overlay = document.getElementById('mobile-overlay');
    const hamburger = document.getElementById('hamburger-btn');
    const isOpen = drawer.classList.contains('open');
    if (isOpen) {
        drawer.classList.remove('open');
        overlay.classList.remove('open');
        hamburger.classList.remove('open');
    } else {
        drawer.classList.add('open');
        overlay.classList.add('open');
        hamburger.classList.add('open');
    }
}

function closeMobileMenu() {
    document.getElementById('mobile-drawer').classList.remove('open');
    document.getElementById('mobile-overlay').classList.remove('open');
    document.getElementById('hamburger-btn').classList.remove('open');
}

// --- Config Management ---
async function loadConfig() {
    if (!state.user) return;
    const usuario = state.user.name;

    const { data, error } = await _supabase
        .from('configuracoes')
        .select('*')
        .in('usuario', [usuario, 'global']);

    if (!error && data) {
        data.forEach(item => {
            state.config[item.chave] = item.valor;
        });
    }

    const cidadeEl = document.getElementById('config-cidade-uf');
    const previewContainer = document.getElementById('signature-preview-container');
    const previewImg = document.getElementById('signature-preview');
    const inicioEl = document.getElementById('config-ano-inicio');
    const fimEl = document.getElementById('config-ano-fim');

    if (cidadeEl) cidadeEl.value = state.config.cidade_uf || '';
    if (inicioEl) inicioEl.value = state.config.ano_inicio || '';
    if (fimEl) fimEl.value = state.config.ano_fim || '';

    if (state.config.assinatura_url && previewImg && previewContainer) {
        previewImg.src = state.config.assinatura_url;
        previewContainer.style.display = 'block';
    } else if (previewContainer) {
        previewContainer.style.display = 'none';
    }
}

async function handleSignatureUpload(input) {
    if (!input.files || !input.files[0]) return;

    const btnUpload = document.querySelector('#section-config .btn');
    if (btnUpload) btnUpload.textContent = 'Enviando...';

    const file = input.files[0];
    const fileExt = file.name.split('.').pop();
    // Namespace por usuario para evitar colisoes
    const safeUser = (state.user?.name || 'user').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const fileName = `sig_${safeUser}_${Date.now()}.${fileExt}`;

    const { error: uploadError } = await _supabase.storage
        .from('assinaturas')
        .upload(fileName, file, { upsert: true });

    if (uploadError) {
        alert('Erro ao enviar imagem: ' + uploadError.message);
        if (btnUpload) btnUpload.innerHTML = '<i class="fas fa-upload"></i> Subir Imagem';
        return;
    }

    const { data: { publicUrl } } = _supabase.storage
        .from('assinaturas')
        .getPublicUrl(fileName);

    state.config.assinatura_url = publicUrl;

    const previewImg = document.getElementById('signature-preview');
    const previewContainer = document.getElementById('signature-preview-container');
    if (previewImg) previewImg.src = publicUrl;
    if (previewContainer) previewContainer.style.display = 'block';
    if (btnUpload) btnUpload.innerHTML = '<i class="fas fa-upload"></i> Subir Imagem';

    // Salva imediatamente apos upload
    await saveConfig(true);
}

function removeSignature() {
    state.config.assinatura_url = '';
    const previewContainer = document.getElementById('signature-preview-container');
    const previewImg = document.getElementById('signature-preview');
    if (previewImg) previewImg.src = '';
    if (previewContainer) previewContainer.style.display = 'none';
    document.getElementById('signature-upload').value = '';
}

async function saveConfig(silent = false) {
    if (!state.user) return;
    const usuario = state.user.name;
    const cidade_uf = document.getElementById('config-cidade-uf').value;
    const ano_inicio = document.getElementById('config-ano-inicio')?.value;
    const ano_fim = document.getElementById('config-ano-fim')?.value;

    const updates = [
        { chave: 'cidade_uf', valor: cidade_uf, usuario },
        { chave: 'assinatura_url', valor: state.config.assinatura_url || '', usuario }
    ];

    if (ano_inicio !== undefined) updates.push({ chave: 'ano_inicio', valor: ano_inicio, usuario: 'global' });
    if (ano_fim !== undefined) updates.push({ chave: 'ano_fim', valor: ano_fim, usuario: 'global' });

    const { error } = await _supabase
        .from('configuracoes')
        .upsert(updates, { onConflict: 'chave, usuario' });

    if (error) alert('Erro ao salvar configurações: ' + error.message);
    else {
        if (!silent) alert('Configurações salvas com sucesso!');
        await renderTrackingList(false); // Atualiza os labels visuais da tela de acompanhamento
    }
}

// --- Teacher Management ---
async function fetchTeachers() {
    const { data, error } = await _supabase
        .from('professores')
        .select('*')
        .order('nome', { ascending: true });
    
    if (error) console.error('Error fetching teachers:', error);
    else state.teachers = data;
}

async function openTeacherModal(id = null) {
    state.editingTeacherId = id;
    await fetchSeries();
    
    if (id) {
        const teacher = state.teachers.find(t => t.id === id);
        document.getElementById('modal-title').textContent = 'Editar Professor';
        document.getElementById('prof-name').value = teacher.nome;
        document.getElementById('prof-type').value = teacher.tipo;
        renderSeriesPicker(teacher.series);
    } else {
        document.getElementById('modal-title').textContent = 'Novo Professor';
        clearTeacherForm();
        renderSeriesPicker();
    }
    
    document.getElementById('modal-container').style.display = 'flex';
}

async function renderSeriesPicker(selectedSeries = []) {
    const picker = document.getElementById('series-picker');
    await fetchSegmentos();
    await fetchSeries();

    if (!state.series || state.series.length === 0) {
        picker.innerHTML = '<p style="color: var(--text-muted); font-size: 0.8rem; text-align: center;">Cadastre séries na aba "Séries" primeiro.</p>';
        return;
    }

    // Agrupar séries por segmento para o picker
    const grouped = {};
    state.segmentos.forEach(s => grouped[s.id] = { nome: s.nome, items: [] });
    grouped['none'] = { nome: 'Sem Categoria', items: [] };

    state.series.forEach(s => {
        const segId = s.segmento_id || 'none';
        if (!grouped[segId]) grouped[segId] = { nome: 'Outros', items: [] };
        grouped[segId].items.push(s);
    });

    let html = '';
    Object.keys(grouped).forEach(segId => {
        const group = grouped[segId];
        if (group.items.length === 0) return;

        html += `<div class="picker-group-title">${group.nome}</div>`;
        group.items.forEach(s => {
            const isChecked = selectedSeries.includes(s.nome) ? 'checked' : '';
            html += `
                <label style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; cursor: pointer;">
                    <input type="checkbox" name="prof-series" value="${s.nome}" style="width: auto;" ${isChecked}>
                    <span>${s.nome}</span>
                </label>
            `;
        });
    });

    picker.innerHTML = html;
}

function closeModal() {
    document.getElementById('modal-container').style.display = 'none';
    state.editingTeacherId = null;
    clearTeacherForm();
}

function clearTeacherForm() {
    document.getElementById('prof-name').value = '';
    document.getElementById('prof-type').value = 'regente';
}

function toggleGradesLimit() {
    const type = document.getElementById('prof-type').value;
    const help = document.getElementById('grades-help');
    if (type === 'regente') {
        help.textContent = 'Atenção: Professores regentes podem ter no máximo 2 séries.';
        help.style.color = 'var(--warning)';
    } else {
        help.textContent = 'Vinculação livre para especialistas.';
        help.style.color = 'var(--text-muted)';
    }
}

async function saveTeacher() {
    const name = document.getElementById('prof-name').value;
    const type = document.getElementById('prof-type').value;
    const checked = Array.from(document.querySelectorAll('input[name="prof-series"]:checked'))
        .map(cb => cb.value);

    if (type === 'regente' && checked.length > 2) {
        alert('Professores regentes podem ter no máximo 2 séries vinculadas.');
        return;
    }
    // Híbrido e Especialista não possuem trava de quantidade de séries

    const payload = { nome: name, tipo: type, series: checked };

    let error;
    if (state.editingTeacherId) {
        const { error: err } = await _supabase
            .from('professores')
            .update(payload)
            .eq('id', state.editingTeacherId);
        error = err;
    } else {
        const { error: err } = await _supabase
            .from('professores')
            .insert([payload]);
        error = err;
    }

    if (error) alert('Erro ao salvar professor: ' + error.message);
    else {
        closeModal();
        await renderTeacherList();
    }
}

async function renderTeacherList() {
    await fetchTeachers();
    await fetchSeries(); 
    const list = document.getElementById('teacher-list');
    list.innerHTML = state.teachers.map(t => {
        const sistemas = t.sistemas || ['eclass'];
        const hasEclass = sistemas.includes('eclass');
        const hasSeq = sistemas.includes('seq_didatica');
        return `
        <tr>
            <td>${t.nome}</td>
            <td style="text-transform: capitalize;">${t.tipo}</td>
            <td>${t.series ? t.series.join(', ') : '-'}</td>
            <td>
                <div class="teacher-actions">
                    <div class="system-check-group">
                        <label class="sys-check-label" title="E-Class">
                            <input type="checkbox" ${hasEclass ? 'checked' : ''} onchange="toggleTeacherSystem('${t.id}', 'eclass', this.checked)">
                            <span class="sys-check-pill eclass-pill">E-Class</span>
                        </label>
                        <label class="sys-check-label" title="Sequência Didática">
                            <input type="checkbox" ${hasSeq ? 'checked' : ''} onchange="toggleTeacherSystem('${t.id}', 'seq_didatica', this.checked)">
                            <span class="sys-check-pill seq-pill">Seq. Did.</span>
                        </label>
                    </div>
                    <div style="display: flex; gap: 0.5rem;">
                        <button class="btn" style="padding: 0.2rem 0.5rem; background: rgba(99, 102, 241, 0.1); color: #818cf8;" onclick="openTeacherModal('${t.id}')">Editar</button>
                        <button class="btn" style="padding: 0.2rem 0.5rem; background: rgba(239, 68, 68, 0.1); color: var(--danger);" onclick="deleteTeacher('${t.id}')">Excluir</button>
                    </div>
                </div>
            </td>
        </tr>
        `;
    }).join('');
}

async function toggleTeacherSystem(teacherId, system, active) {
    const teacher = state.teachers.find(t => t.id === teacherId);
    if (!teacher) return;

    let sistemas = [...(teacher.sistemas || ['eclass'])];
    if (active) {
        if (!sistemas.includes(system)) sistemas.push(system);
    } else {
        sistemas = sistemas.filter(s => s !== system);
    }

    const { error } = await _supabase
        .from('professores')
        .update({ sistemas })
        .eq('id', teacherId);

    if (error) {
        alert('Erro ao atualizar sistema do professor: ' + error.message);
        await renderTeacherList(); // reverte na UI
    } else {
        teacher.sistemas = sistemas; // Atualiza cache local
    }
}

async function deleteTeacher(id) {
    if (!confirm('Tem certeza que deseja excluir este professor?')) return;
    const { error } = await _supabase.from('professores').delete().eq('id', id);
    if (error) alert('Erro ao excluir: ' + error.message);
    else await renderTeacherList();
}

// --- Tracking ---
async function fetchTracking(periodType, periodValue) {
    const key = `${periodType}-${periodValue}`;
    const { data, error } = await _supabase
        .from(getActiveTable())
        .select('*')
        .eq('periodo', key);
    
    if (error) {
        console.error('Error fetching tracking:', error);
        return;
    }

    state.tracking[key] = {};
    data.forEach(item => {
        const cacheId = `${item.professor_id}_${item.serie}`;
        state.tracking[key][cacheId] = {
            status: item.status,
            observacao: item.observacao || ''
        };
    });
}

function toggleSort(key) {
    if (state.sortConfig.key === key) {
        state.sortConfig.direction = state.sortConfig.direction === 'asc' ? 'desc' : 'asc';
    } else {
        state.sortConfig.key = key;
        state.sortConfig.direction = 'asc';
    }
    
    // Feedback visual nos ícones (opcional, já que o CSS cuida da base)
    renderTrackingList(false);
}

function toggleSelectAll(checked) {
    const checkboxes = document.querySelectorAll('.row-checkbox');
    checkboxes.forEach(cb => {
        cb.checked = checked;
        const key = cb.dataset.key;
        if (checked) state.selectedRecords.add(key);
        else state.selectedRecords.delete(key);
    });
    updatePrintButtonsVisibility();
}

function updateSelectedState(key, checked) {
    if (checked) state.selectedRecords.add(key);
    else state.selectedRecords.delete(key);
    
    // Atualiza o "selecionar todos" se necessário
    const all = document.querySelectorAll('.row-checkbox');
    const allChecked = Array.from(all).every(cb => cb.checked);
    const selectAllCb = document.getElementById('select-all-tracking');
    if (selectAllCb) selectAllCb.checked = allChecked;
    
    updatePrintButtonsVisibility();
}

function updatePrintButtonsVisibility() {
    const btnSelected = document.getElementById('btn-print-selected');
    const btnAll = document.getElementById('btn-print-all');
    
    const periodValue = document.getElementById('week-selector').value;
    const periodType = document.getElementById('period-type').value;
    const key = `${periodType}-${periodValue}`;
    const tracking = state.tracking[key] || {};

    // Verifica se há registros selecionáveis na seleção atual
    let hasSelectedPrintable = false;
    state.selectedRecords.forEach(recordKey => {
        const track = tracking[recordKey] || { status: 'Pendente' };
        if (track.status === 'Não fez' || track.status === 'Parcialmente') {
            hasSelectedPrintable = true;
        }
    });

    if (btnSelected) {
        btnSelected.style.display = (state.selectedRecords.size > 0 && hasSelectedPrintable) ? 'inline-flex' : 'none';
    }

    // Verifica se há registros imprimíveis visíveis na lista
    const visibleRows = document.querySelectorAll('.data-table tbody tr:not([style*="display: none"])');
    let hasVisiblePrintable = false;
    visibleRows.forEach(row => {
        if (row.classList.contains('row-nao') || row.classList.contains('row-parcial')) {
            hasVisiblePrintable = true;
        }
    });

    if (btnAll) {
        if (hasVisiblePrintable) {
            btnAll.disabled = false;
            btnAll.style.opacity = '1';
            btnAll.style.pointerEvents = 'auto';
        } else {
            btnAll.disabled = true;
            btnAll.style.opacity = '0.5';
            btnAll.style.pointerEvents = 'none';
        }
    }
}

function updateTrackingStats(rowsData) {
    const statsContainer = document.getElementById('tracking-stats');
    if (!statsContainer) return;

    const stats = {
        total: rowsData.length,
        pendente: 0,
        sim: 0,
        nao: 0,
        parcial: 0
    };

    rowsData.forEach(row => {
        const status = (row.status || '').trim();
        if (status === 'Sim') stats.sim++;
        else if (status === 'Não fez') stats.nao++;
        else if (status === 'Parcialmente') stats.parcial++;
        else stats.pendente++;
    });

    statsContainer.innerHTML = `
        <div class="stat-badge total">
            <span class="count">${stats.total}</span>
            <span class="label">Total</span>
        </div>
        <div class="stat-badge sim">
            <span class="count">${stats.sim}</span>
            <span class="label">Sim</span>
        </div>
        <div class="stat-badge nao">
            <span class="count">${stats.nao}</span>
            <span class="label">Não</span>
        </div>
        <div class="stat-badge parcial">
            <span class="count">${stats.parcial}</span>
            <span class="label">Parcial</span>
        </div>
        <div class="stat-badge pendente">
            <span class="count">${stats.pendente}</span>
            <span class="label">Pendente</span>
        </div>
    `;
}

async function renderTrackingList(shouldFetch = true) {
    const periodValue = document.getElementById('week-selector').value;
    const periodType = document.getElementById('period-type').value;
    const filterProf = document.getElementById('filter-prof').value.toLowerCase();
    const filterSerie = document.getElementById('filter-serie').value.toLowerCase();
    const key = `${periodType}-${periodValue}`;
    
    // Set academic week label if weekly
    const labelEl = document.getElementById('academic-week-label');
    const weekSelectorEl = document.getElementById('week-selector');
    if (labelEl && weekSelectorEl) {
        if (periodType === 'weekly' && periodValue) {
            const aw = getAcademicWeek(periodValue);
            if (aw !== null && aw > 0) {
                labelEl.textContent = `Semana Letiva: ${aw}`;
                labelEl.style.display = 'block';
                weekSelectorEl.classList.add('hide-text');
            } else {
                labelEl.style.display = 'none';
                weekSelectorEl.classList.remove('hide-text');
            }
        } else {
            labelEl.style.display = 'none';
            weekSelectorEl.classList.remove('hide-text');
        }
    }

    if (shouldFetch) {
        await fetchTeachers();
        await fetchTracking(periodType, periodValue);
        state.selectedRecords.clear(); // Limpa seleção ao trocar período ou buscar
        const selectAllCb = document.getElementById('select-all-tracking');
        if (selectAllCb) selectAllCb.checked = false;
        updatePrintButtonsVisibility();
    }

    if (!state.tracking[key]) state.tracking[key] = {};

    const list = document.getElementById('tracking-list');
    let rowsData = [];
    
    state.teachers.forEach(t => {
        if (!t.series) return;
        // Filtra apenas professores vinculados ao sistema ativo
        const sistemas = t.sistemas || ['eclass'];
        if (!sistemas.includes(state.activeSystem)) return;

        t.series.forEach(serie => {
            if (filterProf && !t.nome.toLowerCase().includes(filterProf)) return;
            if (filterSerie && !serie.toLowerCase().includes(filterSerie)) return;

            const cacheId = `${t.id}_${serie}`;
            const track = state.tracking[key][cacheId] || { status: 'Pendente', observacao: '' };
            
            rowsData.push({
                id: t.id,
                nome: t.nome,
                serie: serie,
                status: track.status,
                observacao: track.observacao
            });
        });
    });

    rowsData.sort((a, b) => {
        let valA = a[state.sortConfig.key].toLowerCase();
        let valB = b[state.sortConfig.key].toLowerCase();
        if (valA < valB) return state.sortConfig.direction === 'asc' ? -1 : 1;
        if (valA > valB) return state.sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
    });

    list.innerHTML = rowsData.map(row => {
        const status = (row.status || '').trim();
        let rowClass = '';
        if (status === 'Sim') rowClass = 'row-sim';
        else if (status === 'Não fez') rowClass = 'row-nao';
        else if (status === 'Parcialmente') rowClass = 'row-parcial';

        const safeSerie = row.serie.replace(/\s+/g, '_').replace(/[^\w]/g, '');
        const recordKey = `${row.id}_${row.serie}`;
        const isChecked = state.selectedRecords.has(recordKey) ? 'checked' : '';
        
        return `
            <tr class="${rowClass}" id="row-${row.id}-${safeSerie}">
                <td style="text-align: center;">
                    <input type="checkbox" class="row-checkbox" data-key="${recordKey}" ${isChecked} onchange="updateSelectedState('${recordKey}', this.checked)">
                </td>
                <td>${row.nome}</td>
                <td>${row.serie}</td>
                <td>
                    <select class="status-select" onchange="updateTracking('${row.id}', '${row.serie}', this.value, null)">
                        <option value="Pendente" ${row.status === 'Pendente' ? 'selected' : ''}>Pendente</option>
                        <option value="Sim" class="status-sim" ${row.status === 'Sim' ? 'selected' : ''}>Sim</option>
                        <option value="Não fez" class="status-nao" ${row.status === 'Não fez' ? 'selected' : ''}>Não fez</option>
                        <option value="Parcialmente" class="status-parcial" ${row.status === 'Parcialmente' ? 'selected' : ''}>Parcialmente</option>
                    </select>
                </td>
                <td>
                    <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                        <input type="text" 
                               class="status-select" 
                               style="width: 100%; min-width: 150px; font-size: 0.85rem;" 
                               placeholder="Adicionar observação..." 
                               value="${row.observacao}"
                               onblur="updateTracking('${row.id}', '${row.serie}', null, this.value)"
                               onkeydown="if(event.key === 'Enter') this.blur()">
                        
                        ${(status === 'Não fez' || status === 'Parcialmente') ? `
                            <button class="btn btn-primary" style="padding: 0.2rem 0.6rem; font-size: 0.75rem; width: fit-content;" onclick="printTerm('${row.id}', '${row.serie}')">
                                Imprimir Termo
                            </button>` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    if (rowsData.length === 0) {
        list.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">Nenhum registro encontrado.</td></tr>';
    }

    updateTrackingStats(rowsData);
    updatePrintButtonsVisibility();
}

async function updateTracking(teacherId, serie, status, observacao) {
    const periodValue = document.getElementById('week-selector').value;
    const periodType = document.getElementById('period-type').value;
    const key = `${periodType}-${periodValue}`;
    const cacheId = `${teacherId}_${serie}`;
    
    if (!state.tracking[key]) state.tracking[key] = {};
    
    const currentStatus = status !== null ? status : (state.tracking[key][cacheId]?.status || 'Pendente');
    const currentObs = observacao !== null ? observacao : (state.tracking[key][cacheId]?.observacao || '');

    const safeSerie = serie.replace(/\s+/g, '_').replace(/[^\w]/g, '');
    const row = document.getElementById(`row-${teacherId}-${safeSerie}`);
    if (row && status !== null) {
        row.classList.remove('row-sim', 'row-nao', 'row-parcial');
        if (status === 'Sim') row.classList.add('row-sim');
        else if (status === 'Não fez') row.classList.add('row-nao');
        else if (status === 'Parcialmente') row.classList.add('row-parcial');
    }

    const { error } = await _supabase
        .from(getActiveTable())
        .upsert({ 
            professor_id: teacherId, 
            serie: serie,
            periodo: key, 
            status: currentStatus,
            observacao: currentObs,
            atualizado_por: state.user ? state.user.name : 'Sistema'
        }, { onConflict: 'professor_id, periodo, serie' });

    if (error) {
        console.error('ERRO SUPABASE:', error);
        alert('ERRO AO SALVAR!\n\n' + error.message);
        await renderTrackingList(true);
    } else {
        state.tracking[key][cacheId] = { status: currentStatus, observacao: currentObs };
        if (status !== null) await renderTrackingList(false); 
    }
}

// --- Printing ---
async function printTerm(teacherId, serie) {
    const teacher = state.teachers.find(t => t.id === teacherId);
    const periodValue = document.getElementById('week-selector').value;
    const periodType = document.getElementById('period-type').value;
    const key = `${periodType}-${periodValue}`;
    const cacheId = `${teacherId}_${serie}`;
    const track = state.tracking[key][cacheId] || { status: 'Pendente', observacao: '' };

    const groupedData = [{
        nome: teacher.nome,
        items: [`${serie} (${track.status})`]
    }];
    
    await printGroupedTerms(groupedData);
}

// --- Grouped Printing ---
async function printSelectedTerms() {
    const groupedData = getGroupedData(true);
    await printGroupedTerms(groupedData);
}

async function printAllTerms() {
    const groupedData = getGroupedData(false);
    await printGroupedTerms(groupedData);
}

function getGroupedData(onlySelected = false) {
    const rows = [];
    const filterProf = document.getElementById('filter-prof').value.toLowerCase();
    const filterSerie = document.getElementById('filter-serie').value.toLowerCase();
    const periodValue = document.getElementById('week-selector').value;
    const periodType = document.getElementById('period-type').value;
    const key = `${periodType}-${periodValue}`;

    state.teachers.forEach(t => {
        const sistemas = t.sistemas || ['eclass'];
        if (!sistemas.includes(state.activeSystem)) return;

        t.series.forEach(serie => {
            if (filterProf && !t.nome.toLowerCase().includes(filterProf)) return;
            if (filterSerie && !serie.toLowerCase().includes(filterSerie)) return;

            const recordKey = `${t.id}_${serie}`;
            if (onlySelected && !state.selectedRecords.has(recordKey)) return;

            const cacheId = `${t.id}_${serie}`;
            const track = state.tracking[key][cacheId] || { status: 'Pendente', observacao: '' };

            // FILTRO DE STATUS PARA IMPRESSÃO: Apenas "Não fez" ou "Parcialmente"
            if (track.status !== 'Não fez' && track.status !== 'Parcialmente') return;

            rows.push({
                teacherId: t.id,
                nome: t.nome,
                serie: serie,
                status: track.status
            });
        });
    });

    // Agrupar por professor
    const grouped = {};
    rows.forEach(row => {
        if (!grouped[row.teacherId]) {
            grouped[row.teacherId] = {
                nome: row.nome,
                items: []
            };
        }
        grouped[row.teacherId].items.push(`${row.serie} (${row.status})`);
    });

    return Object.values(grouped);
}

async function printGroupedTerms(groupedData) {
    if (groupedData.length === 0) {
        alert('Nenhum registro para imprimir.');
        return;
    }

    const printArea = document.getElementById('print-area');
    const template = document.getElementById('termo-template');
    printArea.innerHTML = '';

    await loadConfig();
    const periodValue = document.getElementById('week-selector').value;
    const periodoFormatado = formatPeriodForDisplay(periodValue);
    const dataAtual = new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
    const sysLabel = getActiveSystemLabel();

    const sigUrl = state.config.assinatura_url;
    let imagesToLoad = 0;
    let loopDone = false;

    groupedData.forEach(group => {
        const clone = template.content.cloneNode(true);
        
        clone.querySelector('.print-prof-name').textContent = group.nome;
        clone.querySelector('.print-prof-grades').textContent = group.items.join(', ');
        clone.querySelector('.print-week').textContent = periodoFormatado;
        clone.querySelector('.print-date').textContent = dataAtual;
        clone.querySelector('.print-prof-sign-name').textContent = group.nome;
        clone.querySelector('.print-coord-name').textContent = state.user.name;
        clone.querySelector('.print-city-uf').textContent = state.config.cidade_uf || 'Sua Cidade - UF';
        
        clone.querySelectorAll('.print-system-name').forEach(el => el.textContent = sysLabel);
        clone.querySelectorAll('.print-system-name-body').forEach(el => el.textContent = sysLabel);

        const sigImg = clone.querySelector('.print-coord-signature');
        const sigContainer = clone.querySelector('.termo-assinatura-imagem-container');
        
        if (sigUrl) {
            imagesToLoad++;
            sigImg.onload = () => {
                imagesToLoad--;
                if (loopDone && imagesToLoad === 0) window.print();
            };
            sigImg.onerror = () => {
                imagesToLoad--;
                sigImg.style.display = 'none';
                sigContainer.style.display = 'none';
                if (loopDone && imagesToLoad === 0) window.print();
            };
            sigImg.src = sigUrl;
            sigImg.style.display = 'block';
            sigContainer.style.display = 'flex';
        } else {
            sigImg.style.display = 'none';
            sigContainer.style.display = 'none';
        }

        printArea.appendChild(clone);
    });

    loopDone = true;
    if (imagesToLoad === 0) {
        window.print();
    }
}

// --- Reports ---
let mainChart = null;
let trendChart = null;

async function renderReports() {
    const mainCanvas = document.getElementById('mainChart');
    const trendCanvas = document.getElementById('trendChart');
    if (!mainCanvas || !trendCanvas) return;

    const ctxMain = mainCanvas.getContext('2d');
    const ctxTrend = trendCanvas.getContext('2d');
    
    const periodEl = document.getElementById('report-period');
    const reportPeriodType = periodEl ? periodEl.value : 'weekly';
    const trendLabels = getTrendLabels(reportPeriodType);

    // 1. Buscar TODOS os registros do sistema ativo uma única vez para o relatório
    const { data: allTracking, error } = await _supabase
        .from(getActiveTable())
        .select('status, periodo, professor_id, serie');
    
    if (error) {
        console.error("Erro ao buscar dados para o relatório:", error);
        return;
    }

    // 2. Filtrar dados pelo tipo de período selecionado (ex: 'weekly-')
    const filteredTracking = allTracking.filter(item => item.periodo.startsWith(`${reportPeriodType}-`));

    // 3. Identificar os períodos únicos presentes para cálculo de "Pendente"
    // Usamos os períodos que realmente têm algum dado, ou se for semanal, podemos considerar as semanas até a atual
    const uniquePeriods = [...new Set(filteredTracking.map(item => item.periodo))];
    const numPeriods = Math.max(1, uniquePeriods.length);

    // 4. Calcular totais para o Gráfico de Visão Geral (Doughnut)
    let totalSeriesPerTeacher = 0;
    state.teachers.forEach(t => {
        const sistemas = t.sistemas || ['eclass'];
        if (t.series && sistemas.includes(state.activeSystem)) {
            totalSeriesPerTeacher += t.series.length;
        }
    });

    const totalExpected = totalSeriesPerTeacher * numPeriods;
    const stats = { sim: 0, nao: 0, parcial: 0, pendente: 0 };
    let totalRecorded = filteredTracking.length;

    filteredTracking.forEach(item => {
        if (item.status === 'Sim') stats.sim++;
        else if (item.status === 'Não fez') stats.nao++;
        else if (item.status === 'Parcialmente') stats.parcial++;
        else stats.pendente++;
    });

    // Pendentes = (Pendentes explícitos) + (Omissões/Não lançados em todos os períodos detectados)
    stats.pendente += (totalExpected - totalRecorded);

    // Renderizar Doughnut
    if (mainChart) mainChart.destroy();
    mainChart = new Chart(ctxMain, {
        type: 'doughnut',
        plugins: [ChartDataLabels],
        data: {
            labels: ['Sim', 'Não fez', 'Parcialmente', 'Pendente'],
            datasets: [{
                data: [stats.sim, stats.nao, stats.parcial, stats.pendente],
                backgroundColor: ['#10b981', '#ef4444', '#f59e0b', '#334155'],
                borderWidth: 0,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 200 },
            cutout: '60%',
            plugins: { 
                legend: { position: 'bottom', labels: { color: '#f8fafc', padding: 20 } },
                datalabels: {
                    color: '#fff',
                    font: { weight: 'bold', size: 14 },
                    formatter: (value) => value > 0 ? value : ''
                }
            }
        }
    });

    // 5. Calcular Tendência (Line Chart)
    if (trendChart) trendChart.destroy();
    let trendData = [];
    try {
        const expectedPerPeriod = totalSeriesPerTeacher;
        
        // Agrupar dados por período para a tendência
        const periodStatsMap = {};
        filteredTracking.forEach(item => {
            if (!periodStatsMap[item.periodo]) {
                periodStatsMap[item.periodo] = { ok: 0 };
            }
            if (item.status === 'Sim' || item.status === 'Parcialmente') {
                periodStatsMap[item.periodo].ok++;
            }
        });

        const currentYear = new Date().getFullYear();
        trendData = trendLabels.map(label => {
            let searchKey = '';
            if (reportPeriodType === 'weekly') {
                const num = label.match(/\d+/);
                if (num) searchKey = `weekly-${currentYear}-W${num[0].padStart(2, '0')}`;
            } else if (reportPeriodType === 'daily') {
                searchKey = `daily-${label.toLowerCase()}`;
            } else if (reportPeriodType === 'monthly') {
                const months = { 'Jan': 0, 'Fev': 1, 'Mar': 2, 'Abr': 3, 'Mai': 4, 'Jun': 5 };
                if (months[label] !== undefined) searchKey = `monthly-${currentYear}-${String(months[label] + 1).padStart(2, '0')}`;
            } else {
                searchKey = `${reportPeriodType}-${label.toLowerCase()}`;
            }

            const pStats = periodStatsMap[searchKey];
            if (!pStats || expectedPerPeriod === 0) return 0;
            return Math.round((pStats.ok / expectedPerPeriod) * 100);
        });
    } catch (e) {
        console.error("Erro ao calcular tendência:", e);
        trendData = trendLabels.map(() => 0);
    }

    trendChart = new Chart(ctxTrend, {
        type: 'line',
        data: {
            labels: trendLabels,
            datasets: [{
                label: 'Adesão (%)',
                data: trendData,
                borderColor: '#6366f1',
                backgroundColor: 'rgba(99, 102, 241, 0.1)',
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 200 },
            scales: {
                y: { beginAtZero: true, max: 100, ticks: { color: '#94a3b8' } },
                x: { ticks: { color: '#94a3b8' } }
            },
            plugins: { legend: { display: false } }
        }
    });

    // 6. Preparar listagem de professores por status
    const teacherMap = {};
    state.teachers.forEach(t => teacherMap[t.id] = t);

    const listHtml = { 'Sim': [], 'Não fez': [], 'Parcialmente': [], 'Pendente': [] };
    const listTotals = { 'Sim': 0, 'Não fez': 0, 'Parcialmente': 0, 'Pendente': 0 };
    const grouped = { 'Sim': {}, 'Não fez': {}, 'Parcialmente': {}, 'Pendente': {} };

    // Usamos filteredTracking que já contém os dados necessários
    filteredTracking.sort((a, b) => b.periodo.localeCompare(a.periodo));

    filteredTracking.forEach(item => {
        const prof = teacherMap[item.professor_id];
        const sistemas = prof ? (prof.sistemas || ['eclass']) : [];
        if (!prof || !sistemas.includes(state.activeSystem)) return;

        const statusKey = grouped[item.status] ? item.status : 'Pendente';
        const statusGroup = grouped[statusKey];
        
        if (!statusGroup[prof.id]) {
            statusGroup[prof.id] = { nome: prof.nome, count: 0, details: [] };
        }
        statusGroup[prof.id].count++;
        statusGroup[prof.id].details.push(`${item.serie} | ${item.periodo.replace(reportPeriodType+'-', '')}`);
        listTotals[statusKey]++;
    });

    // IMPORTANTE: Adicionar quem não tem NENHUM registro no período como Pendente
    // Porém, em relatórios agregados, isso é complexo. 
    // Vamos manter apenas quem tem registro explícito de pendência ou o total do doughnut reflete a omissão.
    // O usuário disse: "gráfico... aparece só com os dados Pendentes e os cards... aparecem com outros dados"
    // Isso sugere que o Doughnut deve bater com os cards.
    // Então para o Doughnut bater com os cards em termos de Sim/Não/Parcial, 
    // a base deve ser a mesma. O "Pendente" do doughnut incluirá as omissões.

    Object.keys(grouped).forEach(status => {
        const profs = Object.values(grouped[status]);
        profs.sort((a, b) => a.nome.localeCompare(b.nome));
        
        profs.forEach(p => {
            const badge = p.count > 1 ? `<span style="background: rgba(255,255,255,0.1); color: var(--text-main); padding: 2px 6px; border-radius: 12px; font-size: 0.75rem; margin-left: 8px;">${p.count}</span>` : '';
            const detailsHtml = p.details.map(d => {
                const [serie, periodPart] = d.split(' | ');
                return `<div>${serie} | ${formatPeriodForDisplay(periodPart)}</div>`;
            }).join('');
            
            const html = `
                <div style="padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <div style="font-weight: 600; font-size: 0.9rem; display: flex; align-items: center;">${p.nome} ${badge}</div>
                    <div style="color: var(--text-muted); font-size: 0.75rem; margin-top: 4px;">${detailsHtml}</div>
                </div>
            `;
            listHtml[status].push(html);
        });
    });

    const container = document.getElementById('report-teacher-list');
    if (container) {
        container.innerHTML = `
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1.5rem;">
                <div class="card" style="padding: 1.5rem; border-top: 4px solid var(--success);">
                    <h3 style="color: var(--success); margin-bottom: 1rem; font-size: 1rem; display: flex; justify-content: space-between;">
                        <span><i class="fas fa-check-circle"></i> Sim</span>
                        <span style="background: rgba(16,185,129,0.15); padding: 2px 8px; border-radius: 12px; font-size: 0.8rem;">${listTotals['Sim']}</span>
                    </h3>
                    <div style="display: flex; flex-direction: column; max-height: 400px; overflow-y: auto; padding-right: 5px;" class="scroll-box">
                        ${listHtml['Sim'].join('') || '<span style="color: var(--text-muted); font-size: 0.85rem;">Nenhum registro</span>'}
                    </div>
                </div>
                <div class="card" style="padding: 1.5rem; border-top: 4px solid var(--danger);">
                    <h3 style="color: var(--danger); margin-bottom: 1rem; font-size: 1rem; display: flex; justify-content: space-between;">
                        <span><i class="fas fa-times-circle"></i> Não fez</span>
                        <span style="background: rgba(239,68,68,0.15); padding: 2px 8px; border-radius: 12px; font-size: 0.8rem;">${listTotals['Não fez']}</span>
                    </h3>
                    <div style="display: flex; flex-direction: column; max-height: 400px; overflow-y: auto; padding-right: 5px;" class="scroll-box">
                        ${listHtml['Não fez'].join('') || '<span style="color: var(--text-muted); font-size: 0.85rem;">Nenhum registro</span>'}
                    </div>
                </div>
                <div class="card" style="padding: 1.5rem; border-top: 4px solid var(--warning);">
                    <h3 style="color: var(--warning); margin-bottom: 1rem; font-size: 1rem; display: flex; justify-content: space-between;">
                        <span><i class="fas fa-exclamation-circle"></i> Parcialmente</span>
                        <span style="background: rgba(245,158,11,0.15); padding: 2px 8px; border-radius: 12px; font-size: 0.8rem;">${listTotals['Parcialmente']}</span>
                    </h3>
                    <div style="display: flex; flex-direction: column; max-height: 400px; overflow-y: auto; padding-right: 5px;" class="scroll-box">
                        ${listHtml['Parcialmente'].join('') || '<span style="color: var(--text-muted); font-size: 0.85rem;">Nenhum registro</span>'}
                    </div>
                </div>
                <div class="card" style="padding: 1.5rem; border-top: 4px solid #64748b;">
                    <h3 style="color: #94a3b8; margin-bottom: 1rem; font-size: 1rem; display: flex; justify-content: space-between;">
                        <span><i class="fas fa-clock"></i> Pendente explícito</span>
                        <span style="background: rgba(100,116,139,0.15); padding: 2px 8px; border-radius: 12px; font-size: 0.8rem;">${listTotals['Pendente']}</span>
                    </h3>
                    <div style="display: flex; flex-direction: column; max-height: 400px; overflow-y: auto; padding-right: 5px;" class="scroll-box">
                        ${listHtml['Pendente'].join('') || '<span style="color: var(--text-muted); font-size: 0.85rem;">Nenhum registro</span>'}
                        <div style="margin-top: 15px; font-size: 0.75rem; color: var(--text-muted); font-style: italic;">*Apenas pendências explícitas lançadas.</div>
                    </div>
                </div>
            </div>
        `;
    }

    // Gerar a versão em tabela para a impressão
    let printTableHtml = `
        <table class="report-print-table">
            <thead>
                <tr>
                    <th style="width: 30%;">Professor</th>
                    <th style="width: 20%;">Status</th>
                    <th style="width: 50%;">Série | Período</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    const statusColors = { 'Sim': '#10b981', 'Não fez': '#ef4444', 'Parcialmente': '#f59e0b', 'Pendente': '#64748b' };
    
    ['Sim', 'Não fez', 'Parcialmente', 'Pendente'].forEach(status => {
        if (!grouped[status]) return;
        const profs = Object.values(grouped[status]);
        profs.sort((a, b) => a.nome.localeCompare(b.nome));
        
        profs.forEach(p => {
            const detailsHtml = p.details.map(d => {
                const [serie, periodPart] = d.split(' | ');
                return `${serie} | ${formatPeriodForDisplay(periodPart)}`;
            }).join('<br>');
            
            printTableHtml += `
                <tr>
                    <td style="font-weight: bold; border-left: 4px solid ${statusColors[status]};">${p.nome}</td>
                    <td style="color: ${statusColors[status]}; font-weight: bold;">${status} ${p.count > 1 ? `(${p.count})` : ''}</td>
                    <td>${detailsHtml}</td>
                </tr>
            `;
        });
    });
    
    printTableHtml += `</tbody></table>`;
    
    const printContainer = document.getElementById('report-print-table-container');
    if (printContainer) {
        if (Object.values(listTotals).reduce((a, b) => a + b, 0) === 0) {
            printContainer.innerHTML = '<p style="text-align: center; color: #555; padding: 2rem;">Nenhum registro encontrado para este período.</p>';
        } else {
            printContainer.innerHTML = printTableHtml;
        }
    }
}

// --- Print Report ---
function printReport() {
    window.print();
}

window.addEventListener('beforeprint', () => {
    if (state.currentSection === 'reports') {
        document.body.classList.add('printing-report');
        if (typeof mainChart !== 'undefined' && mainChart) {
            mainChart.options.plugins.legend.labels.color = '#000000';
            if (mainChart.options.plugins.datalabels) {
                mainChart.options.plugins.datalabels.color = '#ffffff';
            }
            mainChart.update('none');
        }
        if (typeof trendChart !== 'undefined' && trendChart) {
            trendChart.options.scales.x.ticks.color = '#000000';
            trendChart.options.scales.y.ticks.color = '#000000';
            trendChart.update('none');
        }
    }
});

window.addEventListener('afterprint', () => {
    if (state.currentSection === 'reports') {
        document.body.classList.remove('printing-report');
        if (typeof mainChart !== 'undefined' && mainChart) {
            mainChart.options.plugins.legend.labels.color = '#f8fafc';
            if (mainChart.options.plugins.datalabels) {
                mainChart.options.plugins.datalabels.color = '#ffffff';
            }
            mainChart.update('none');
        }
        if (typeof trendChart !== 'undefined' && trendChart) {
            trendChart.options.scales.x.ticks.color = '#94a3b8';
            trendChart.options.scales.y.ticks.color = '#94a3b8';
            trendChart.update('none');
        }
    }
});

function getTrendLabels(type) {
    switch(type) {
        case 'daily': return ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'];
        case 'weekly': return ['Sem 1', 'Sem 2', 'Sem 3', 'Sem 4'];
        case 'monthly': return ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun'];
        case 'bimestral': return ['Bim 1', 'Bim 2', 'Bim 3', 'Bim 4', 'Bim 5', 'Bim 6'];
        case 'trimestral': return ['Tri 1', 'Tri 2', 'Tri 3', 'Tri 4'];
        case 'semestral': return ['Sem 1', 'Sem 2'];
        case 'anual': return ['2023', '2024', '2025', '2026'];
        default: return ['P1', 'P2', 'P3', 'P4'];
    }
}

// --- Segmentos Management ---
async function fetchSegmentos() {
    const { data, error } = await _supabase.from('segmentos').select('*').order('ordem', { ascending: true });
    if (error) console.error('Error fetching segmentos:', error);
    else state.segmentos = data;
}

async function saveSegment() {
    const nome = document.getElementById('new-segment-name').value.trim();
    if (!nome) return;

    const { error } = await _supabase.from('segmentos').insert([{ nome, ordem: state.segmentos.length + 1 }]);
    if (error) alert('Erro ao salvar turma: ' + error.message);
    else {
        document.getElementById('new-segment-name').value = '';
        await renderSegmentList();
        await fetchSegmentos();
    }
}

async function deleteSegment(id) {
    if (!confirm('Excluir esta turma? Séries vinculadas ficarão sem categoria.')) return;
    const { error } = await _supabase.from('segmentos').delete().eq('id', id);
    if (error) alert('Erro ao excluir: ' + error.message);
    else {
        await renderSegmentList();
        await fetchSegmentos();
    }
}

async function renderSegmentList() {
    await fetchSegmentos();
    const list = document.getElementById('segment-list');
    list.innerHTML = state.segmentos.map(s => `
        <tr>
            <td>${s.nome}</td>
            <td style="text-align: right;">
                <button class="btn" style="padding: 0.2rem 0.5rem; background: rgba(239, 68, 68, 0.1); color: var(--danger);" onclick="deleteSegment('${s.id}')">Excluir</button>
            </td>
        </tr>
    `).join('');
}

// --- Series Management ---
async function fetchSeries() {
    const { data, error } = await _supabase.from('series').select('*').order('nome', { ascending: true });
    if (error) console.error('Error fetching series:', error);
    else state.series = data;
}

async function openSeriesModal(id = null) {
    state.editingSeriesId = id;
    await fetchSegmentos();
    const select = document.getElementById('series-segment');
    select.innerHTML = '<option value="">Sem Turma/Segmento</option>' + 
        state.segmentos.map(s => `<option value="${s.id}">${s.nome}</option>`).join('');
    
    const title = document.getElementById('series-modal-title');
    const nameInput = document.getElementById('series-name');

    if (id) {
        const serie = state.series.find(s => s.id === id);
        title.textContent = 'Editar Série';
        nameInput.value = serie.nome;
        select.value = serie.segmento_id || '';
    } else {
        title.textContent = 'Nova Série';
        nameInput.value = '';
        select.value = '';
    }

    const modal = document.getElementById('series-modal-container');
    if (modal) modal.style.display = 'flex';
}

function closeSeriesModal() {
    const modal = document.getElementById('series-modal-container');
    if (modal) modal.style.display = 'none';
    state.editingSeriesId = null;
    document.getElementById('series-name').value = '';
}

async function saveSeries() {
    const nome = document.getElementById('series-name').value.trim();
    const segmento_id = document.getElementById('series-segment').value || null;
    if (!nome) return;

    let error;
    if (state.editingSeriesId) {
        const res = await _supabase.from('series').update({ nome, segmento_id }).eq('id', state.editingSeriesId);
        error = res.error;
    } else {
        const res = await _supabase.from('series').insert([{ nome, segmento_id }]);
        error = res.error;
    }

    if (error) alert('Erro ao salvar série: ' + error.message);
    else {
        closeSeriesModal();
        await renderSeriesList();
    }
}

async function renderSeriesList() {
    await fetchSegmentos();
    await fetchSeries();
    await renderSegmentList();
    const container = document.getElementById('series-list');
    
    if (state.series.length === 0) {
        container.innerHTML = '<p style="color: var(--text-muted); text-align: center; width: 100%;">Nenhuma série cadastrada.</p>';
        return;
    }

    // Agrupar por segmento
    const grouped = {};
    state.segmentos.forEach(s => grouped[s.id] = { nome: s.nome, items: [] });
    grouped['none'] = { nome: 'Sem Categoria', items: [] };

    state.series.forEach(s => {
        const segId = s.segmento_id || 'none';
        if (!grouped[segId]) grouped[segId] = { nome: 'Outros', items: [] };
        grouped[segId].items.push(s);
    });

    let html = state.segmentos.map(seg => {
        const group = grouped[seg.id] || { nome: seg.nome, items: [] };
        if (group.items.length === 0) {
             return `
                <div class="segment-card">
                    <div class="segment-header">
                        <h2><i class="fas fa-folder-open" style="opacity: 0.5;"></i> ${seg.nome}</h2>
                        <span class="segment-badge">0 Séries</span>
                    </div>
                    <div class="segment-content" style="padding: 1.5rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
                        Nenhuma série vinculada a esta turma.
                    </div>
                </div>
            `;
        }

        return `
            <div class="segment-card">
                <div class="segment-header">
                    <h2><i class="fas fa-layer-group"></i> ${group.nome}</h2>
                    <span class="segment-badge">${group.items.length} Séries</span>
                </div>
                <div class="segment-content">
                    <table class="series-table">
                        <tbody>
                            ${group.items.map(serie => `
                                <tr>
                                    <td>${serie.nome}</td>
                                    <td style="text-align: right; display: flex; gap: 8px; justify-content: flex-end;">
                                        <button class="btn" style="padding: 0.2rem 0.5rem; background: rgba(99, 102, 241, 0.1); color: #818cf8;" onclick="openSeriesModal('${serie.id}')">Editar</button>
                                        <button class="btn" style="padding: 0.2rem 0.5rem; background: rgba(239, 68, 68, 0.1); color: var(--danger);" onclick="deleteSeries('${serie.id}')">Excluir</button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }).join('');

    // Adiciona órfãos (sem categoria) no final
    if (grouped['none'] && grouped['none'].items.length > 0) {
        html += `
            <div class="segment-card" style="border-style: dashed; opacity: 0.8;">
                <div class="segment-header">
                    <h2><i class="fas fa-question-circle"></i> Sem Categoria</h2>
                    <span class="segment-badge">${grouped['none'].items.length} Séries</span>
                </div>
                <div class="segment-content">
                    <table class="series-table">
                        <tbody>
                            ${grouped['none'].items.map(serie => `
                                <tr>
                                    <td>${serie.nome}</td>
                                    <td style="text-align: right; display: flex; gap: 8px; justify-content: flex-end;">
                                        <button class="btn" style="padding: 0.2rem 0.5rem; background: rgba(99, 102, 241, 0.1); color: #818cf8;" onclick="openSeriesModal('${serie.id}')">Editar</button>
                                        <button class="btn" style="padding: 0.2rem 0.5rem; background: rgba(239, 68, 68, 0.1); color: var(--danger);" onclick="deleteSeries('${serie.id}')">Excluir</button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    container.innerHTML = html;
}

async function deleteSeries(id) {
    if (!confirm('Tem certeza que deseja excluir esta série?')) return;
    const { error } = await _supabase.from('series').delete().eq('id', id);
    if (error) alert('Erro ao excluir: ' + error.message);
    else await renderSeriesList();
}

async function initDashboard() {
    await fetchSegmentos();
    await fetchSeries();
    await renderTrackingList();
    await loadConfig(); // Prefetch config
}

// Bind events safely
const periodTypeEl = document.getElementById('period-type');
const weekSelectorEl = document.getElementById('week-selector');
const reportPeriodEl = document.getElementById('report-period');

if (periodTypeEl) periodTypeEl.addEventListener('change', () => { updatePeriodSelector(); renderTrackingList(); });
if (weekSelectorEl) weekSelectorEl.addEventListener('change', () => renderTrackingList());
if (reportPeriodEl) reportPeriodEl.addEventListener('change', renderReports);

// --- Easter Egg ---
let logoClicks = 0;
let logoClickTimeout;

function handleLogoClick() {
    logoClicks++;
    clearTimeout(logoClickTimeout);
    
    if (logoClicks === 3) {
        openCredits();
        logoClicks = 0;
    } else {
        logoClickTimeout = setTimeout(() => {
            logoClicks = 0;
        }, 1000); // 1 segundo para clicar 3 vezes
    }
}

function openCredits() {
    const screen = document.getElementById('credits-screen');
    if (screen) {
        screen.style.display = 'flex';
        // Impede scroll do body
        document.body.style.overflow = 'hidden';
    }
}

function closeCredits() {
    const screen = document.getElementById('credits-screen');
    if (screen) {
        screen.style.display = 'none';
        // Restaura scroll do body
        document.body.style.overflow = 'auto';
    }
}
