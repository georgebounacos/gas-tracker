/* Gas Price Tracker - Main application */

(function () {
    'use strict';

    const DATA_BASE = 'data/';
    const BASELINE_DATE = '2025-01-06'; // First Monday of 2025
    const STATE_NAMES = {
        AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",
        CO:"Colorado",CT:"Connecticut",DE:"Delaware",DC:"District of Columbia",
        FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",IL:"Illinois",
        IN:"Indiana",IA:"Iowa",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",
        ME:"Maine",MD:"Maryland",MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",
        MS:"Mississippi",MO:"Missouri",MT:"Montana",NE:"Nebraska",NV:"Nevada",
        NH:"New Hampshire",NJ:"New Jersey",NM:"New Mexico",NY:"New York",
        NC:"North Carolina",ND:"North Dakota",OH:"Ohio",OK:"Oklahoma",OR:"Oregon",
        PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",SD:"South Dakota",
        TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",VA:"Virginia",
        WA:"Washington",WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming"
    };

    let chart = null;
    let nationalData = null;
    let currentStateData = null;
    let currentRange = 'jan2025';
    let sortCol = 'date';
    let sortDir = -1; // -1 = descending (newest first)

    // ── Data loading ──

    async function loadJSON(path) {
        const resp = await fetch(DATA_BASE + path);
        if (!resp.ok) return null;
        return resp.json();
    }

    async function init() {
        // Load national data
        nationalData = await loadJSON('national.json');
        if (!nationalData) {
            document.getElementById('calloutPrice').textContent = 'No data';
            return;
        }

        // Load metadata
        const meta = await loadJSON('metadata.json');
        if (meta && meta.last_updated) {
            const d = new Date(meta.last_updated);
            document.getElementById('lastUpdated').textContent =
                'Last updated: ' + d.toLocaleDateString('en-US', {
                    month: 'long', day: 'numeric', year: 'numeric'
                });
        }

        // Populate state dropdown
        populateStateDropdown();

        // Set up event listeners
        setupControls();

        // Initial render
        updateDashboard();
    }

    function populateStateDropdown() {
        const sel = document.getElementById('stateSelect');
        const sorted = Object.entries(STATE_NAMES).sort((a, b) => a[1].localeCompare(b[1]));
        for (const [code, name] of sorted) {
            const opt = document.createElement('option');
            opt.value = code;
            opt.textContent = name;
            sel.appendChild(opt);
        }
    }

    // ── Controls ──

    function setupControls() {
        document.getElementById('stateSelect').addEventListener('change', onStateChange);
        document.getElementById('showNational').addEventListener('change', updateDashboard);

        // Range buttons
        document.querySelectorAll('#rangeButtons button').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#rangeButtons button').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentRange = btn.dataset.range;
                // Clear custom date pickers
                document.getElementById('dateFrom').value = '';
                document.getElementById('dateTo').value = '';
                updateDashboard();
            });
        });

        // Custom date pickers
        document.getElementById('dateFrom').addEventListener('change', onCustomDate);
        document.getElementById('dateTo').addEventListener('change', onCustomDate);

        // Table sorting
        document.querySelectorAll('#priceTable th[data-sort]').forEach(th => {
            th.addEventListener('click', () => {
                const col = th.dataset.sort;
                if (sortCol === col) {
                    sortDir *= -1;
                } else {
                    sortCol = col;
                    sortDir = col === 'date' ? -1 : -1;
                }
                renderTable();
            });
        });

        // Export buttons
        document.getElementById('btnCopy').addEventListener('click', copyTable);
        document.getElementById('btnCSV').addEventListener('click', exportCSV);
        document.getElementById('btnPDF').addEventListener('click', exportPDF);
    }

    async function onStateChange() {
        const code = document.getElementById('stateSelect').value;
        if (code) {
            currentStateData = await loadJSON('states/' + code + '.json');
        } else {
            currentStateData = null;
        }
        updateDashboard();
    }

    function onCustomDate() {
        const from = document.getElementById('dateFrom').value;
        const to = document.getElementById('dateTo').value;
        if (from || to) {
            document.querySelectorAll('#rangeButtons button').forEach(b => b.classList.remove('active'));
            currentRange = 'custom';
        }
        updateDashboard();
    }

    // ── Date range logic ──

    function getDateRange() {
        const now = new Date();
        const today = now.toISOString().slice(0, 10);

        if (currentRange === 'custom') {
            return {
                start: document.getElementById('dateFrom').value || '2000-01-01',
                end: document.getElementById('dateTo').value || today,
            };
        }

        switch (currentRange) {
            case 'jan2025': return { start: '2025-01-01', end: today };
            case '3m': {
                const d = new Date(now);
                d.setMonth(d.getMonth() - 3);
                return { start: d.toISOString().slice(0, 10), end: today };
            }
            case '6m': {
                const d = new Date(now);
                d.setMonth(d.getMonth() - 6);
                return { start: d.toISOString().slice(0, 10), end: today };
            }
            case 'ytd': return { start: now.getFullYear() + '-01-01', end: today };
            case '1y': {
                const d = new Date(now);
                d.setFullYear(d.getFullYear() - 1);
                return { start: d.toISOString().slice(0, 10), end: today };
            }
            case 'all': return { start: '1990-01-01', end: today };
            default: return { start: '2025-01-01', end: today };
        }
    }

    function filterByRange(dataPoints) {
        const { start, end } = getDateRange();
        return dataPoints.filter(d => d.date >= start && d.date <= end);
    }

    // ── Baseline calculation ──

    function getBaseline(dataPoints) {
        // Find earliest data point on or after BASELINE_DATE
        const sorted = [...dataPoints].sort((a, b) => a.date.localeCompare(b.date));
        const baseline = sorted.find(d => d.date >= BASELINE_DATE);
        return baseline || sorted[0] || null;
    }

    function pctChange(current, baseline) {
        if (!baseline || baseline === 0) return null;
        return ((current - baseline) / baseline) * 100;
    }

    // ── Dashboard update ──

    function updateDashboard() {
        const showNational = document.getElementById('showNational').checked;
        const primaryData = currentStateData || nationalData;
        const primaryPoints = primaryData ? filterByRange(primaryData.data) : [];
        const nationalPoints = nationalData ? filterByRange(nationalData.data) : [];

        // Update callout
        updateCallout(primaryData, primaryPoints);

        // Update chart title
        updateChartTitle();

        // Update chart
        updateChart(primaryPoints, nationalPoints, showNational);

        // Update legend
        updateLegend(showNational);

        // Update table
        renderTable();
    }

    function updateCallout(source, points) {
        const priceEl = document.getElementById('calloutPrice');
        const labelEl = document.getElementById('calloutLabel');
        const changeEl = document.getElementById('calloutChange');

        if (!points.length) {
            priceEl.textContent = 'No data';
            labelEl.textContent = source ? (source.name || 'Selected') : 'National Average';
            changeEl.textContent = '';
            changeEl.className = 'callout-change';
            return;
        }

        const latest = points[points.length - 1];
        const baseline = getBaseline(source.data);

        priceEl.textContent = '$' + latest.price.toFixed(2);
        labelEl.textContent = currentStateData
            ? (currentStateData.name || currentStateData.state)
            : 'National Average';

        if (baseline) {
            const pct = pctChange(latest.price, baseline.price);
            const dollarDiff = latest.price - baseline.price;
            if (pct !== null) {
                const dSign = dollarDiff >= 0 ? '+' : '';
                const pSign = pct >= 0 ? '+' : '';
                changeEl.innerHTML = dSign + '$' + Math.abs(dollarDiff).toFixed(2) + '/gal ' +
                    '<span class="callout-pct">(' + pSign + pct.toFixed(1) + '%)</span>' +
                    ' since Jan 2025';
                changeEl.className = 'callout-change ' + (pct >= 0 ? 'up' : 'down');
            }
        } else {
            changeEl.innerHTML = '';
            changeEl.className = 'callout-change';
        }
    }

    // ── Chart title & legend ──

    function updateChartTitle() {
        const label = currentStateData
            ? (currentStateData.name || currentStateData.state)
            : 'National Average';
        document.getElementById('chartTitle').textContent =
            label + ' — Weekly Retail Gasoline Prices (Regular Unleaded)';
    }

    function updateLegend(showNational) {
        const el = document.getElementById('chartLegend');
        const label = currentStateData
            ? (currentStateData.name || currentStateData.state)
            : 'National Average';

        let html = '<div class="chart-legend-item">' +
            '<span class="chart-legend-swatch" style="background:' +
            (currentStateData ? '#2563eb' : '#1a1a2e') + '"></span>' +
            '<span>' + label + '</span></div>';

        if (showNational && currentStateData) {
            html += '<div class="chart-legend-item">' +
                '<span class="chart-legend-swatch dashed"></span>' +
                '<span>National Average</span></div>';
        }

        el.innerHTML = html;
    }

    // ── Chart ──

    function updateChart(primaryPoints, nationalPoints, showNational) {
        const ctx = document.getElementById('priceChart').getContext('2d');
        const datasets = [];

        const label = currentStateData
            ? (currentStateData.name || currentStateData.state)
            : 'National Average';

        // Primary line (state or national)
        if (primaryPoints.length) {
            datasets.push({
                label: label,
                data: primaryPoints.map(d => ({ x: d.date, y: d.price })),
                borderColor: currentStateData ? '#2563eb' : '#1a1a2e',
                backgroundColor: 'transparent',
                borderWidth: 2.5,
                pointRadius: primaryPoints.length > 100 ? 0 : 3,
                pointHoverRadius: 5,
                tension: 0.1,
                segment: {
                    borderDash: ctx => {
                        const idx = ctx.p0DataIndex;
                        return primaryPoints[idx] && primaryPoints[idx].source === 'eia_pad'
                            ? [5, 3] : undefined;
                    }
                }
            });
        }

        // National overlay
        if (showNational && currentStateData && nationalPoints.length) {
            datasets.push({
                label: 'National Average',
                data: nationalPoints.map(d => ({ x: d.date, y: d.price })),
                borderColor: '#9ca3af',
                backgroundColor: 'transparent',
                borderWidth: 1.5,
                borderDash: [6, 3],
                pointRadius: 0,
                pointHoverRadius: 4,
                tension: 0.1,
            });
        }

        if (chart) {
            chart.data.datasets = datasets;
            chart.update('none');
            return;
        }

        chart = new Chart(ctx, {
            type: 'line',
            data: { datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            title: items => {
                                if (!items.length) return '';
                                const d = new Date(items[0].parsed.x || items[0].label);
                                return d.toLocaleDateString('en-US', {
                                    month: 'short', day: 'numeric', year: 'numeric'
                                });
                            },
                            label: item => {
                                let lbl = item.dataset.label + ': $' + item.parsed.y.toFixed(3);
                                // Check if proxy data
                                const idx = item.dataIndex;
                                const points = currentStateData
                                    ? filterByRange(currentStateData.data)
                                    : filterByRange(nationalData.data);
                                if (points[idx] && points[idx].source === 'eia_pad') {
                                    lbl += ' (regional estimate)';
                                }
                                return lbl;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        type: 'time',
                        time: {
                            unit: 'month',
                            displayFormats: { month: 'MMM yyyy' },
                            tooltipFormat: 'MMM d, yyyy'
                        },
                        grid: { display: false },
                        ticks: { font: { size: 11 } }
                    },
                    y: {
                        title: { display: true, text: '$/gallon', font: { size: 12 } },
                        ticks: {
                            callback: v => '$' + v.toFixed(2),
                            font: { size: 11 }
                        },
                        grid: { color: '#f0f0f0' }
                    }
                }
            }
        });
    }

    // ── Table ──

    function getTableData() {
        const source = currentStateData || nationalData;
        if (!source) return [];

        const points = filterByRange(source.data);
        const baseline = getBaseline(source.data);

        return points.map((d, i) => {
            const prev = i > 0 ? points[i - 1] : null;
            const weekChange = prev ? d.price - prev.price : null;
            const weekPct = prev ? pctChange(d.price, prev.price) : null;
            const baseChange = baseline ? pctChange(d.price, baseline.price) : null;

            return {
                date: d.date,
                price: d.price,
                weekChange,
                weekPct,
                baseChange,
                source: d.source,
                isProxy: d.source === 'eia_pad',
            };
        });
    }

    function renderTable() {
        const tbody = document.getElementById('priceTableBody');
        let rows = getTableData();

        // Sort
        rows.sort((a, b) => {
            let va = a[sortCol], vb = b[sortCol];
            if (va === null) va = -Infinity;
            if (vb === null) vb = -Infinity;
            if (typeof va === 'string') return va.localeCompare(vb) * sortDir;
            return (va - vb) * sortDir;
        });

        const hasProxy = rows.some(r => r.isProxy);
        document.getElementById('proxyNote').style.display = hasProxy ? 'block' : 'none';

        tbody.innerHTML = rows.map(r => {
            const wcClass = r.weekChange > 0 ? 'positive' : r.weekChange < 0 ? 'negative' : '';
            const bcClass = r.baseChange > 0 ? 'positive' : r.baseChange < 0 ? 'negative' : '';
            const proxy = r.isProxy ? ' <span class="proxy-indicator">*</span>' : '';
            const srcLabel = { aaa: 'AAA', eia_state: 'EIA', eia: 'EIA', eia_pad: 'PAD Est.*' }[r.source] || r.source;

            return `<tr>
                <td>${formatDate(r.date)}</td>
                <td>$${r.price.toFixed(3)}${proxy}</td>
                <td class="${wcClass}">${r.weekChange !== null ? (r.weekChange >= 0 ? '+' : '') + r.weekChange.toFixed(3) : '--'}</td>
                <td class="${wcClass}">${r.weekPct !== null ? (r.weekPct >= 0 ? '+' : '') + r.weekPct.toFixed(1) + '%' : '--'}</td>
                <td class="${bcClass}">${r.baseChange !== null ? (r.baseChange >= 0 ? '+' : '') + r.baseChange.toFixed(1) + '%' : '--'}</td>
                <td>${srcLabel}</td>
            </tr>`;
        }).join('');
    }

    function formatDate(dateStr) {
        const d = new Date(dateStr + 'T00:00:00');
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    // ── Export functions ──

    function copyTable() {
        const rows = getTableData();
        const header = 'Date\tPrice\tWeek Change ($)\tWeek Change (%)\tvs Jan 2025 (%)\tSource';
        const lines = rows.map(r =>
            `${r.date}\t${r.price.toFixed(3)}\t${r.weekChange !== null ? r.weekChange.toFixed(3) : ''}\t` +
            `${r.weekPct !== null ? r.weekPct.toFixed(1) + '%' : ''}\t` +
            `${r.baseChange !== null ? r.baseChange.toFixed(1) + '%' : ''}\t${r.source}`
        );
        const text = header + '\n' + lines.join('\n');
        navigator.clipboard.writeText(text).then(() => {
            const btn = document.getElementById('btnCopy');
            btn.textContent = 'Copied!';
            setTimeout(() => btn.textContent = 'Copy Table', 2000);
        });
    }

    function exportCSV() {
        const rows = getTableData();
        const header = 'Date,Price,Week Change ($),Week Change (%),vs Jan 2025 (%),Source';
        const lines = rows.map(r =>
            `${r.date},${r.price.toFixed(3)},${r.weekChange !== null ? r.weekChange.toFixed(3) : ''},` +
            `${r.weekPct !== null ? r.weekPct.toFixed(1) : ''},` +
            `${r.baseChange !== null ? r.baseChange.toFixed(1) : ''},${r.source}`
        );
        const csv = header + '\n' + lines.join('\n');
        downloadFile(csv, 'gas-prices.csv', 'text/csv');
    }

    function exportPDF() {
        // Export only the chart section as PDF via print
        const chartSection = document.querySelector('.chart-section');
        const allSections = document.querySelectorAll('body > *');
        const hidden = [];
        allSections.forEach(el => {
            if (el !== chartSection) {
                hidden.push({ el, display: el.style.display });
                el.style.display = 'none';
            }
        });

        const label = currentStateData
            ? (currentStateData.name || currentStateData.state)
            : 'National Average';
        const { start, end } = getDateRange();
        const origTitle = document.title;
        document.title = `Trumpflation Gas Price Tracker - ${label} (${start} to ${end})`;
        window.print();
        document.title = origTitle;

        hidden.forEach(({ el, display }) => {
            el.style.display = display || '';
        });
    }

    function downloadFile(content, filename, type) {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    // ── Start ──
    document.addEventListener('DOMContentLoaded', init);
})();
