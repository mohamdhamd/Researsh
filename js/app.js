(function () {
  window.REPORTS_DATA = window.REPORTS_DATA || {};
  let currentReport = null;
  let deferredInstallPrompt = null;
  let searchHits = [];
  let currentHitIdx = -1;

  const $ = (id) => document.getElementById(id);

  /* ---------- 1. إشعار سريع وحالة الاتصال ---------- */
  function showToast(msg, duration = 3200) {
    const t = $('status-toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.hidden = true; }, duration);
  }

  function updateConnectionUI() {
    const pill = $('connection-pill');
    if (!pill) return;
    if (navigator.onLine) {
      pill.textContent = '🟢 متصل بالإنترنت';
    } else {
      pill.textContent = '📴 وضع الأوفلاين (شغال من ذاكرة الموبايل)';
    }
  }

  /* ---------- 2. الوضع الليلي ---------- */
  function initTheme() {
    const saved = localStorage.getItem('farm_theme') || 'light';
    document.documentElement.setAttribute('data-theme', saved);
    $('btn-theme').textContent = saved === 'dark' ? '☀️' : '🌙';
    $('btn-theme').addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('farm_theme', next);
      $('btn-theme').textContent = next === 'dark' ? '☀️' : '🌙';
    });
  }

  /* ---------- 3. محرك تحويل المعادلات والماركداون بدون إنترنت ---------- */
  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderMathExpr(expr) {
    let out = escapeHtml(expr.trim());
    // تحويل الكسور \frac{a}{b}
    for (let i = 0; i < 4; i++) {
      out = out.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g,
        '<span class="math-frac"><span class="num">$1</span><span class="den">$2</span></span>');
    }
    out = out
      .replace(/\\text\{([^{}]+)\}/g, '<span class="math-text">$1</span>')
      .replace(/\\left\(/g, '(').replace(/\\right\)/g, ')')
      .replace(/\\times/g, '&times;')
      .replace(/\\div/g, '&divide;')
      .replace(/\\approx/g, '&asymp;')
      .replace(/\\le/g, '&le;')
      .replace(/\\ge/g, '&ge;')
      .replace(/\\implies/g, ' &rArr; ')
      .replace(/\\qquad/g, '&nbsp;&nbsp;&nbsp;&nbsp;')
      .replace(/\\quad/g, '&nbsp;&nbsp;')
      .replace(/\\%/g, '%')
      .replace(/\^\{([^{}]+)\}/g, '<sup>$1</sup>')
      .replace(/\^([0-9.]+)/g, '<sup>$1</sup>')
      .replace(/_\{([^{}]+)\}/g, '<sub>$1</sub>');
    return out;
  }

  function formatInline(rawText) {
    const mathTokens = [];
    // حفظ المعادلات أولًا
    let text = rawText.replace(/\$\$([^$]+)\$\$/g, (_, m) => {
      mathTokens.push(`<div class="math-block" dir="ltr">${renderMathExpr(m)}</div>`);
      return `@@MATH${mathTokens.length - 1}@@`;
    });
    text = text.replace(/\$([^$\n]+)\$/g, (_, m) => {
      mathTokens.push(`<span class="math-inline" dir="ltr">${renderMathExpr(m)}</span>`);
      return `@@MATH${mathTokens.length - 1}@@`;
    });

    text = escapeHtml(text);

    // روابط URL التلقائية
    text = text.replace(/(https?:\/\/[^\s<>"')،؛]+)/g, (url) => {
      const clean = url.replace(/[.,;]+$/, '');
      const trail = url.slice(clean.length);
      return `<a href="${clean}" target="_blank" rel="noopener noreferrer">${clean}</a>${trail}`;
    });

    // عريض ومائل
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');

    // مصطلحات البوب-أب {{id|النص}}
    text = text.replace(/\{\{([a-z0-9-]+)\|([^}]+)\}\}/gi, (_, id, label) => {
      return `<button type="button" class="term" data-term="${id}">${label}</button>`;
    });

    // استرجاع المعادلات
    text = text.replace(/@@MATH(\d+)@@/g, (_, idx) => mathTokens[Number(idx)]);
    return text;
  }

  function parseMarkdown(md) {
    const lines = md.replace(/\r/g, '').split('\n');
    const html = [];
    const toc = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i].trim();
      if (!line) { i++; continue; }

      // فاصل أفقي
      if (/^---+$/.test(line)) {
        html.push('<hr />');
        i++; continue;
      }

      // معادلة مستقلة
      if (line.startsWith('$$') && line.endsWith('$$')) {
        html.push(formatInline(line));
        i++; continue;
      }

      // العناوين
      const hMatch = line.match(/^(#{2,4})\s+(.+)$/);
      if (hMatch) {
        const level = hMatch[1].length;
        const text = hMatch[2].trim();
        const secId = `sec-${toc.length}`;
        const plainTitle = text.replace(/\{\{[a-z0-9-]+\|([^}]+)\}\}/gi, '$1').replace(/\*\*/g, '');
        if (level <= 3) toc.push({ id: secId, level, title: plainTitle });
        html.push(`<h${level} id="${secId}">${formatInline(text)}</h${level}>`);
        i++; continue;
      }

      // الجداول (تجاهل علامة | الموجودة داخل مصطلحات البوب-أب {{id|النص}})
      if (line.startsWith('|') && i + 1 < lines.length && lines[i + 1].trim().startsWith('|') && /---/.test(lines[i + 1])) {
        const splitRow = (r) =>
          r.trim()
            .replace(/^\|/, '')
            .replace(/\|$/, '')
            .replace(/\{\{[^}]+\}\}/g, (m) => m.replace(/\|/g, '@@PIPE@@'))
            .split('|')
            .map((c) => c.replace(/@@PIPE@@/g, '|').trim());
        const headers = splitRow(line);
        i += 2; // تخطي صف الفواصل
        const rows = [];
        while (i < lines.length && lines[i].trim().startsWith('|')) {
          rows.push(splitRow(lines[i]));
          i++;
        }
        let tbl = '<div class="table-wrap"><table><thead><tr>';
        headers.forEach((h) => { tbl += `<th>${formatInline(h)}</th>`; });
        tbl += '</tr></thead><tbody>';
        rows.forEach((r) => {
          tbl += '<tr>';
          headers.forEach((_, ci) => { tbl += `<td>${formatInline(r[ci] || '')}</td>`; });
          tbl += '</tr>';
        });
        tbl += '</tbody></table></div>';
        html.push(tbl);
        continue;
      }

      // قوائم نقطية (تشمل الفرعية)
      if (/^[-*]\s+/.test(line)) {
        let listHtml = '<ul>';
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          const itemText = lines[i].replace(/^\s*[-*]\s+/, '');
          listHtml += `<li>${formatInline(itemText)}</li>`;
          i++;
        }
        listHtml += '</ul>';
        html.push(listHtml);
        continue;
      }

      // قوائم مرقمة
      if (/^\d+\.\s+/.test(line)) {
        let listHtml = '<ol>';
        while (i < lines.length && /^\s*(\d+\.\s+|[-*]\s+)/.test(lines[i])) {
          const isSub = /^\s+[-*]\s+/.test(lines[i]);
          const itemText = lines[i].replace(/^\s*(\d+\.|[-*])\s+/, '');
          listHtml += isSub ? `<li style="list-style:circle;margin-right:18px">${formatInline(itemText)}</li>` : `<li>${formatInline(itemText)}</li>`;
          i++;
        }
        listHtml += '</ol>';
        html.push(listHtml);
        continue;
      }

      // فقرة عادية
      const paraLines = [line];
      i++;
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^(#{2,4}\s|---|\||[-*]\s|\d+\.\s|\$\$)/.test(lines[i].trim())
      ) {
        paraLines.push(lines[i].trim());
        i++;
      }
      html.push(`<p>${formatInline(paraLines.join(' '))}</p>`);
    }

    return { html: html.join('\n'), toc };
  }

  /* ---------- 4. عرض مكتبة التقارير وتحميل أي تقرير ديناميكيًا ---------- */
  function renderLibrary() {
    const list = window.REPORTS_INDEX || [];
    $('reports-count').textContent = `${list.length} تقرير`;
    const grid = $('reports-grid');
    grid.innerHTML = '';

    list.forEach((meta) => {
      const card = document.createElement('article');
      card.className = 'report-card';
      card.innerHTML = `
        <div class="report-card-top">
          <span class="report-cat">${escapeHtml(meta.category)}</span>
          <span class="report-date">${escapeHtml(meta.updated)}</span>
        </div>
        <h3>${escapeHtml(meta.title)}</h3>
        <p>${escapeHtml(meta.summary)}</p>
        <div class="report-card-meta">
          <span>📚 ${meta.chaptersCount || 15} فصلًا</span>
          <span>💬 ${meta.termsCount || 40}+ شرح بالعامية</span>
          ${meta.has3D ? '<span>🏗️ مجسم 3D</span>' : ''}
        </div>
        <div class="report-card-cta">فتح التقرير كامل ←</div>
      `;
      card.addEventListener('click', () => openReport(meta));
      grid.appendChild(card);
    });
  }

  function loadScriptDynamic(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('تعذر تحميل ملف التقرير: ' + src));
      document.head.appendChild(s);
    });
  }

  async function openReport(meta) {
    try {
      if (!window.REPORTS_DATA[meta.id]) {
        await loadScriptDynamic(meta.file);
      }
      const data = window.REPORTS_DATA[meta.id];
      if (!data) throw new Error('بيانات التقرير غير موجودة.');
      currentReport = { meta, ...data };

      // إظهار واجهة القراءة وإغلاق الفهرس افتراضيًا على الموبايل
      closeTOC();
      document.body.classList.add('is-reading');
      $('library-view').hidden = true;
      $('reader-view').hidden = false;
      $('btn-toc').hidden = false;
      $('btn-back-home').hidden = false;
      $('btn-glossary').hidden = false;
      $('btn-export').hidden = false;
      $('read-progress-wrap').hidden = false;

      // ترويسة التقرير
      $('report-header-card').innerHTML = `
        <span class="report-cat">${escapeHtml(meta.category)}</span>
        <h1>${escapeHtml(data.title)}</h1>
        <div class="report-meta-row">
          <span>📍 ${escapeHtml(meta.location || 'مصر')}</span>
          <span>🗓️ آخر تحديث: ${escapeHtml(meta.updated)}</span>
          <span>💬 ${Object.keys(data.glossary || {}).length} مصطلح مشروح بالعامية</span>
        </div>
      `;

      // تحويل وعرض المحتوى
      const { html, toc } = parseMarkdown(data.markdown);
      $('report-body').innerHTML = html;
      renderTOC(toc);
      renderGlossaryList('');
      switchTab('content');
      window.scrollTo({ top: 0, behavior: 'instant' });
      history.replaceState(null, '', '#' + meta.id);
    } catch (err) {
      showToast('❌ ' + err.message, 4000);
    }
  }

  function showLibrary() {
    if (window.BarnScene3D) window.BarnScene3D.stop();
    document.body.classList.remove('is-reading');
    $('reader-view').hidden = true;
    $('library-view').hidden = false;
    $('btn-toc').hidden = true;
    $('btn-back-home').hidden = true;
    $('btn-glossary').hidden = true;
    $('btn-export').hidden = true;
    $('read-progress-wrap').hidden = true;
    closeTOC();
    history.replaceState(null, '', '#');
  }

  function renderTOC(toc) {
    const nav = $('toc-list');
    nav.innerHTML = '';
    const countEl = $('toc-count');
    if (countEl) countEl.textContent = `${toc.length} قسم وفصل`;
    toc.forEach((item, idx) => {
      const a = document.createElement('a');
      a.href = '#' + item.id;
      a.dataset.sec = item.id;
      a.className = 'toc-link' + (item.level === 3 ? ' sub' : '') + (idx === 0 ? ' active' : '');
      a.textContent = item.title;
      a.addEventListener('click', () => {
        switchTab('content');
        closeTOC();
      });
      nav.appendChild(a);
    });
  }

  function updateActiveTOC() {
    if ($('reader-view').hidden || $('tab-content').hidden) return;
    const headings = $('report-body').querySelectorAll('h2[id], h3[id]');
    if (!headings.length) return;
    let activeId = headings[0].id;
    const offset = 110;
    for (const h of headings) {
      if (h.getBoundingClientRect().top <= offset) {
        activeId = h.id;
      } else {
        break;
      }
    }
    $('toc-list').querySelectorAll('.toc-link').forEach((link) => {
      link.classList.toggle('active', link.dataset.sec === activeId);
    });
  }

  /* ---------- 5. التبويبات والفهرس الجانبي ---------- */
  function openTOC() {
    $('toc-sidebar').classList.add('open');
    $('toc-backdrop').hidden = false;
  }
  function closeTOC() {
    $('toc-sidebar').classList.remove('open');
    $('toc-backdrop').hidden = true;
  }

  function switchTab(name) {
    document.querySelectorAll('.tab-btn').forEach((b) => {
      const active = b.dataset.tab === name;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', String(active));
    });
    ['content', 'scene3d', 'tools'].forEach((t) => {
      const panel = $('tab-' + t);
      if (panel) panel.hidden = t !== name;
    });

    if (name === 'scene3d') {
      setTimeout(() => {
        if (window.BarnScene3D) window.BarnScene3D.init($('canvas3d-wrap'));
      }, 60);
    } else if (window.BarnScene3D) {
      window.BarnScene3D.stop();
    }
  }

  /* ---------- 6. البوب-أب بالعامية والقاموس ---------- */
  function openTermPopup(termId) {
    if (!currentReport || !currentReport.glossary) return;
    const item = currentReport.glossary[termId];
    if (!item) return;
    $('popup-title').textContent = item.title;
    $('popup-baladi').textContent = item.baladi;
    $('popup-impact').textContent = item.impact;
    $('popup-overlay').hidden = false;
  }

  function renderGlossaryList(query) {
    const container = $('glossary-list');
    if (!currentReport || !currentReport.glossary) return;
    const q = query.trim().toLowerCase();
    const entries = Object.values(currentReport.glossary).filter((g) =>
      !q || g.title.toLowerCase().includes(q) || g.baladi.toLowerCase().includes(q) || g.impact.toLowerCase().includes(q)
    );
    if (!entries.length) {
      container.innerHTML = '<p class="muted" style="text-align:center">لا توجد نتائج مطابقة.</p>';
      return;
    }
    container.innerHTML = entries.map((g) => `
      <div class="glossary-item">
        <strong>${escapeHtml(g.title)}</strong>
        <p>${escapeHtml(g.baladi)}</p>
        <p class="g-imp">💰 ${escapeHtml(g.impact)}</p>
      </div>
    `).join('');
  }

  /* ---------- 7. البحث الفوري جوه التقرير ---------- */
  function clearSearchHighlights() {
    const body = $('report-body');
    body.querySelectorAll('mark.search-hit').forEach((m) => {
      const parent = m.parentNode;
      parent.replaceChild(document.createTextNode(m.textContent), m);
      parent.normalize();
    });
    searchHits = [];
    currentHitIdx = -1;
    $('search-meta').hidden = true;
  }

  function runReportSearch(query) {
    clearSearchHighlights();
    const q = query.trim();
    if (q.length < 2) return;

    switchTab('content');
    const walker = document.createTreeWalker($('report-body'), NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) {
      if (node.parentElement && !['SCRIPT', 'STYLE', 'BUTTON'].includes(node.parentElement.tagName)) {
        if (node.nodeValue.toLowerCase().includes(q.toLowerCase())) nodes.push(node);
      }
    }

    const escQ = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(${escQ})`, 'gi');
    nodes.forEach((n) => {
      const span = document.createElement('span');
      span.innerHTML = escapeHtml(n.nodeValue).replace(re, '<mark class="search-hit">$1</mark>');
      n.parentNode.replaceChild(span, n);
    });

    searchHits = Array.from($('report-body').querySelectorAll('mark.search-hit'));
    $('search-meta').hidden = false;
    $('search-count').textContent = `${searchHits.length} نتيجة`;
    if (searchHits.length > 0) jumpToHit(0);
  }

  function jumpToHit(idx) {
    if (!searchHits.length) return;
    if (currentHitIdx >= 0 && searchHits[currentHitIdx]) {
      searchHits[currentHitIdx].classList.remove('current-hit');
    }
    currentHitIdx = (idx + searchHits.length) % searchHits.length;
    const el = searchHits[currentHitIdx];
    el.classList.add('current-hit');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('search-count').textContent = `${currentHitIdx + 1} / ${searchHits.length}`;
  }

  /* ---------- 8. أدوات المزرعة التفاعلية ---------- */
  const CHECKLIST_ITEMS = [
    { id: 'c1', text: 'اليقظة والوقفة: العجل نشيط، أذناه متحركتان، ورأسه مرفوع (غير خامل)' },
    { id: 'c2', text: 'العينان والمخطم: عين صافية لامعة، ومخطم رطب ندي بدون مخاط أصفر أو قروح' },
    { id: 'c3', text: 'الفم والحوافر: لا سيلان لعاب غزير ولا بثور فم أو عرج أو تورم مفاصل' },
    { id: 'c4', text: 'التنفس والرئة: تنفس هادئ منتظم بدون كحة أو نهجان بعد المشي لمسافة قصيرة' },
    { id: 'c5', text: 'الجلد والشعر: جلد مرن لامع خالٍ من القراد والتينيا والعقد الجلدية' },
    { id: 'c6', text: 'الذيل والروث: نظيف وجاف تحت الذيل وروث متماسك بدون آثار إسهال مدمم أو مائي' },
    { id: 'c7', text: 'الهيكل والامتلاء: ظهر عريض وصدر مفتوح وأرجل قوية (مش كرش منفوخ بالماء)' },
    { id: 'c8', text: 'الحرارة والوثائق: حرارة طبيعية (~38.0–39.2°م) وتوافر رقم أذن أو سجل تحصين إن أمكن' }
  ];

  function calcWeight() {
    const g = parseFloat($('calc-girth').value) || 0;
    const l = parseFloat($('calc-length').value) || 0;
    const yld = parseFloat($('calc-yield-type').value) || 0.55;
    const w = (g * g * l) / 10840;
    const minW = w * 0.95;
    const maxW = w * 1.05;
    const carcass = w * yld;
    const dmi = w * 0.025;
    $('out-weight').innerHTML = `
      <div class="kpi-row">
        <div class="kpi-box"><span class="k-lbl">الوزن القائم التقديري</span><span class="k-val">${w.toFixed(1)} كجم</span></div>
        <div class="kpi-box"><span class="k-lbl">النطاق (±5%)</span><span class="k-val">${minW.toFixed(0)} – ${maxW.toFixed(0)} كجم</span></div>
        <div class="kpi-box"><span class="k-lbl">اللحم الصافي المتوقع</span><span class="k-val">${carcass.toFixed(1)} كجم</span></div>
        <div class="kpi-box"><span class="k-lbl">احتياج DM تقريبي (2.5%)</span><span class="k-val">${dmi.toFixed(2)} كجم/ي</span></div>
      </div>`;
  }

  function calcWater() {
    const bw = parseFloat($('calc-w-bw').value) || 300;
    const n = parseFloat($('calc-w-heads').value) || 20;
    const ceti = parseFloat($('calc-w-temp').value) || 32;
    const sbw = 0.96 * bw;
    const perHead = Math.max(5, 7.3 + 0.0805 * sbw - 0.00008 * sbw * sbw - 1.225 * ceti + 0.0411 * ceti * ceti + 0.0023268 * sbw * ceti);
    const total = perHead * n;
    const tank = Math.ceil((total * 2) / 100) * 100;
    $('out-water').innerHTML = `
      <div class="kpi-row">
        <div class="kpi-box"><span class="k-lbl">احتياج الرأس يوميًا</span><span class="k-val">${perHead.toFixed(1)} لتر</span></div>
        <div class="kpi-box"><span class="k-lbl">إجمالي القطيع يوميًا</span><span class="k-val">${Math.round(total).toLocaleString('en-US')} لتر</span></div>
        <div class="kpi-box"><span class="k-lbl">خزان مظلل (احتياطي يومين)</span><span class="k-val">${tank.toLocaleString('en-US')} لتر</span></div>
      </div>`;
  }

  function calcFinance() {
    const n = Math.max(1, parseFloat($('f-heads').value) || 20);
    const wStart = parseFloat($('f-wstart').value) || 200;
    const wEnd = parseFloat($('f-wend').value) || 425;
    const adg = Math.max(0.3, parseFloat($('f-adg').value) || 1.25);
    const pBuy = parseFloat($('f-pbuy').value) || 215;
    const pSell = parseFloat($('f-psell').value) || 185;
    const feedDay = parseFloat($('f-feed').value) || 105.5;
    const mortPct = Math.min(50, Math.max(0, parseFloat($('f-mort').value) || 0)) / 100;
    const workers = parseFloat($('f-workers').value) || 0;
    const wage = parseFloat($('f-wage').value) || 0;
    const vetTrans = parseFloat($('f-vet').value) || 0;
    const capexHead = parseFloat($('f-capex').value) || 0;

    const days = Math.max(1, Math.round((wEnd - wStart) / adg));
    const months = days / 30;
    const totalCapex = n * capexHead;
    const fixedCycle = totalCapex * 0.065;
    const calfCost = n * wStart * pBuy;
    const surv = n * (1 - mortPct);
    const avgFed = n * (1 - mortPct / 2);
    const feedCost = avgFed * days * feedDay;
    const otherVar = n * vetTrans + workers * wage * months + n * days * 2.5;
    const workingCap = calfCost + feedCost + otherVar;
    const totalCost = workingCap + fixedCycle;
    const totalKgSold = surv * wEnd;
    const revenue = totalKgSold * pSell;
    const netProfit = revenue - totalCost;
    const profitPerHead = netProfit / n;
    const gainKg = Math.max(1, surv * (wEnd - wStart));
    const costPerKgGain = (totalCost - calfCost) / gainKg;
    const breakeven = totalCost / Math.max(1, totalKgSold);
    const roiWork = (netProfit / Math.max(1, workingCap)) * 100;

    const fmt = (v) => Math.round(v).toLocaleString('en-US');
    const cls = netProfit >= 0 ? 'success' : 'danger';

    $('out-fin').innerHTML = `
      <div class="kpi-row">
        <div class="kpi-box"><span class="k-lbl">مدة الدورة التقديرية</span><span class="k-val">${days} يومًا</span></div>
        <div class="kpi-box"><span class="k-lbl">رأس المال التشغيلي</span><span class="k-val">${fmt(workingCap)} ج</span></div>
        <div class="kpi-box"><span class="k-lbl">إجمالي التكاليف</span><span class="k-val">${fmt(totalCost)} ج</span></div>
        <div class="kpi-box"><span class="k-lbl">إجمالي الإيرادات</span><span class="k-val">${fmt(revenue)} ج</span></div>
        <div class="kpi-box ${cls}"><span class="k-lbl">صافي الربح للدورة</span><span class="k-val">${fmt(netProfit)} ج</span></div>
        <div class="kpi-box ${cls}"><span class="k-lbl">صافي ربح الرأس</span><span class="k-val">${fmt(profitPerHead)} ج</span></div>
        <div class="kpi-box"><span class="k-lbl">تكلفة كجم الزيادة</span><span class="k-val">${costPerKgGain.toFixed(1)} ج</span></div>
        <div class="kpi-box ${pSell < breakeven ? 'danger' : 'success'}"><span class="k-lbl">نقطة التعادل (أقل بيع)</span><span class="k-val">${breakeven.toFixed(1)} ج/كجم</span></div>
        <div class="kpi-box ${cls}"><span class="k-lbl">العائد التشغيلي</span><span class="k-val">${roiWork.toFixed(1)}%</span></div>
      </div>
      ${netProfit < 0 ? '<p style="color:var(--danger);font-weight:800;margin:10px 0 0">⚠️ تحذير: بهذه الأسعار المشروع خاسر! يجب خفض سعر الشراء أو تكلفة العلف أو استهداف سعر بيع أعلى من نقطة التعادل.</p>' : ''}
    `;
  }

  function initChecklist() {
    const saved = JSON.parse(localStorage.getItem('farm_market_check') || '{}');
    const wrap = $('market-checklist');
    wrap.innerHTML = '';

    CHECKLIST_ITEMS.forEach((item) => {
      const lbl = document.createElement('label');
      lbl.className = 'check-item' + (saved[item.id] ? ' checked' : '');
      lbl.innerHTML = `<input type="checkbox" data-cid="${item.id}" ${saved[item.id] ? 'checked' : ''} /><span>${item.text}</span>`;
      lbl.querySelector('input').addEventListener('change', (e) => {
        saved[item.id] = e.target.checked;
        lbl.classList.toggle('checked', e.target.checked);
        localStorage.setItem('farm_market_check', JSON.stringify(saved));
        updateChecklistScore(saved);
      });
      wrap.appendChild(lbl);
    });
    updateChecklistScore(saved);

    $('btn-reset-check').addEventListener('click', () => {
      localStorage.removeItem('farm_market_check');
      initChecklist();
    });
  }

  function updateChecklistScore(saved) {
    const count = CHECKLIST_ITEMS.filter((x) => saved[x.id]).length;
    const total = CHECKLIST_ITEMS.length;
    let verdict = 'ارفض الصفقة أو استعن بطبيب بيطري — فيه علامات ناقصة خطيرة.';
    let color = 'var(--danger)';
    if (count === total) {
      verdict = '✅ عجل ممتاز ومطابق لكل المعايير — توكل على الله وتفاوض على السعر بالوزن.';
      color = 'var(--success)';
    } else if (count >= 6) {
      verdict = '⚠️ عجل مقبول مبدئيًا — راجع البندين الناقصين بدقة قبل ما تدفع عربون.';
      color = 'var(--accent)';
    }
    $('out-check').innerHTML = `<strong style="color:${color}">النتيجة: ${count} / ${total} — ${verdict}</strong>`;
  }

  /* ---------- 9. PWA والأوفلاين وتصدير ملف HTML واحد مستقل ---------- */
  function initOfflinePWA() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      $('btn-install').hidden = false;
    });

    $('btn-install').addEventListener('click', async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      $('btn-install').hidden = true;
    });

    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('./sw.js').then((reg) => {
        reg.update().catch(() => {});
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              nw.postMessage({ type: 'SKIP_WAITING' });
              showToast('🔄 تم تنزيل تحديث جديد للتطبيق — أعد تحميل الصفحة أو اضغط «تحديث / أوفلاين».', 4500);
            }
          });
        });
      }).catch(() => {});

      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'OFFLINE_READY') {
          $('offline-label').textContent = 'محدّث وأوفلاين ✓';
          showToast(`✅ تم تحديث وحفظ ${event.data.saved} ملفًا على موبايلك — تقدر تقفل النت وتشتغل أوفلاين تمامًا!`, 4200);
        }
      });
    }

    const triggerOfflineSave = async () => {
      if (location.protocol === 'file:') {
        showToast('💡 أنت فاتح الموقع محليًا من ملفات الجهاز بالفعل — تقدر تستخدم زرار «ملف واحد» لتصدير نسخة مستقلة.', 4200);
        return;
      }
      if (!('serviceWorker' in navigator)) {
        showToast('المتصفح لا يدعم Service Worker — استخدم زرار «ملف واحد» للتحميل أوفلاين.', 4000);
        return;
      }
      showToast('⏳ جاري فحص التحديثات وحفظ كل التقارير والبيانات على موبايلك...', 2800);
      const reg = await navigator.serviceWorker.ready;
      try {
        await reg.update();
        if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      } catch (_) {}
      const reportUrls = (window.REPORTS_INDEX || []).map((r) => r.file);
      const targetSw = reg.active || reg.waiting || reg.installing;
      if (targetSw) {
        targetSw.postMessage({ type: 'CACHE_ALL_OFFLINE', urls: reportUrls });
      }
    };

    $('btn-offline').addEventListener('click', triggerOfflineSave);
    $('hero-offline-btn').addEventListener('click', triggerOfflineSave);
  }

  async function exportSingleFile() {
    if (!currentReport) return;
    showToast('⏳ جاري تجهيز ملف HTML واحد مستقل يعمل أوفلاين...');

    // جلب CSS لتضمينه بالكامل جوه الملف المستقل
    let cssText = '';
    try {
      const res = await fetch('./css/style.css');
      if (res.ok) cssText = await res.text();
    } catch (_) {
      try {
        for (const sheet of document.styleSheets) {
          for (const rule of sheet.cssRules) cssText += rule.cssText + '\n';
        }
      } catch (__) {
        cssText = 'body{font-family:Tahoma,Arial,sans-serif;direction:rtl;background:#f7f6f1;color:#1f251e;line-height:1.8;padding:18px;max-width:920px;margin:auto}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:8px;text-align:right}th{background:#2d5a27;color:#fff}.term{background:#fff5e6;color:#b8660b;border:none;border-bottom:2px dashed #b8660b;cursor:pointer;font-weight:700;padding:0 4px}.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px}.popup-sheet{background:#fff;padding:20px;border-radius:16px;max-width:520px;width:100%}[hidden]{display:none!important}';
      }
    }

    const glossaryJson = JSON.stringify(currentReport.glossary || {}).replace(/</g, '\\u003c');
    const bodyHtml = $('report-body').innerHTML;
    const headerHtml = $('report-header-card').innerHTML;
    const tocHtml = $('toc-list').innerHTML;

    const standaloneHtml = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(currentReport.title)} (نسخة أوفلاين)</title>
<style>${cssText}</style>
</head>
<body>
<header class="topbar">
  <div class="topbar-right">
    <button id="btn-toc" class="icon-btn">☰</button>
    <span class="brand-btn">🌿 نسخة أوفلاين مستقلة</span>
  </div>
  <div class="topbar-actions">
    <button id="btn-theme" class="icon-btn">🌙</button>
  </div>
</header>
<div class="reader-view">
  <div id="toc-backdrop" class="backdrop" hidden></div>
  <aside id="toc-sidebar" class="toc-sidebar">
    <div class="toc-header"><h3>فهرس الفصول</h3><button id="btn-close-toc" class="icon-btn small">✕</button></div>
    <nav class="toc-list">${tocHtml}</nav>
  </aside>
  <main class="reader-main">
    <div class="report-header-card">${headerHtml}</div>
    <div class="popup-hint-banner">💡 اضغط على أي مصطلح <span class="demo-term">ملوّن تحته خط متقطع</span> عشان يفتحلك الشرح بالعامية المصرية بدون إنترنت.</div>
    <article id="report-body" class="report-body">${bodyHtml}</article>
  </main>
</div>
<div id="popup-overlay" class="modal-overlay" hidden>
  <div class="popup-sheet">
    <div class="sheet-handle"></div>
    <div class="popup-header">
      <div><span class="popup-badge">شرح بالعامية المصرية 🇪🇬</span><h3 id="popup-title"></h3></div>
      <button id="btn-close-popup" class="icon-btn small">✕</button>
    </div>
    <div class="popup-body">
      <div class="popup-block baladi-block"><h4>🗣️ يعني إيه الكلام ده بالبلدي؟</h4><p id="popup-baladi"></p></div>
      <div class="popup-block impact-block"><h4>💰 تفرق معاك في إيه في المزرعة؟</h4><p id="popup-impact"></p></div>
    </div>
  </div>
</div>
<script>
const GLOSSARY=${glossaryJson};
const $=id=>document.getElementById(id);
document.addEventListener('click',e=>{
  const t=e.target.closest('.term');
  if(t && GLOSSARY[t.dataset.term]){
    const g=GLOSSARY[t.dataset.term];
    $('popup-title').textContent=g.title;
    $('popup-baladi').textContent=g.baladi;
    $('popup-impact').textContent=g.impact;
    $('popup-overlay').hidden=false;
  }
});
$('btn-close-popup').onclick=()=>$('popup-overlay').hidden=true;
$('popup-overlay').onclick=e=>{if(e.target===$('popup-overlay'))$('popup-overlay').hidden=true;};
$('btn-toc').onclick=()=>{$('toc-sidebar').classList.add('open');$('toc-backdrop').hidden=false;};
const closeT=()=>{$('toc-sidebar').classList.remove('open');$('toc-backdrop').hidden=true;};
$('btn-close-toc').onclick=closeT;$('toc-backdrop').onclick=closeT;
document.querySelectorAll('.toc-link').forEach(a=>a.onclick=closeT);
$('btn-theme').onclick=()=>{
  const n=document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark';
  document.documentElement.setAttribute('data-theme',n);
  $('btn-theme').textContent=n==='dark'?'☀️':'🌙';
};
</scr` + `ipt>
</body></html>`;

    const blob = new Blob([standaloneHtml], { type: 'text/html;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${currentReport.meta.id}-offline.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    showToast('✅ نزل الملف على جهازك — تقدر تفتحه أو تبعته واتساب ويشتغل أوفلاين بالبوب-أب!', 4000);
  }

  /* ---------- 10. تهيئة الأحداث عند تشغيل الصفحة ---------- */
  function init() {
    initTheme();
    updateConnectionUI();
    window.addEventListener('online', updateConnectionUI);
    window.addEventListener('offline', updateConnectionUI);

    renderLibrary();
    initOfflinePWA();

    // التنقل والأزرار
    $('btn-home').addEventListener('click', showLibrary);
    $('btn-back-home').addEventListener('click', showLibrary);
    $('btn-toc-home').addEventListener('click', showLibrary);
    $('btn-toc').addEventListener('click', openTOC);
    $('btn-close-toc').addEventListener('click', closeTOC);
    $('toc-backdrop').addEventListener('click', closeTOC);
    $('btn-export').addEventListener('click', exportSingleFile);

    // التبويبات
    document.querySelectorAll('.tab-btn').forEach((b) =>
      b.addEventListener('click', () => switchTab(b.dataset.tab))
    );

    // أزرار مشهد 3D
    document.querySelectorAll('.mode-btn[data-season]').forEach((b) => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.mode-btn[data-season]').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        if (window.BarnScene3D) window.BarnScene3D.setSeason(b.dataset.season);
      });
    });
    $('btn-reset-cam').addEventListener('click', () => window.BarnScene3D && window.BarnScene3D.resetCamera());
    $('btn-toggle-3d').addEventListener('click', () => {
      if (!window.BarnScene3D) return;
      if (window.BarnScene3D.isRunning()) {
        window.BarnScene3D.stop();
        $('btn-toggle-3d').textContent = '▶️ تشغيل الـ 3D';
      } else {
        window.BarnScene3D.start();
        $('btn-toggle-3d').textContent = '⏸️ إيقاف الـ 3D (توفير البطارية)';
      }
    });

    // الضغط على مصطلح بوب-أب داخل التقرير
    $('report-body').addEventListener('click', (e) => {
      const btn = e.target.closest('.term');
      if (btn) openTermPopup(btn.dataset.term);
    });
    $('btn-close-popup').addEventListener('click', () => { $('popup-overlay').hidden = true; });
    $('popup-overlay').addEventListener('click', (e) => {
      if (e.target === $('popup-overlay')) $('popup-overlay').hidden = true;
    });

    // القاموس
    $('btn-glossary').addEventListener('click', () => {
      $('glossary-overlay').hidden = false;
      $('glossary-search').focus();
    });
    $('btn-close-glossary').addEventListener('click', () => { $('glossary-overlay').hidden = true; });
    $('glossary-overlay').addEventListener('click', (e) => {
      if (e.target === $('glossary-overlay')) $('glossary-overlay').hidden = true;
    });
    $('glossary-search').addEventListener('input', (e) => renderGlossaryList(e.target.value));

    // إغلاق النوافذ بزر Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        $('popup-overlay').hidden = true;
        $('glossary-overlay').hidden = true;
        closeTOC();
      }
    });

    // البحث جوه التقرير
    let searchTimer;
    $('report-search').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => runReportSearch(e.target.value), 250);
    });
    $('btn-next-hit').addEventListener('click', () => jumpToHit(currentHitIdx + 1));
    $('btn-prev-hit').addEventListener('click', () => jumpToHit(currentHitIdx - 1));
    $('btn-clear-search').addEventListener('click', () => {
      $('report-search').value = '';
      clearSearchHighlights();
    });

    // شريط تقدم القراءة وتحديث الفهرس النشط
    window.addEventListener('scroll', () => {
      if ($('reader-view').hidden) return;
      const docH = document.documentElement.scrollHeight - window.innerHeight;
      const pct = docH > 0 ? Math.min(100, Math.max(0, (window.scrollY / docH) * 100)) : 0;
      $('read-progress-bar').style.width = pct + '%';
      updateActiveTOC();
    }, { passive: true });

    // تهيئة حاسبات أدوات المزرعة
    ['calc-girth', 'calc-length', 'calc-yield-type'].forEach((id) =>
      $(id).addEventListener('input', calcWeight)
    );
    ['calc-w-bw', 'calc-w-heads', 'calc-w-temp'].forEach((id) =>
      $(id).addEventListener('input', calcWater)
    );
    ['f-heads', 'f-wstart', 'f-wend', 'f-adg', 'f-pbuy', 'f-psell', 'f-feed', 'f-mort', 'f-workers', 'f-wage', 'f-vet', 'f-capex'].forEach((id) =>
      $(id).addEventListener('input', calcFinance)
    );
    calcWeight();
    calcWater();
    calcFinance();
    initChecklist();

    // فتح تقرير مباشر لو الرابط فيه #id
    const hashId = location.hash.replace('#', '');
    if (hashId) {
      const found = (window.REPORTS_INDEX || []).find((r) => r.id === hashId);
      if (found) openReport(found);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();