// --- Supabase Configuration ---
const SUPABASE_URL = 'https://qqnckvemoetdbimrofrm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_9Ys3sLag7RRkVjkMBG7uHQ_hq4bNURE';
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// --- State Management ---
let state = {
    user: null,
    teachers: [],
    series: [], 
    tracking: {}, 
    config: {
        cidade_uf: 'Sua Cidade - UF',
        assinatura_url: ''
    },
    currentSection: 'tracking',
    editingTeacherId: null,
    sortConfig: { key: 'nome', direction: 'asc' }
};

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

    const savedUser = localStorage.getItem('sace_user');
    if (savedUser) {
        state.user = JSON.parse(savedUser);
        document.getElementById('auth-overlay').style.display = 'none';
        updateUserInfo();
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
    await initDashboard();
}

function updateUserInfo() {
    const nameEl = document.getElementById('user-name');
    const roleEl = document.getElementById('user-role-label');
    if (nameEl) nameEl.textContent = state.user.name;
    if (roleEl) roleEl.textContent = state.user.role;
}

// --- Navigation ---
async function showSection(id) {
    document.querySelectorAll('.section').forEach(s => s.style.display = 'none');
    document.getElementById(`section-${id}`).style.display = 'block';
    
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    const activeLink = Array.from(document.querySelectorAll('.nav-link'))
        .find(l => l.getAttribute('onclick')?.includes(id));
    if (activeLink) activeLink.classList.add('active');
    
    state.currentSection = id;
    if (id === 'tracking') await renderTrackingList();
    if (id === 'teachers') await renderTeacherList();
    if (id === 'series') await renderSeriesList();
    if (id === 'reports') await renderReports();
    if (id === 'config') await loadConfig();
}

// --- Config Management ---
async function loadConfig() {
    const { data, error } = await _supabase.from('configuracoes').select('*');
    if (!error && data) {
        data.forEach(item => {
            state.config[item.chave] = item.valor;
        });
    }
    
    document.getElementById('config-cidade-uf').value = state.config.cidade_uf || '';
    if (state.config.assinatura_url) {
        document.getElementById('signature-preview').src = state.config.assinatura_url;
        document.getElementById('signature-preview-container').style.display = 'block';
    }
}

async function handleSignatureUpload(input) {
    if (!input.files || !input.files[0]) return;
    
    const file = input.files[0];
    const fileExt = file.name.split('.').pop();
    const fileName = `sig_${Date.now()}.${fileExt}`;
    const filePath = `${fileName}`;

    // Upload to Supabase Storage (Bucket: assinaturas)
    const { error: uploadError } = await _supabase.storage
        .from('assinaturas')
        .upload(filePath, file);

    if (uploadError) {
        alert('Erro ao subir imagem: ' + uploadError.message);
        return;
    }

    // Get Public URL
    const { data: { publicUrl } } = _supabase.storage
        .from('assinaturas')
        .getPublicUrl(filePath);

    state.config.assinatura_url = publicUrl;
    document.getElementById('signature-preview').src = publicUrl;
    document.getElementById('signature-preview-container').style.display = 'block';
}

async function saveConfig() {
    const cidade_uf = document.getElementById('config-cidade-uf').value;
    
    const updates = [
        { chave: 'cidade_uf', valor: cidade_uf },
        { chave: 'assinatura_url', valor: state.config.assinatura_url }
    ];

    const { error } = await _supabase
        .from('configuracoes')
        .upsert(updates);

    if (error) alert('Erro ao salvar configurações: ' + error.message);
    else alert('Configurações salvas com sucesso!');
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

function renderSeriesPicker(selectedSeries = []) {
    const picker = document.getElementById('series-picker');
    if (!state.series || state.series.length === 0) {
        picker.innerHTML = '<p style="color: var(--text-muted); font-size: 0.8rem; text-align: center;">Cadastre séries na aba "Séries" primeiro.</p>';
        return;
    }
    picker.innerHTML = state.series.map(s => {
        const isChecked = selectedSeries.includes(s.nome) ? 'checked' : '';
        return `
            <label style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; cursor: pointer;">
                <input type="checkbox" name="prof-series" value="${s.nome}" style="width: auto;" ${isChecked}>
                <span>${s.nome}</span>
            </label>
        `;
    }).join('');
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
    list.innerHTML = state.teachers.map(t => `
        <tr>
            <td>${t.nome}</td>
            <td style="text-transform: capitalize;">${t.tipo}</td>
            <td>${t.series ? t.series.join(', ') : '-'}</td>
            <td>
                <div style="display: flex; gap: 0.5rem;">
                    <button class="btn" style="padding: 0.2rem 0.5rem; background: rgba(99, 102, 241, 0.1); color: #818cf8;" onclick="openTeacherModal('${t.id}')">Editar</button>
                    <button class="btn" style="padding: 0.2rem 0.5rem; background: rgba(239, 68, 68, 0.1); color: var(--danger);" onclick="deleteTeacher('${t.id}')">Excluir</button>
                </div>
            </td>
        </tr>
    `).join('');
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
        .from('acompanhamento')
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

async function renderTrackingList(shouldFetch = true) {
    const periodValue = document.getElementById('week-selector').value;
    const periodType = document.getElementById('period-type').value;
    const filterProf = document.getElementById('filter-prof').value.toLowerCase();
    const filterSerie = document.getElementById('filter-serie').value.toLowerCase();
    const key = `${periodType}-${periodValue}`;
    
    if (shouldFetch) {
        await fetchTeachers();
        await fetchTracking(periodType, periodValue);
    }

    if (!state.tracking[key]) state.tracking[key] = {};

    const list = document.getElementById('tracking-list');
    let rowsData = [];
    
    state.teachers.forEach(t => {
        if (!t.series) return;
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
        let rowClass = '';
        if (row.status === 'Sim') rowClass = 'row-sim';
        else if (row.status === 'Não fez') rowClass = 'row-nao';
        else if (row.status === 'Parcialmente') rowClass = 'row-parcial';

        const safeSerie = row.serie.replace(/\s+/g, '_').replace(/[^\w]/g, '');
        return `
            <tr class="${rowClass}" id="row-${row.id}-${safeSerie}">
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
                        
                        ${row.status === 'Não fez' ? `
                            <button class="btn btn-primary" style="padding: 0.2rem 0.6rem; font-size: 0.75rem; width: fit-content;" onclick="printTerm('${row.id}', '${row.serie}')">
                                Imprimir Termo
                            </button>` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    if (rowsData.length === 0) {
        list.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">Nenhum registro encontrado.</td></tr>';
    }
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
        .from('acompanhamento')
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
    
    // Load config before printing
    await loadConfig();

    document.getElementById('print-prof-name').textContent = teacher.nome;
    document.getElementById('print-prof-grades').textContent = serie; 
    document.getElementById('print-week').textContent = periodValue;
    document.getElementById('print-date').textContent = new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
    document.getElementById('print-prof-sign-name').textContent = teacher.nome;
    document.getElementById('print-coord-name').textContent = state.user.name;
    document.getElementById('print-city-uf').textContent = state.config.cidade_uf;

    const sigImg = document.getElementById('print-coord-signature');
    if (state.config.assinatura_url) {
        sigImg.src = state.config.assinatura_url;
        sigImg.style.display = 'block';
    } else {
        sigImg.style.display = 'none';
    }
    
    // Wait for image to load if visible
    if (sigImg.style.display === 'block') {
        sigImg.onload = () => window.print();
    } else {
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
    
    const periodValue = document.getElementById('week-selector').value;
    const periodType = document.getElementById('period-type').value;
    const currentKey = `${periodType}-${periodValue}`;

    // 1. Buscar registros existentes
    const { data: allTracking, error } = await _supabase
        .from('acompanhamento')
        .select('status')
        .eq('periodo', currentKey);
    
    // 2. Calcular total esperado de registros
    let totalExpected = 0;
    state.teachers.forEach(t => {
        if (t.series) totalExpected += t.series.length;
    });

    const stats = { sim: 0, nao: 0, parcial: 0, pendente: 0 };
    let totalRecorded = 0;

    if (!error && allTracking) {
        allTracking.forEach(item => {
            if (item.status === 'Sim') stats.sim++;
            else if (item.status === 'Não fez') stats.nao++;
            else if (item.status === 'Parcialmente') stats.parcial++;
            else stats.pendente++;
            totalRecorded++;
        });
    }

    // 3. Pendentes reais = (Já marcados como pendente) + (Quem ainda não tem registro)
    stats.pendente += (totalExpected - totalRecorded);

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

    const trendLabels = getTrendLabels(reportPeriodType);
    const trendData = trendLabels.map(() => Math.floor(Math.random() * 40) + 60);

    if (trendChart) trendChart.destroy();
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
            scales: {
                y: { beginAtZero: true, max: 100, ticks: { color: '#94a3b8' } },
                x: { ticks: { color: '#94a3b8' } }
            },
            plugins: { legend: { display: false } }
        }
    });
}

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

// --- Series Management ---
async function fetchSeries() {
    const { data, error } = await _supabase.from('series').select('*').order('nome', { ascending: true });
    if (error) console.error('Error fetching series:', error);
    else state.series = data;
}

function openSeriesModal() {
    const modal = document.getElementById('series-modal-container');
    if (modal) modal.style.display = 'flex';
}

function closeSeriesModal() {
    const modal = document.getElementById('series-modal-container');
    if (modal) modal.style.display = 'none';
    document.getElementById('series-name').value = '';
}

async function saveSeries() {
    const nome = document.getElementById('series-name').value.trim();
    if (!nome) return;

    const { error } = await _supabase.from('series').insert([{ nome }]);
    if (error) alert('Erro ao salvar série: ' + error.message);
    else {
        closeSeriesModal();
        await renderSeriesList();
    }
}

async function renderSeriesList() {
    await fetchSeries();
    const list = document.getElementById('series-list');
    list.innerHTML = state.series.map(s => `
        <tr>
            <td>${s.nome}</td>
            <td style="text-align: right;">
                <button class="btn" style="padding: 0.2rem 0.5rem; background: rgba(239, 68, 68, 0.1); color: var(--danger);" onclick="deleteSeries('${s.id}')">Excluir</button>
            </td>
        </tr>
    `).join('');
}

async function deleteSeries(id) {
    if (!confirm('Tem certeza que deseja excluir esta série?')) return;
    const { error } = await _supabase.from('series').delete().eq('id', id);
    if (error) alert('Erro ao excluir: ' + error.message);
    else await renderSeriesList();
}

async function initDashboard() {
    await fetchSeries();
    await renderTrackingList();
    await loadConfig(); // Prefetch config
}

// Bind events safely
const periodTypeEl = document.getElementById('period-type');
const weekSelectorEl = document.getElementById('week-selector');
const reportPeriodEl = document.getElementById('report-period');

if (periodTypeEl) periodTypeEl.addEventListener('change', () => renderTrackingList());
if (weekSelectorEl) weekSelectorEl.addEventListener('change', () => renderTrackingList());
if (reportPeriodEl) reportPeriodEl.addEventListener('change', renderReports);
