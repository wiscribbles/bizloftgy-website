# Connecting the application forms to Google Sheets

Both forms on `/business-registration/` send each application to one private Google Sheet:

- **Business Registration package** documents go to the **Business registrations** tab.
- **Company incorporation** goes to the **Company incorporations** tab.

Uploaded IDs and TIN certificates go to a private Google Drive folder, one sub-folder per application. Nothing is stored on the website itself.

```
Browser ──HTTPS──▶ Netlify functions /api/registration and /api/incorporation ──HTTPS + secret──▶ Apps Script web app ──▶ Sheet row + Drive files
```

The browser never sees the Google address or the secret. Both live only in Netlify's environment variables and in the script.

## One-time setup (about 15 minutes)

Use the Google account you'll keep the records in. Before you start, turn on **2-Step Verification** for that account (myaccount.google.com → Security). Anyone who gets into that account can see every application.

1. **Make the upload folder.**
   - In Google Drive, create a folder called `Business registrations – uploads`.
   - Don't share it with anyone.
   - Open it and copy the long ID at the end of the address bar, after `/folders/`.
2. **Make the sheet.**
   - Create a new Google Sheet called `The Business Loft – Applications`.
   - Don't share it with anyone.
3. **Add the script.**
   - In the sheet, open **Extensions → Apps Script**.
   - Delete what's there, and paste in the whole of `Code.gs` from this folder.
   - Save.
4. **Set the script properties.** Open **Project Settings** (gear icon) → **Script properties** → **Add script property**:
   - `SHARED_SECRET`: a long random value, at least 32 characters. Generate one at 1password.com/password-generator with 40 characters, letters and numbers only. Keep a copy for step 7.
   - `FOLDER_ID`: the folder ID from step 1.
   - `NOTIFY_EMAIL`: `support@bizloftgy.com`. Optional: it sends a short notice for each new application, with no ID or TIN numbers in it.
5. **Grant permissions.**
   - Back in the editor, choose the `setup` function in the toolbar and press **Run**.
   - Google asks you to authorise Drive, Sheets and email access. Accept.
   - The sheet now has **Business registrations** and **Company incorporations** tabs with headings.
6. **Deploy.**
   - Go to **Deploy → New deployment**, then the gear icon → **Web app**.
   - Set *Execute as*: **Me**. Set *Who has access*: **Anyone**.
   - Press **Deploy** and copy the **Web app URL**. It ends in `/exec`.
   - *Anyone* is needed so our server can reach the script. The secret is what keeps everyone else out.
7. **Tell Netlify.**
   - Go to **Site configuration → Environment variables** and add:
     - `GOOGLE_SCRIPT_URL`: the Web app URL from step 6.
     - `GOOGLE_SCRIPT_SECRET`: the same value as `SHARED_SECRET`.
   - Then redeploy the site: **Deploys → Trigger deploy**.
8. **Test.**
   - Submit the business form once with test details and two small images.
   - Submit the company form once too.
   - Check that a row appears in each tab and a sub-folder in Drive for each.
   - Delete the test row and folder.

Until steps 6 and 7 are done, the form tells applicants to WhatsApp or email instead, and nothing is lost.

## If you change the script later

Use **Deploy → Manage deployments → Edit → New version**. This keeps the same URL. A *new deployment* gives a new URL, which would then need updating in Netlify.

## What protects the data

- **Where it lives:** in your Google account only. The website keeps no copy.
- **Who can send applications:** only our server. The script refuses any request without the secret, and the secret never reaches the browser.
- **Checks on the website's server:**
  - posts must come from our own site
  - every field is checked
  - uploads must really be PDF, JPG or PNG files (checked from the file contents, not the name), at most 2 MB each
  - each connection can send five applications an hour
- **Spreadsheet safety:** text that starts like a formula (`=`, `+`, `-`, `@`) is stored as plain text, so it can't run in the sheet.
- **The notice email:** carries only the reference, business name and plan.

What it does **not** protect against: someone getting into your Google account, or the sheet or folder being shared by mistake. Keep 2-Step Verification on, never use "Anyone with the link", and give staff their own Google accounts with access to the sheet rather than your password.

## Changing the columns

The script writes the heading row only when a tab is empty. If you created a tab before its columns changed (for example the Business registrations tab before 15 October 2026), delete that tab, or clear it, and run `setup` again, so the headings match the new columns.
