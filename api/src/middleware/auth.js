export function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key || key !== process.env.API_KEY) {
    return res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Missing or invalid API key', field: null }
    });
  }
  next();
}
