import multer from "multer";

export function multerErrorHandler(error, req, res, next) {
  if (error.message === "Origin is not allowed by CORS.") {
    return res.status(403).json({ error: "Origin is not allowed." });
  }
  if (
    error instanceof multer.MulterError ||
    error.message?.includes("PDF") ||
    error.message?.includes("image")
  ) {
    return res.status(400).json({ error: error.message });
  }
  next(error);
}

export function globalErrorHandler(error, req, res, next) {
  console.error(error);
  res.status(500).json({ error: "Unexpected backend error." });
}
