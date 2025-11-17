const { google } = require('googleapis');
const SftpClient = require('ssh2-sftp-client');

function makeCsv(rows) {
  return rows
    .map(r =>
      r
        .map(v => {
          const s = v ?? '';
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(',')
    )
    .join('\n');
}

/**
 * Vercel serverless function
 * @param {import('@vercel/node').VercelRequest} req
 * @param {import('@vercel/node').VercelResponse} res
 */
module.exports = async (req, res) => {
  try {
    const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    const sheetId = process.env.GOOGLE_SHEETS_ID;

    const host = process.env.SUMMIT_SFTP_HOST;
    const port = Number(process.env.SUMMIT_SFTP_PORT || '22');
    const username = process.env.SUMMIT_SFTP_USERNAME;
    const password = process.env.SUMMIT_SFTP_PASSWORD;
    const remotePath =
      process.env.SUMMIT_SFTP_REMOTE_PATH || '/ar2/armadillo_inventory.csv';

    if (!saJson || !sheetId) {
      throw new Error(
        'Missing Google env vars (GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SHEETS_ID)'
      );
    }

    const creds = JSON.parse(saJson);

    // 🔑 Use GoogleAuth with service account credentials
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const client = await auth.getClient();

    const sheets = google.sheets({ version: 'v4', auth: client });

    // Read "Summit Feed"!A1:C
    const range = `'Summit Feed'!A1:C`;
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range,
    });

    const values = resp.data.values || [];
    if (!values.length) {
      throw new Error('No data in Summit Feed sheet');
    }

    // If SFTP env missing, report that but confirm Google is working
    if (!host || !username || !password) {
      return res.status(200).json({
        ok: false,
        stage: 'google-ok',
        rows: values.length - 1,
        error: 'SFTP env vars missing (host/username/password)',
      });
    }

    const csv = makeCsv(values);

    const sftp = new SftpClient();
    await sftp.connect({ host, port, username, password });
    await sftp.put(Buffer.from(csv, 'utf8'), remotePath);
    await sftp.end();

    return res.status(200).json({
      ok: true,
      stage: 'upload-complete',
      rows: values.length - 1,
      remotePath,
    });
  } catch (err) {
    console.error('summit-upload error', err);
    return res.status(500).json({
      ok: false,
      error: err && err.message ? err.message : String(err),
    });
  }
};
