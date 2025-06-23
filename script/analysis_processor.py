#!/usr/bin/env python3
"""
獨立的檔案分析處理器
功能：讀取cytoscape-elements.json，從GitHub獲取檔案內容，使用OpenAI API進行摘要和Docker關係分析
支援從網路獲取或克隆倉庫到本地兩種模式
"""

import json
import os
import time
import signal
import sys
import shutil
import subprocess
from typing import Dict, List, Optional, Any
from pathlib import Path
import asyncio
import aiohttp
from dataclasses import dataclass
from tqdm import tqdm
import openai
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import PydanticOutputParser
from pydantic import BaseModel, Field


# 設定中斷處理
class GracefulKiller:
    kill_now = False

    def __init__(self):
        signal.signal(signal.SIGINT, self._exit_gracefully)
        signal.signal(signal.SIGTERM, self._exit_gracefully)

    def _exit_gracefully(self, *args):
        self.kill_now = True
        print("\n🛑 收到中斷信號，正在安全退出...")


@dataclass
class DockerAPI:
    apiType: str
    description: str
    line: Optional[int] = None
    codeSnippet: Optional[str] = None


class DockerAnalysisResult(BaseModel):
    """Docker 分析結果的結構化輸出"""
    hasDockerIntegration: bool = Field(description="是否有Docker整合")
    dockerApis: List[dict] = Field(description="Docker API 列表", default_factory=list)
    dockerTools: List[str] = Field(description="Docker 工具列表", default_factory=list)
    summary: str = Field(description="檔案摘要")
    fileType: str = Field(description="檔案類型")
    keyFunctions: List[str] = Field(description="主要功能", default_factory=list)


class AnalysisProcessor:
    def __init__(
        self,
        openai_api_key: str,
        github_repo: str,
        github_token: Optional[str] = None,
        cache_dir: str = ".",
        use_local_clone: bool = False,
        clone_dir: str = "temp_repo_clone",
        branch: str = "main"
    ):
        self.openai_api_key = openai_api_key
        self.github_repo = github_repo
        self.github_token = github_token
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(exist_ok=True)

        # 新增參數
        self.use_local_clone = use_local_clone
        self.clone_dir = Path(clone_dir)
        self.branch = branch
        self.cloned_successfully = False

        # 初始化 OpenAI 和 LangChain
        self.llm = ChatOpenAI(
            api_key=openai_api_key,
            model="gpt-4o",
            temperature=0.1
        )

        # 設定輸出解析器
        self.output_parser = PydanticOutputParser(pydantic_object=DockerAnalysisResult)

        # 創建提示模板
        self.prompt = ChatPromptTemplate.from_messages([
            ("system", """你是一個專業的程式碼分析師。請仔細分析給定的程式碼檔案，提供以下資訊：

1. 檔案摘要：用繁體中文簡要描述檔案的主要功能和用途，用一段文字描述給開發者參考
2. Docker 整合分析：
   - 檢測是否使用了 Docker API 或相關技術
   - 識別 Docker 相關功能，如容器管理、映像檔操作、網路配置等
   - 分析使用的 Docker 工具或套件
   - 評估 Docker 整合的重要性和複雜度
3. 檔案類型分類（如：component, api, utility, config, service 等）
4. 主要功能列表

請特別注意以下 Docker 相關關鍵字：
- Docker API 調用
- 容器操作（create, start, stop, remove）
- 映像檔操作（build, pull, push）
- Docker Compose
- Dockerfile 相關
- 容器編排
- Docker 網路和存儲

{format_instructions}

請用繁體中文回答，摘要部分要詳細且實用。"""),
            ("user", """檔案位置：{file_path}

檔案內容：
```
{file_content}
```

請分析這個檔案並提供結構化的分析結果。""")
        ])

        # 緩存檔案路徑
        self.summaries_cache = self.cache_dir / "summaries.json"
        self.docker_analysis_cache = self.cache_dir / "docker-analysis.json"
        self.combined_cache = self.cache_dir / "combined-analysis.json"

        # 載入現有緩存
        self.summaries = self._load_cache(self.summaries_cache)
        self.docker_analysis = self._load_cache(self.docker_analysis_cache)
        self.combined_analysis = self._load_cache(self.combined_cache)

        # 中斷處理
        self.killer = GracefulKiller()

    def _load_cache(self, cache_file: Path) -> Dict[str, Any]:
        """載入緩存檔案"""
        try:
            if cache_file.exists():
                with open(cache_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
        except Exception as e:
            print(f"⚠️ 載入緩存失敗 {cache_file}: {e}")
        return {}

    def _save_cache(self, cache_file: Path, data: Dict[str, Any]):
        """保存緩存檔案"""
        try:
            with open(cache_file, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"❌ 保存緩存失敗 {cache_file}: {e}")

    def _clone_repository(self) -> bool:
        """克隆 GitHub 倉庫到本地"""
        try:
            if self.clone_dir.exists():
                print(f"🗑️ 刪除現有的克隆目錄: {self.clone_dir}")
                shutil.rmtree(self.clone_dir)

            github_url = f"https://github.com/{self.github_repo}.git"
            print(f"📦 正在克隆倉庫: {github_url}")
            print(f"🌿 分支: {self.branch}")

            # 使用 git clone 命令
            result = subprocess.run([
                "git", "clone", "-b", self.branch, "--depth", "1",
                github_url, str(self.clone_dir)
            ], capture_output=True, text=True)

            if result.returncode == 0:
                print(f"✅ 倉庫克隆成功到: {self.clone_dir}")
                self.cloned_successfully = True
                return True
            else:
                print(f"❌ 克隆失敗: {result.stderr}")

                # 嘗試其他常見分支名稱
                alternative_branches = ["master", "develop", "dev"]
                if self.branch == "main":
                    alternative_branches.insert(0, "master")
                elif self.branch == "master":
                    alternative_branches.insert(0, "main")

                for alt_branch in alternative_branches:
                    if alt_branch == self.branch:
                        continue

                    print(f"🔄 嘗試分支: {alt_branch}")
                    result = subprocess.run([
                        "git", "clone", "-b", alt_branch, "--depth", "1",
                        github_url, str(self.clone_dir)
                    ], capture_output=True, text=True)

                    if result.returncode == 0:
                        print(f"✅ 使用分支 {alt_branch} 克隆成功")
                        self.branch = alt_branch
                        self.cloned_successfully = True
                        return True

                return False

        except Exception as e:
            print(f"❌ 克隆倉庫時發生錯誤: {e}")
            return False

    def _read_local_file(self, file_path: str) -> Optional[str]:
        """從本地克隆的倉庫讀取檔案，智慧地嘗試不同的路徑"""
        try:
            # 嘗試的路徑順序
            possible_paths = [
                file_path,  # 原始路徑
                f"src/{file_path}",  # 加上 src/ 前綴
                f"./{file_path}",  # 加上 ./ 前綴
            ]

            for attempt_path in possible_paths:
                local_file_path = self.clone_dir / attempt_path
                if local_file_path.exists():
                    with open(local_file_path, 'r', encoding='utf-8') as f:
                        content = f.read()
                    print(f"📂 從本地讀取檔案：{attempt_path} (原路徑: {file_path})")
                    return content

            print(f"⚠️ 本地檔案不存在，已嘗試路徑: {possible_paths}")
            return None

        except Exception as e:
            print(f"❌ 讀取本地檔案失敗 {file_path}: {e}")
            return None

    async def _fetch_github_file(self, session: aiohttp.ClientSession, file_path: str) -> Optional[str]:
        """從 GitHub 獲取檔案內容（優先使用 Raw API，更快且無需認證）"""

        # 如果使用本地克隆模式
        if self.use_local_clone:
            if self.cloned_successfully:
                return self._read_local_file(file_path)
            else:
                print(f"❌ 倉庫未成功克隆，無法讀取檔案: {file_path}")
                return None

        # 網路模式 - 智慧路徑嘗試
        try:
            # 嘗試不同的分支
            branches_to_try = [self.branch]
            if self.branch == "main":
                branches_to_try.append("master")
            elif self.branch == "master":
                branches_to_try.append("main")

            # 嘗試不同的路徑前綴
            path_variants = [
                file_path,  # 原始路徑
                f"src/{file_path}",  # 加上 src/ 前綴
                f"./{file_path}",  # 加上 ./ 前綴
            ]

            for branch in branches_to_try:
                for attempt_path in path_variants:
                    # 優先使用 GitHub Raw API
                    raw_url = f"https://raw.githubusercontent.com/{self.github_repo}/{branch}/{attempt_path}"
                    async with session.get(raw_url) as response:
                        if response.status == 200:
                            content = await response.text()
                            print(f"📥 從 GitHub Raw ({branch}) 獲取檔案：{attempt_path} (原路徑: {file_path})")
                            return content
                        elif response.status == 404:
                            continue  # 嘗試下一個路徑/分支
                        else:
                            print(f"❌ GitHub Raw API 錯誤 {response.status} ({branch}): {attempt_path}")

            # 如果 Raw API 都失敗，嘗試使用 GitHub API
            for branch in branches_to_try:
                for attempt_path in path_variants:
                    api_url = f"https://api.github.com/repos/{self.github_repo}/contents/{attempt_path}?ref={branch}"
                    headers = {}
                    if self.github_token:
                        headers["Authorization"] = f"token {self.github_token}"

                    async with session.get(api_url, headers=headers) as response:
                        if response.status == 200:
                            data = await response.json()
                            if data.get("type") == "file" and data.get("content"):
                                import base64
                                content = base64.b64decode(data["content"]).decode('utf-8')
                                print(f"📥 從 GitHub API ({branch}) 獲取檔案：{attempt_path} (原路徑: {file_path})")
                                return content
                        elif response.status == 404:
                            continue  # 嘗試下一個路徑/分支
                        else:
                            print(f"❌ GitHub API 錯誤 {response.status} ({branch}): {attempt_path}")

            print(f"⚠️ 所有分支和路徑都找不到檔案: {file_path}")

        except Exception as e:
            print(f"❌ 獲取檔案失敗 {file_path}: {e}")
        return None

    async def _analyze_file(self, file_path: str, file_content: str) -> Optional[DockerAnalysisResult]:
        """使用 OpenAI 分析檔案"""
        try:
            # 準備提示
            formatted_prompt = self.prompt.format_messages(
                format_instructions=self.output_parser.get_format_instructions(),
                file_path=file_path,
                file_content=file_content[:8000]  # 限制內容長度避免超出 token 限制
            )

            # 調用 LLM
            response = await self.llm.ainvoke(formatted_prompt)

            # 解析結果
            try:
                result = self.output_parser.parse(response.content)
                if isinstance(result, DockerAnalysisResult):
                    return result
                else:
                    print(f"⚠️ 解析結果不是 DockerAnalysisResult 類型 {file_path}: {type(result)}")
                    return None
            except Exception as parse_error:
                print(f"⚠️ 解析 LLM 回應失敗 {file_path}: {parse_error}")
                print(f"原始回應內容: {response.content[:500]}...")

                # 嘗試創建一個基本的分析結果
                try:
                    basic_result = DockerAnalysisResult(
                        hasDockerIntegration=False,
                        dockerApis=[],
                        dockerTools=[],
                        summary=f"無法完整分析檔案 {file_path}，但已成功讀取內容。",
                        fileType="unknown",
                        keyFunctions=[]
                    )
                    return basic_result
                except Exception as fallback_error:
                    print(f"❌ 創建備用分析結果失敗 {file_path}: {fallback_error}")
                    return None

        except Exception as e:
            print(f"❌ 分析檔案失敗 {file_path}: {e}")
            return None

    def _load_cytoscape_elements(self, file_path: str = "./cytoscape-elements.json") -> List[str]:
        """載入 cytoscape-elements.json 並提取檔案路徑"""
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                elements = json.load(f)

            file_paths = []
            for element in elements:
                if "data" in element and "id" in element["data"]:
                    element_id = element["data"]["id"]
                    # 只處理檔案節點，跳過連線
                    if "source" not in element["data"] and "target" not in element["data"]:
                        file_paths.append(element_id)

            print(f"📁 找到 {len(file_paths)} 個檔案需要分析")
            return file_paths

        except Exception as e:
            print(f"❌ 載入 cytoscape-elements.json 失敗: {e}")
            return []

    def cleanup(self):
        """清理臨時檔案"""
        if self.use_local_clone and self.clone_dir.exists():
            try:
                print(f"🧹 清理克隆目錄: {self.clone_dir}")
                shutil.rmtree(self.clone_dir)
            except Exception as e:
                print(f"⚠️ 清理克隆目錄失敗: {e}")

    async def process_files(self, cytoscape_file: str = "./cytoscape-elements.json"):
        """處理所有檔案"""
        print("🚀 開始檔案分析處理...")
        print(f"📦 GitHub 倉庫: {self.github_repo}")
        print(f"🌿 分支: {self.branch}")
        print(f"🔧 模式: {'本地克隆' if self.use_local_clone else '網路獲取'}")

        # 如果使用本地克隆模式，先克隆倉庫
        if self.use_local_clone:
            if not self._clone_repository():
                print("❌ 無法克隆倉庫，請檢查倉庫名稱和網路連線")
                return

        try:
            # 載入要處理的檔案列表
            file_paths = self._load_cytoscape_elements(cytoscape_file)
            if not file_paths:
                print("❌ 沒有找到要處理的檔案")
                return

            # 過濾已處理的檔案
            pending_files = [f for f in file_paths if f not in self.combined_analysis]

            if not pending_files:
                print("✅ 所有檔案都已分析完成")
                return

            print(f"📋 待處理檔案: {len(pending_files)} 個")

            # 創建進度條
            progress_bar = tqdm(
                total=len(pending_files),
                desc="分析進度",
                unit="files",
                ncols=100
            )

            # 創建 HTTP 會話（網路模式才需要）
            if not self.use_local_clone:
                timeout = aiohttp.ClientTimeout(total=30)
                async with aiohttp.ClientSession(timeout=timeout) as session:
                    await self._process_files_with_session(session, pending_files, progress_bar)
            else:
                await self._process_files_with_session(None, pending_files, progress_bar)

            progress_bar.close()

            # 最終保存
            self._save_all_caches()

            print(f"\n✅ 分析完成！已處理 {len(self.combined_analysis)} 個檔案")
            self._print_statistics()

        finally:
            # 清理
            if self.use_local_clone:
                self.cleanup()

    async def _process_files_with_session(self, session: Optional[aiohttp.ClientSession], pending_files: List[str], progress_bar):
        """使用指定的會話處理檔案"""
        for i, file_path in enumerate(pending_files):
            # 檢查中斷信號
            if self.killer.kill_now:
                print("\n🛑 收到中斷信號，正在保存進度...")
                break

            progress_bar.set_description(f"處理: {file_path}")

            try:
                # 獲取檔案內容
                if self.use_local_clone:
                    file_content = self._read_local_file(file_path)
                else:
                    file_content = await self._fetch_github_file(session, file_path)

                if not file_content:
                    progress_bar.update(1)
                    continue

                # 分析檔案
                analysis_result = await self._analyze_file(file_path, file_content)
                if analysis_result:
                    try:
                        # 確保是 DockerAnalysisResult 的實例
                        if isinstance(analysis_result, DockerAnalysisResult):
                            # 保存到合併的分析結果 - 使用 Pydantic 的 model_dump 方法
                            self.combined_analysis[file_path] = analysis_result.model_dump()

                            # 同時更新舊的分離緩存（向後兼容）
                            self.summaries[file_path] = analysis_result.summary

                            docker_analysis = {
                                "hasDockerIntegration": analysis_result.hasDockerIntegration,
                                "dockerApis": analysis_result.dockerApis,
                                "dockerTools": analysis_result.dockerTools,
                                "summary": analysis_result.summary
                            }
                            self.docker_analysis[file_path] = docker_analysis
                        else:
                            print(f"⚠️ 分析結果類型錯誤 {file_path}: {type(analysis_result)}")
                    except Exception as e:
                        print(f"⚠️ 保存分析結果失敗 {file_path}: {e}")
                        # 如果無法轉換，直接保存原始結果
                        self.combined_analysis[file_path] = str(analysis_result)

                # 每 5 個檔案保存一次
                if (i + 1) % 5 == 0:
                    self._save_all_caches()

                progress_bar.update(1)

                # 避免 API 限制
                if not self.use_local_clone:
                    await asyncio.sleep(0.5)

            except Exception as e:
                print(f"\n❌ 處理檔案失敗 {file_path}: {e}")
                progress_bar.update(1)
                continue

    def _save_all_caches(self):
        """保存所有緩存"""
        self._save_cache(self.combined_cache, self.combined_analysis)
        self._save_cache(self.summaries_cache, self.summaries)
        self._save_cache(self.docker_analysis_cache, self.docker_analysis)

    def _print_statistics(self):
        """打印統計資訊"""
        total_files = len(self.combined_analysis)
        docker_files = sum(1 for analysis in self.combined_analysis.values()
                           if analysis.get("hasDockerIntegration", False))

        print(f"\n📊 分析統計:")
        print(f"   總檔案數: {total_files}")
        print(f"   Docker 整合檔案: {docker_files}")
        print(f"   Docker 整合比例: {docker_files / total_files * 100:.1f}%" if total_files > 0 else "")

        # 檔案類型統計
        file_types = {}
        for analysis in self.combined_analysis.values():
            file_type = analysis.get("fileType", "unknown")
            file_types[file_type] = file_types.get(file_type, 0) + 1

        print(f"\n📋 檔案類型分佈:")
        for file_type, count in sorted(file_types.items(), key=lambda x: x[1], reverse=True):
            print(f"   {file_type}: {count}")


def main():
    """主函數"""
    # 從環境變數獲取配置
    openai_api_key = os.getenv("OPENAI_API_KEY")
    github_repo = os.getenv("GITHUB_REPO", "YC815/ai-web-ide")  # 預設為指定倉庫
    github_token = os.getenv("GITHUB_TOKEN")  # 可選的 GitHub token
    branch = os.getenv("GITHUB_BRANCH", "main")  # 預設分支
    use_local_clone = os.getenv("USE_LOCAL_CLONE", "false").lower() == "true"  # 是否使用本地克隆

    if not openai_api_key:
        print("❌ 錯誤: 請設定 OPENAI_API_KEY 環境變數")
        sys.exit(1)

    print(f"🔑 使用 GitHub 倉庫: {github_repo}")
    print(f"🌿 使用分支: {branch}")
    print(f"🔧 使用模式: {'本地克隆' if use_local_clone else '網路獲取'}")

    if github_token:
        print("🔐 使用 GitHub Token 進行認證")
    else:
        print("📖 使用公開倉庫，無 GitHub Token")

    # 創建處理器
    processor = AnalysisProcessor(
        openai_api_key=openai_api_key,
        github_repo=github_repo,
        github_token=github_token,
        use_local_clone=use_local_clone,
        branch=branch
    )

    # 執行處理
    try:
        asyncio.run(processor.process_files())
    except KeyboardInterrupt:
        print("\n🛑 程序被用戶中斷")
        if use_local_clone:
            processor.cleanup()
    except Exception as e:
        print(f"\n❌ 程序執行失敗: {e}")
        if use_local_clone:
            processor.cleanup()
        sys.exit(1)


if __name__ == "__main__":
    main()
