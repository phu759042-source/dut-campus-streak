// Version of the deployment that is live right now. Open pages compare it with the version they started with
// and offer a reload when a newer deployment has gone out (see js/update.js).
module.exports = (req, res) => {
  const v = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_URL || 'unknown';
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.end(JSON.stringify({ v }));
};
