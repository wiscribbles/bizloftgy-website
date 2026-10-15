/**
 * The Business Loft — registration and incorporation intake.
 *
 * Paste this into Extensions → Apps Script of the private Google Sheet
 * "The Business Loft — Applications". The website's server posts each
 * application here (Netlify functions /api/registration and /api/incorporation).
 * This script:
 *   1. checks the shared secret, so only our website can add rows;
 *   2. saves the uploaded documents in a private Drive folder,
 *      one sub-folder per application;
 *   3. adds one row to the "Business registrations" or "Company incorporations" tab;
 *   4. emails a short notice (no ID or TIN numbers) to NOTIFY_EMAIL.
 *
 * Script properties (Project Settings → Script properties):
 *   SHARED_SECRET  the same long random value as GOOGLE_SCRIPT_SECRET in Netlify
 *   FOLDER_ID      the ID of the private Drive folder for uploads
 *   NOTIFY_EMAIL   optional, e.g. support@bizloftgy.com
 *
 * Deploy → New deployment → Web app → Execute as: Me; Who has access: Anyone.
 * "Anyone" is required so our server can reach it; the secret keeps everyone else out.
 * After editing this code: Deploy → Manage deployments → Edit → New version (same URL).
 */

var FORMS = {
  business_name: {
    sheet: 'Business registrations',
    title: 'Business Registration package',
    nameKey: 'applicant_name',
    files: ['application', 'authorization', 'id_doc', 'tin_cert'],
    columns: [
      ['ref', 'Reference'],
      ['submitted_at', 'Submitted (UTC)'],
      ['status', 'Status'],
      ['applicant_name', 'Applicant'],
      ['phone', 'Contact numbers'],
      ['email', 'Email'],
      ['plan_name', 'Package / sign-up plan'],
      ['principal_place', 'Principal place of business'],
      ['application_url', 'Business Registration Application Form'],
      ['authorization_url', 'Bizloft Authorization Form'],
      ['id_doc_url', 'ID / passport'],
      ['tin_cert_url', 'TIN certificate'],
      ['folder_url', 'Upload folder'],
    ],
  },
  company: {
    sheet: 'Company incorporations',
    title: 'company incorporation',
    nameKey: 'company_name',
    files: ['p1_id', 'p2_id', 'p3_id', 'p4_id', 'p5_id'],
    columns: (function () {
      var cols = [
        ['ref', 'Reference'],
        ['submitted_at', 'Submitted (UTC)'],
        ['status', 'Status'],
        ['company_name', 'Proposed company name'],
        ['company_name_alt', 'Alternative name'],
        ['nature', 'Nature of the business'],
        ['registered_office', 'Registered office'],
        ['bylaws', 'By-laws'],
        ['phone', 'Contact numbers'],
        ['email', 'Email'],
      ];
      for (var n = 1; n <= 5; n++) {
        cols.push(['p' + n + '_name', 'Party ' + n + ' name']);
        cols.push(['p' + n + '_shares', 'Party ' + n + ' shares %']);
        cols.push(['p' + n + '_roles', 'Party ' + n + ' role(s)']);
        cols.push(['p' + n + '_address', 'Party ' + n + ' address']);
        cols.push(['p' + n + '_id_url', 'Party ' + n + ' ID']);
      }
      cols.push(['shares_total', 'Shares total %']);
      cols.push(['plan_name', 'Sign-up plan']);
      cols.push(['folder_url', 'Upload folder']);
      return cols;
    })(),
  },
};

function doPost(e) {
  var props = PropertiesService.getScriptProperties();
  var data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply_({ ok: false, code: 'BAD_JSON' });
  }
  if (!secretMatches_(String(data.secret || ''), String(props.getProperty('SHARED_SECRET') || ''))) {
    return reply_({ ok: false, code: 'FORBIDDEN' });
  }
  if (data.kind === 'status') return reply_(status_(data));
  var form = FORMS[data.kind || 'business_name'];
  if (!form) return reply_({ ok: false, code: 'BAD_KIND' });
  var record = data.record || {};
  if (!/^[0-9A-F]{10}$/.test(String(record.ref || ''))) return reply_({ ok: false, code: 'BAD_REF' });

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var root = DriveApp.getFolderById(props.getProperty('FOLDER_ID'));
    var folder = root.createFolder((record.ref + ' - ' + String(record[form.nameKey] || '')).slice(0, 100));
    var urls = {};
    (data.files || []).forEach(function (f) {
      if (form.files.indexOf(f.field) === -1) return;
      if (['application/pdf', 'image/jpeg', 'image/png'].indexOf(f.mime) === -1) return;
      var blob = Utilities.newBlob(Utilities.base64Decode(f.base64), f.mime, String(f.name).slice(0, 120));
      urls[f.field + '_url'] = folder.createFile(blob).getUrl();
    });

    var sheet = sheet_(form);
    sheet.appendRow(form.columns.map(function (c) {
      var key = c[0];
      if (key === 'status') return 'New';
      if (key === 'folder_url') return folder.getUrl();
      if (/_url$/.test(key)) return urls[key] || '';
      return safe_(record[key]);
    }));

    var notify = props.getProperty('NOTIFY_EMAIL');
    if (notify) {
      MailApp.sendEmail({
        to: notify,
        subject: 'New ' + form.title + ' application ' + record.ref,
        body:
          'A new ' + form.title + ' application has arrived.\n\n' +
          'Reference: ' + record.ref + '\n' +
          'Name: ' + String(record[form.nameKey] || '') + '\n' +
          'Sign-up plan: ' + String(record.plan_name || '') + '\n\n' +
          'Open the sheet ("' + form.sheet + '" tab) to see the details and documents:\n' +
          SpreadsheetApp.getActiveSpreadsheet().getUrl() + '\n\n' +
          'ID and TIN numbers are deliberately left out of this email.',
      });
    }
    return reply_({ ok: true });
  } catch (err) {
    console.error('store failed ' + record.ref + ': ' + err);
    return reply_({ ok: false, code: 'STORE_FAILED' });
  } finally {
    lock.releaseLock();
  }
}

/** Is this reference in the sheet yet? Used by the website when saving the
 *  documents took longer than it could wait. The row is added only after every
 *  file is saved, so "found" means the whole application is stored. */
function status_(data) {
  var form = FORMS[data.form];
  var ref = String(data.ref || '');
  if (!form || !/^[0-9A-F]{10}$/.test(ref)) return { ok: false, code: 'BAD_REQUEST' };
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(form.sheet);
  if (!sheet || sheet.getLastRow() < 2) return { ok: true, found: false };
  var hit = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).createTextFinder(ref).matchEntireCell(true).findNext();
  return { ok: true, found: Boolean(hit) };
}

/** Visiting the URL in a browser shows nothing useful. */
function doGet() {
  return reply_({ ok: false, code: 'POST_ONLY' });
}

function sheet_(form) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(form.sheet) || ss.insertSheet(form.sheet);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(form.columns.map(function (c) { return c[1]; }));
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, form.columns.length).setFontWeight('bold');
  }
  return sheet;
}

/** Store as plain text: stop formulas from running, and keep leading zeros
 *  on ID, TIN and phone numbers (Sheets would otherwise turn them into numbers). */
function safe_(v) {
  if (typeof v === 'number') return v;
  var s = v === undefined || v === null ? '' : String(v);
  return /^[=+\-@]/.test(s) || /^[0-9][0-9 ]*$/.test(s) ? "'" + s : s;
}

/** Compare without stopping at the first different character. */
function secretMatches_(a, b) {
  if (!b || b.length < 32 || a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Run once from the editor to create both tabs and grant permissions. */
function setup() {
  sheet_(FORMS.business_name);
  sheet_(FORMS.company);
  var id = PropertiesService.getScriptProperties().getProperty('FOLDER_ID');
  if (!id) throw new Error('Set the FOLDER_ID script property first.');
  DriveApp.getFolderById(id).getName();
  console.log('Ready.');
}
