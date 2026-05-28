const apiLogger = (req, res, next) => {
  const start = Date.now();

  console.log(
    `➡️  ${req.method} ${req.originalUrl} | IP: ${req.ip} | Time: ${new Date().toLocaleString()}`
  );

  // After response is sent
  res.on("finish", () => {
    const duration = Date.now() - start;

    console.log(
      `⬅️  ${req.method} ${req.originalUrl} | Status: ${res.statusCode} | ${duration}ms`
    );
  });

  next();
};

export default apiLogger;