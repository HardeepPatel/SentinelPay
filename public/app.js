document.addEventListener('DOMContentLoaded', () => {
    // ---- SPA ROUTING ----
    const navBtns = document.querySelectorAll('.nav-btn');
    const views = document.querySelectorAll('.view-section');
    function switchView(targetId) {
        views.forEach(v => v.classList.remove('active'));
        navBtns.forEach(b => b.classList.remove('active'));
        document.getElementById(targetId).classList.add('active');
        document.querySelector(`[data-target="${targetId}"]`).classList.add('active');
        if (targetId === 'view-policies') loadPolicies();
        if (targetId === 'view-audit') loadCompliance();
    }
    navBtns.forEach(btn => btn.addEventListener('click', (e) => { e.preventDefault(); switchView(btn.getAttribute('data-target')); }));

    // ---- STATE ----
    let currentFilter = 'ALL';
    let cachedLogs = [];
    const tBodyLive = document.getElementById('audit-table-body');
    const tBodyCompliance = document.getElementById('compliance-table-body');
    const drawer = document.getElementById('risk-drawer');
    const overlay = document.getElementById('drawer-overlay');

    // ---- HELPERS ----
    function getDecisionTag(d) {
        if (d === 'APPROVE') return `<span class="tag approve">APPROVE</span>`;
        if (d === 'ESCALATE') return `<span class="tag escalate">ESCALATE</span>`;
        if (d === 'BLOCK') return `<span class="tag block">BLOCK</span>`;
        return `<span class="tag neutral">${d}</span>`;
    }
    function getSourceTag(source) {
        const s = (source || '').toUpperCase();
        if (s === 'POLICY')   return `<span class="source-tag policy">POLICY</span>`;
        if (s === 'AI')       return `<span class="source-tag ai">AI</span>`;
        if (s === 'SYSTEM')   return `<span class="source-tag system">SYSTEM</span>`;
        if (s === 'COMBINED') return `<span class="source-tag combined">COMBINED</span>`;
        return `<span class="source-tag" style="color:#94a3b8">${s || '?'}</span>`;
    }
    function formatTime(isoStr) {
        const d = new Date(isoStr);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
             + ` <span style="color:#64748b;font-size:0.7rem">${d.toLocaleDateString()}</span>`;
    }
    function formatCurrency(amount) {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: amount % 1 === 0 ? 0 : 2 }).format(amount);
    }
    function cleanReason(log) {
        const src = (log.decisionSource || '').toUpperCase();
        if (src === 'POLICY' && log.policyResult?.blockReason) return log.policyResult.blockReason;
        if (src === 'POLICY') return log.finalReason || 'Hard policy block';
        if (src === 'SYSTEM') return log.finalReason || 'LLM failure → fail-closed';
        if (src === 'COMBINED') return log.finalReason || 'Soft policy + AI context';
        if (src === 'AI') return log.finalReason || log.aiResult?.explanation || 'AI reasoning';
        return log.aiReasoning || log.policyBlockReason || log.finalReason || 'Automation';
    }
    function statusColor(status) {
        const s = (status || '').toUpperCase();
        if (['PASS', 'OK', 'DONE', 'WRITTEN', 'APPROVE'].includes(s)) return '#10b981';
        if (['BLOCK', 'TIMEOUT', 'FAILED'].includes(s)) return '#ef4444';
        if (['ESCALATE', 'SKIPPED'].includes(s)) return '#f59e0b';
        return '#94a3b8';
    }

    // ---- RENDER TIMELINE ----
    function renderTimeline(timeline) {
        if (!timeline || !timeline.length) return '<div class="context-text">No timeline data</div>';
        return timeline.map((t, i) => `
            <div class="timeline-step">
                <div class="timeline-step-label">Step ${t.step} · ${t.stage} <span class="timeline-step-status" style="color:${statusColor(t.status)}">${t.status}</span></div>
                <div class="timeline-step-msg">${t.message}</div>
            </div>
            ${i < timeline.length - 1 ? '<div class="pipeline-arrow">↓</div>' : ''}
        `).join('');
    }

    // ---- SOURCE FILTER ----
    document.getElementById('source-filter').addEventListener('click', (e) => {
        if (!e.target.classList.contains('filter-btn')) return;
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        currentFilter = e.target.getAttribute('data-filter');
        renderFeedTable(cachedLogs);
    });

    // ---- FEED TABLE ----
    async function loadFeed() {
        try { const res = await fetch('/api/payments'); cachedLogs = await res.json(); renderFeedTable(cachedLogs); } catch (e) { console.error(e); }
    }
    function renderFeedTable(logs) {
        const filtered = currentFilter === 'ALL' ? logs : logs.filter(l => (l.decisionSource || '').toUpperCase() === currentFilter);
        tBodyLive.innerHTML = '';
        if (filtered.length === 0) { tBodyLive.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#64748b; padding:40px;">No records match this filter. Run a simulation.</td></tr>`; return; }
        filtered.forEach(log => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="mono" style="font-size:0.8rem; color:#94a3b8;">${log.traceId}</td>
                <td>${formatTime(log.timestamp)}</td>
                <td style="font-weight:500;">${log.requestContext?.userId || '-'}</td>
                <td style="font-weight:600; color:white;">${formatCurrency(log.requestContext?.amount || 0)}</td>
                <td>${getSourceTag(log.decisionSource)}</td>
                <td><span class="reason-text">${cleanReason(log)}</span></td>
                <td>${getDecisionTag(log.finalDecision)}</td>
            `;
            tr.addEventListener('click', () => openDrawer(log));
            tBodyLive.appendChild(tr);
        });
    }

    // ---- PIPELINE DRAWER (uses enriched replay API) ----
    async function openDrawer(log) {
        // Try to get enriched replay data
        let data = log;
        try {
            const res = await fetch(`/api/audit/${log.traceId}/replay`);
            if (res.ok) data = await res.json();
        } catch (e) { /* use raw log as fallback */ }

        document.getElementById('drawer-source-tag').innerHTML = getSourceTag(data.decisionSource || log.decisionSource);
        document.getElementById('drawer-decision-tag').innerHTML = getDecisionTag(data.finalDecision || log.finalDecision);
        document.getElementById('drawer-trace-id').textContent = data.traceId || log.traceId;
        document.getElementById('drawer-user').textContent = data.userId || log.requestContext?.userId || '-';
        document.getElementById('drawer-merchant').textContent = data.merchantId || log.requestContext?.merchantId || '-';
        document.getElementById('drawer-amount').textContent = formatCurrency(data.amount || log.requestContext?.amount || 0);
        document.getElementById('drawer-reason').textContent = data.finalReason || cleanReason(log);

        // Timeline waterfall
        document.getElementById('drawer-timeline').innerHTML = renderTimeline(data.timeline || log.timeline);

        // Integrity
        const intBadge = document.getElementById('drawer-integrity');
        const hashStatus = data.integrity?.hashChainStatus || (log.currentHash ? 'VALID' : 'UNVERIFIED');
        intBadge.textContent = `TAMPER EVIDENCE: ${hashStatus}`;
        intBadge.style.background = hashStatus === 'VALID' ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)';
        intBadge.style.color = hashStatus === 'VALID' ? '#10b981' : '#f59e0b';
        intBadge.style.borderColor = hashStatus === 'VALID' ? 'rgba(16,185,129,0.3)' : 'rgba(245,158,11,0.3)';
        document.getElementById('drawer-hash').textContent = data.integrity?.currentHash || log.currentHash || 'Hash unavailable';

        overlay.classList.add('active');
        drawer.classList.add('open');
    }
    function closeDrawer() { overlay.classList.remove('active'); drawer.classList.remove('open'); }
    overlay.addEventListener('click', closeDrawer);
    document.getElementById('close-drawer').addEventListener('click', closeDrawer);

    // ---- SIMULATION LAB ----
    const presets = {
        coffee: { userId: 'u123', merchantId: 'coffee_shop', amount: 5, department: 'engineering', category: 'food', paymentMethod: 'card', justification: 'Morning coffee', recentBurstCount: 0, recentBurstWindowMinutes: 60 },
        highValue: { userId: 'u444', merchantId: 'electronics', amount: 4500, department: 'engineering', category: 'electronics', paymentMethod: 'card', justification: 'Urgent team hardware', recentBurstCount: 0, recentBurstWindowMinutes: 60 },
        blacklist: { userId: 'u999', merchantId: 'merch_block_001', amount: 10, department: 'finance', category: 'misc', paymentMethod: 'card', justification: 'Test payment', recentBurstCount: 0, recentBurstWindowMinutes: 60 },
        smurfing: { userId: 'u888', merchantId: 'gift_cards', amount: 49, department: 'engineering', category: 'gift_cards', paymentMethod: 'card', justification: 'Small purchase', recentBurstCount: 8, recentBurstWindowMinutes: 15 },
    };

    function getFormData() {
        return {
            userId: document.getElementById('sim-userId').value,
            merchantId: document.getElementById('sim-merchantId').value,
            amount: Number(document.getElementById('sim-amount').value),
            department: document.getElementById('sim-department').value,
            category: document.getElementById('sim-category').value,
            paymentMethod: document.getElementById('sim-paymentMethod').value,
            justification: document.getElementById('sim-justification').value,
            recentBurstCount: Number(document.getElementById('sim-burstCount').value),
            recentBurstWindowMinutes: Number(document.getElementById('sim-burstWindow').value),
        };
    }
    function setFormData(data) {
        document.getElementById('sim-userId').value = data.userId || '';
        document.getElementById('sim-merchantId').value = data.merchantId || '';
        document.getElementById('sim-amount').value = data.amount || 0;
        document.getElementById('sim-department').value = data.department || '';
        document.getElementById('sim-category').value = data.category || '';
        document.getElementById('sim-paymentMethod').value = data.paymentMethod || '';
        document.getElementById('sim-justification').value = data.justification || '';
        document.getElementById('sim-burstCount').value = data.recentBurstCount || 0;
        document.getElementById('sim-burstWindow').value = data.recentBurstWindowMinutes || 60;
    }

    // Presets
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => { setFormData(presets[btn.getAttribute('data-preset')]); });
    });

    // Render sim result
    function renderSimResult(data) {
        const panel = document.getElementById('sim-result-content');
        panel.innerHTML = `
            <div style="margin-bottom:16px;">
                <div style="display:flex; gap:12px; margin-bottom:12px;">${getSourceTag(data.decisionSource)} ${getDecisionTag(data.decision)}</div>
                <div style="font-size:0.8rem; color:#64748b;">Policy Version: ${data.policyVersion || 'N/A'}</div>
            </div>
            ${data.aiResult && data.aiResult.riskScore != null ? `
            <div class="timeline-step" style="margin-bottom:12px;">
                <div class="timeline-step-label">AI Reasoning</div>
                <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px; margin:8px 0; font-size:0.8rem;">
                    <div>Risk: <strong>${data.aiResult.riskScore?.toFixed(2) ?? 'N/A'}</strong></div>
                    <div>Conf: <strong>${data.aiResult.confidence?.toFixed(2) ?? 'N/A'}</strong></div>
                    <div>Sug: <strong>${data.aiResult.decisionSuggestion ?? 'N/A'}</strong></div>
                </div>
                <div class="timeline-step-msg">${data.aiResult.explanation || ''}</div>
                ${data.aiResult.signals?.length ? `<div style="margin-top:6px; font-size:0.8rem; color:#94a3b8;">Signals: ${data.aiResult.signals.join(', ')}</div>` : ''}
            </div>` : ''}
            <div style="margin-bottom:12px;">
                <div style="font-size:0.75rem; color:#64748b; text-transform:uppercase; margin-bottom:8px;">Timeline</div>
                ${renderTimeline(data.timeline)}
            </div>
            <div class="integrity-badge" style="margin-top:12px; font-size:0.75rem;">${data.integrity?.hashChainStatus || 'NOT_PERSISTED'}</div>
            <div style="margin-top:8px; font-size:0.75rem; color:#64748b;">${data.integrity?.note || ''}</div>
        `;
    }

    // Run Simulation
    document.getElementById('run-sim-btn').addEventListener('click', async () => {
        const btn = document.getElementById('run-sim-btn');
        btn.textContent = 'Running...'; btn.disabled = true;
        document.getElementById('compare-results').style.display = 'none';
        try {
            const res = await fetch('/api/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(getFormData()) });
            const data = await res.json();
            renderSimResult(data);
        } catch (err) {
            document.getElementById('sim-result-content').innerHTML = `<div style="color:#ef4444;">Error: ${err.message}</div>`;
        }
        btn.textContent = 'Run Simulation'; btn.disabled = false;
    });

    // Compare Policies
    document.getElementById('compare-btn').addEventListener('click', async () => {
        const btn = document.getElementById('compare-btn');
        btn.textContent = 'Comparing...'; btn.disabled = true;
        try {
            const res = await fetch('/api/simulate/compare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: getFormData(), draftPolicies: null }) });
            const data = await res.json();
            renderCompare(data);
        } catch (err) {
            document.getElementById('compare-results').innerHTML = `<div style="color:#ef4444;">Compare failed: ${err.message}</div>`;
            document.getElementById('compare-results').style.display = 'block';
        }
        btn.textContent = 'Compare Policies'; btn.disabled = false;
    });

    function renderCompare(data) {
        const el = document.getElementById('compare-results');
        el.style.display = 'grid';
        el.innerHTML = `
            <div class="compare-card">
                <h4>Current Policy</h4>
                <div style="margin-bottom:8px;">${getSourceTag(data.current?.decisionSource)} ${getDecisionTag(data.current?.finalDecision)}</div>
                <div style="font-size:0.85rem; color:#cbd5e1;">${data.current?.finalReason || data.current?.aiResult?.explanation || data.current?.policyResult?.blockReason || 'N/A'}</div>
            </div>
            <div class="compare-card">
                <h4>Draft Policy</h4>
                <div style="margin-bottom:8px;">${getSourceTag(data.draft?.decisionSource)} ${getDecisionTag(data.draft?.finalDecision)}</div>
                <div style="font-size:0.85rem; color:#cbd5e1;">${data.draft?.finalReason || data.draft?.aiResult?.explanation || data.draft?.policyResult?.blockReason || 'N/A'}</div>
            </div>
            <div class="compare-diff">
                <h4>Difference Summary</h4>
                <div class="diff-row"><span>Decision changed</span><span class="${data.diff?.decisionChanged ? 'diff-yes' : 'diff-no'}">${data.diff?.decisionChanged ? '⚠ Yes' : '✓ No'}</span></div>
                <div class="diff-row"><span>Source changed</span><span class="${data.diff?.sourceChanged ? 'diff-yes' : 'diff-no'}">${data.diff?.sourceChanged ? '⚠ Yes' : '✓ No'}</span></div>
                <div class="diff-row"><span>Policy result changed</span><span class="${data.diff?.policyChanged ? 'diff-yes' : 'diff-no'}">${data.diff?.policyChanged ? '⚠ Yes' : '✓ No'}</span></div>
                <div class="diff-row"><span>AI reasoning changed</span><span class="${data.diff?.aiChanged ? 'diff-yes' : 'diff-no'}">${data.diff?.aiChanged ? '⚠ Yes' : '✓ No'}</span></div>
            </div>
        `;
    }

    // ---- SIDEBAR PRESET BUTTONS ----
    document.querySelectorAll('.sim-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const scenario = e.target.getAttribute('data-scenario');
            btn.style.opacity = '0.5';
            try {
                await fetch('/api/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenario }) });
                await loadFeed();
                if (document.getElementById('view-audit').classList.contains('active')) loadCompliance();
            } catch (err) { console.error(err); }
            btn.style.opacity = '1';
        });
    });

    // ---- POLICIES ----
    const editor = document.getElementById('policy-editor');
    const vBadge = document.getElementById('policy-version-badge');
    async function loadPolicies() { const res = await fetch('/api/policies'); const data = await res.json(); editor.value = JSON.stringify(data.policies, null, 2); vBadge.textContent = data.version; }
    document.getElementById('save-policies-btn').addEventListener('click', async () => {
        const status = document.getElementById('policy-save-status');
        try { JSON.parse(editor.value); const res = await fetch('/api/policies', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: editor.value }); const data = await res.json(); status.style.color = '#10b981'; status.textContent = '✓ Deployed: ' + data.version; vBadge.textContent = data.version; setTimeout(() => status.textContent = '', 3000); }
        catch (err) { status.style.color = '#ef4444'; status.textContent = 'Invalid JSON: ' + err.message; }
    });

    // ---- COMPLIANCE ----
    async function loadCompliance() {
        const metricsRes = await fetch('/api/metrics'); const metrics = await metricsRes.json();
        document.getElementById('metrics-grid').innerHTML = `
            <div class="metric-box"><h3>Policy Hit Rate</h3><div class="val">${metrics.policyHitRate}%</div><div class="sub">Hard blocks via Policy Engine</div></div>
            <div class="metric-box"><h3>AI Overrides / Esc.</h3><div class="val">${metrics.escalatedPct}%</div><div class="sub">Soft policy/AI flagged</div></div>
            <div class="metric-box"><h3>Auto-Approved</h3><div class="val">${metrics.approvedPct}%</div><div class="sub">Low Risk Trajectory</div></div>
            <div class="metric-box"><h3>Fail-Closed Events</h3><div class="val">${metrics.failClosedEvents}</div><div class="sub">System protection faults</div></div>
        `;
        const res = await fetch('/api/payments'); const data = await res.json();
        tBodyCompliance.innerHTML = '';
        data.forEach(log => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="mono" style="font-size:0.85rem; color:#38bdf8; cursor:pointer;">
                    ${log.traceId}<br/><span style="color:#64748b;font-size:0.7rem;">${log.timestamp}</span>
                </td>
                <td><span class="tag approve" style="font-size:0.65rem;">✓ HASH VERIFIED</span></td>
                <td><button class="action-btn" style="padding:6px 12px; font-size:0.75rem;">Forensic Replay</button></td>
            `;
            tr.addEventListener('click', () => openDrawer(log));
            tBodyCompliance.appendChild(tr);
        });
    }

    // INIT
    loadFeed();
    setInterval(loadFeed, 5000);
});
