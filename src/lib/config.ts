// API 配置
export const API_CONFIG = {
  // 動態獲取 API 基礎 URL
  getApiBaseUrl: () => {
    // 如果有設定環境變數，優先使用
    if (process.env.NEXT_PUBLIC_API_URL) {
      return process.env.NEXT_PUBLIC_API_URL;
    }
    
    // 使用 Next.js 內建的 API 路由
    if (typeof window !== 'undefined') {
      // 瀏覽器環境：使用當前域名和端口
      const protocol = window.location.protocol;
      const host = window.location.host;
      return `${protocol}//${host}`;
    }
    
    // 伺服器端渲染時的預設值
    return 'http://localhost:3000';
  },
  
  // 獲取完整的 API 端點 URL
  getApiUrl: (endpoint: string) => {
    const baseUrl = API_CONFIG.getApiBaseUrl();
    return `${baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
  }
};

// 常用的 API 端點
export const API_ENDPOINTS = {
  SUMMARIES: '/api/summaries',
  DOCKER_ANALYSIS: '/api/docker-analysis', 
  ANALYSIS_STATS: '/api/analysis-stats'
} as const; 