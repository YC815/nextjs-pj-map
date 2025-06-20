import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const CACHE_DIR = path.join(process.cwd(), '.cache');
const DOCKER_CACHE = path.join(CACHE_DIR, 'docker-analysis.json');

interface DockerAnalysisResult {
  hasDockerIntegration: boolean;
  dockerApis: Array<{
    apiType: string;
    description: string;
    line?: number;
    codeSnippet?: string;
  }>;
  dockerTools: string[];
  summary: string;
}

async function readCache(cacheFile: string): Promise<Record<string, DockerAnalysisResult>> {
  try {
    const content = await fs.readFile(cacheFile, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

export async function GET() {
  try {
    const dockerAnalysis = await readCache(DOCKER_CACHE);
    return NextResponse.json(dockerAnalysis);
  } catch (error) {
    console.error('Error reading docker analysis cache:', error);
    return NextResponse.json({}, { status: 200 }); // 返回空物件而不是錯誤
  }
} 