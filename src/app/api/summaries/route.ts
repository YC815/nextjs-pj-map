import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const CACHE_DIR = path.join(process.cwd(), '.cache');
const SUMMARIES_CACHE = path.join(CACHE_DIR, 'summaries.json');

async function readCache(cacheFile: string): Promise<Record<string, string>> {
  try {
    const content = await fs.readFile(cacheFile, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

export async function GET() {
  try {
    const summaries = await readCache(SUMMARIES_CACHE);
    return NextResponse.json(summaries);
  } catch (error) {
    console.error('Error reading summaries cache:', error);
    return NextResponse.json({}, { status: 200 }); // 返回空物件而不是錯誤
  }
} 