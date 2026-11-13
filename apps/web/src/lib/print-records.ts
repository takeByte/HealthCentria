import type { MedicalProfile, PatientVisit } from './api';

/**
 * Opens a clean, print-ready copy of a patient's records in a new window so
 * they can print it or choose "Save as PDF" in the browser's print dialog.
 * Built from plain HTML (every value escaped) so it never depends on the app's
 * styles and carries no scripts of its own.
 */

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function ymd(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return '';
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString('en-PH', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function list(items: string[]): string {
  return items.length ? esc(items.join(', ')) : '<span class="muted">None recorded</span>';
}

function block(text: string): string {
  return text.trim() ? esc(text).replace(/\n/g, '<br>') : '<span class="muted">—</span>';
}

export interface PrintableRecords {
  patientName: string;
  birthdate?: string;
  sex?: string;
  medical: MedicalProfile | null;
  visits: PatientVisit[];
  /** Short note about any filter applied, e.g. "Year 2026 · Service: Prenatal". */
  filterNote?: string;
}

/** Returns false when the browser blocked the new window. */
export function printRecords(data: PrintableRecords): boolean {
  const win = window.open('', '_blank');
  if (!win) return false;

  const m = data.medical;
  const generated = new Date().toLocaleString('en-PH', { dateStyle: 'long', timeStyle: 'short' });

  const medicalHtml = m
    ? `<h2>Medical profile</h2>
       <table class="facts">
         <tr><th>Blood type</th><td>${m.bloodType ? esc(m.bloodType) : '<span class="muted">Not recorded</span>'}</td></tr>
         <tr><th>Allergies</th><td>${list(m.allergies)}</td></tr>
         <tr><th>Conditions</th><td>${list(m.conditions)}</td></tr>
         <tr><th>Medications</th><td>${list(m.medications)}</td></tr>
         <tr><th>Immunizations</th><td>${
           m.immunizations.length
             ? m.immunizations
                 .map((v) => esc([v.name, ymd(v.date), v.note].filter(Boolean).join(' — ')))
                 .join('<br>')
             : '<span class="muted">None recorded</span>'
         }</td></tr>
       </table>`
    : '';

  const visitsHtml = data.visits.length
    ? data.visits
        .map((v) => {
          const service = typeof v.service === 'object' ? v.service.name : 'Service';
          return `<section class="visit">
            <h3>${esc(service)} <span class="muted">· ${esc(ymd(v.day))}</span></h3>
            <p><strong>Diagnosis:</strong> ${block(v.diagnosis)}</p>
            <p><strong>Prescription:</strong> ${block(v.prescription)}</p>
            ${v.visitNotes.trim() ? `<p><strong>Visit notes:</strong> ${block(v.visitNotes)}</p>` : ''}
          </section>`;
        })
        .join('')
    : '<p class="muted">No completed visits to show.</p>';

  const subtitle = [data.birthdate ? `Born ${ymd(data.birthdate)}` : '', data.sex || ''].filter(Boolean).join(' · ');

  win.document.open();
  win.document.write(`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Medical record — ${esc(data.patientName)}</title>
<style>
  body{font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#0f172a;margin:32px auto;max-width:760px;padding:0 20px}
  header{border-bottom:2px solid #0f766e;padding-bottom:10px;margin-bottom:18px}
  header .org{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#0f766e;font-weight:700}
  h1{font-size:22px;margin:4px 0 0}
  h2{font-size:15px;margin:22px 0 8px;color:#134e4a}
  h3{font-size:14px;margin:0 0 4px}
  .muted{color:#64748b;font-weight:400}
  .facts{border-collapse:collapse;width:100%}
  .facts th{text-align:left;width:150px;vertical-align:top;padding:6px 10px 6px 0;color:#475569;font-weight:600}
  .facts td{padding:6px 0;border-bottom:1px solid #e2e8f0}
  .visit{border:1px solid #cbd5e1;border-radius:8px;padding:10px 14px;margin:0 0 10px;break-inside:avoid}
  .visit p{margin:3px 0}
  footer{margin-top:26px;font-size:11.5px;color:#64748b;border-top:1px solid #e2e8f0;padding-top:8px}
  @media print{body{margin:0}}
</style></head><body>
<header>
  <div class="org">HealthCentria · Brgy. 11 Health Center</div>
  <h1>${esc(data.patientName)}</h1>
  ${subtitle ? `<div class="muted">${esc(subtitle)}</div>` : ''}
</header>
${medicalHtml}
<h2>Visit records${data.filterNote ? ` <span class="muted">(${esc(data.filterNote)})</span>` : ''}</h2>
${visitsHtml}
<footer>Printed ${esc(generated)}. This document contains personal health information. Keep it private.
These are the center's own notes and do not replace advice from your doctor.</footer>
</body></html>`);
  win.document.close();
  win.focus();
  // Give the new document a beat to lay out before the print dialog opens.
  window.setTimeout(() => win.print(), 250);
  return true;
}
