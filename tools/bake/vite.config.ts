import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defineConfig } from 'vite';
import { SPRITE_INDEX, writeSpriteIndex } from '../spriteIndex';

const ASSETS = path.resolve(import.meta.dirname, '../../public/assets');

/** 精灵烘焙页面的开发服务器，收到图片后写进 public/assets/sprites。 */
export default defineConfig({
  root: import.meta.dirname,
  publicDir: path.resolve(import.meta.dirname, '../../assets-src/models'),
  server: { port: 5180, strictPort: true },
  plugins: [
    {
      name: 'save-baked-sprites',
      configureServer(server) {
        server.middlewares.use('/save', (request, response) => {
          const query = new URL(request.url ?? '', 'http://bake').searchParams;
          const name = path.basename(query.get('name') ?? '');
          const output = path.join(ASSETS, path.basename(query.get('dir') ?? 'sprites'));
          const chunks: Buffer[] = [];
          request.on('data', (chunk: Buffer) => chunks.push(chunk));
          request.on('end', async () => {
            await mkdir(output, { recursive: true });
            await writeFile(path.join(output, name), Buffer.concat(chunks));
            if (name.endsWith('.json') && name !== SPRITE_INDEX && output.endsWith('sprites')) writeSpriteIndex(output);
            response.end('ok');
          });
        });
      },
    },
  ],
});
