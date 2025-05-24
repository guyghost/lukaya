// This file is required for Vercel Node.js runtime to work with TypeScript entrypoints.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { main } from "../main";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  await main();
  res.status(200).send("Trading bot started (see logs for details)");
}
