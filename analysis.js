/**
 * Basira's deterministic CSV and lightweight text inspection helpers.
 * No network requests, AI calls, or external libraries.
 */

const MAX_PREVIEW_ROWS = 8;
const fmt = n => new Intl.NumberFormat('ar-SA', { maximumFractionDigits: 3 }).format(n);

export function detectDelimiter(text) {
  const line = (text.replace(/^\uFEFF/, '').split(/\r?\n/).find(x => x.trim()) || '').slice(0, 8000);
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      if (quoted && line[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted && Object.prototype.hasOwnProperty.call(counts, line[i])) counts[line[i]]++;
  }
  return Object.entries(counts).sort((a,b) => b[1] - a[1])[0][1] ? Object.entries(counts).sort((a,b) => b[1] - a[1])[0][0] : ',';
}

export function parseCSV(text, delimiter = detectDelimiter(text)) {
  if (typeof text !== 'string') throw new TypeError('النص ليس صالحًا');
  text = text.replace(/^\uFEFF/, '');
  if (!text.trim()) throw new Error('الملف فارغ');
  const output = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else if (quoted) quoted = false;
      else if (!field.trim()) { field = ''; quoted = true; }
      else field += c;
    } else if (c === delimiter && !quoted) {
      row.push(field); field = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(x => x.trim())) output.push(row);
      row = [];
    } else { field += c; }
  }
  if (quoted) throw new Error('يوجد حقل بعلامات اقتباس غير مغلقة في CSV');
  row.push(field);
  if (row.some(x => x.trim())) output.push(row);
  if (!output.length) throw new Error('لم يتم العثور على صفوف');
  const head = output.shift();
  const used = new Set();
  const headers = head.map((raw, i) => {
    const base = raw.trim() || `عمود ${i+1}`;
    let name = base, j = 2;
    while (used.has(name)) name = `${base} (${j++})`;
    used.add(name);
    return name;
  });
  if (headers.length > 150) throw new Error('عدد الأعمدة كبير جدًا للنسخة الأولية');
  const rows = output.map((parts) => Object.fromEntries(headers.map((h,i) => [h, (parts[i] ?? '').trim()])));
  return {headers, rows, delimiter};
}

export function numericValue(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  let s = raw.trim().replace(/[٠-٩]/g, c => String(c.charCodeAt(0)-0x660))
    .replace(/[۰-۹]/g, c => String(c.charCodeAt(0)-0x6f0))
    .replaceAll('٬','').replaceAll('٫','.');
  if (!s || /^(-|n\/a|null|na|undefined)$/i.test(s)) return null;
  if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?%?$/.test(s)) s=s.replaceAll(',','');
  if (!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?%?$/i.test(s)) return null;
  const n = Number(s.endsWith('%') ? s.slice(0,-1) : s);
  return Number.isFinite(n) ? n : null;
}

function median(sorted) {
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length/2);
  return sorted.length%2 ? sorted[mid] : (sorted[mid-1]+sorted[mid])/2;
}
function quartiles(sorted) {
  const n=sorted.length;
  const half=Math.floor(n/2);
  return [median(sorted.slice(0,half)),median(sorted.slice(n%2?half+1:half))];
}
function covariancePairs(rows, a,b) {
  const pairs = rows.map(r=>[numericValue(r[a]),numericValue(r[b])]).filter(x=>x.every(v=>v!==null));
  if (pairs.length<3) return null;
  const mA=pairs.reduce((s,p)=>s+p[0],0)/pairs.length;
  const mB=pairs.reduce((s,p)=>s+p[1],0)/pairs.length;
  const num=pairs.reduce((s,p)=>s+(p[0]-mA)*(p[1]-mB),0);
  const d1=Math.sqrt(pairs.reduce((s,p)=>s+(p[0]-mA)**2,0));
  const d2=Math.sqrt(pairs.reduce((s,p)=>s+(p[1]-mB)**2,0));
  return d1*d2>0?{n:pairs.length,r:num/(d1*d2)}:null;
}

export function analyzeCSV(text, filename='data.csv') {
  const {headers, rows, delimiter} = parseCSV(text);
  const rowCount=rows.length;
  if (!rowCount) throw new Error('يوجد عنوان الأعمدة فقط، دون أي بيانات');
  const numeric = [], categorical=[], nullCounts=[];
  for (const header of headers) {
    const original=rows.map(r => r[header]);
    const present=original.filter(v => v !== '');
    const numbers=present.map(numericValue).filter(v => v !== null);
    nullCounts.push({column:header, missing:rowCount-present.length});
    if (present.length && numbers.length/present.length >= .85) {
      const sorted=[...numbers].sort((a,b)=>a-b);
      const mean=numbers.reduce((a,b)=>a+b,0)/numbers.length;
      const variance=numbers.reduce((a,b)=>a+(b-mean)**2,0)/(numbers.length>1 ? numbers.length-1 : 1);
      const [q1,q3]=quartiles(sorted);
      const iqr=(q3??0)-(q1??0);
      const outliers=iqr ? numbers.filter(n=>n<(q1-1.5*iqr)||n>(q3+1.5*iqr)).length : 0;
      numeric.push({column:header,count:numbers.length,invalid:present.length-numbers.length,missing:rowCount-present.length,mean,median:median(sorted),min:sorted[0],max:sorted.at(-1),stddev:Math.sqrt(variance),q1,q3,outliers});
    } else {
      const counts=new Map();
      for (const v of present) counts.set(v,(counts.get(v)||0)+1);
      const top=[...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([value,count])=>({value,count}));
      categorical.push({column:header,unique:counts.size,missing:rowCount-present.length,top});
    }
  }
  const relations=[];
  const numericNames=numeric.slice(0,6).map(x=>x.column);
  for(let i=0;i<numericNames.length;i++)for(let j=i+1;j<numericNames.length;j++){
    const corr=covariancePairs(rows,numericNames[i],numericNames[j]);
    if(corr)relations.push({a:numericNames[i],b:numericNames[j],...corr});
  }
  relations.sort((a,b)=>Math.abs(b.r)-Math.abs(a.r));
  const duplicates = rowCount - new Set(rows.map(r=>JSON.stringify(headers.map(h=>r[h])))).size;
  const lines = [
    `تقرير بيانات موثّق بالحسابات — ${filename}`,
    `عدد السجلات: ${fmt(rowCount)} | الأعمدة: ${fmt(headers.length)} | مكرر بالكامل: ${fmt(duplicates)} | الفاصل: ${delimiter==='\t'?'Tab':delimiter}`,
    '', 'الحقول العددية:'
  ];
  if (!numeric.length) lines.push('لم أتعرف على أي عمود عددي موثوق.');
  for (const c of numeric) {
    lines.push(`• ${c.column}: عدد صالح=${fmt(c.count)}، مفقود=${fmt(c.missing)}، متوسط=${fmt(c.mean)}، وسيط=${fmt(c.median)}، أدنى=${fmt(c.min)}، أعلى=${fmt(c.max)}، انحراف معياري للعينة=${fmt(c.stddev)}، قيم شاذة بطريقة IQR=${fmt(c.outliers)}.`);
    if (c.invalid) lines.push(`  تنبيه: ${fmt(c.invalid)} قيمة غير رقمية بين الخانات غير الفارغة.`);
  }
  lines.push('', 'الحقول التصنيفية:');
  if (!categorical.length) lines.push('لا توجد حقول تصنيفية.');
  for (const c of categorical) lines.push(`• ${c.column}: ${fmt(c.unique)} قيمة مميزة، مفقود=${fmt(c.missing)}؛ الأكثر تكرارًا: ${c.top.map(t=>`${t.value.slice(0,35)} (${fmt(t.count)})`).join('، ')||'لا شيء'}.`);
  if (relations.length) {
    lines.push('', 'أقوى علاقات ارتباط بيرسون (الارتباط لا يثبت السببية):');
    for (const c of relations.slice(0,5)) lines.push(`• ${c.a} ↔ ${c.b}: r = ${c.r.toFixed(3)}, الأزواج=${fmt(c.n)}.`);
  }
  lines.push('', 'تنبيه منهجي: النتائج وصفية وليست استنتاجًا سببيًا. يجب فحص مصدر البيانات والقيم المفقودة قبل اتخاذ قرار مهم.');
  return {
    kind:'csv', filename, headers,rowCount,duplicateRows:duplicates,numeric,categorical,correlations:relations,
    report:lines.join('\n'),
    preview: rows.slice(0,MAX_PREVIEW_ROWS).map(r => Object.fromEntries(headers.slice(0,12).map(h=>[h,r[h]])))
  };
}

const codeExts = new Set(['js','jsx','ts','tsx','py','swift','html','css','sql','json','yml','yaml']);

export function analyzeText(text, filename='file.txt') {
  if (typeof text !== 'string') throw new TypeError('يجب توفير نص');
  const ext = filename.split('.').pop().toLowerCase();
  const lines=text.split(/\r?\n/);
  const findings=[];
  const checks=[
    {test:/\b(TODO|FIXME|HACK)\b/i, message:'ملاحظة مؤجلة أو TODO'},
    {test:/\b(eval\s*\(|exec\s*\()/i, message:'استدعاء eval/exec قد يكون غير آمن مع المدخلات غير الموثوقة'},
    {test:/\binnerHTML\s*=/, message:'innerHTML قد يفتح ثغرات XSS إذا استُخدم مع مدخلات غير موثوقة'},
    {test:/\bconsole\.log\s*\(|\bprint\s*\(/, message:'طباعة/تصحيح: راجع أن الرسائل لا تسرب بيانات حساسة'},
    {test:/\bexcept\s*:\s*pass\b/, message:'تجاهل استثناء بدون معالجته'},
    {test:/\bpassword\s*[:=]\s*["'][^"']{4,}["']|\bapi[_-]?key\s*[:=]\s*["'][^"']{6,}["']/i, message:'قد يوجد سر ثابت داخل الملف: لا تشاركه أو تحتفظ به داخل الشيفرة'}
  ];
  if (codeExts.has(ext)) for(let i=0;i<lines.length;i++){
    for(const check of checks) if(check.test.test(lines[i])) findings.push({line:i+1,detail:check.message});
  }
  if(ext==='json')try{JSON.parse(text);}catch(e){findings.push({line:null,detail:`JSON غير صالح: ${e.message}`});}
  const report=[
    `فحص أوّلي للملف: ${filename}`,
    `عدد الأسطر: ${lines.length} | عدد الأحرف: ${text.length} | نوع الملف: ${ext}`,
    ...findings.slice(0,35).map(f=>`• ${f.line?'السطر '+f.line+': ':''}${f.detail}`),
    findings.length>35?`تم اختصار ${findings.length-35} ملاحظة إضافية.`:'',
    'تنبيه: هذه فحوصات شكلية محدودة وليست تشغيلًا للكود أو اختبار أمان شاملًا.'
  ].filter(Boolean).join('\n');
  return {kind:'text',filename,lineCount:lines.length,findings,report, preview:text.slice(0,12000)};
}
