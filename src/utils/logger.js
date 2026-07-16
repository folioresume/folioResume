const apiLogger = (req, res, next) => {
  const start = Date.now();
  console.log(`➡️  ${req.method} ${req.originalUrl} | IP: ${req.ip} | ${new Date().toLocaleString()}`);
  res.on("finish", () => {
    console.log(`⬅️  ${req.method} ${req.originalUrl} | ${res.statusCode} | ${Date.now() - start}ms`);
  });
  next();
};

export default apiLogger;
