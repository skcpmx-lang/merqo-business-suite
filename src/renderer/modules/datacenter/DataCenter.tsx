/** Data center — backup & restore, CSV import with preview, CSV export,
 *  database integrity check. */
import { useRef, useState } from 'react';
import {
  DatabaseBackup, Download, Upload, ShieldCheck, RefreshCw, FileText, AlertTriangle, CheckCircle2, Lock
} from 'lucide-react';
import { useSession } from '../../lib/session';
import { useAsync } from '../../lib/useAsync';
import { api, errMsg, idemKey } from '../../lib/api';
import { FIELD_DEFINITIONS, type ImportEntity } from '@shared/importFields';
import type { Row, ImportPreviewResult, ImportResult } from '@shared/ipc';
import { Button, SelectInput, useToast, fmtDateTime, Bn, Tabs, ConfirmDialog, Empty } from '../../ui';

export function DataCenter() {
  const { user } = useSession();
  const token = user!.token;
  const [tab, setTab] = useState('backup');
  const [importEntity, setImportEntity] = useState<ImportEntity>('products');

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">ডেটা: ব্যাকআপ, ইমপোর্ট, এক্সপোর্ট</div>
          <div className="page-sub">সব ডেটা এই কম্পিউটারেই — নিরাপত্তার জন্য নিয়মিত ব্যাকআপ নিন</div>
        </div>
      </div>

      <Tabs
        tabs={[
          { key: 'backup', label: 'ব্যাকআপ ও পুনরুদ্ধার' },
          { key: 'import', label: 'ইমপোর্ট (CSV)' },
          { key: 'export', label: 'এক্সপোর্ট (CSV)' },
          { key: 'health', label: 'ডাটাবেস পরীক্ষা' }
        ]}
        active={tab}
        onChange={setTab}
      />
      <div style={{ height: 14 }} />

      {tab === 'backup' && <BackupPanel token={token} />}
      {tab === 'import' && <ImportPanel token={token} entity={importEntity} onEntity={(e) => setImportEntity(e)} />}
      {tab === 'export' && <ExportPanel token={token} />}
      {tab === 'health' && <HealthPanel token={token} />}
    </div>
  );
}

/* ---------------- backup ---------------- */

function BackupPanel({ token }: { token: string }) {
  const { can } = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState<Row | null>(null);
  const allowed = can('backup.create');
  const { data: backups, reload } = useAsync(
    allowed ? async () => (await api.backup.list(token)) as Row[] : (async () => []),
    [token, allowed]
  );
  const { data: dir } = useAsync(allowed ? async () => (await api.backup.directory(token)) as string : (async () => ''), [token, allowed]);

  if (!allowed) {
    return (
      <div className="card card-pad">
        <Empty
          title="ব্যাকআপের অধিকার নেই"
          sub="মালিক বা অনুমোদিত ব্যবহারকারীরা ব্যাকআপ নিতে/দেখতে পারবেন।"
          icon={<Lock size={22} />}
        />
      </div>
    );
  }

  async function create() {
    setBusy(true);
    try {
      const b = await api.backup.create(token, idemKey());
      toast('success', 'ব্যাকআপ তৈরি হয়েছে', String(b.file_name));
      reload();
    } catch (e) {
      toast('error', 'ব্যাকআপ তৈরি হয়নি', errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function verify(b: Row) {
    try {
      const r = await api.backup.verify(token, String(b.id));
      toast(r.ok ? 'success' : 'error', r.ok ? 'ব্যাকআপ সঠিক' : 'ব্যাকআপে সমস্যা', r.message);
      reload();
    } catch (e) {
      toast('error', 'যাচাই করা যায়নি', errMsg(e));
    }
  }

  return (
    <div>
      <div className="toolbar" style={{ marginBottom: 14 }}>
        <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--c-ink-2)' }}>
          ব্যাকআপ ফোল্ডার: <code style={{ background: 'var(--c-surface-2)', padding: '2px 8px', borderRadius: 6 }}>{dir}</code>
        </span>
        <div style={{ flex: 1 }} />
        {can('backup.create') && (
          <Button variant="primary" icon={<DatabaseBackup size={16} />} loading={busy} onClick={create}>
            এখন ব্যাকআপ নিন
          </Button>
        )}
      </div>

      {(backups ?? []).length === 0 ? (
        <div className="card card-pad">
          <Empty
            title="এখনো কোনো ব্যাকআপ নেই"
            sub="ব্যাকআপ মানে পুরো ডাটাবেসের এক কপি — পুনরুদ্ধার করলে সব হিসাব সেই সময়ের অবস্থায় ফিরে আসে।"
            icon={<DatabaseBackup size={22} />}
            action={can('backup.create') ? <Button variant="primary" onClick={create}>প্রথম ব্যাকআপ নিন</Button> : undefined}
          />
        </div>
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr><th>ফাইল</th><th>তৈরি হয়েছে</th><th>অবস্থা</th><th className="num">সাইজ</th><th></th></tr>
            </thead>
            <tbody>
              {(backups ?? []).map((b) => (
                <tr key={String(b.id)}>
                  <td><strong>{String(b.file_name)}</strong></td>
                  <td>{fmtDateTime((b.created_at as number) ?? null)}</td>
                  <td>
                    {b.status === 'verified' && <span className="badge badge-green"><CheckCircle2 size={11} /> যাচাই করা</span>}
                    {b.status === 'completed' && <span className="badge badge-blue">সম্পন্ন</span>}
                    {b.status === 'missing' && <span className="badge badge-red">ফাইল নেই</span>}
                    {b.status === 'failed' && <span className="badge badge-red">ত্রুটি</span>}
                    {b.status === 'deleted' && <span className="badge badge-gray">মুছে ফেলা</span>}
                  </td>
                  <td className="num">{Math.round(((b.size_bytes as number) ?? 0) / 1024 / 1024 * 10) / 10} MB</td>
                  <td>
                    <div className="tbl-row-actions">
                      <Button size="sm" variant="ghost" icon={<ShieldCheck size={13} />} onClick={() => void verify(b)}>যাচাই</Button>
                      {can('backup.restore') && (
                        <Button size="sm" variant="outline" onClick={() => setRestoring(b)}>পুনরুদ্ধার</Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {restoring && (
        <ConfirmDialog
          title="ব্যাকআপ থেকে পুনরুদ্ধার করবেন?"
          message={
            <>
              <p>
                <strong>{String(restoring.file_name)}</strong> — {fmtDateTime((restoring.created_at as number) ?? null)}
              </p>
              <p style={{ marginTop: 10, color: 'var(--c-danger)', fontWeight: 700 }}>
                সতর্কতা: বর্তমান সব ডেটা এই ব্যাকআপের অবস্থায় ফিরে যাবে। অ্যাপটি বন্ধ হয়ে আবার চালু হবে।
              </p>
            </>
          }
          confirmLabel="পুনরুদ্ধার করুন"
          danger
          onConfirm={async () => {
            try {
              const r = await api.backup.restore(token, String(restoring.id));
              setRestoring(null);
              if (r.restartRequired) {
                toast('warn', 'পুনরুদ্ধার সম্পন্ন — অ্যাপ এখন বন্ধ হবে', 'আবার চালু হলে ডেটা পুনরায় লোড হবে।');
              }
            } catch (e) {
              toast('error', 'পুনরুদ্ধার হয়নি', errMsg(e));
              setRestoring(null);
            }
          }}
          onClose={() => setRestoring(null)}
        />
      )}
    </div>
  );
}

/* ---------------- import ---------------- */

function ImportPanel({ token, entity, onEntity }: { token: string; entity: ImportEntity; onEntity: (e: ImportEntity) => void }) {
  const { can } = useSession();
  const toast = useToast();
  const allowed = can('imports.run');
  const [csv, setCsv] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [fieldMap, setFieldMap] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const defs = FIELD_DEFINITIONS[entity];

  function loadCsvText(text: string) {
    setCsv(text);
    setPreview(null);
    setResult(null);
    const firstLine = text.split(/\r?\n/)[0] ?? '';
    const hs = firstLine.split(',').map((h) => h.replace(/^"|"$/g, '').trim());
    setHeaders(hs);
    // auto-map by header name
    const map: Record<string, number> = {};
    hs.forEach((h, i) => {
      const def = defs.find((d) => d.label.toLowerCase() === h.toLowerCase() || d.key.toLowerCase() === h.toLowerCase());
      if (def) map[def.key] = i;
    });
    setFieldMap(map);
  }

  function readFile(f: File) {
    // Hard cap: importing multi-hundred-MB CSVs would freeze the renderer
    // (full file is parsed in memory). 25 MB ≈ 200k+ rows of products.
    if (f.size > 25 * 1024 * 1024) {
      toast('error', 'ফাইল খুব বড়', '২৫ মেগাবাইটের বেশি ফাইল ইমপোর্ট করা যায় না। ছোট করে আবার চেষ্টা করুন।');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      let text = String(reader.result ?? '');
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      loadCsvText(text);
    };
    reader.readAsText(f, 'utf-8');
  }

  async function doPreview() {
    if (!csv.trim()) return;
    setPreviewBusy(true);
    try {
      const p = await api.imports.preview(token, { entity, csv, fieldMap });
      setPreview(p);
    } catch (e) {
      toast('error', 'প্রিভিউ করা যায়নি', errMsg(e));
    } finally {
      setPreviewBusy(false);
    }
  }

  async function doImport() {
    setImporting(true);
    try {
      const r = await api.imports.execute(token, { entity, csv, fieldMap }, idemKey());
      setResult(r);
      setPreview(null);
      toast('success', 'ইমপোর্ট সম্পন্ন', `${r.imported}টি যোগ হয়েছে, ${r.failed}টি বাদ`);
    } catch (e) {
      toast('error', 'ইমপোর্ট হয়নি', errMsg(e));
    } finally {
      setImporting(false);
    }
  }

  const errorCount = preview?.errors.length ?? 0;
  const validCount = preview?.validRows ?? 0;

  return (
    <div>
      <div className="toolbar" style={{ marginBottom: 14 }}>
        <SelectInput value={entity} onChange={(e) => { onEntity(e.target.value as ImportEntity); setPreview(null); setCsv(''); setHeaders([]); setFieldMap({}); }} style={{ width: 170 }}>
          <option value="products">পণ্য</option>
          <option value="customers">কাস্টমার</option>
          <option value="suppliers">সাপ্লায়ার</option>
        </SelectInput>
        <Button icon={<FileText size={15} />} disabled={!allowed} onClick={() => fileRef.current?.click()}>CSV ফাইল বাছাই</Button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); e.currentTarget.value = ''; }} />
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--c-ink-3)' }}>প্রথম সারি হেডার হিসেবে ধরা হবে</span>
      </div>

      <div
        style={{
          border: `2px dashed ${dragOver ? 'var(--c-primary)' : 'var(--c-border-strong)'}`,
          borderRadius: 14,
          padding: 10,
          transition: 'border-color 120ms ease',
          background: dragOver ? 'var(--c-primary-soft)' : 'var(--c-surface-2)'
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) readFile(f);
        }}
      >
        <textarea
          className="textarea"
          style={{ minHeight: 130, fontFamily: 'Consolas, monospace', fontSize: 12 }}
          placeholder={'নাম,ফোন,বিক্রয় মূল্য\nচিপস,০১১১১১১১,৩০'}
          value={csv}
          onChange={(e) => {
            const v = e.target.value;
            setCsv(v);
            setPreview(null);
            const firstLine = v.split(/\r?\n/)[0] ?? '';
            setHeaders(firstLine ? firstLine.split(',').map((h) => h.replace(/^"|"$/g, '').trim()) : []);
          }}
        />
      </div>

      {csv && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
          <div className="card card-pad">
            <div className="card-title" style={{ fontSize: 'var(--fs-md)' }}>কলাম ম্যাপিং</div>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              {defs.map((d) => (
                <div className="field" key={d.key}>
                  <label>
                    {d.label} {d.required && <span style={{ color: 'var(--c-danger)' }}>*</span>}
                  </label>
                  <SelectInput value={fieldMap[d.key] ?? -1} onChange={(e) => {
                    const v = Number(e.target.value);
                    setFieldMap((m) => {
                      const n = { ...m };
                      if (v < 0) delete n[d.key];
                      else n[d.key] = v;
                      return n;
                    });
                  }}>
                    <option value={-1}>— নেই —</option>
                    {headers.map((h, i) => (
                      <option key={i} value={i}>{h || `কলাম ${i + 1}`}</option>
                    ))}
                  </SelectInput>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 14 }}>
              <Button variant="primary" icon={<Eye />} loading={previewBusy} disabled={!allowed} onClick={doPreview}>প্রিভিযু দেখুন</Button>
            </div>
          </div>

          {preview && (
            <div className="card card-pad" style={{ borderColor: errorCount ? 'var(--c-warn)' : 'var(--c-success)' }}>
              <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 12 }}>
                <strong>
                  <Bn>{preview.totalRows}</Bn> সারি — <span style={{ color: 'var(--c-success)' }}><Bn>{validCount}</Bn> সঠিক</span>
                  {errorCount > 0 && <span style={{ color: 'var(--c-warn)' }}> — <Bn>{errorCount}</Bn> ত্রুটি</span>}
                </strong>
                <div style={{ flex: 1 }} />
                <Button variant="primary" icon={<Upload size={15} />} loading={importing} disabled={!allowed || validCount === 0} onClick={doImport}>
                  <Bn>{validCount}</Bn>টি ইমপোর্ট করুন
                </Button>
              </div>
              {preview.errors.length > 0 && (
                <div style={{ background: 'var(--c-warn-soft)', borderRadius: 10, padding: '10px 14px', fontSize: 'var(--fs-sm)', color: 'var(--c-warn)', maxHeight: 150, overflow: 'auto' }}>
                  {preview.errors.slice(0, 20).map((e, i) => (
                    <div key={i}>সারি {e.row}: {e.field ? `${e.field} — ` : ''}{e.message}</div>
                  ))}
                  {preview.errors.length > 20 && <div style={{ marginTop: 4 }}>…আরো {preview.errors.length - 20}টি ত্রুটি</div>}
                </div>
              )}
              {preview.sample.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div className="table-wrap" style={{ borderRadius: 10, maxHeight: 200, overflow: 'auto' }}>
                    <table className="tbl">
                      <thead>
                        <tr>{Object.keys(preview.sample[0]).map((k) => <th key={k}>{k}</th>)}</tr>
                      </thead>
                      <tbody>
                        {preview.sample.slice(0, 5).map((r, i) => (
                          <tr key={i}>{Object.values(r).map((v, j) => <td key={j}>{String(v ?? '')}</td>)}</tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {result && (
            <div className="card card-pad" style={{ borderColor: 'var(--c-success)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--c-success)', fontWeight: 700 }}>
                <CheckCircle2 size={20} /> ইমপোর্ট সম্পন্ন: {result.imported}টি যোগ, {result.skipped}টি বাদ, {result.failed}টি ব্যর্থ
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Eye() {
  return <RefreshCw size={15} />;
}

/* ---------------- export ---------------- */

function ExportPanel({ token }: { token: string }) {
  const { can } = useSession();
  const toast = useToast();
  const allowed = can('exports.run');
  const [busy, setBusy] = useState<string | null>(null);

  async function doExport(entity: 'products' | 'customers' | 'suppliers' | 'sales' | 'purchases', label: string) {
    setBusy(entity);
    try {
      const csv = await api.exports.csv(token, entity);
      const path = await api.app.saveFile(`MERQO_${entity}_${new Date().toISOString().slice(0, 10)}.csv`, '\uFEFF' + csv);
      if (path) toast('success', `${label} এক্সপোর্ট হয়েছে`, path);
    } catch (e) {
      toast('error', 'এক্সপোর্ট হয়নি', errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const items: { key: 'products' | 'customers' | 'suppliers' | 'sales' | 'purchases'; label: string; sub: string }[] = [
    { key: 'products', label: 'পণ্য', sub: 'নাম, SKU, বারকোড, দাম, স্টক' },
    { key: 'customers', label: 'কাস্টমার', sub: 'নাম, ফোন, ঠিকানা, বকেয়া' },
    { key: 'suppliers', label: 'সাপ্লায়ার', sub: 'নাম, ফোন, ঠিকানা, প্রদেয়' },
    { key: 'sales', label: 'বিক্রয়ের বিল', sub: 'রেফারেন্স, তারিখ, পণ্য, মোট' },
    { key: 'purchases', label: 'ক্রয়ের বিল', sub: 'রেফারেন্স, তারিখ, সাপ্লায়ার, মোট' }
  ];

  return (
    <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
      {items.map((it) => (
        <div key={it.key} className="card card-pad" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div className="empty-icon" style={{ flex: 'none' }}><Download size={18} /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 'var(--fs-md)' }}>{it.label}</div>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--c-ink-3)' }}>{it.sub}</div>
          </div>
          <Button variant="outline" icon={<Download size={15} />} loading={busy === it.key} disabled={!allowed} onClick={() => void doExport(it.key, it.label)}>
            CSV
          </Button>
        </div>
      ))}
      <div className="card card-pad" style={{ gridColumn: '1 / -1', background: 'var(--c-surface-2)' }}>
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--c-ink-2)', lineHeight: 1.6 }}>
          এক্সপোর্ট করা ফাইল স্ট্যান্ডার্ড CSV — Excel/Google Sheets-এ খুলতে পারবেন। পরে “ইমপোর্ট” ট্যাব থেকে পণ্য/কাস্টমার/সাপ্লায়ার আবার
          এনে নিতে পারবেন।
        </p>
      </div>
    </div>
  );
}

/* ---------------- health ---------------- */

function HealthPanel({ token }: { token: string }) {
  const { data, reload } = useAsync(async () => await api.app.integrity(), [token]);
  const { data: info } = useAsync(async () => await api.app.info(), []);
  if (!data) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
        <div className="spinner" />
      </div>
    );
  }
  return (
    <div className="card card-pad" style={{ maxWidth: 640 }}>
      <div className="card-title">
        {data.ok ? <CheckCircle2 size={18} style={{ color: 'var(--c-success)' }} /> : <AlertTriangle size={18} style={{ color: 'var(--c-danger)' }} />}
        ডাটাবেসের স্বাস্থ্য
      </div>
      {data.ok ? (
        <p style={{ fontSize: 'var(--fs-md)', color: 'var(--c-success)', fontWeight: 700 }}>
          সব পরীক্ষা পাশ — ডাটাবেস সঠিক অবস্থায় আছে।
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <p style={{ fontSize: 'var(--fs-md)', color: 'var(--c-danger)', fontWeight: 700 }}>সমস্যা পাওয়া গেছে:</p>
          {data.issues.map((i, n) => (
            <div key={n} style={{ fontSize: 'var(--fs-sm)', fontFamily: 'monospace', background: 'var(--c-danger-soft)', borderRadius: 8, padding: '8px 10px', color: 'var(--c-danger)' }}>
              {i}
            </div>
          ))}
          <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--c-ink-2)' }}>সবচেয়ে সাম্প্রতিক ব্যাকআপ থেকে পুনরুদ্ধার করার পরামর্শ দেওয়া হচ্ছে।</p>
        </div>
      )}
      <div className="divider" />
      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--c-ink-2)', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span>সফটওয়্যার সংস্করণ: <strong>{info?.version}</strong></span>
        <span>স্কিমা সংস্করণ: <strong>{info?.schemaVersion}</strong></span>
        <span>ডেটা ফোল্ডার: <code style={{ background: 'var(--c-surface-2)', padding: '2px 6px', borderRadius: 5 }}>{info?.dataDirectory}</code></span>
      </div>
      <div style={{ marginTop: 14 }}>
        <Button variant="outline" icon={<RefreshCw size={15} />} onClick={reload}>আবার পরীক্ষা করুন</Button>
      </div>
    </div>
  );
}
