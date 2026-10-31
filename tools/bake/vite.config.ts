import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defineConfig } from 'vite';

const OUTPUT = path.resolve(import.meta.dirname, '../../public/assets/sprites');

/** 精灵烘焙页面的开发服务器，收到图片后写进 public/assets/sprites。 */
export default defineConfig({
  root: import.meta.dirname,
  server: { port: 5180, strictPort: true },
  plugins: [
    {
      name: 'save-baked-sprites',
      configureServer(server) {
        server.middlewares.use('/save', (request, response) => {
          const name = path.basename(new URL(request.url ?? '', 'http://bake').searchParams.get('name') ?? '');
          const chunks: Buffer[] = [];
          request.on('data', (chunk: Buffer) => chunks.push(chunk));
          request.on('end', async () => {
            await mkdir(OUTPUT, { recursive: true });
            await writeFile(path.join(OUTPUT, name), Buffer.concat(chunks));
            response.end('ok');
          });
        });
      },
    },
  ],
});
