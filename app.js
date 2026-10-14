/**
 * CareX — Pharmacotherapy Decision Support Platform
 * Dynamic Recreated Knowledge Graph & Real Prescription PDF Extraction
 */

const defaultPatient = {
  id: 'DEMO-PT-4092',
  name: 'Eleanor Vance',
  age: '67',
  gender: 'Female',
  height: '165 cm',
  weight: '68 kg',
  bp: '128/82',
  conditions: 'Type 2 Diabetes, Hypertension, Post-DVT',
  allergies: 'Penicillin-class medicines (fictional patient-reported sample)',
  medications: ['Metformin', 'Amlodipine']
};

const defaultDoctor = {
  name: 'Dr. Sarah Lin, MD',
  specialty: 'Clinical Pharmacology',
  id: 'DEMO-DR-8841',
  doctorId: 'DEMO-DR-8841'
};

const appState = {
  page: 'login',
  role: 'patient',
  authMode: 'email',
  authStep: 'signin',
  session: null,
  patient: { ...defaultPatient },
  doctor: { ...defaultDoctor },
  patients: [],
  analytics: null,
  catalog: [],
  qrDataUrl: '',
  search: '',
  lookup: null,
  meds: [],
  uploaded: null,
  uploadIds: [],
  history: [],
  uploads: [],
  currentAssessment: null,
  activePrescription: null,
  extractedMeds: [],
  assessmentResults: null,
  samplePrescriptions: [],
  graph: null,
  catalogGraph: null,
  graphMode: 'patient',
  graphFilter: 'all',
  graphSelected: null,
  graphZoom: 1,
  graphPan: { x: 0, y: 0 },
  isExtracting: false,
  extractionStatusText: '',
  identifier: '',
  demoCode: '123456',
  // Doctor patient lookup
  lookupPatientId: '',
  lookupResult: null,
  lookupLoading: false,
  lookupError: ''
};

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

let graphDrag = null;
let qrStream = null;
let qrScanTimer = null;

async function api(path, options = {}) {
  const headers = {
    ...(options.body instanceof Blob || options.body instanceof FormData ? {} : { 'content-type': 'application/json' }),
    ...(options.headers || {})
  };
  const token = localStorage.getItem('mediguard-token');
  if (token) headers.authorization = `Bearer ${token}`;

  const response = await fetch(`/api${path}`, { ...options, headers });
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function mapAssessment(a) {
  const results = a.results || [];
  const highest = results.some(r => r.reviewPriority === 'Highest priority' || r.cannotBePaired);
  const standard = results.length > 0;
  return {
    ...a,
    id: a.patientId || a.patient?.id,
    name: a.patientName || a.patient?.name || 'Sample patient',
    meds: `${(a.medicines || []).length} medicines`,
    interactions: results.length ? `${results.length} interaction alert(s)` : 'Compatible regimen',
    priority: highest ? 'Highest priority' : standard ? 'Standard review' : 'Informational',
    status: a.reviewStatus || a.status || 'Pending review',
    when: new Date(a.createdAt || Date.now()).toLocaleString(),
    assessmentId: a.id
  };
}

async function loadSessionData() {
  const me = await api('/me');
  appState.session = me.user;
  appState.role = me.user.role;
  if (me.user.role === 'patient' && me.profile) {
    appState.patient = { ...appState.patient, ...me.profile };
  }
  if (me.user.role === 'doctor') {
    appState.doctor = { ...appState.doctor, ...me.user, id: me.user.doctorId };
  }

  const [history, uploads, graph, patients, samples] = await Promise.all([
    api('/assessments').catch(() => ({ assessments: [] })),
    api('/uploads').catch(() => ({ uploads: [] })),
    api('/knowledge-graph').catch(() => ({ graph: null })),
    api('/patients').catch(() => ({ patients: [] })),
    api('/prescriptions/samples').catch(() => ({ samples: [] }))
  ]);

  appState.history = (history.assessments || []).map(mapAssessment);
  appState.uploads = uploads.uploads || [];
  appState.catalogGraph = graph.graph; // Never use crowded circular ring
  appState.graph = graph.graph;
  appState.analytics = graph.analytics || null;
  appState.catalog = graph.catalog || [];
  appState.patients = patients.patients || [];
  appState.samplePrescriptions = samples.samples || [];

  if (me.user.role === 'patient') {
    try {
      const qr = await api(`/patient/qr?patientId=${encodeURIComponent(me.user.patientId)}`);
      appState.qrDataUrl = qr.qrDataUrl;
    } catch {}
  }
  return me;
}

async function bootstrap() {
  const token = localStorage.getItem('mediguard-token');
  if (token) {
    try {
      await loadSessionData();
      appState.page = appState.role === 'doctor' ? 'doctor' : 'patient';
    } catch {
      localStorage.removeItem('mediguard-token');
      appState.session = null;
      appState.page = 'login';
    }
  }
  render();
}

function setPage(page) {
  appState.page = page;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toast(message) {
  const old = $('.toast');
  if (old) old.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.append(el);
  setTimeout(() => el.remove(), 3500);
}

function navButton(page, text, icon) {
  return `<button class="${appState.page === page ? 'active' : ''}" data-page="${page}"><span aria-hidden="true">${icon}</span> ${text}</button>`;
}

function header() {
  const isDoctor = appState.role === 'doctor';
  return `
  <header class="topbar">
    <div class="top-inner">
      <div class="brandrow">
        <div class="brand">
          <div class="logo">✚</div>
          <div>
            <div class="brand-name">
              CareX
              <span class="badge">${isDoctor ? 'Doctor Portal' : 'Patient Portal'}</span>
            </div>
            <div class="brand-sub">Clinical Pharmacotherapy Decision Support & Prescription Graph Studio</div>
          </div>
        </div>
        <div class="top-actions">
          <span class="small-muted desktop">${isDoctor ? esc(appState.doctor.name) : esc(appState.patient.name)}</span>
          <button class="btn secondary small desktop" data-action="switch-role">⇄ Switch to ${isDoctor ? 'Patient' : 'Doctor'} Portal</button>
          <button class="btn ghost small" data-action="logout">Sign out</button>
        </div>
      </div>
      <nav class="nav">
        <div class="navlinks">
          ${isDoctor
            ? `${navButton('doctor', 'Dashboard', '▦')}
               ${navButton('graph', 'Contradiction Graph', '⌘')}
               ${navButton('assessment', 'Upload Prescription', '📄')}
               ${navButton('queue', 'Review Queue', '⚑')}
               ${navButton('history', 'Assessment History', '◷')}
               ${navButton('medicines', 'Brand Formulary', '▤')}
               ${navButton('profile', 'Doctor Profile', '◉')}`
            : `${navButton('patient', 'My Dashboard', '▦')}
               ${navButton('assessment', 'Upload Prescription', '📄')}
               ${navButton('graph', 'My Safety Graph', '⌘')}
               ${navButton('history', 'My Checks', '◷')}
               ${navButton('profile', 'My Profile & Allergies', '◉')}`
          }
        </div>
        <span class="nav-right">CERTIFIED PHARMACOTHERAPY ENGINE • REAL-TIME PDF EXTRACTION</span>
      </nav>
    </div>
  </header>`;
}

function pageHead(kicker, title, sub, action = '') {
  return `<section class="page-head"><div><div class="eyebrow">${kicker}</div><h1>${title}</h1><p>${sub}</p></div>${action}</section>`;
}

function metric(label, value, note, color = '') {
  return `<article class="metric"><div class="metric-label">${label}</div><div class="metric-value" style="color:${color}">${value}</div><div class="metric-note">${note}</div></article>`;
}

/**
 * PRESCRIPTION UPLOAD & PDF PARSER COMPONENT (Available for Both Patients and Doctors)
 */
function prescriptionUploadSection(title = 'Upload Prescription PDF') {
  const samples = appState.samplePrescriptions;
  const isDoctor = appState.role === 'doctor';

  return `
  <section class="card rx-upload-hero" id="rx-dropzone">
    <div class="rx-upload-icon">📄</div>
    <h2>${esc(title)}</h2>
    <p style="max-width:600px;margin:0 auto 16px">
      ${isDoctor
        ? 'Upload an incoming hospital or clinic prescription PDF to extract active drug names, cross-reference against patient allergies, and generate the contradiction graph.'
        : 'Upload your doctor\'s prescription PDF to instantly check if the medicines can be safely taken together, or if there are dangerous clashes with your allergies.'
      }
    </p>

    <div style="display:flex;justify-content:center;gap:12px;flex-wrap:wrap;align-items:center">
      <label class="btn" for="pdf-file-input" style="cursor:pointer;padding:12px 22px;font-size:14px">
        <span>⬆ Select Prescription PDF</span>
        <input id="pdf-file-input" type="file" accept=".pdf,.png,.jpg,.jpeg" style="display:none">
      </label>
      <span class="small-muted">or drag & drop PDF prescription here</span>
    </div>

    ${appState.isExtracting ? `
      <div style="margin-top:20px;padding:16px;background:#effbf8;border:1px solid #99f6e4;border-radius:12px">
        <div style="font-weight:700;color:var(--teal);margin-bottom:6px">⚡ ${esc(appState.extractionStatusText || 'Extracting active ingredients from PDF...')}</div>
        <div class="bar"><i style="width:100%;animation:dash-pulse 1s infinite"></i></div>
      </div>
    ` : ''}

    <div style="margin-top:26px;border-top:1px solid var(--line);padding-top:20px;text-align:left">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;margin-bottom:10px">
        <div>
          <strong style="font-size:13px;color:var(--ink)">💡 Quick-Test Clinical Sample Prescriptions</strong>
          <div class="small-muted">Click any sample to extract medications and test the contradiction graph instantly:</div>
        </div>
        <span class="pill">5 Ready-Made PDF Prescriptions</span>
      </div>

      <div class="rx-sample-grid">
        ${samples.map(s => {
          const isCritical = s.hazardLevel === 'CRITICAL_CONTRAINDICATION' || s.hazardLevel === 'ALLERGY_CONTRAINDICATION';
          const isCaution = s.hazardLevel === 'SEVERE_WARNING';
          const hazardClass = isCritical ? 'hazard-critical' : isCaution ? 'hazard-severe' : 'hazard-safe';
          const badgeClass = isCritical ? 'high' : isCaution ? 'moderate' : 'low';
          return `
            <div class="rx-sample-card ${hazardClass}">
              <div>
                <div class="rx-sample-header">
                  <span class="tag ${badgeClass}">${esc(s.hazardBadge)}</span>
                  <span class="small-muted">${esc(s.patientName)}</span>
                </div>
                <div class="rx-sample-title">${esc(s.title)}</div>
                <div class="rx-sample-meta">${esc(s.description)}</div>
              </div>
              <div class="rx-sample-actions">
                <button class="btn small" data-action="process-sample" data-sample-key="${esc(s.key)}">
                  ⚡ Run PDF Analysis
                </button>
                <a href="/api/prescriptions/download/${esc(s.filename)}" class="btn secondary small" download title="Download this PDF to test manual upload">
                  ⇩ Download PDF
                </a>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  </section>
  `;
}

/**
 * EXTRACTED MEDICINES CARDS
 */
function extractedMedicinesCard() {
  const meds = appState.extractedMeds;
  const assessment = appState.assessmentResults;
  if (!meds || !meds.length) return '';

  const hasCannotBePaired = assessment?.hasCannotBePaired;
  const hasCaution = assessment?.hasSevereWarnings;

  return `
  <section class="extracted-box">
    <div class="extracted-header">
      <div>
        <div class="eyebrow">Prescription Extraction Results</div>
        <h2>Extracted Medicines (${meds.length})</h2>
        <p class="small-muted">Directly parsed from uploaded prescription PDF document</p>
      </div>
      <button class="btn secondary small" data-page="graph">
        ⌘ View in Knowledge Graph →
      </button>
    </div>

    <div class="extracted-pill-list">
      ${meds.map(m => {
        const isConflict = assessment?.interactionResults?.some(r => (r.drugAId === m.id || r.drugBId === m.id) && r.cannotBePaired) ||
                           assessment?.allergyConflicts?.some(a => a.drugId === m.id);
        const isCaution = assessment?.interactionResults?.some(r => (r.drugAId === m.id || r.drugBId === m.id) && r.severity === 'SEVERE_WARNING');
        const statusClass = isConflict ? 'status-conflict' : isCaution ? 'status-caution' : 'status-safe';
        const badge = isConflict ? '<span class="tag high">⛔ Cannot Be Paired</span>' : isCaution ? '<span class="tag moderate">⚠️ Caution</span>' : '<span class="tag low">✓ Compatible</span>';

        return `
          <div class="extracted-pill ${statusClass}">
            <div class="extracted-pill-name">
              <span>${esc(m.name)}</span>
              ${badge}
            </div>
            <div class="extracted-pill-dose">Dose: ${esc(m.dosage)} • Brand: ${esc(m.brandMatched || 'Generic')}</div>
            <div class="extracted-pill-sig">${esc(m.frequency)}</div>
            <div class="extracted-pill-citation">Source: "${esc(m.sourceLine)}"</div>
          </div>
        `;
      }).join('')}
    </div>
  </section>
  `;
}

/**
 * SAFETY SUMMARY BANNER
 */
function safetyBanner() {
  const assessment = appState.assessmentResults;
  if (!assessment) return '';

  if (assessment.hasCannotBePaired) {
    const primary = assessment.interactionResults.find(r => r.cannotBePaired) || assessment.allergyConflicts[0];
    return `
      <div class="safety-banner danger">
        <div class="safety-banner-icon">⛔</div>
        <div>
          <div class="safety-banner-title">CRITICAL CONTRADICTION DETECTED: CANNOT BE PAIRED</div>
          <div class="safety-banner-desc">
            ${esc(primary?.patientSummary || primary?.reason || 'Severe life-threatening pharmacotherapy clash detected in this prescription.')}
          </div>
        </div>
      </div>
    `;
  }

  if (assessment.hasSevereWarnings) {
    const primary = assessment.interactionResults.find(r => r.severity === 'SEVERE_WARNING');
    return `
      <div class="safety-banner caution">
        <div class="safety-banner-icon">⚠️</div>
        <div>
          <div class="safety-banner-title">HIGH CLINICAL CAUTION: SEVERE INTERACTION FOUND</div>
          <div class="safety-banner-desc">
            ${esc(primary?.patientSummary || 'Potentially hazardous combination requiring close clinical monitoring.')}
          </div>
        </div>
      </div>
    `;
  }

  return `
    <div class="safety-banner safe">
      <div class="safety-banner-icon">✅</div>
      <div>
        <div class="safety-banner-title">COMPATIBLE PRESCRIPTION: NO SEVERE CONTRADICTIONS</div>
        <div class="safety-banner-desc">
          All extracted medications are clinically compatible for co-administration with patient profile and allergies.
        </div>
      </div>
    </div>
  `;
}

/**
 * RECREATED KNOWLEDGE GRAPH MODEL COMPONENT
 */
function recreatedKnowledgeGraphSection() {
  const graph = appState.graph || appState.catalogGraph || { nodes: [], edges: [], width: 1100, height: 700 };
  const nodes = graph.nodes || [];
  const edges = graph.edges || [];
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
  const isDoctor = appState.graphMode === 'doctor';

  // Apply filters if needed
  let visibleEdges = edges;
  if (appState.graphFilter === 'critical') {
    visibleEdges = edges.filter(e => e.type === 'contraindication_fatal' || e.type === 'allergy_contraindication');
  } else if (appState.graphFilter === 'safe') {
    visibleEdges = edges.filter(e => e.type !== 'contraindication_fatal' && e.type !== 'allergy_contraindication');
  }

  // Edge SVG rendering
  const edgeMarkup = visibleEdges.map(e => {
    const s = byId[e.sourceNode || e.source];
    const t = byId[e.targetNode || e.target];
    if (!s || !t) return '';

    const isFatal = e.type === 'contraindication_fatal' || e.severity === 'CONTRAINDICATED';
    const isAllergy = e.type === 'allergy_contraindication' || e.type === 'allergy_link';
    const isCaution = e.type === 'interaction_severe' || e.severity === 'SEVERE_WARNING';
    const isPrescribedTo = e.type === 'prescribed_to';
    const isSafe = e.severity === 'SAFE_COMPATIBLE' || (!isFatal && !isAllergy && !isCaution && !isPrescribedTo);

    const edgeClass = isFatal ? 'danger' : isAllergy ? 'allergy' : isCaution ? 'caution' : isPrescribedTo ? 'prescribed' : 'safe';
    const badgeClass = isFatal ? 'danger' : isCaution ? 'caution' : isPrescribedTo ? 'dosage' : 'safe';
    const midX = (s.x + t.x) / 2;
    const midY = (s.y + t.y) / 2 - (isPrescribedTo ? 4 : 8);

    return `
      <g class="cg-edge-group" data-edge-id="${esc(e.id)}">
        <line class="cg-edge-line ${edgeClass}" x1="${s.x}" y1="${s.y}" x2="${t.x}" y2="${t.y}"></line>
        <line class="cg-edge-hit" x1="${s.x}" y1="${s.y}" x2="${t.x}" y2="${t.y}"></line>
        ${e.label ? `<text class="cg-edge-badge ${badgeClass}" x="${midX}" y="${midY}" text-anchor="middle">${esc(e.label)}</text>` : ''}
      </g>
    `;
  }).join('');

  // Node SVG rendering
  const nodeMarkup = nodes.map(n => {
    const isSelected = appState.graphSelected?.id === n.id;
    const isHazard = n.type === 'danger_hazard' || n.status === 'CANNOT_BE_PAIRED';
    const isCaution = n.status === 'CAUTION';
    const nodeStatusClass = isHazard ? 'status-danger' : isCaution ? 'status-caution' : '';
    const radius = n.r || 46;

    return `
      <g class="cg-node ${nodeStatusClass} ${isSelected ? 'selected' : ''}"
         data-node-id="${esc(n.id)}"
         transform="translate(${n.x}, ${n.y})"
         tabindex="0"
         role="button">
        <circle r="${radius}" fill="${esc(n.color || '#08796f')}"></circle>
        <text class="cg-icon" y="-12">${esc(n.icon || '💊')}</text>
        <text class="cg-title" y="8">${esc(n.label || '')}</text>
        <text class="cg-sub" y="24">${esc(n.subtitle || n.type || '')}</text>
      </g>
    `;
  }).join('');

  // Node & Edge detail drawer
  const selected = appState.graphSelected;
  let detailDrawer = '';

  if (selected) {
    if (selected.type === 'node') {
      const nodeObj = nodes.find(n => n.id === selected.id);
      if (nodeObj) {
        const drug = nodeObj.drugData;
        const conflict = nodeObj.conflictData;

        detailDrawer = `
          <div class="side-card ${nodeObj.status === 'CANNOT_BE_PAIRED' ? 'danger' : 'safe'}">
            <div class="side-card-title">
              <span>${esc(nodeObj.icon || '💊')} ${esc(nodeObj.label)}</span>
              <span class="side-card-badge ${nodeObj.status === 'CANNOT_BE_PAIRED' ? 'danger' : 'safe'}">
                ${esc(nodeObj.status || nodeObj.type)}
              </span>
            </div>
            <p style="margin-bottom:12px">${esc(nodeObj.subtitle || '')}</p>

            ${drug ? `
              <div class="patient-info">
                <div class="info-box"><div class="info-label">Active Ingredient</div><div class="info-value">${esc(drug.genericName)}</div></div>
                <div class="info-box"><div class="info-label">Prescribed Dose</div><div class="info-value">${esc(drug.dosage)}</div></div>
                <div class="info-box"><div class="info-label">Pharmacologic Class</div><div class="info-value">${esc(drug.drugClass)}</div></div>
                <div class="info-box"><div class="info-label">Indication</div><div class="info-value">${esc(drug.primaryIndication || 'Therapeutic Indication')}</div></div>
              </div>
            ` : ''}

            ${conflict ? `
              <div class="notice alert" style="margin-top:14px">
                <strong>⛔ CRITICAL COMBINATION WARNING:</strong>
                <div>${esc(isDoctor ? conflict.doctorPharmacology : conflict.patientSummary)}</div>
              </div>
              <div style="margin-top:10px">
                <strong>Recommended Clinical Action:</strong>
                <p style="margin-top:4px">${esc(isDoctor ? conflict.clinicalAlternative : conflict.patientAction)}</p>
              </div>
            ` : ''}
          </div>
        `;
      }
    } else if (selected.type === 'edge') {
      const edgeObj = edges.find(e => e.id === selected.id);
      const conflict = edgeObj?.conflictData;
      const allergy = edgeObj?.allergyData;

      if (conflict) {
        detailDrawer = `
          <div class="side-card danger">
            <div class="side-card-title">
              <span>⚡ ${esc(conflict.title)}</span>
              <span class="side-card-badge danger">${esc(conflict.severity)}</span>
            </div>
            <div style="margin-bottom:12px;font-weight:700;color:var(--red)">
              ${conflict.cannotBePaired ? 'CANNOT BE PAIRED TOGETHER' : 'HIGH CAUTION INTERACTION'}
            </div>

            <div class="tabs" style="margin-bottom:14px">
              <button class="${!isDoctor ? 'active' : ''}" data-action="toggle-graph-mode" data-mode="patient">Patient Plain Explanation</button>
              <button class="${isDoctor ? 'active' : ''}" data-action="toggle-graph-mode" data-mode="doctor">Doctor Pharmacology</button>
            </div>

            <p style="font-size:13px;line-height:1.6">
              ${isDoctor ? esc(conflict.doctorPharmacology) : esc(conflict.patientSummary)}
            </p>

            <div class="notice warning" style="margin-top:12px">
              <strong>${isDoctor ? 'Therapeutic Alternative & Guidance:' : 'What You Should Do:'}</strong>
              <div style="margin-top:4px">${esc(isDoctor ? conflict.clinicalAlternative : conflict.patientAction)}</div>
            </div>

            ${isDoctor ? `
              <div style="margin-top:12px;font-size:11px;color:var(--muted)">
                Guideline Source: ${esc(conflict.guidelineCitation || 'FDA Boxed Warning')}
              </div>
            ` : ''}
          </div>
        `;
      } else if (allergy) {
        detailDrawer = `
          <div class="side-card danger">
            <div class="side-card-title">
              <span>❌ Patient Allergy Contradiction</span>
              <span class="side-card-badge danger">Strict Allergy Clash</span>
            </div>
            <div style="margin-bottom:12px;font-weight:700;color:var(--red)">
              ${esc(allergy.allergyName)} ⇎ ${esc(allergy.drugName)}
            </div>
            <p style="font-size:13px;line-height:1.6">
              ${isDoctor ? esc(allergy.doctorPharmacology) : esc(allergy.patientSummary)}
            </p>
            <div class="notice alert" style="margin-top:12px">
              <strong>Action:</strong> ${esc(isDoctor ? allergy.clinicalAlternative : allergy.patientAction)}
            </div>
          </div>
        `;
      }
    }
  }

  return `
  <section class="card" style="margin-bottom:18px">
    <div class="section-head">
      <div>
        <div class="eyebrow">Interactive Pharmacotherapy Network</div>
        <h2>Recreated Contraindication Knowledge Graph Studio</h2>
        <p class="small-muted">
          Clear visual model designed for both patients and clinicians. Node positions are dynamically solved via spring repulsion.
        </p>
      </div>

      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <div class="graph-view-switch">
          <button class="${!isDoctor ? 'active' : ''}" data-action="toggle-graph-mode" data-mode="patient">
            👤 Patient Mode (Plain Language)
          </button>
          <button class="${isDoctor ? 'active' : ''}" data-action="toggle-graph-mode" data-mode="doctor">
            ⚕️ Doctor Mode (Clinical Pharmacology)
          </button>
        </div>

        <button class="btn secondary small" data-action="print-report">
          📄 Print Safety Report
        </button>
      </div>
    </div>

    <div class="grid two-col" style="grid-template-columns:minmax(0,1.35fr) minmax(300px,.65fr);align-items:start">
      <div class="recreated-graph-container">
        <div class="graph-toolbar">
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            <span class="small-muted">Filter:</span>
            <button class="btn ghost small ${appState.graphFilter === 'all' ? 'active' : ''}" data-action="filter-graph" data-filter="all">All</button>
            <button class="btn ghost small ${appState.graphFilter === 'critical' ? 'active' : ''}" data-action="filter-graph" data-filter="critical">⛔ Cannot Be Paired</button>
            <button class="btn ghost small ${appState.graphFilter === 'safe' ? 'active' : ''}" data-action="filter-graph" data-filter="safe">✓ Safe</button>
          </div>

          <!-- Quick Splitted Patient Case Switchers -->
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            <span class="small-muted">Patient Case:</span>
            <button class="btn secondary small ${appState.patient.id === 'DEMO-PT-4092' ? 'active' : ''}" data-action="switch-graph-patient" data-patient-id="DEMO-PT-4092" style="font-size:11px;padding:4px 9px">
              👤 Eleanor Vance (DEMO-PT-4092)
            </button>
            <button class="btn secondary small ${appState.patient.id === 'DEMO-PT-3810' ? 'active' : ''}" data-action="switch-graph-patient" data-patient-id="DEMO-PT-3810" style="font-size:11px;padding:4px 9px">
              👤 Marcus Henderson (DEMO-PT-3810)
            </button>
          </div>

          <div style="display:flex;gap:4px">
            <button class="btn secondary small" data-graph-action="zoom-out" aria-label="Zoom out">−</button>
            <button class="btn secondary small" data-graph-action="reset" aria-label="Reset zoom">Reset</button>
            <button class="btn secondary small" data-graph-action="zoom-in" aria-label="Zoom in">＋</button>
          </div>
        </div>

        <svg id="recreated-graph-svg" class="graph-svg-canvas" viewBox="0 0 ${graph.width || 1100} ${graph.height || 700}">
          <g id="recreated-graph-g" transform="translate(${appState.graphPan.x}, ${appState.graphPan.y}) scale(${appState.graphZoom})">
            ${edgeMarkup}
            ${nodeMarkup}
          </g>
        </svg>

        <div style="padding:12px 18px;background:#fff;border-top:1px solid var(--line);display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--muted)">
          <span><strong style="color:#dc2626">● Red Line:</strong> Cannot Be Paired (Fatal / Severe Risk)</span>
          <span><strong style="color:#ea580c">● Amber Line:</strong> High Caution / Monitor</span>
          <span><strong style="color:#059669">● Green Line:</strong> Safe Combination</span>
          <span><strong style="color:#b91c1c">● Dashed Red:</strong> Patient Allergy Conflict</span>
          <span><strong style="color:#08796f">● Teal Node:</strong> Patient</span>
        </div>
      </div>

      <div class="graph-side-panel">
        ${detailDrawer || `
          <div class="side-card">
            <div class="side-card-title">
              <span>🔍 Graph Entity Inspector</span>
            </div>
            <p class="small-muted">
              Click any medication node, hazard symbol, or connection line to inspect the safety explanation, clinical mechanism, and recommended alternatives.
            </p>
            <div class="notice" style="margin-top:12px">
              <strong>Interactive Tip:</strong> You can drag any node in the graph with your mouse or finger to adjust layout placement.
            </div>
          </div>
        `}

        <div class="card">
          <div class="section-head" style="margin-bottom:8px">
            <h3>Knowledge Graph Metrics</h3>
            <span class="pill">NetworkX v3.6</span>
          </div>
          <div class="stat-line"><span>Extracted Medicines</span><strong>${nodes.filter(n => n.type === 'medicine').length}</strong></div>
          <div class="stat-line"><span>Contradiction Edges</span><strong style="color:var(--red)">${edges.filter(e => e.type === 'contraindication_fatal' || e.severity === 'CONTRAINDICATED').length}</strong></div>
          <div class="stat-line"><span>Allergy Cross-Reactions</span><strong style="color:var(--red)">${edges.filter(e => e.type === 'allergy_contraindication').length}</strong></div>
          <div class="stat-line"><span>Safe Compatible Edges</span><strong style="color:var(--green)">${edges.filter(e => e.severity === 'SAFE_COMPATIBLE' || e.type === 'safe_pair').length}</strong></div>
        </div>
      </div>
    </div>
  </section>
  `;
}

/**
 * PATIENT SUMMARY
 */
function patientSummary(p) {
  p = p || appState.patient;
  return `
  <section class="card">
    <div class="section-head">
      <div>
        <div class="eyebrow">Active Patient Profile</div>
        <h2>${esc(p.name)} <span class="pill">${esc(p.id)}</span></h2>
      </div>
      <button class="btn secondary small" data-page="profile">Edit Profile & Allergies</button>
    </div>
    <div class="patient-info">
      ${[
        ['Age', (p.age || '—') + (p.age ? ' years' : '')],
        ['Sex', p.gender || '—'],
        ['Blood Pressure', p.bp || '—'],
        ['Active Conditions', p.conditions || 'None specified'],
        ['Reported Allergies', p.allergies || 'None reported'],
        ['Active Regimen', (p.medications || []).join(', ') || 'None recorded']
      ].map(([l, v]) => `
        <div class="info-box">
          <div class="info-label">${l}</div>
          <div class="info-value">${esc(v)}</div>
        </div>
      `).join('')}
    </div>
  </section>
  `;
}

/**
 * DOCTOR PATIENT ACCESS GATE (Strictly User ID or QR Code Authentication)
 */
function doctorPatientLookupPanel() {
  const res = appState.lookupResult;
  const loading = appState.lookupLoading;
  const err = appState.lookupError;

  return `
  <section class="card" style="margin-bottom:18px;border:1.5px solid #0d9488">
    <div class="section-head">
      <div>
        <div class="eyebrow" style="color:#0d9488">Patient Confidentiality & Access Control Gate</div>
        <h2>🔒 Patient Record Access Gate (User ID or QR Code)</h2>
        <p class="small-muted">Clinicians can only access patient medical data by providing the registered <strong>Patient User ID</strong> or by scanning their official <strong>QR Code Pass</strong>.</p>
      </div>
      <span class="pill" style="background:${res ? '#ccfbf1' : '#f1f5f9'};color:${res ? '#0f766e' : '#475569'};border-color:${res ? '#5eead4' : '#cbd5e1'}">
        ${res ? '✓ Patient Access Authorized' : '🔒 Patient Data Locked'}
      </span>
    </div>

    ${!res ? `
      <div style="background:#f8fafc;border:2px dashed #0d9488;border-radius:14px;padding:22px 20px;margin-bottom:14px">
        <div style="text-align:center;margin-bottom:18px">
          <div style="width:50px;height:50px;border-radius:50%;background:#ccfbf1;color:#0f766e;display:grid;place-items:center;font-size:24px;margin:0 auto 10px">
            🔒
          </div>
          <h3 style="font-size:16px;margin:0 0 6px;color:#0f172a">Provide Patient User ID or Scan QR Code to Access</h3>
          <p class="small-muted" style="max-width:580px;margin:0 auto;font-size:13px">
            Patient privacy is strictly enforced. The doctor must authenticate with either the patient's <strong>User ID</strong> or their <strong>QR Code</strong> to unlock health history, active medications, and prescriptions.
          </p>
        </div>

        <div class="grid two-col" style="gap:16px;align-items:stretch">
          <!-- Option A: User ID Access -->
          <div style="background:#fff;border:1.5px solid var(--line);border-radius:12px;padding:18px;display:flex;flex-direction:column;justify-content:space-between">
            <div>
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
                <span style="font-size:18px">🆔</span>
                <strong style="font-size:14px">Access Method 1: Patient User ID</strong>
              </div>
              <p class="small-muted" style="font-size:12px;margin-bottom:12px">
                Enter the patient's unique registered User ID (e.g. <code>DEMO-PT-4092</code> or <code>DEMO-PT-3810</code>).
              </p>
              <input id="patient-user-id-input" class="input" style="font-family:monospace;font-size:14px;margin-bottom:10px"
                placeholder="Enter Patient User ID (e.g. DEMO-PT-4092)"
                value="${esc(appState.lookupPatientId)}"
              >
            </div>
            <button class="btn" data-action="access-by-user-id" ${loading ? 'disabled' : ''} style="width:100%;background:#08796f">
              ${loading ? '⏳ Verifying...' : '🔍 Verify & Access via User ID →'}
            </button>
          </div>

          <!-- Option B: QR Code Access -->
          <div style="background:#fff;border:1.5px solid var(--line);border-radius:12px;padding:18px;display:flex;flex-direction:column;justify-content:space-between">
            <div>
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
                <span style="font-size:18px">📷</span>
                <strong style="font-size:14px">Access Method 2: Patient QR Code</strong>
              </div>
              <p class="small-muted" style="font-size:12px;margin-bottom:12px">
                Scan or upload the patient's digital or physical QR Health Pass.
              </p>
              <div style="margin-bottom:10px">
                <button class="btn secondary" data-action="lookup-qr-select" style="width:100%">
                  📁 Upload / Scan QR Code Image
                </button>
                <input id="qr-file-input" type="file" accept="image/*" style="display:none">
              </div>
            </div>
            <div>
              <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:6px">
                Simulate Patient Presenting QR Pass:
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap">
                ${appState.patients.map(p => `
                  <button class="btn secondary small" data-action="scan-patient-qr" data-patient-id="${esc(p.id)}" style="background:#f0fdfa;border:1px solid #5eead4;color:#0f766e;padding:5px 9px;font-size:11px">
                    📷 ${esc(p.name)} (${esc(p.id)})
                  </button>
                `).join('')}
              </div>
            </div>
          </div>
        </div>
      </div>
    ` : `
      <!-- Authorized Dossier Banner -->
      <div style="background:#ecfdf5;border:1.5px solid #059669;border-radius:12px;padding:14px 18px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div style="display:flex;align-items:center;gap:12px">
          <span style="font-size:26px">🛡️</span>
          <div>
            <div style="font-weight:800;color:#065f46;font-size:14px">PATIENT MEDICAL RECORD ACCESS AUTHORIZED</div>
            <div style="font-size:12px;color:#047857">
              Active Patient: <strong>${esc(res.name)} (${esc(res.id)})</strong> • Access Mode: <code>Verified ${esc(res.authMethod || 'User ID / QR')}</code> • Audit Log Recorded
            </div>
          </div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn secondary small" data-action="lock-patient-access" style="background:#fee2e2;color:#991b1b;border:1px solid #fca5a5">
            🔒 Lock & Close Patient Record
          </button>
          <button class="btn secondary small" data-action="lookup-qr-select">
            📷 Scan Another Patient's QR
          </button>
          <input id="qr-file-input" type="file" accept="image/*" style="display:none">
        </div>
      </div>
    `}

    ${err ? `<div class="notice alert" style="margin-bottom:14px">❌ ${esc(err)}</div>` : ''}

    ${res ? `
      <div style="border-top:2px solid var(--teal);padding-top:16px;margin-top:6px">
        <div class="section-head" style="margin-bottom:14px">
          <div style="display:flex;align-items:center;gap:12px">
            ${appState.qrDataUrl || res.qrDataUrl ? `
              <img src="${res.qrDataUrl || appState.qrDataUrl}" alt="QR" style="width:72px;height:72px;border:2px solid var(--teal);border-radius:8px">
            ` : ''}
            <div>
              <div class="eyebrow" style="color:var(--teal)">Verified Database Record</div>
              <h3 style="margin:0">${esc(res.name)} <span class="pill">${esc(res.id)}</span></h3>
              <p class="small-muted" style="margin:2px 0 0">Unique ID: <code>${esc(res.id)}</code> • Linked Prescriptions & Safety History</p>
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn secondary small" data-action="switch-patient" data-patient-id="${esc(res.id)}">
              ✓ Set as Active Clinical Patient
            </button>
            <button class="btn small" data-action="view-patient-graph" data-patient-id="${esc(res.id)}">
              🕸️ View Patient Safety Graph
            </button>
          </div>
        </div>

        <!-- Demographics & Clinical Information -->
        <div class="patient-info" style="margin-bottom:16px">
          ${[
            ['Patient ID', res.id],
            ['Age / Sex', `${res.age || '—'} / ${res.gender || '—'}`],
            ['Blood Pressure', res.bp || '—'],
            ['Active Conditions', res.conditions || 'None recorded'],
            ['Reported Drug Allergies', res.allergies || 'None reported'],
            ['Active Regimen / Medications', (res.medications || []).join(', ') || 'None recorded']
          ].map(([l, v]) => `
            <div class="info-box">
              <div class="info-label">${l}</div>
              <div class="info-value">${esc(v)}</div>
            </div>
          `).join('')}
        </div>

        <!-- Patient Statistics -->
        ${res.stats ? `
          <div class="grid metrics" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:16px">
            <article class="metric"><div class="metric-label">Assessments</div><div class="metric-value">${res.stats.totalAssessments}</div></article>
            <article class="metric"><div class="metric-label">Uploads</div><div class="metric-value">${res.stats.totalUploads}</div></article>
            <article class="metric"><div class="metric-label">Critical Warnings</div><div class="metric-value" style="color:#dc2626">${res.stats.criticalContraindications}</div></article>
            <article class="metric"><div class="metric-label">Pending Reviews</div><div class="metric-value" style="color:#ea580c">${res.stats.pendingReviews}</div></article>
            <article class="metric"><div class="metric-label">Active Medicines</div><div class="metric-value" style="color:#08796f">${res.stats.activeMedications}</div></article>
          </div>
        ` : ''}

        <!-- Uploaded Prescription Documents in DB -->
        <div style="margin-bottom:16px">
          <div class="section-head" style="margin-bottom:8px">
            <h4 style="margin:0">📄 Stored Prescription Files (${(res.uploads || []).length})</h4>
          </div>
          ${(res.uploads || []).length ? `
            <div style="display:flex;flex-wrap:wrap;gap:10px">
              ${res.uploads.map(u => `
                <div style="background:#f0fdfa;border:1px solid #99f6e4;border-radius:8px;padding:10px 14px;min-width:220px;flex:1">
                  <div style="font-weight:700;color:var(--teal)">📄 ${esc(u.originalName || u.name || u.id)}</div>
                  <div class="small-muted" style="margin-top:2px;font-size:12px">${esc(u.processingStatus || 'Stored')}</div>
                  <div class="small-muted" style="font-size:11px">${new Date(u.createdAt || Date.now()).toLocaleString()}</div>
                  ${(u.extractedMeds || []).length ? `
                    <div style="margin-top:4px">
                      ${u.extractedMeds.map(m => `<span class="tag low" style="font-size:11px;margin:1px">${esc(m.name || m)}</span>`).join('')}
                    </div>
                  ` : ''}
                  ${u.assessmentId ? `
                    <button class="btn secondary small" style="margin-top:8px;padding:3px 8px;font-size:11px" data-action="open-result" data-assessment-id="${esc(u.assessmentId)}">
                      View Clinical Assessment →
                    </button>
                  ` : ''}
                </div>
              `).join('')}
            </div>
          ` : '<div class="empty" style="padding:16px;text-align:center">No uploaded prescription files stored for this patient yet.</div>'}
        </div>

        <!-- Clinical Assessments & Contraindication History -->
        <div>
          <div class="section-head" style="margin-bottom:8px">
            <h4 style="margin:0">🛡️ Clinical Contraindication & Interaction History (${(res.assessments || []).length})</h4>
          </div>
          ${(res.assessments || []).length ? `
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Assessment ID</th>
                    <th>Prescribed Medicines</th>
                    <th>Safety Status</th>
                    <th>Review Priority</th>
                    <th>Timestamp</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  ${res.assessments.map(a => `
                    <tr>
                      <td><code style="font-size:11px">${esc(a.id)}</code></td>
                      <td>${esc((a.medicines || []).join(', ') || 'None')}</td>
                      <td><span class="tag ${a.status?.includes('Critical') || a.status?.includes('cannot') ? 'high' : a.status?.includes('safe') || a.status === 'Assessment safe' ? 'low' : 'moderate'}">${esc(a.status || '')}</span></td>
                      <td><span class="tag ${a.priority?.includes('Highest') ? 'priority' : 'standard'}">${esc(a.priority || '')}</span></td>
                      <td style="font-size:11px">${esc(new Date(a.createdAt || Date.now()).toLocaleString())}</td>
                      <td>
                        <button class="btn secondary small" data-action="open-result" data-assessment-id="${esc(a.id)}">
                          View Graph
                        </button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          ` : '<div class="empty" style="padding:16px;text-align:center">No clinical assessments evaluated yet for this patient.</div>'}
        </div>
      </div>
    ` : ''}
  </section>
  `;
}


/**
 * PATIENT DASHBOARD
 */
function patientDashboard() {
  const uploads = appState.uploads || [];
  const qr = appState.qrDataUrl;
  return `
  <main class="page">
    ${pageHead(
      'Patient Decision Support Portal',
      `Welcome, ${esc(appState.patient.name.split(' ')[0])}`,
      'Upload your prescription PDF to scan for drug contradictions, see your personalized safety graph, and protect against allergy clashes.',
      '<button class="btn" data-page="assessment">📄 Upload Prescription PDF</button>'
    )}

    ${safetyBanner()}
    ${extractedMedicinesCard()}
    ${appState.graph ? recreatedKnowledgeGraphSection() : ''}

    <div class="grid two-col" style="margin-bottom:18px">
      ${prescriptionUploadSection('Upload Your Prescription PDF')}
      <div>
        ${patientSummary()}
        ${qr ? `
          <section class="card" style="margin-top:16px;text-align:center">
            <div class="eyebrow">Your Patient Identity QR Code</div>
            <h3 style="margin-bottom:12px">Scan to Share with Doctor</h3>
            <img src="${qr}" alt="Patient QR Code" style="width:160px;height:160px;border:3px solid var(--teal);border-radius:12px;margin:0 auto 10px">
            <div class="small-muted">Patient ID: <strong>${esc(appState.patient.id)}</strong></div>
            <div class="small-muted" style="font-size:11px">Show this QR code to your doctor so they can instantly pull up your full medical record and prescription history.</div>
          </section>
        ` : ''}
      </div>
    </div>

    ${uploads.length ? `
      <section class="card" style="margin-bottom:18px">
        <div class="section-head">
          <div>
            <h2>Your Uploaded Prescriptions</h2>
            <p class="small-muted">All files you have uploaded — saved to your patient record in the database</p>
          </div>
          <span class="pill">${uploads.length} file(s)</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:10px">
          ${uploads.map(u => `
            <div style="background:#f0fdfa;border:1px solid #99f6e4;border-radius:10px;padding:12px 16px;min-width:220px;max-width:300px">
              <div style="font-weight:700;color:var(--teal)">📄 ${esc(u.name||u.originalName||u.id)}</div>
              <div class="small-muted" style="margin-top:4px">${esc(u.processingStatus||'')}</div>
              <div class="small-muted" style="font-size:11px">${new Date(u.createdAt||Date.now()).toLocaleString()}</div>
              ${(u.extractedMeds||[]).length ? `<div style="margin-top:6px">${(u.extractedMeds||[]).slice(0,4).map(m=>`<span class="tag low" style="font-size:11px;margin:1px">${esc(m.name||m)}</span>`).join('')}</div>` : ''}
              ${u.assessmentId ? `<button class="btn secondary small" style="margin-top:8px" data-action="open-result" data-assessment-id="${esc(u.assessmentId)}">View Graph →</button>` : ''}
            </div>
          `).join('')}
        </div>
      </section>
    ` : ''}

    <section class="card" style="margin-bottom:18px">
      <div class="section-head">
        <div>
          <h2>Your Recent Prescription Checks</h2>
          <p class="small-muted">Saved records with verified contraindication analysis</p>
        </div>
        <button class="btn secondary small" data-page="history">View History →</button>
      </div>
      ${tableHistory(appState.history.slice(0, 4))}
    </section>
  </main>
  `;
}

/**
 * DOCTOR DASHBOARD
 */
function doctorDashboard() {
  const highPriorityCount = appState.history.filter(a => a.priority === 'Highest priority').length;
  const pendingCount = appState.history.filter(a => a.status === 'Pending review').length;

  return `
  <main class="page">
    ${pageHead(
      'Clinical Pharmacotherapy Decision Support',
      `Welcome, ${esc(appState.doctor.name)}`,
      'Review clinical prescription alerts, evaluate severe drug-drug combinations, and visualize interaction topology.',
      '<button class="btn" data-page="assessment">📄 New Prescription Upload</button>'
    )}

    ${safetyBanner()}
    ${extractedMedicinesCard()}
    ${appState.graph ? recreatedKnowledgeGraphSection() : ''}

    <div class="grid metrics">
      ${metric('Total Assessments', appState.history.length, 'Clinical history')}
      ${metric('Highest Priority Reviews', highPriorityCount, 'Cannot be paired', '#dc2626')}
      ${metric('Pending Review', pendingCount, 'Awaiting physician sign-off', '#ea580c')}
      ${metric('Database', 'SQLite 3 Connected', 'data/mediguard.sqlite', '#0284c7')}
      ${metric('Graph Engine', 'NetworkX', 'v3.6.1 topology', '#08796f')}
      ${metric('Patients Registered', appState.patients.length, 'In local database', '#059669')}
    </div>

    ${doctorPatientLookupPanel()}

    ${appState.lookupResult ? `
      <div class="grid two-col" style="margin-bottom:18px">
        ${prescriptionUploadSection(`Doctor Prescription Intake for ${esc(appState.lookupResult.name)}`)}
        <div>
          ${patientSummary(appState.lookupResult)}
        </div>
      </div>
    ` : `
      <div class="notice" style="margin-bottom:18px;text-align:center;padding:16px;background:#f8fafc;border:1px solid var(--line)">
        🔒 <strong>Patient clinical data is locked.</strong> The doctor can only view patient medications, profile, and upload prescriptions after providing the patient's <strong>User ID</strong> or scanning their <strong>QR Code</strong> above.
      </div>
    ` }

    <section class="card" style="margin-bottom:18px">
      <div class="section-head">
        <div>
          <h2>Priority Review Queue <span class="tag high">Urgent Action</span></h2>
          <p class="small-muted">Severe combinations that cannot be paired without clinician override</p>
        </div>
        <button class="btn secondary small" data-page="queue">Open Full Queue →</button>
      </div>
      ${queueTable()}
    </section>
  </main>
  `;
}

/**
 * ASSESSMENT / PRESCRIPTION CHECK PAGE
 */
function assessmentPage() {
  return `
  <main class="page">
    ${pageHead(
      'Prescription Intake & Contradiction Evaluation',
      appState.role === 'doctor' ? 'Clinical Prescription Scan' : 'Check Your Prescription',
      'Upload a doctor prescription PDF to automatically extract medicine names, dosages, and verify against severe contraindications and allergies.'
    )}

    ${safetyBanner()}
    ${prescriptionUploadSection('Upload Prescription PDF for Drug Extraction')}
    ${extractedMedicinesCard()}
    ${appState.graph ? recreatedKnowledgeGraphSection() : ''}
  </main>
  `;
}

/**
 * GRAPH PAGE
 */
function graphPage() {
  return `
  <main class="page">
    ${pageHead(
      'Topological Pharmacotherapy Knowledge Graph',
      'Medication Contradiction & Safety Graph Studio',
      'Interactive force-directed graph displaying prescription medicines, severe combinations that cannot be paired, and allergy paths.'
    )}

    ${safetyBanner()}
    ${recreatedKnowledgeGraphSection()}
    ${extractedMedicinesCard()}
    ${prescriptionUploadSection('Upload a Different Prescription PDF to Visualize')}
  </main>
  `;
}

/**
 * QUEUE & HISTORY TABLES
 */
function queueTable() {
  const items = appState.history.filter(a => a.status.includes('review') || a.priority.includes('Highest'));
  if (!items.length) return `<div class="empty">There are no pending contradiction reviews.</div>`;

  return `
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Patient ID</th>
          <th>Prescription / Medicines</th>
          <th>Severity</th>
          <th>Priority</th>
          <th>Contradiction Reason</th>
          <th>Status</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        ${items.map(x => `
          <tr>
            <td><strong>${esc(x.id)}</strong><div class="small-muted">${esc(x.name)}</div></td>
            <td><strong>${esc(x.meds)}</strong></td>
            <td><span class="tag high">High / Severe</span></td>
            <td><span class="tag priority">Highest priority</span></td>
            <td>${esc(x.interactions)}</td>
            <td><span class="tag pending">${esc(x.status)}</span></td>
            <td>
              <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
                <button class="btn small" data-action="open-result" data-assessment-id="${esc(x.assessmentId)}">
                  Inspect Graph
                </button>
                <button class="btn secondary small" data-action="toggle-review" data-assessment-id="${esc(x.assessmentId)}">
                  ${x.status === 'Reviewed' ? '✓ Reviewed' : 'Review'}
                </button>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>
  `;
}

function tableHistory(rows = appState.history) {
  if (!rows.length) return `<div class="empty">No prescription assessments found.</div>`;

  return `
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Patient ID</th>
          <th>Patient</th>
          <th>Prescription Medicines</th>
          <th>Contraindications</th>
          <th>Priority</th>
          <th>Status</th>
          <th>Timestamp</th>
          <th>Inspect</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td><strong>${esc(r.id)}</strong></td>
            <td>${esc(r.name)}</td>
            <td>${esc(r.meds)}</td>
            <td>${esc(r.interactions)}</td>
            <td><span class="tag ${r.priority.includes('Highest') ? 'priority' : 'standard'}">${esc(r.priority)}</span></td>
            <td><span class="tag ${r.status.includes('Pending') || r.status.includes('review') ? 'pending' : 'done'}">${esc(r.status)}</span></td>
            <td>${esc(r.when)}</td>
            <td>
              <button class="btn secondary small" data-action="open-result" data-assessment-id="${esc(r.assessmentId)}">
                View Graph
              </button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>
  `;
}

function historyPage() {
  return `
  <main class="page">
    ${pageHead(
      appState.role === 'doctor' ? 'Clinical Assessment Log' : 'Personal Prescription Log',
      'Assessment & Prescription History',
      'Browse all stored prescription assessments, extracted medicines, and safety findings.'
    )}
    <section class="card">
      <div class="section-head">
        <h2>Saved Clinical Records</h2>
      </div>
      ${tableHistory(appState.history)}
    </section>
  </main>
  `;
}

function queuePage() {
  return `
  <main class="page">
    ${pageHead(
      'Doctor Workspace',
      'Priority Contraindication Review Queue',
      'Review and sign off on severe combinations, patient allergy alerts, and clinical override justifications.'
    )}
    <section class="card">
      ${queueTable()}
    </section>
  </main>
  `;
}

function medicineCatalogPage() {
  const rows = appState.catalog || [];
  return `
  <main class="page">
    ${pageHead('Formulary Directory', '34-Entry Medicine Catalog', 'Brand aliases, generic names, and cited DailyMed adverse reactions.')}
    <section class="card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Brand Name</th>
              <th>Generic Ingredient</th>
              <th>Dosage Form</th>
              <th>Documented Adverse Reactions</th>
              <th>Label Reference</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td><strong>${esc(r.brand_example)}</strong></td>
                <td>${esc(r.generic_name)}</td>
                <td>${esc(r.form_example)}</td>
                <td>${(r.label_effects || '').split('|').filter(Boolean).map(e => `<span class="tag low" style="margin:2px">${esc(e)}</span>`).join(' ') || '<span class="small-muted">DailyMed monograph</span>'}</td>
                <td><a href="${esc(r.label_source_url || 'https://dailymed.nlm.nih.gov')}" target="_blank" rel="noreferrer">DailyMed ↗</a></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
  </main>
  `;
}

function profilePage() {
  const isDoctor = appState.role === 'doctor';
  const p = isDoctor ? appState.doctor : appState.patient;

  return `
  <main class="page">
    ${pageHead(
      isDoctor ? 'Physician Profile' : 'Patient Health Profile',
      isDoctor ? esc(appState.doctor.name) : esc(appState.patient.name),
      isDoctor ? 'Manage prescribing credentials and specialty.' : 'Manage reported drug allergies and active health conditions.'
    )}
    <section class="card" style="max-width:850px">
      <form id="profile-form">
        <div class="grid two-col">
          <div class="field">
            <label for="p-name">Full Name</label>
            <input class="input" id="p-name" name="name" value="${esc(p.name || '')}" required>
          </div>
          <div class="field">
            <label for="p-id">ID Code</label>
            <input class="input" id="p-id" name="id" value="${esc(p.id || p.doctorId || '')}" readonly>
          </div>
          ${!isDoctor ? `
            <div class="field">
              <label for="p-age">Age</label>
              <input class="input" id="p-age" name="age" value="${esc(p.age || '')}">
            </div>
            <div class="field">
              <label for="p-gender">Sex</label>
              <input class="input" id="p-gender" name="gender" value="${esc(p.gender || '')}">
            </div>
            <div class="field">
              <label for="p-bp">Blood Pressure</label>
              <input class="input" id="p-bp" name="bp" value="${esc(p.bp || '')}">
            </div>
            <div class="field">
              <label for="p-conditions">Conditions</label>
              <input class="input" id="p-conditions" name="conditions" value="${esc(p.conditions || '')}">
            </div>
            <div class="field" style="grid-column:1/-1">
              <label for="p-allergies">Reported Drug Allergies (CRITICAL FOR SAFETY CHECKS)</label>
              <input class="input" id="p-allergies" name="allergies" value="${esc(p.allergies || '')}">
              <span class="small-muted">Example: Penicillin-class medicines, Sulfonamides, NSAIDs</span>
            </div>
          ` : `
            <div class="field" style="grid-column:1/-1">
              <label for="p-specialty">Clinical Specialty</label>
              <input class="input" id="p-specialty" name="specialty" value="${esc(p.specialty || '')}">
            </div>
          `}
        </div>
        <div style="margin-top:16px">
          <button class="btn" type="submit">Save Profile</button>
        </div>
      </form>
    </section>
  </main>
  `;
}

function loginPage() {
  return `
  <main class="auth-layout">
    <section class="auth-welcome">
      <div>
        <div class="logo" style="width:48px;height:48px;margin-bottom:20px">✚</div>
        <div class="eyebrow">Pharmacotherapy Safety Platform</div>
        <h1>CareX Clinical Decision Support</h1>
        <p>Recreated Knowledge Graph Model with instant PDF Prescription Extraction & Contraindication Safety Analysis.</p>
      </div>
      <div class="notice">Demo access: Use pre-filled credentials or custom email/phone. Code: <strong>123456</strong></div>
    </section>

    <section class="card auth-card">
      <h2>Select Portal</h2>
      <!-- Privacy-First Patient QR Code Login -->
      <div style="background:#f0fdfa;border:1.5px solid #99f6e4;border-radius:14px;padding:16px;margin-bottom:16px;text-align:center">
        <div class="eyebrow" style="color:var(--teal);margin-bottom:4px">Privacy-First Patient Authentication</div>
        <h3 style="margin:0 0 6px">📷 Patient Sign In with QR Health Pass</h3>
        <p class="small-muted" style="margin-bottom:12px;font-size:12px">Sign in directly with your personal cryptographic Patient QR Pass without passwords.</p>
        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
          <button class="btn small" data-action="qr-login-patient" data-patient-id="DEMO-PT-4092" style="background:#08796f">
            📷 Eleanor Vance QR Pass
          </button>
          <button class="btn small" data-action="qr-login-patient" data-patient-id="DEMO-PT-3810" style="background:#08796f">
            📷 Marcus Henderson QR Pass
          </button>
          <button class="btn secondary small" data-action="qr-login-upload">
            📁 Upload QR File
          </button>
        </div>
        <input id="qr-login-file-input" type="file" accept="image/*" style="display:none">
      </div>

      <div class="role-grid">
        <button class="role-option ${appState.role === 'patient' ? 'active' : ''}" data-role="patient">
          <strong>👤 Patient Portal</strong>
          <span>Upload prescriptions & view plain safety graph</span>
        </button>
        <button class="role-option ${appState.role === 'doctor' ? 'active' : ''}" data-role="doctor">
          <strong>⚕️ Doctor Portal</strong>
          <span>Clinical decision support & pharmacology view</span>
        </button>
      </div>

      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px">
        <button class="btn" data-action="instant-login-doctor" style="padding:13px;font-size:14px;background:#0d9488">
          ⚡ Instant Sign In: Doctor Portal (Dr. Sarah Lin) →
        </button>
        <button class="btn secondary" data-action="instant-login-patient" style="padding:13px;font-size:14px">
          ⚡ Instant Sign In: Patient Portal (Eleanor Vance) →
        </button>
      </div>

      <div style="text-align:center;color:var(--muted);font-size:12px;margin:12px 0">── or sign in with demo code ──</div>

      ${appState.authStep === 'otp' ? `
        <div class="field">
          <label for="otp">Enter 6-Digit Demo Code</label>
          <input class="input" id="otp" inputmode="numeric" placeholder="123456" value="123456">
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn" data-action="verify-otp" style="flex:1">Sign In →</button>
          <button class="btn secondary" data-action="back-auth">Back</button>
        </div>
      ` : `
        <div class="field">
          <label for="auth-input">Demo Email Address</label>
          <input id="auth-input" class="input" type="email" value="${appState.role === 'doctor' ? 'doctor@mediguard.demo' : 'patient@mediguard.demo'}">
        </div>
        <button class="btn secondary" data-action="send-otp" style="width:100%">Request Demo Code (123456) →</button>
      `}
    </section>
  </main>
  `;
}

function render() {
  const root = $('#app');
  const auth = appState.page === 'login';
  let content = '';

  if (auth) content = loginPage();
  else if (appState.page === 'patient') content = patientDashboard();
  else if (appState.page === 'doctor') content = doctorDashboard();
  else if (appState.page === 'assessment') content = assessmentPage();
  else if (appState.page === 'graph') content = graphPage();
  else if (appState.page === 'history') content = historyPage();
  else if (appState.page === 'queue') content = queuePage();
  else if (appState.page === 'medicines') content = medicineCatalogPage();
  else if (appState.page === 'profile') content = profilePage();

  root.innerHTML = `
    ${auth ? '' : header()}
    ${content}
    <footer class="footer">
      © 2026 CareX • Certified Pharmacotherapy Decision Support Platform • NetworkX Graph Topology v3.6.1
    </footer>
  `;

  attachEventListeners();
}

/**
 * PDF UPLOAD HANDLER
 */
async function handlePdfUpload(file) {
  if (!file) return;
  appState.isExtracting = true;
  appState.extractionStatusText = `Reading PDF streams from ${file.name}...`;
  render();

  try {
    const targetPatientId = appState.role === 'doctor' ? appState.patient.id : appState.session?.patientId;
    const url = `/uploads?name=${encodeURIComponent(file.name)}&patientId=${encodeURIComponent(targetPatientId || '')}`;
    
    appState.extractionStatusText = 'Extracting active pharmaceutical ingredients, dosages, and instructions...';
    render();

    const data = await api(url, {
      method: 'POST',
      body: file,
      headers: { 'content-type': file.type || 'application/pdf' }
    });

    appState.uploaded = data.upload;
    if (data.upload) {
      appState.uploads = [data.upload, ...(appState.uploads || []).filter(u => u.id !== data.upload.id)];
    }
    appState.extractedMeds = data.extractedMeds || [];
    appState.assessmentResults = data.assessmentResults || null;
    appState.graph = data.graph || null;
    if (data.patient) appState.patient = { ...appState.patient, ...data.patient };
    if (data.patients && Array.isArray(data.patients)) appState.patients = data.patients;
    if (data.assessment) {
      const mapped = mapAssessment(data.assessment);
      appState.history = [mapped, ...appState.history.filter(h => h.assessmentId !== mapped.assessmentId)];
      appState.currentAssessment = data.assessment;
    }

    appState.isExtracting = false;
    render();

    if (data.assessmentResults?.hasCannotBePaired) {
      toast('⚠️ CRITICAL CONTRADICTION FOUND: CANNOT BE PAIRED!');
    } else {
      toast(`Successfully extracted ${data.extractedMeds.length} medicines from prescription PDF!`);
    }
  } catch (error) {
    appState.isExtracting = false;
    render();
    toast(`Upload failed: ${error.message}`);
  }
}

/**
 * PROCESS SAMPLE PRESCRIPTION WITH 1-CLICK
 */
async function processSamplePrescription(sampleKey) {
  appState.isExtracting = true;
  appState.extractionStatusText = `Decompressing PDF streams for ${sampleKey}...`;
  render();

  try {
    const targetPatientId = appState.role === 'doctor' ? appState.patient.id : appState.session?.patientId;
    const data = await api('/prescriptions/process-sample', {
      method: 'POST',
      body: JSON.stringify({ sampleKey, patientId: targetPatientId })
    });

    appState.extractedMeds = data.extractedMeds || [];
    appState.assessmentResults = data.assessmentResults || null;
    appState.graph = data.graph || null;
    if (data.patient) appState.patient = { ...appState.patient, ...data.patient };
    if (data.patients && Array.isArray(data.patients)) appState.patients = data.patients;
    if (data.assessment) {
      const mapped = mapAssessment(data.assessment);
      appState.history = [mapped, ...appState.history.filter(h => h.assessmentId !== mapped.assessmentId)];
      appState.currentAssessment = data.assessment;
    }

    appState.isExtracting = false;
    render();

    if (data.assessmentResults?.hasCannotBePaired) {
      toast('⚠️ CRITICAL CONTRADICTION DETECTED: CANNOT BE PAIRED');
    } else {
      toast(`Extracted ${data.extractedMeds.length} medicines and generated knowledge graph!`);
    }
  } catch (error) {
    appState.isExtracting = false;
    render();
    toast(`Processing failed: ${error.message}`);
  }
}

function attachEventListeners() {
  // File input change
  const fileInput = $('#pdf-file-input');
  if (fileInput) {
    fileInput.addEventListener('change', e => {
      const file = e.target.files?.[0];
      if (file) handlePdfUpload(file);
    });
  }

  // Drag and drop for prescription dropzone
  const dropzone = $('#rx-dropzone');
  if (dropzone) {
    ['dragenter', 'dragover'].forEach(eventName => {
      dropzone.addEventListener(eventName, e => {
        e.preventDefault();
        dropzone.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach(eventName => {
      dropzone.addEventListener(eventName, e => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
      });
    });
    dropzone.addEventListener('drop', e => {
      const file = e.dataTransfer?.files?.[0];
      if (file) handlePdfUpload(file);
    });
  }

  // Patient User ID input - Enter key
  const userIdInput = $('#patient-user-id-input');
  if (userIdInput) {
    userIdInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const btn = document.querySelector('[data-action="access-by-user-id"]');
        if (btn) btn.click();
      }
    });
  }

  // QR File input change for clinician QR scan
  const qrFileInput = $('#qr-file-input');
  if (qrFileInput) {
    qrFileInput.addEventListener('change', async e => {
      const file = e.target.files?.[0];
      if (!file) return;
      const fname = file.name;
      const match = fname.match(/(DEMO-PT-\d+|PT-[A-Z0-9]+|HTN-\d+)/i);
      const pid = match ? match[1].toUpperCase() : 'DEMO-PT-4092';
      appState.lookupLoading = true;
      appState.lookupError = '';
      render();
      try {
        const data = await api(`/patients/qr-lookup?id=${encodeURIComponent(pid)}&authMethod=qr`);
        appState.lookupResult = data.patient;
        if (data.qrDataUrl) appState.lookupResult.qrDataUrl = data.qrDataUrl;
        appState.lookupLoading = false;
        render();
        toast(`🔒 QR Consent Verified from uploaded image for ${data.patient.name}!`);
      } catch (err) {
        appState.lookupLoading = false;
        appState.lookupError = err.message;
        render();
      }
    });
  }

  // QR Login File input for patients
  const qrLoginFileInput = $('#qr-login-file-input');
  if (qrLoginFileInput) {
    qrLoginFileInput.addEventListener('change', async e => {
      const file = e.target.files?.[0];
      if (!file) return;
      const fname = file.name;
      const match = fname.match(/(DEMO-PT-\d+|PT-[A-Z0-9]+|HTN-\d+)/i);
      const pid = match ? match[1].toUpperCase() : 'DEMO-PT-4092';
      try {
        const data = await api('/auth/qr-login', {
          method: 'POST',
          body: JSON.stringify({ patientId: pid })
        });
        localStorage.setItem('mediguard-token', data.token);
        await loadSessionData();
        setPage('patient');
        toast(`Signed in via QR Pass as ${data.patient.name}!`);
      } catch (err) {
        toast(`QR Pass authentication failed: ${err.message}`);
      }
    });
  }

  // Interactive Graph drag and zoom
  const graphSvg = $('#recreated-graph-svg');
  if (graphSvg) {
    graphSvg.addEventListener('pointerdown', e => {
      if (e.target.closest('.cg-node, .cg-edge-group')) return;
      graphDrag = {
        x: e.clientX,
        y: e.clientY,
        origin: { ...appState.graphPan },
        pointerId: e.pointerId
      };
      graphSvg.setPointerCapture(e.pointerId);
    });

    graphSvg.addEventListener('pointermove', e => {
      if (!graphDrag) return;
      appState.graphPan = {
        x: graphDrag.origin.x + (e.clientX - graphDrag.x),
        y: graphDrag.origin.y + (e.clientY - graphDrag.y)
      };
      const g = $('#recreated-graph-g');
      if (g) {
        g.setAttribute('transform', `translate(${appState.graphPan.x}, ${appState.graphPan.y}) scale(${appState.graphZoom})`);
      }
    });

    const endDrag = () => { graphDrag = null; };
    graphSvg.addEventListener('pointerup', endDrag);
    graphSvg.addEventListener('pointercancel', endDrag);
  }
}

// Global click event dispatcher
document.addEventListener('click', async e => {
  const page = e.target.closest('[data-page]')?.dataset.page;
  if (page) { setPage(page); return; }

  const role = e.target.closest('[data-role]')?.dataset.role;
  if (role) { appState.role = role; render(); return; }

  const action = e.target.closest('[data-action]')?.dataset.action;
  if (!action) {
    // Check node / edge inspection clicks
    const nodeEl = e.target.closest('[data-node-id]');
    if (nodeEl) {
      const id = nodeEl.dataset.nodeId;
      appState.graphSelected = { type: 'node', id };
      render();
      return;
    }
    const edgeEl = e.target.closest('[data-edge-id]');
    if (edgeEl) {
      const id = edgeEl.dataset.edgeId;
      appState.graphSelected = { type: 'edge', id };
      render();
      return;
    }
    return;
  }

  if (action === 'switch-role') {
    const nextRole = appState.role === 'doctor' ? 'patient' : 'doctor';
    try {
      const email = nextRole === 'doctor' ? 'doctor@mediguard.demo' : 'patient@mediguard.demo';
      appState.role = nextRole;
      const data = await api('/auth/verify-code', {
        method: 'POST',
        body: JSON.stringify({ identifier: email, role: nextRole, code: '123456' })
      });
      localStorage.setItem('mediguard-token', data.token);
      await loadSessionData();
      setPage(nextRole === 'doctor' ? 'doctor' : 'patient');
      toast(`Switched and authenticated into ${nextRole === 'doctor' ? 'Doctor' : 'Patient'} Portal!`);
    } catch {
      appState.role = nextRole;
      setPage(nextRole === 'doctor' ? 'doctor' : 'patient');
      toast(`Switched to ${nextRole === 'doctor' ? 'Doctor' : 'Patient'} Portal`);
    }
  }
  else if (action === 'logout') {
    try { await api('/auth/logout', { method: 'POST' }); } catch {}
    localStorage.removeItem('mediguard-token');
    appState.session = null;
    appState.authStep = 'signin';
    setPage('login');
  }
  else if (action === 'instant-login-doctor' || action === 'instant-login-patient' || action === 'instant-login') {
    try {
      const targetRole = action === 'instant-login-doctor' ? 'doctor' : (action === 'instant-login-patient' ? 'patient' : appState.role);
      appState.role = targetRole;
      const email = targetRole === 'doctor' ? 'doctor@mediguard.demo' : 'patient@mediguard.demo';
      appState.identifier = email;

      await api('/auth/request-code', {
        method: 'POST',
        body: JSON.stringify({ identifier: email, role: targetRole })
      }).catch(() => {});

      const data = await api('/auth/verify-code', {
        method: 'POST',
        body: JSON.stringify({ identifier: email, role: targetRole, code: '123456' })
      });
      localStorage.setItem('mediguard-token', data.token);
      await loadSessionData();
      setPage(targetRole === 'doctor' ? 'doctor' : 'patient');
      toast(`Signed in as ${data.user.name || email}!`);
    } catch (error) {
      toast(`Sign in failed: ${error.message}`);
    }
  }
  else if (action === 'send-otp') {
    const input = $('#auth-input');
    appState.identifier = input?.value.trim() || (appState.role === 'doctor' ? 'doctor@mediguard.demo' : 'patient@mediguard.demo');
    try {
      await api('/auth/request-code', {
        method: 'POST',
        body: JSON.stringify({ identifier: appState.identifier, role: appState.role })
      });
      appState.authStep = 'otp';
      render();
      toast('Demo code is 123456');
    } catch (error) {
      toast(error.message);
    }
  }
  else if (action === 'verify-otp') {
    const code = ($('#otp')?.value || '123456').trim();
    try {
      const data = await api('/auth/verify-code', {
        method: 'POST',
        body: JSON.stringify({ identifier: appState.identifier, role: appState.role, code })
      });
      localStorage.setItem('mediguard-token', data.token);
      await loadSessionData();
      setPage(appState.role === 'doctor' ? 'doctor' : 'patient');
      toast('Signed in successfully!');
    } catch (error) {
      toast(error.message);
    }
  }
  else if (action === 'back-auth') {
    appState.authStep = 'signin';
    render();
  }
  else if (action === 'process-sample') {
    const sampleKey = e.target.closest('[data-sample-key]')?.dataset.sampleKey;
    if (sampleKey) processSamplePrescription(sampleKey);
  }
  else if (action === 'toggle-graph-mode') {
    const mode = e.target.closest('[data-mode]')?.dataset.mode;
    if (mode) {
      appState.graphMode = mode;
      render();
      toast(`Switched to ${mode === 'doctor' ? 'Doctor Clinical' : 'Patient Plain'} mode`);
    }
  }
  else if (action === 'switch-graph-patient') {
    const patientId = e.target.closest('[data-patient-id]')?.dataset.patientId;
    if (patientId) {
      const found = appState.patients.find(p => p.id === patientId);
      if (found) {
        appState.patient = { ...found };
        try {
          const graphData = await api(`/knowledge-graph?patientId=${encodeURIComponent(patientId)}`);
          appState.graph = graphData.graph;
          render();
          toast(`Loaded clear splitted graph for ${found.name}`);
        } catch (err) {
          toast(err.message);
        }
      }
    }
  }
  else if (action === 'filter-graph') {
    const filter = e.target.closest('[data-filter]')?.dataset.filter;
    if (filter) {
      appState.graphFilter = filter;
      render();
    }
  }
  else if (action === 'switch-patient') {
    const patientId = e.target.closest('[data-patient-id]')?.dataset.patientId;
    const found = appState.patients.find(p => p.id === patientId);
    if (found) {
      appState.patient = { ...found };
      render();
      toast(`Active patient switched to ${found.name}`);
    }
  }

  else if (action === 'access-by-user-id') {
    const input = $('#patient-user-id-input');
    const pid = (input?.value || '').trim().toUpperCase();
    if (!pid) { toast('Please enter a Patient User ID (e.g. DEMO-PT-4092).'); return; }
    appState.lookupPatientId = pid;
    appState.lookupLoading = true;
    appState.lookupError = '';
    render();
    try {
      const data = await api(`/patients/qr-lookup?id=${encodeURIComponent(pid)}&authMethod=user_id`);
      appState.lookupResult = { ...data.patient, authMethod: 'User ID' };
      if (data.qrDataUrl) appState.lookupResult.qrDataUrl = data.qrDataUrl;
      appState.patient = { ...data.patient };
      appState.lookupLoading = false;
      render();
      toast(`✓ Patient record accessed via User ID: ${data.patient.name}`);
    } catch (err) {
      appState.lookupLoading = false;
      appState.lookupError = err.message;
      render();
      toast(`Access failed: ${err.message}`);
    }
  }
  else if (action === 'lock-patient-access' || action === 'revoke-qr-access') {
    appState.lookupResult = null;
    appState.lookupPatientId = '';
    render();
    toast('🔒 Patient record closed & locked.');
  }
  else if (action === 'scan-patient-qr') {
    const pid = e.target.closest('[data-patient-id]')?.dataset.patientId;
    if (!pid) return;
    appState.lookupLoading = true;
    appState.lookupError = '';
    render();
    try {
      const data = await api(`/patients/qr-lookup?id=${encodeURIComponent(pid)}&authMethod=qr`);
      appState.lookupResult = { ...data.patient, authMethod: 'QR Code' };
      if (data.qrDataUrl) appState.lookupResult.qrDataUrl = data.qrDataUrl;
      appState.patient = { ...data.patient };
      appState.lookupLoading = false;
      render();
      toast(`🔒 Patient QR Verified: Consent granted for ${data.patient.name}`);
    } catch (err) {
      appState.lookupLoading = false;
      appState.lookupError = err.message;
      render();
      toast(`QR Authorization failed: ${err.message}`);
    }
  }
  else if (action === 'revoke-qr-access') {
    appState.lookupResult = null;
    appState.lookupPatientId = '';
    render();
    toast('🔒 Patient record locked. Session authorization revoked.');
  }
  else if (action === 'qr-login-patient') {
    const pid = e.target.closest('[data-patient-id]')?.dataset.patientId;
    if (!pid) return;
    try {
      const data = await api('/auth/qr-login', {
        method: 'POST',
        body: JSON.stringify({ patientId: pid })
      });
      localStorage.setItem('mediguard-token', data.token);
      await loadSessionData();
      setPage('patient');
      toast(`Signed in via QR Pass as ${data.patient.name}!`);
    } catch (err) {
      toast(`QR Sign-In failed: ${err.message}`);
    }
  }
  else if (action === 'qr-login-upload') {
    const fileIn = $('#qr-login-file-input');
    if (fileIn) fileIn.click();
  }
  else if (action === 'lookup-patient') {
    const input = $('#patient-lookup-input');
    const pid = (input?.value || '').trim().toUpperCase();
    if (!pid) { toast('Enter a Patient ID to look up.'); return; }
    appState.lookupPatientId = pid;
    appState.lookupLoading = true;
    appState.lookupError = '';
    appState.lookupResult = null;
    render();
    try {
      const data = await api(`/patients/qr-lookup?id=${encodeURIComponent(pid)}`);
      appState.lookupResult = data.patient;
      if (data.qrDataUrl) appState.lookupResult.qrDataUrl = data.qrDataUrl;
      appState.lookupLoading = false;
      render();
      toast(`Patient record loaded: ${data.patient.name}`);
    } catch (err) {
      appState.lookupLoading = false;
      appState.lookupError = err.message;
      render();
    }
  }
  else if (action === 'lookup-qr-select') {
    const qrInput = $('#qr-file-input');
    if (qrInput) qrInput.click();
  }
  else if (action === 'view-patient-graph') {
    const patientId = e.target.closest('[data-patient-id]')?.dataset.patientId;
    if (patientId) {
      const found = appState.patients.find(p => p.id === patientId) || appState.lookupResult;
      if (found) {
        appState.patient = { ...found };
        try {
          const graphData = await api(`/knowledge-graph?patientId=${encodeURIComponent(patientId)}`);
          appState.graph = graphData.graph;
        } catch {}
        setPage('graph');
        toast(`Showing safety graph for ${found.name}`);
      }
    }
  }
  else if (action === 'print-report') {
    window.print();
  }
  else if (action === 'open-result') {
    const assessmentId = e.target.closest('[data-assessment-id]')?.dataset.assessmentId;
    if (assessmentId) {
      try {
        const full = await api(`/assessments/${encodeURIComponent(assessmentId)}`);
        const a = full.assessment || appState.history.find(h => h.assessmentId === assessmentId);
        if (a) {
          appState.currentAssessment = a;
          appState.extractedMeds = a.extractedDetails || (a.medicines || []).map(m => ({ name: m, genericName: m, dosage: 'Prescribed Regimen', frequency: 'Clinical Rx' }));
          appState.assessmentResults = {
            hasCannotBePaired: (a.results || []).some(r => r.cannotBePaired),
            hasSevereWarnings: (a.results || []).some(r => r.sourceSeverity === 'High' && !r.cannotBePaired),
            statusLabel: a.analysisStatus || a.status,
            interactionResults: a.results || [],
            allergyConflicts: a.allergyConflicts || []
          };
          if (a.graph) appState.graph = a.graph;
          if (a.patientId) {
            const p = appState.patients.find(pt => pt.id === a.patientId);
            if (p) appState.patient = { ...p };
          }
        }
      } catch (err) {
        console.error(err);
      }
    }
    setPage('graph');
  }
  else if (action === 'toggle-review') {
    const assessmentId = e.target.closest('[data-assessment-id]')?.dataset.assessmentId;
    if (assessmentId) {
      try {
        const current = appState.history.find(h => h.assessmentId === assessmentId);
        const nextStatus = current?.status === 'Reviewed' ? 'Pending review' : 'Reviewed';
        const updated = await api(`/assessments/${encodeURIComponent(assessmentId)}/review`, {
          method: 'PATCH',
          body: JSON.stringify({ reviewStatus: nextStatus })
        });
        const mapped = mapAssessment(updated.assessment);
        const idx = appState.history.findIndex(h => h.assessmentId === assessmentId);
        if (idx !== -1) appState.history[idx] = mapped;
        render();
        toast(`Assessment marked as ${nextStatus}!`);
      } catch (err) {
        toast(`Review update failed: ${err.message}`);
      }
    }
  }

  // Zoom actions
  const graphAction = e.target.closest('[data-graph-action]')?.dataset.graphAction;
  if (graphAction) {
    if (graphAction === 'zoom-in') appState.graphZoom = Math.min(2.2, appState.graphZoom + 0.2);
    else if (graphAction === 'zoom-out') appState.graphZoom = Math.max(0.5, appState.graphZoom - 0.2);
    else { appState.graphZoom = 1; appState.graphPan = { x: 0, y: 0 }; }
    render();
  }
});

// Profile form submission
document.addEventListener('submit', async e => {
  if (e.target.id === 'profile-form') {
    e.preventDefault();
    const formData = Object.fromEntries(new FormData(e.target));
    try {
      if (appState.role === 'doctor') {
        const result = await api('/me', { method: 'PATCH', body: JSON.stringify(formData) });
        appState.doctor = { ...appState.doctor, ...result.user };
      } else {
        const result = await api(`/patients/${encodeURIComponent(appState.patient.id)}`, { method: 'PATCH', body: JSON.stringify(formData) });
        appState.patient = { ...appState.patient, ...result.patient };
      }
      toast('Profile & allergy details updated successfully!');
      render();
    } catch (err) {
      toast(err.message);
    }
  }
});

// Start the application
bootstrap();
