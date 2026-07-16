import mongoose from "mongoose";
import app from "./app.js";
import { MONGODB_URI, PORT } from "./src/config/env.js";
import Resume from "./src/models/Resume.js";

async function runMigrations() {
  const col = mongoose.connection.db.collection("resumes");

  try {
    const indexes = await col.indexes();
    if (indexes.find((i) => i.name === "handle_1")) {
      await col.dropIndex("handle_1");
      console.log("Migration: dropped legacy handle_1 index.");
    }
    const { modifiedCount } = await col.updateMany({ handle: null }, { $unset: { handle: "" } });
    if (modifiedCount > 0) {
      console.log(`Migration: cleared null handle from ${modifiedCount} resume(s).`);
    }
  } catch (err) {
    console.warn("Migration: handle index cleanup warning:", err.message);
  }

  await Resume.createIndexes();

  const { modifiedCount } = await Resume.updateMany(
    { status: { $exists: false }, parseStatus: "completed", parsedData: { $ne: null } },
    { $set: { status: "active", paymentStatus: "paid" } },
  );
  if (modifiedCount > 0) {
    console.log(`Migration: activated ${modifiedCount} pre-existing portfolio(s).`);
  }
}

async function startServer() {
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  console.log("Connected to MongoDB");
  await runMigrations();
  app.listen(PORT, () => {
    console.log(`Resume parser API running at http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Server failed to start:", error.message || error);
  process.exit(1);
});
