import { spawn } from 'node:child_process';

/** Starts the built app on a local port and resolves once it answers. */
export async function startServer(port = Number(process.env.E2E_PORT) || 4173) {
  // E2E_DIST serves another build (to test it while another run uses dist/).
  const dir = process.env.E2E_DIST ? ['--outDir', process.env.E2E_DIST] : [];
  const child = spawn('npx', ['vite', 'preview', ...dir, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}/`;
  const deadline = Date.now() + 30000;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) {
      child.kill();
      throw new Error('The preview server did not start.');
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return { url, stop: () => child.kill() };
}
