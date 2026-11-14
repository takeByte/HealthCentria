import mongoose from 'mongoose';

export async function connectDB(uri) {
  if (!uri) throw new Error('MONGODB_URI is missing');
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri);
  // Uptime makes a slow handshake visible in the log instead of guesswork.
  console.log(
    `MongoDB connected: ${mongoose.connection.host} (${(process.uptime() * 1000).toFixed(0)} ms after start)`,
  );
}

export async function disconnectDB() {
  await mongoose.disconnect();
}
