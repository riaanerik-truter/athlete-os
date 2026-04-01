export function errorHandler(err, req, res, _next) {
  req.log?.error(err);
  const status = err.status ?? 500;
  res.status(status).json({
    error: {
      code: err.code ?? 'INTERNAL_ERROR',
      message: err.message ?? 'Unexpected error',
      field: err.field ?? null
    }
  });
}
