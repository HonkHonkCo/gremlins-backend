import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// .env рядом с package.json (на уровень выше от src/)
dotenv.config({ path: path.join(__dirname, '..', '.env') });
