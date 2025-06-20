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
    
    // 計算統計資訊
    const stats = {
      totalAnalyzedFiles: Object.keys(dockerAnalysis).length,
      dockerIntegrationCount: 0,
      dockerTypes: {
        api: 0,
        tool: 0,
        config: 0,
        service: 0
      }
    };

    // 分析每個檔案的 Docker 整合情況
    Object.values(dockerAnalysis).forEach((analysis: DockerAnalysisResult) => {
      if (analysis.hasDockerIntegration) {
        stats.dockerIntegrationCount++;
        
        // 統計不同類型的 Docker API 使用
        analysis.dockerApis?.forEach((api) => {
          const apiType = api.apiType as keyof typeof stats.dockerTypes;
          if (stats.dockerTypes[apiType] !== undefined) {
            stats.dockerTypes[apiType]++;
          }
        });
      }
    });

    return NextResponse.json(stats);
  } catch (error) {
    console.error('Error generating analysis stats:', error);
    return NextResponse.json({
      totalAnalyzedFiles: 0,
      dockerIntegrationCount: 0,
      dockerTypes: { api: 0, tool: 0, config: 0, service: 0 }
    }, { status: 200 });
  }
} 